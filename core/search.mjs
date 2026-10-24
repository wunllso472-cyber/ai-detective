import tencentcloud from 'tencentcloud-sdk-nodejs-wsa';
import { getConfig, isSearchMock } from './config.mjs';
import { cacheGet, cacheSet } from './store.mjs';

// 元宝搜索 SearchPro 适配层：签名交给官方 SDK；这里负责 Pages 二次解析、版本降级、限流重试、缓存和模拟数据。

const WsaClient = tencentcloud.wsa.v20250508.Client;
let client = null;
let detectedVersion = null; // lite / standard / flagship，首次成功调用后得知

function getClient() {
  if (client) return client;
  const c = getConfig().tencent;
  client = new WsaClient({
    credential: { secretId: c.secretId, secretKey: c.secretKey },
    region: '',
    profile: { httpProfile: { endpoint: c.endpoint, reqTimeout: 30 } },
  });
  return client;
}

export function searchStatus() {
  return { mock: isSearchMock(), version: isSearchMock() ? 'mock' : detectedVersion || 'unknown' };
}

// 简单信号量，避免并发过高触发 RequestLimitExceeded
let running = 0;
const waiting = [];
async function withSlot(fn) {
  const max = getConfig().search.concurrency;
  if (running >= max) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePages(pages = []) {
  const out = [];
  for (const p of pages) {
    try {
      const d = typeof p === 'string' ? JSON.parse(p) : p;
      if (!/^https?:\/\//i.test(d?.url || '')) continue; // 只接受 http(s) 链接
      out.push({
        title: d.title || '',
        url: d.url,
        date: d.date || '',
        passage: d.passage || '',
        content: d.content || '',
        site: d.site || '',
        score: typeof d.score === 'number' ? d.score : null,
        authorityLevel: typeof d.authority_level === 'number' ? d.authority_level : null,
        favicon: d.favicon || '',
        pics: Array.isArray(d.pics) ? d.pics.slice(0, 3) : [],
      });
    } catch {
      // 单条解析失败直接跳过
    }
  }
  return out;
}

/**
 * @param {{query:string, mode?:number, cnt?:number, industry?:string, freshness?:string, site?:string}} params
 * @returns {Promise<{query:string, params:object, pages:object[], version:string, requestId?:string, cached?:boolean}>}
 */
export async function search(params) {
  const req = { Query: params.query.slice(0, 200) };
  // 极速版不支持 Mode/Cnt/Industry，探测到 lite 后自动去掉
  const lite = detectedVersion === 'lite';
  if (!lite && params.mode != null) req.Mode = params.mode;
  if (!lite && params.cnt) req.Cnt = params.cnt;
  if (!lite && params.industry) req.Industry = params.industry;
  if (params.freshness) req.Freshness = params.freshness;
  if (params.site) req.Site = params.site;

  if (isSearchMock()) return { query: params.query, params: req, pages: mockPages(req), version: 'mock' };

  const key = JSON.stringify(req);
  const cached = cacheGet(key, getConfig().search.cacheMinutes * 60_000);
  if (cached) return { ...cached, cached: true };

  const res = await withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getClient().SearchPro(req);
      } catch (e) {
        const code = e?.code || '';
        if (code === 'RequestLimitExceeded' && attempt < 3) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        if (code === 'InvalidParameter' && !lite && (req.Mode != null || req.Cnt || req.Industry) && attempt < 1) {
          // 可能是极速版不支持的参数，去掉后重试一次
          delete req.Mode;
          delete req.Cnt;
          delete req.Industry;
          continue;
        }
        const err = new Error(`元宝搜索调用失败：${code || ''} ${e?.message || e}`.trim());
        err.code = code;
        throw err;
      }
    }
  });

  if (res.Version) detectedVersion = res.Version;
  const result = {
    query: params.query,
    params: req,
    pages: parsePages(res.Pages),
    version: res.Version || 'unknown',
    requestId: res.RequestId,
    msg: res.Msg || '',
  };
  cacheSet(key, result);
  return result;
}

// ---------- 模拟数据：没有 key 时用于开发和界面演示，结果全部标注【模拟】 ----------
function hashStr(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const MOCK_SITES = [
  { site: '某省人民政府', host: 'www.demo-province.gov.cn', kind: 'gov' },
  { site: '新华网', host: 'www.news.cn', kind: 'media' },
  { site: '人民网', host: 'www.people.com.cn', kind: 'media' },
  { site: '中国知网', host: 'www.cnki.net', kind: 'acad' },
  { site: '澎湃新闻', host: 'www.thepaper.cn', kind: 'media' },
  { site: '知乎', host: 'www.zhihu.com', kind: 'ugc' },
  { site: '微信公众平台', host: 'mp.weixin.qq.com', kind: 'ugc' },
  { site: '百家号', host: 'baijiahao.baidu.com', kind: 'ugc' },
  { site: '网易', host: 'www.163.com', kind: 'portal' },
  { site: '腾讯新闻', host: 'news.qq.com', kind: 'portal' },
];

function mockPages(req) {
  const q = req.Query;
  const refute = /辟谣|不实|谣言|假的|真相/.test(q);
  const n = Math.min(req.Cnt || 10, 8);
  const seed = hashStr(q + (req.Mode ?? '') + (req.Industry ?? ''));
  const baseText = q.replace(/\s*(辟谣|不实|官方|通报|原文|出处|最早)\s*/g, '');
  const pages = [];
  for (let i = 0; i < n; i++) {
    const s = MOCK_SITES[(seed + i * 3) % MOCK_SITES.length];
    if (req.Industry === 'gov' && s.kind !== 'gov' && i > 1) continue;
    const day = 1 + ((seed >> (i % 8)) % 27);
    const month = 1 + ((seed + i) % 9);
    const stanceText =
      refute || (seed + i) % 4 === 0
        ? `经核实，网传“${baseText}”的说法不实，相关部门已辟谣。`
        : `记者从有关方面证实，${baseText}。相关负责人表示，情况属实。`;
    // 让部分结果高度相似，模拟“同源转载”
    const passage = i % 3 === 2 && pages[0] ? pages[0].passage : `【模拟】${stanceText}这是用于界面演示的模拟摘要，第${i + 1}条。`;
    pages.push(
      JSON.stringify({
        title: `【模拟】${baseText}${refute ? '？官方回应来了' : '：最新消息'}（${s.site}）`,
        url: `https://${s.host}/mock/${(seed + i).toString(36)}.html`,
        date: `2026/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} 10:${String(i * 7).padStart(2, '0')}:00`,
        passage,
        content: passage,
        site: s.site,
        score: Number((0.95 - i * 0.07).toFixed(3)),
        favicon: '',
      }),
    );
  }
  return parsePages(pages);
}
