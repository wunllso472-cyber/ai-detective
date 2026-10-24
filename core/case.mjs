import { search, searchStatus } from './search.mjs';
import { chatJSON, llmStatus } from './llm.mjs';
import { today } from './config.mjs';
import { newId, saveDoc, upsert } from './store.mjs';
import {
  normalizeUrl,
  classifySource,
  quoteFound,
  groupBySimilarity,
  parseDate,
  fmtDate,
  TIER_WEIGHT,
} from './sources.mjs';

// 一次查证 = 一个 case：拆解 → 多路搜索 → 逐条核对（引用逐字校验）→ 溯源 → 打分 → 带引用的结论。
// 深度调查、截图查证、持续盯梢都复用这里的步骤函数。

export const VERDICT_LABEL = {
  verified: '有据可查',
  disputed: '存疑',
  false: '与证据不符',
  insufficient: '证据不足',
};

export const STANCE_LABEL = { support: '支持', refute: '反驳', neutral: '提及', irrelevant: '无关' };

const noop = () => {};

export function newCase(input, context = '') {
  return {
    id: newId('r'),
    input: input.trim(),
    context,
    createdAt: new Date().toISOString(),
    claims: [],
    sources: {}, // id -> source
    urlIndex: {}, // 规范化 URL -> id
    assessments: {}, // `${claimId}|${sourceId}` -> assessment
    searchLog: [],
    stats: { searchCalls: 0, searchErrors: 0, hallucinationBlocked: 0 },
    trace: null,
  };
}

/** 从已保存的结果恢复 case，用于盯梢复查 */
export function restoreCase(result) {
  const c = newCase(result.input, result.context || '');
  c.id = result.id;
  c.createdAt = result.createdAt;
  c.claims = result.claims.map((x) => ({ id: x.id, text: x.text, queries: x.queries, industry: x.industry }));
  for (const s of result.sources) {
    c.sources[s.id] = { ...s };
    c.urlIndex[s.key] = s.id;
  }
  for (const a of result.assessments || []) c.assessments[`${a.claimId}|${a.sourceId}`] = { ...a };
  c.searchLog = [...(result.searchLog || [])];
  c.stats = { ...c.stats, ...(result.stats || {}) };
  return c;
}

// ---------------- 1. 拆解 ----------------
export async function decompose(c, emit = noop) {
  emit({ type: 'stage', stage: 'decompose', status: 'start', message: '拆解待查证的说法' });
  const out = await chatJSON({
    task: 'decompose',
    system:
      '你是严谨的事实核查员。把用户给出的问题或消息拆成可以独立核查的“主张”，并为每条主张设计搜索词。' +
      '规则：1) 主张 1~3 条，用陈述句表达（问题要改写成待核实的陈述，如“喝咖啡会致癌吗”→“咖啡会导致癌症”）；' +
      '2) 搜索词是简短的关键词组合（不超过 20 字），不要整句；' +
      '3) support_queries 用于查找该说法本身，2 个；refute_queries 用于查找辟谣/反驳/澄清，带“辟谣”“不实”“真相”“回应”等词，1~2 个；' +
      'origin_queries 用于查找最初出处，如“通报”“原文”“论文”“首发”“发布会”，1~2 个；' +
      '4) industry 从 gov/news/acad/finance 中选最可能有权威信息的一个领域，都不合适填 null。',
    user:
      `今天是 ${today()}。\n待查证内容：${c.input}\n${c.context ? `补充信息：${c.context}\n` : ''}` +
      '输出格式：{"topic":"一句话话题","claims":[{"text":"","support_queries":[],"refute_queries":[],"origin_queries":[],"industry":null}]}',
    mock: () => {
      const t = c.input.replace(/[?？吗呢吧。！!]+$/g, '').slice(0, 40);
      return {
        topic: t,
        claims: [{ text: t, support_queries: [t, `${t} 最新`], refute_queries: [`${t} 辟谣`], origin_queries: [`${t} 官方 通报`], industry: 'news' }],
      };
    },
  });
  const arr = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, n) : []);
  c.topic = out.topic || c.input.slice(0, 40);
  c.claims = (Array.isArray(out.claims) ? out.claims : [])
    .filter((x) => x?.text)
    .slice(0, 3)
    .map((x, i) => {
      const support = arr(x.support_queries, 2);
      return {
        id: `c${i + 1}`,
        text: String(x.text).trim(),
        queries: {
          support: support.length ? support : [String(x.text).slice(0, 30)],
          refute: arr(x.refute_queries, 2),
          origin: arr(x.origin_queries, 2),
        },
        industry: ['gov', 'news', 'acad', 'finance'].includes(x.industry) ? x.industry : null,
      };
    });
  if (!c.claims.length) {
    c.claims = [{ id: 'c1', text: c.input.slice(0, 80), queries: { support: [c.input.slice(0, 30)], refute: [], origin: [] }, industry: null }];
  }
  emit({ type: 'claims', claims: c.claims, topic: c.topic });
  emit({ type: 'stage', stage: 'decompose', status: 'done', message: `拆出 ${c.claims.length} 条主张` });
}

// ---------------- 2. 搜索 ----------------
export function initialSearchTasks(c) {
  const tasks = [];
  for (const cl of c.claims) {
    const [q1, q2] = cl.queries.support;
    tasks.push({ claimId: cl.id, kind: 'support', query: q1, mode: 0, cnt: 20 });
    tasks.push({ claimId: cl.id, kind: 'authority', query: q1, mode: 1, cnt: 10 });
    if (q2) tasks.push({ claimId: cl.id, kind: 'support', query: q2, mode: 0, cnt: 10 });
    if (cl.industry) tasks.push({ claimId: cl.id, kind: 'industry', query: q1, industry: cl.industry, cnt: 10 });
    for (const q of cl.queries.refute.slice(0, 1)) tasks.push({ claimId: cl.id, kind: 'refute', query: q, mode: 0, cnt: 10 });
    for (const q of cl.queries.origin.slice(0, 1)) tasks.push({ claimId: cl.id, kind: 'origin', query: q, mode: 0, cnt: 10 });
  }
  return tasks;
}

export const KIND_LABEL = {
  support: '全网检索',
  authority: '权威信源',
  industry: '垂直领域',
  refute: '反方/辟谣',
  origin: '找出处',
  early: '溯源补搜',
  deep: '深挖',
  watch: '盯梢增量',
  publisher: '核对发布者',
};

function briefSource(s) {
  return { id: s.id, title: s.title, url: s.url, site: s.site || s.host, date: s.date, tier: s.tier, tierLabel: s.tierLabel };
}

function addPage(c, page, task) {
  const key = normalizeUrl(page.url);
  const existing = c.urlIndex[key];
  if (existing) {
    const s = c.sources[existing];
    if (!s.foundBy.some((f) => f.claimId === task.claimId && f.query === task.query)) {
      s.foundBy.push({ claimId: task.claimId, kind: task.kind, query: task.query });
    }
    s.score = Math.max(s.score ?? 0, page.score ?? 0);
    return null;
  }
  const id = `S${Object.keys(c.sources).length + 1}`;
  const cls = classifySource(page);
  const d = parseDate(page.date);
  c.sources[id] = {
    id,
    key,
    ...page,
    ...cls,
    dateISO: d ? d.toISOString() : null,
    foundBy: [{ claimId: task.claimId, kind: task.kind, query: task.query }],
    addedAt: new Date().toISOString(),
  };
  c.urlIndex[key] = id;
  return id;
}

/** 执行一批搜索任务，返回新增来源 id */
export async function runSearches(c, tasks, emit = noop) {
  emit({ type: 'stage', stage: 'search', status: 'start', message: `元宝搜索 ${tasks.length} 路并发检索` });
  const newIds = [];
  let ok = 0;
  await Promise.all(
    tasks.map(async (t) => {
      const log = { claimId: t.claimId, kind: t.kind, kindLabel: KIND_LABEL[t.kind] || t.kind, query: t.query, at: new Date().toISOString() };
      try {
        const res = await search(t);
        c.stats.searchCalls++;
        ok++;
        const added = res.pages.map((p) => addPage(c, p, t)).filter(Boolean);
        newIds.push(...added);
        Object.assign(log, { params: res.params, count: res.pages.length, added: added.length, cached: !!res.cached, requestId: res.requestId });
        emit({ type: 'search', ...log });
        if (added.length) emit({ type: 'sources', sources: added.map((id) => briefSource(c.sources[id])) });
      } catch (e) {
        c.stats.searchErrors++;
        log.error = e.message;
        emit({ type: 'search', ...log });
      }
      c.searchLog.push(log);
    }),
  );
  // 整批全部失败且手里没有任何来源时，直接报错而不是给出“证据不足”
  if (tasks.length && !ok && !Object.keys(c.sources).length) {
    throw new Error(c.searchLog.find((l) => l.error)?.error || '搜索全部失败');
  }
  emit({ type: 'stage', stage: 'search', status: 'done', message: `新增 ${newIds.length} 个来源，累计 ${Object.keys(c.sources).length} 个` });
  return newIds;
}

// ---------------- 3. 核对 ----------------
function sourceText(s) {
  const parts = [s.title, s.passage];
  if (s.content && s.content !== s.passage) parts.push(s.content);
  return parts.filter(Boolean).join('\n');
}

function pickForAssessment(c, claimId, candidateIds, limit) {
  return candidateIds
    .filter((id) => c.sources[id].foundBy.some((f) => f.claimId === claimId) && !c.assessments[`${claimId}|${id}`])
    .sort((a, b) => {
      const A = c.sources[a];
      const B = c.sources[b];
      return B.tier * 0.15 + (B.score ?? 0.5) - (A.tier * 0.15 + (A.score ?? 0.5));
    })
    .slice(0, limit);
}

function mockStance(text) {
  if (/不实|辟谣|谣言|假消息|并非|没有依据|误读/.test(text)) return 'refute';
  if (/证实|属实|确认|发布|宣布|显示/.test(text)) return 'support';
  return 'neutral';
}

async function assessBatch(c, claim, ids) {
  const blocks = ids.map((id) => {
    const s = c.sources[id];
    return `[${id}] 网站：${s.site || s.host}（${s.tierLabel}）日期：${s.date || '未知'}\n${sourceText(s).slice(0, 900)}`;
  });
  const out = await chatJSON({
    task: 'assess',
    system:
      '你是事实核查员，逐条判断每个来源对“主张”的立场。只依据来源文本本身，不要用你自己的知识补充。' +
      'stance 取值：support=来源内容支持该主张为真；refute=来源内容否定/辟谣该主张；neutral=提及相关话题但没有明确支持或否定；irrelevant=与主张无关。' +
      'quote：从该来源文本中**逐字复制**最能体现立场的一句原话（10~80 字，不得改写、不得拼接），irrelevant 时可为空。note：不超过 30 字的说明。',
    user:
      `主张：${claim.text}\n\n来源列表：\n${blocks.join('\n\n')}\n\n` +
      '输出格式：{"results":[{"source_id":"S1","stance":"support","quote":"","note":""}]}，每个来源都要给出一条。',
    mock: () => ({
      results: ids.map((id) => {
        const s = c.sources[id];
        const first = (s.passage || s.title).split(/(?<=[。！？])/)[0].slice(0, 80);
        return { source_id: id, stance: mockStance(s.passage || s.title), quote: first, note: '模拟判断' };
      }),
    }),
  });
  return Array.isArray(out.results) ? out.results : [];
}

/** 对某条主张核对一批来源（内部按 10 条分批调用 LLM） */
export async function assessClaim(c, claim, candidateIds, emit = noop, limit = 14) {
  const ids = pickForAssessment(c, claim.id, candidateIds, limit);
  if (!ids.length) return [];
  const batches = [];
  for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
  const done = [];
  await Promise.all(
    batches.map(async (batch) => {
      let results = [];
      try {
        results = await assessBatch(c, claim, batch);
      } catch (e) {
        emit({ type: 'warn', message: `核对出错：${e.message}` });
      }
      for (const id of batch) {
        const r = results.find((x) => String(x.source_id).trim() === id);
        if (!r) continue;
        const stance = ['support', 'refute', 'neutral', 'irrelevant'].includes(r.stance) ? r.stance : 'neutral';
        const quote = String(r.quote || '').trim();
        const s = c.sources[id];
        const found = quote ? quoteFound(quote, sourceText(s)) : false;
        const decisive = stance === 'support' || stance === 'refute';
        // 防幻觉：支持/反驳必须附带能在原文中逐字找到的引用，否则不计入证据
        const verified = decisive ? found : true;
        if (decisive && !found) c.stats.hallucinationBlocked++;
        const a = { claimId: claim.id, sourceId: id, stance, quote: found ? quote : '', rawQuote: found ? undefined : quote || undefined, note: String(r.note || '').slice(0, 60), verified };
        c.assessments[`${claim.id}|${id}`] = a;
        done.push(a);
      }
    }),
  );
  emit({ type: 'assessed', claimId: claim.id, results: done.map((a) => ({ sourceId: a.sourceId, stance: a.stance, verified: a.verified })) });
  return done;
}

export async function assessAll(c, candidateIds, emit = noop, limit = 14) {
  emit({ type: 'stage', stage: 'assess', status: 'start', message: '逐条核对来源立场（引用需逐字可查）' });
  const before = c.stats.hallucinationBlocked;
  await Promise.all(c.claims.map((cl) => assessClaim(c, cl, candidateIds, emit, limit)));
  const blocked = c.stats.hallucinationBlocked - before;
  emit({ type: 'stage', stage: 'assess', status: 'done', message: `核对完成${blocked ? `，拦截 ${blocked} 条无法在原文中找到的引用` : ''}` });
}

// ---------------- 4. 溯源 ----------------
function evidenceOf(c, claimId) {
  return Object.values(c.assessments).filter((a) => a.claimId === claimId && a.verified && (a.stance === 'support' || a.stance === 'refute'));
}

export function trace(c, emit = noop) {
  emit({ type: 'stage', stage: 'trace', status: 'start', message: '按发布时间和文本相似度溯源' });
  const relevantIds = [...new Set(c.claims.flatMap((cl) => evidenceOf(c, cl.id).map((a) => a.sourceId)))];
  const relevant = relevantIds.map((id) => c.sources[id]);
  const groups = groupBySimilarity(relevant, (s) => `${s.title} ${s.passage}`).map((members, i) => {
    const sorted = [...members].sort((a, b) => (a.dateISO || '9999').localeCompare(b.dateISO || '9999'));
    const origin = sorted.find((s) => s.dateISO) || sorted[0];
    return {
      id: `G${i + 1}`,
      members: sorted.map((s) => s.id),
      origin: origin.id,
      earliest: origin.dateISO,
      maxTier: Math.max(...members.map((s) => s.tier)),
    };
  });
  groups.sort((a, b) => (a.earliest || '9999').localeCompare(b.earliest || '9999'));
  groups.forEach((g, i) => (g.id = `G${i + 1}`));
  const groupOf = {};
  for (const g of groups) for (const id of g.members) groupOf[id] = g.id;

  const stanceOf = (id) => {
    const st = c.claims.map((cl) => c.assessments[`${cl.id}|${id}`]).filter((a) => a?.verified && (a.stance === 'support' || a.stance === 'refute'));
    return st[0]?.stance || 'neutral';
  };
  const timeline = relevant
    .filter((s) => s.dateISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .map((s) => ({ sourceId: s.id, date: s.dateISO, stance: stanceOf(s.id), group: groupOf[s.id] }));
  const first = timeline[0];
  const firstOfficial = timeline.find((t) => c.sources[t.sourceId].tier >= 4);
  c.trace = {
    groups,
    groupOf,
    timeline,
    firstSeen: first?.sourceId || null,
    firstAuthoritative: firstOfficial?.sourceId || null,
    reposts: groups.filter((g) => g.members.length > 1).length,
  };
  emit({
    type: 'stage',
    stage: 'trace',
    status: 'done',
    message: `${relevant.length} 个有效来源归为 ${groups.length} 个独立信源${first ? `，最早见于 ${fmtDate(new Date(first.date))}` : ''}`,
  });
  return c.trace;
}

/** 溯源补搜：在已知最早日期之前再搜一轮，尝试找到真正的首发 */
export async function earlierSearch(c, emit = noop) {
  const first = c.trace?.firstSeen && c.sources[c.trace.firstSeen];
  if (!first?.dateISO) return [];
  const d = new Date(first.dateISO);
  d.setDate(d.getDate() - 1);
  if (d.getFullYear() < 2001) return [];
  const range = `2000-01-01,${fmtDate(d)}`;
  const tasks = c.claims.slice(0, 2).map((cl) => ({
    claimId: cl.id,
    kind: 'early',
    query: cl.queries.origin[0] || cl.queries.support[0],
    mode: 0,
    cnt: 10,
    freshness: range,
  }));
  const ids = await runSearches(c, tasks, emit);
  if (ids.length) await assessAll(c, ids, emit, 10);
  return ids;
}

// ---------------- 5. 打分 ----------------
function combine(verdicts) {
  if (verdicts.every((v) => v === 'verified')) return 'verified';
  if (verdicts.every((v) => v === 'false')) return 'false';
  if (verdicts.every((v) => v === 'insufficient')) return 'insufficient';
  const known = verdicts.filter((v) => v !== 'insufficient');
  if (known.length && known.every((v) => v === 'verified')) return 'verified';
  if (known.length && known.every((v) => v === 'false')) return 'false';
  return 'disputed';
}

export function score(c) {
  const groupOf = c.trace?.groupOf || {};
  const perClaim = c.claims.map((cl) => {
    const ev = evidenceOf(c, cl.id);
    // 同一转载组只算一个独立来源，组内取最高分级
    const groups = {};
    for (const a of ev) {
      const g = groupOf[a.sourceId] || a.sourceId;
      groups[g] ||= { support: 0, refute: 0, tier: 0 };
      groups[g][a.stance]++;
      groups[g].tier = Math.max(groups[g].tier, c.sources[a.sourceId].tier);
    }
    let s = 0;
    let r = 0;
    let indepSupport = 0;
    let indepRefute = 0;
    let topSupportTier = 0;
    let topRefuteTier = 0;
    for (const g of Object.values(groups)) {
      const w = TIER_WEIGHT[g.tier] ?? 0.4;
      if (g.support >= g.refute) {
        s += w;
        indepSupport++;
        topSupportTier = Math.max(topSupportTier, g.tier);
      } else {
        r += w;
        indepRefute++;
        topRefuteTier = Math.max(topRefuteTier, g.tier);
      }
    }
    let verdict;
    let confidence;
    const total = s + r;
    const ratio = total ? s / total : 0.5;
    if (total < 1.2 || indepSupport + indepRefute < 2) {
      verdict = 'insufficient';
      confidence = Math.round(15 + total * 10);
    } else if (ratio >= 0.75 && (indepSupport >= 2 || topSupportTier >= 4)) {
      verdict = 'verified';
      confidence = Math.round(Math.min(96, 45 + s * 7 - r * 8 + (topSupportTier >= 4 ? 10 : 0)));
    } else if (ratio <= 0.25 && (indepRefute >= 2 || topRefuteTier >= 4)) {
      verdict = 'false';
      confidence = Math.round(Math.min(96, 45 + r * 7 - s * 8 + (topRefuteTier >= 4 ? 10 : 0)));
    } else {
      verdict = 'disputed';
      confidence = Math.round(40 + Math.abs(ratio - 0.5) * 30);
    }
    return { claimId: cl.id, verdict, confidence: Math.max(5, confidence), supportWeight: +s.toFixed(2), refuteWeight: +r.toFixed(2), indepSupport, indepRefute };
  });
  const verdict = combine(perClaim.map((p) => p.verdict));
  const confidence = Math.round(perClaim.reduce((a, p) => a + p.confidence, 0) / perClaim.length);
  c.scores = { perClaim, verdict, confidence };
  return c.scores;
}

// ---------------- 6. 结论 ----------------
function evidenceForPrompt(c, claimId, n = 8) {
  return evidenceOf(c, claimId)
    .map((a) => ({ a, s: c.sources[a.sourceId] }))
    .sort((x, y) => y.s.tier - x.s.tier)
    .slice(0, n);
}

function sanitizeCitations(text, allowed) {
  return String(text || '').replace(/\[(S\d+)\]/g, (m, id) => (allowed.has(id) ? m : ''));
}

export async function conclude(c, emit = noop) {
  emit({ type: 'stage', stage: 'conclude', status: 'start', message: '生成带引用的结论' });
  const allowed = new Set();
  const blocks = c.claims.map((cl) => {
    const p = c.scores.perClaim.find((x) => x.claimId === cl.id);
    const ev = evidenceForPrompt(c, cl.id);
    ev.forEach(({ s }) => allowed.add(s.id));
    const lines = ev.map(({ a, s }) => `  [${s.id}] ${STANCE_LABEL[a.stance]}｜${s.site || s.host}（${s.tierLabel}，${s.date || '日期未知'}）：“${a.quote}”`);
    return `主张 ${cl.id}：${cl.text}\n判定：${VERDICT_LABEL[p.verdict]}（独立支持 ${p.indepSupport}，独立反驳 ${p.indepRefute}）\n证据：\n${lines.join('\n') || '  （无有效证据）'}`;
  });
  const firstSeen = c.trace?.firstSeen ? c.sources[c.trace.firstSeen] : null;
  const out = await chatJSON({
    task: 'conclude',
    system:
      '你是事实核查报告撰写人。根据给定的判定和证据写结论。硬性要求：' +
      '1) 不得改变给定的判定；2) 每个事实陈述后用 [S数字] 标注来源，只能引用给出的来源编号；' +
      '3) 不得加入证据之外的信息，证据不足就明确说证据不足；4) 语言简洁，面向普通读者。',
    user:
      `原始问题：${c.input}\n总体判定：${VERDICT_LABEL[c.scores.verdict]}\n` +
      (firstSeen ? `最早可查来源：[${firstSeen.id}] ${firstSeen.site || firstSeen.host} ${firstSeen.date}\n` : '') +
      `\n${blocks.join('\n\n')}\n\n` +
      '输出格式：{"summary":"2~4 句总体结论，带[S]引用","claims":[{"id":"c1","explanation":"1~2 句解释，带[S]引用"}],"caveats":["读者需要注意的局限，0~3 条"]}',
    mock: () => ({
      summary: `【模拟结论】关于“${c.input}”，当前判定为“${VERDICT_LABEL[c.scores.verdict]}”。${[...allowed]
        .slice(0, 2)
        .map((id) => `${c.sources[id].site} 的报道可供参考[${id}]。`)
        .join('')}`,
      claims: c.claims.map((cl) => ({ id: cl.id, explanation: `【模拟】共找到 ${evidenceOf(c, cl.id).length} 条有效证据。` })),
      caveats: ['当前为模拟模式，搜索结果与结论均为演示数据。'],
    }),
  });
  c.conclusion = {
    summary: sanitizeCitations(out.summary, allowed),
    claims: Object.fromEntries((Array.isArray(out.claims) ? out.claims : []).map((x) => [x.id, sanitizeCitations(x.explanation, allowed)])),
    caveats: (Array.isArray(out.caveats) ? out.caveats : []).map(String).slice(0, 3),
  };
  emit({ type: 'stage', stage: 'conclude', status: 'done', message: '结论已生成' });
  return c.conclusion;
}

// ---------------- 汇总 ----------------
export function buildResult(c, extra = {}) {
  const usedIds = new Set(Object.values(c.assessments).map((a) => a.sourceId));
  const claims = c.claims.map((cl) => {
    const p = c.scores.perClaim.find((x) => x.claimId === cl.id);
    const all = Object.values(c.assessments).filter((a) => a.claimId === cl.id);
    const pick = (st) =>
      all
        .filter((a) => a.stance === st && a.verified)
        .sort((x, y) => c.sources[y.sourceId].tier - c.sources[x.sourceId].tier)
        .map((a) => ({ sourceId: a.sourceId, quote: a.quote, note: a.note }));
    return {
      ...cl,
      verdict: p.verdict,
      verdictLabel: VERDICT_LABEL[p.verdict],
      confidence: p.confidence,
      indepSupport: p.indepSupport,
      indepRefute: p.indepRefute,
      explanation: c.conclusion?.claims?.[cl.id] || '',
      support: pick('support'),
      refute: pick('refute'),
      neutralCount: all.filter((a) => a.stance === 'neutral').length,
      blocked: all.filter((a) => !a.verified).map((a) => ({ sourceId: a.sourceId, stance: a.stance, rawQuote: a.rawQuote })),
    };
  });
  const sources = Object.values(c.sources)
    .map((s) => ({ ...s, assessed: usedIds.has(s.id) }))
    .sort((a, b) => Number(b.assessed) - Number(a.assessed) || b.tier - a.tier || (b.score ?? 0) - (a.score ?? 0));
  return {
    id: c.id,
    kind: extra.kind || 'verify',
    input: c.input,
    context: c.context,
    topic: c.topic,
    createdAt: c.createdAt,
    finishedAt: new Date().toISOString(),
    verdict: c.scores.verdict,
    verdictLabel: VERDICT_LABEL[c.scores.verdict],
    confidence: c.scores.confidence,
    summary: c.conclusion?.summary || '',
    caveats: c.conclusion?.caveats || [],
    claims,
    sources,
    assessments: Object.values(c.assessments),
    trace: c.trace,
    searchLog: c.searchLog,
    stats: {
      ...c.stats,
      sourcesFound: Object.keys(c.sources).length,
      sourcesAssessed: usedIds.size,
      independentSources: c.trace?.groups?.length || 0,
    },
    engine: { search: searchStatus(), llm: llmStatus() },
    ...extra,
  };
}

export function saveResult(result, { history = true } = {}) {
  saveDoc('results', result.id, result);
  if (history) {
    upsert('history', {
      id: result.id,
      kind: result.kind,
      input: result.input,
      verdict: result.verdict,
      verdictLabel: result.verdictLabel,
      confidence: result.confidence,
      createdAt: result.createdAt,
      reportId: result.reportId || null,
      sourcesFound: result.stats.sourcesFound,
    });
  }
  return result;
}

/** 基础查证 */
export async function verify(input, { emit = noop, context = '', extraTasks = [], kind = 'verify', save = true, extra = {} } = {}) {
  if (!input?.trim()) throw new Error('请输入要查证的问题或消息');
  const c = newCase(input, context);
  await decompose(c, emit);
  const ids = await runSearches(c, [...initialSearchTasks(c), ...extraTasks.map((t) => ({ claimId: 'c1', ...t }))], emit);
  await assessAll(c, ids, emit);
  trace(c, emit);
  await earlierSearch(c, emit);
  trace(c, emit);
  score(c);
  await conclude(c, emit);
  const result = buildResult(c, { kind, ...extra });
  if (save) saveResult(result);
  return result;
}
