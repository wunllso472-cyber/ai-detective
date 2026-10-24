// 来源工具：URL 规范化、来源分级、文本相似度、同源转载分组。

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|share|scene|chksm|sessionid|isappinstalled)/i.test(k)) u.searchParams.delete(k);
    }
    return (u.protocol + '//' + u.host + u.pathname.replace(/\/$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return String(raw).trim().toLowerCase();
  }
}

export function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// 分级 tier：5 官方  4 权威媒体/学术  3 主流媒体/门户  2 自媒体/社区/百科  1 其他未知
const RULES = [
  { tier: 5, label: '官方', test: (h) => /(^|\.)gov\.cn$|\.gov$|(^|\.)gov\.[a-z]{2}$|who\.int$|un\.org$|npc\.gov\.cn$|court\.gov\.cn$|12377\.cn$|piyao\.org\.cn$/.test(h) },
  { tier: 4, label: '学术', test: (h) => /\.edu\.cn$|\.edu$|\.ac\.cn$|cnki\.net$|wanfangdata\.com\.cn$|nature\.com$|science\.org$|thelancet\.com$|nejm\.org$|nih\.gov$|pubmed|cell\.com$|springer\.com$|sciencedirect\.com$|arxiv\.org$/.test(h) },
  { tier: 4, label: '权威媒体', test: (h) => /(^|\.)news\.cn$|xinhuanet\.com$|people\.com\.cn$|cctv\.com$|cctv\.cn$|cnr\.cn$|chinadaily\.com\.cn$|gmw\.cn$|chinanews\.com(\.cn)?$|ce\.cn$|cyol\.com$|youth\.cn$|china\.com\.cn$|81\.cn$|reuters\.com$|apnews\.com$|bbc\.(com|co\.uk)$|caixin\.com$|thepaper\.cn$|bjnews\.com\.cn$|jiemian\.com$|yicai\.com$|stcn\.com$|cs\.com\.cn$/.test(h) },
  { tier: 2, label: '自媒体/社区', test: (h) => /mp\.weixin\.qq\.com$|baijiahao\.baidu\.com$|zhihu\.com$|weibo\.(com|cn)$|douyin\.com$|xiaohongshu\.com$|bilibili\.com$|toutiao\.com$|tieba\.baidu\.com$|douban\.com$|sohu\.com\/a|kuaishou\.com$|ixigua\.com$|163\.com\/dy|csdn\.net$|jianshu\.com$/.test(h) },
  { tier: 2, label: '百科/问答', test: (h) => /baike\.baidu\.com$|baike\.sogou\.com$|wikipedia\.org$|zhidao\.baidu\.com$|wenwen\.sogou\.com$/.test(h) },
  { tier: 3, label: '主流媒体', test: (h) => /qq\.com$|163\.com$|sina\.com(\.cn)?$|sohu\.com$|ifeng\.com$|36kr\.com$|huxiu\.com$|eastmoney\.com$|cls\.cn$|nbd\.com\.cn$|21jingji\.com$|guancha\.cn$|hexun\.com$|nytimes\.com$|wsj\.com$|ft\.com$|cnn\.com$|theguardian\.com$/.test(h) },
];

export function classifySource({ url, site, authorityLevel }) {
  const h = hostOf(url);
  // 自媒体规则需要看路径（如 sohu.com/a/、163.com/dy/）
  const hp = h + (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  let rule = RULES.find((r) => r.test(h) || (r.tier === 2 && r.test(hp)));
  if (!rule && /政府|人民政府|公安|法院|检察院|卫健委|部$|局$|委员会/.test(site || '')) rule = { tier: 5, label: '官方' };
  let tier = rule ? rule.tier : 1;
  let label = rule ? rule.label : '其他';
  // 旗舰版返回 authority_level（0–5），与规则取较高者
  if (typeof authorityLevel === 'number' && authorityLevel > tier) {
    tier = authorityLevel;
    if (label === '其他') label = authorityLevel >= 4 ? '权威信源' : '一般信源';
  }
  return { tier, tierLabel: label, host: h };
}

export const TIER_WEIGHT = { 5: 3, 4: 2.4, 3: 1.4, 2: 0.6, 1: 0.4, 0: 0.2 };

export function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d) ? null : d;
}

export function fmtDate(d) {
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 用于引用校验的文本归一化：去掉空白和常见标点差异
export function normText(s) {
  return String(s || '')
    .replace(/[\s　]+/g, '')
    .replace(/[“”"「」『』]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/[，,]/g, ',')
    .replace(/[。.]/g, '.')
    .replace(/[：:]/g, ':')
    .replace(/[；;]/g, ';')
    .replace(/[！!]/g, '!')
    .replace(/[？?]/g, '?')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/…+|\.{3,}/g, '…')
    .toLowerCase();
}

/** 引用是否能在原文中逐字找到（允许用省略号拼接的多段，每段都必须存在） */
export function quoteFound(quote, text) {
  const q = normText(quote);
  if (q.length < 4) return false;
  const t = normText(text);
  return q
    .split('…')
    .filter((p) => p.length > 0)
    .every((p) => p.length >= 2 && t.includes(p));
}

function bigrams(s) {
  const t = normText(s).replace(/【模拟】/g, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 把文本高度相似的来源合并为“同源转载”组，返回 [[id,...], ...] */
export function groupBySimilarity(items, textOf, threshold = 0.55) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grams = items.map((x) => textOf(x));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) !== find(j) && similarity(grams[i], grams[j]) >= threshold) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  items.forEach((x, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(x);
  });
  return [...groups.values()];
}
