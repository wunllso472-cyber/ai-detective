import {
  newCase,
  decompose,
  initialSearchTasks,
  runSearches,
  assessAll,
  trace,
  earlierSearch,
  score,
  conclude,
  buildResult,
  saveResult,
  VERDICT_LABEL,
  STANCE_LABEL,
  KIND_LABEL,
} from './case.mjs';
import { chatJSON } from './llm.mjs';
import { today } from './config.mjs';
import { saveDoc, newId } from './store.mjs';
import { fmtDate } from './sources.mjs';

// 深度调查：多轮“检索 → 核对 → 找缺口 → 补充检索”，最后生成一份调查报告。

const noop = () => {};

function evidenceDigest(c, perClaim = 6) {
  return c.claims
    .map((cl) => {
      const p = c.scores.perClaim.find((x) => x.claimId === cl.id);
      const ev = Object.values(c.assessments)
        .filter((a) => a.claimId === cl.id && a.verified && (a.stance === 'support' || a.stance === 'refute'))
        .slice(0, perClaim)
        .map((a) => {
          const s = c.sources[a.sourceId];
          return `  [${s.id}] ${STANCE_LABEL[a.stance]}｜${s.site || s.host}（${s.tierLabel}，${s.date || '日期未知'}）：“${a.quote}”`;
        });
      return `主张 ${cl.id}：${cl.text}\n当前判定：${VERDICT_LABEL[p.verdict]}（独立支持 ${p.indepSupport}，独立反驳 ${p.indepRefute}）\n${ev.join('\n') || '  （暂无有效证据）'}`;
    })
    .join('\n\n');
}

async function findGaps(c, round, maxRounds) {
  const searched = [...new Set(c.searchLog.map((l) => l.query))];
  return chatJSON({
    task: 'gaps',
    system:
      '你是调查记者，正在做多轮深度调查。根据当前证据找出缺口：还缺哪方面的证据（官方回应、原始出处、反方说法、关键细节、最新进展）、哪里有矛盾。' +
      '再给出下一轮最值得搜的关键词（不要重复已搜过的），如果证据已经足够下结论，就 done=true。',
    user:
      `今天是 ${today()}。调查对象：${c.input}\n当前第 ${round}/${maxRounds} 轮。\n已搜过：${searched.join('；')}\n\n${evidenceDigest(c)}\n\n` +
      '输出格式：{"done":false,"findings":["到目前为止的关键发现，1~3 条"],"gaps":["证据缺口，0~3 条"],' +
      '"next_queries":[{"claim_id":"c1","query":"关键词","purpose":"找官方回应|找原始出处|找反方证据|核实细节|查最新进展","industry":null,"freshness":null}]}' +
      '。next_queries 最多 4 条；industry 可选 gov/news/acad/finance/null；freshness 可选 d7/m1/m6/y1/null。',
    mock: () =>
      round >= 3
        ? { done: true, findings: ['【模拟】证据已基本充分'], gaps: [], next_queries: [] }
        : {
            done: false,
            findings: [`【模拟】第 ${round} 轮找到 ${Object.keys(c.sources).length} 个来源`],
            gaps: ['缺少官方正式回应'],
            next_queries: [
              { claim_id: 'c1', query: `${c.claims[0].text.slice(0, 16)} 官方回应`, purpose: '找官方回应', industry: 'gov', freshness: null },
              { claim_id: 'c1', query: `${c.claims[0].text.slice(0, 16)} 最新进展`, purpose: '查最新进展', industry: null, freshness: 'm1' },
            ],
          },
  });
}

async function writeReport(c, rounds) {
  const allowed = new Set(Object.values(c.assessments).filter((a) => a.verified && a.stance !== 'irrelevant').map((a) => a.sourceId));
  const out = await chatJSON({
    task: 'report',
    system:
      '你是调查报告撰写人。只依据给定证据写报告，每个事实后用 [S数字] 标注来源，只能用给定编号；不得改变判定；证据不足要明说。',
    user:
      `调查对象：${c.input}\n总体判定：${VERDICT_LABEL[c.scores.verdict]}\n\n${evidenceDigest(c, 10)}\n\n各轮发现：\n${rounds
        .map((r) => `第${r.round}轮：${(r.findings || []).join('；')}`)
        .join('\n')}\n\n` +
      '输出格式：{"title":"报告标题","abstract":"摘要 3~5 句","background":"事件背景 2~4 句",' +
      '"viewpoints":[{"party":"官方/权威媒体/当事方/网友/专家等","position":"该方说法","sources":["S1"]}],' +
      '"doubts":["仍然存疑或无法核实的点"],"conclusion":"结论段落","advice":"给读者的建议 1~2 句"}',
    mock: () => ({
      title: `【模拟】关于“${c.input}”的调查报告`,
      abstract: `【模拟】经过 ${rounds.length} 轮检索，共找到 ${Object.keys(c.sources).length} 个来源，判定为“${VERDICT_LABEL[c.scores.verdict]}”。`,
      background: '【模拟】这是演示用的背景描述。',
      viewpoints: [...allowed].slice(0, 3).map((id) => ({ party: c.sources[id].tierLabel, position: `${c.sources[id].site} 的说法`, sources: [id] })),
      doubts: ['【模拟】部分细节仍待官方确认'],
      conclusion: `【模拟】综合来看，结论为“${VERDICT_LABEL[c.scores.verdict]}”。`,
      advice: '【模拟】请以官方发布为准。',
    }),
  });
  const clean = (t) => String(t || '').replace(/\[(S\d+)\]/g, (m, id) => (allowed.has(id) ? m : ''));
  return {
    title: clean(out.title) || `关于“${c.input}”的调查报告`,
    abstract: clean(out.abstract),
    background: clean(out.background),
    viewpoints: (Array.isArray(out.viewpoints) ? out.viewpoints : []).map((v) => ({
      party: String(v.party || ''),
      position: clean(v.position),
      sources: (Array.isArray(v.sources) ? v.sources : []).filter((id) => allowed.has(id)),
    })),
    doubts: (Array.isArray(out.doubts) ? out.doubts : []).map(clean),
    conclusion: clean(out.conclusion),
    advice: clean(out.advice),
  };
}

function reportMarkdown(result, report, rounds) {
  const src = Object.fromEntries(result.sources.map((s) => [s.id, s]));
  const cite = (t) => String(t || '').replace(/\[(S\d+)\]/g, (m, id) => (src[id] ? `[[${id}]](${src[id].url})` : ''));
  const L = [];
  L.push(`# ${report.title}`, '');
  L.push(`> 调查对象：${result.input}  `);
  L.push(`> 总体判定：**${result.verdictLabel}**（置信度 ${result.confidence}）  `);
  L.push(`> 生成时间：${new Date(result.finishedAt).toLocaleString('zh-CN')}　｜　检索 ${result.stats.searchCalls} 次 · 来源 ${result.stats.sourcesFound} 个 · 独立信源 ${result.stats.independentSources} 个 · 拦截无据引用 ${result.stats.hallucinationBlocked} 条`, '');
  L.push('## 一、摘要', '', cite(report.abstract), '');
  if (report.background) L.push('## 二、事件背景', '', cite(report.background), '');
  L.push('## 三、逐条核查', '');
  for (const cl of result.claims) {
    L.push(`### ${cl.id.toUpperCase()}　${cl.text}`, '', `**判定：${cl.verdictLabel}**（独立支持 ${cl.indepSupport} · 独立反驳 ${cl.indepRefute} · 置信度 ${cl.confidence}）`, '');
    if (cl.explanation) L.push(cite(cl.explanation), '');
    for (const [label, list] of [['支持', cl.support], ['反驳', cl.refute]]) {
      if (!list.length) continue;
      L.push(`**${label}证据**`, '');
      for (const e of list.slice(0, 6)) {
        const s = src[e.sourceId];
        L.push(`- [${s.id}] ${s.site || s.host}（${s.tierLabel}，${s.date || '日期未知'}）：“${e.quote}”`);
      }
      L.push('');
    }
  }
  if (report.viewpoints.length) {
    L.push('## 四、各方说法', '', '| 说法方 | 观点 | 来源 |', '|---|---|---|');
    for (const v of report.viewpoints) L.push(`| ${v.party} | ${cite(v.position).replace(/\|/g, '｜')} | ${v.sources.map((id) => `[${id}](${src[id].url})`).join(' ')} |`);
    L.push('');
  }
  const t = result.trace;
  if (t?.timeline?.length) {
    L.push('## 五、时间线与传播溯源', '');
    if (t.firstSeen) {
      const s = src[t.firstSeen];
      L.push(`- **最早可查来源**：[${s.id}] ${s.site || s.host}，${s.date}，《${s.title}》`);
    }
    if (t.firstAuthoritative && t.firstAuthoritative !== t.firstSeen) {
      const s = src[t.firstAuthoritative];
      L.push(`- **最早权威来源**：[${s.id}] ${s.site || s.host}，${s.date}`);
    }
    L.push(`- 有效来源归并为 **${t.groups.length}** 个独立信源，其中 ${t.reposts} 组存在转载/同源内容`, '');
    L.push('| 时间 | 来源 | 分级 | 立场 | 信源组 |', '|---|---|---|---|---|');
    for (const x of t.timeline.slice(0, 30)) {
      const s = src[x.sourceId];
      L.push(`| ${fmtDate(new Date(x.date))} | [${s.site || s.host}](${s.url}) | ${s.tierLabel} | ${STANCE_LABEL[x.stance]} | ${x.group} |`);
    }
    L.push('');
  }
  if (report.doubts.length) L.push('## 六、存疑点', '', ...report.doubts.map((d) => `- ${cite(d)}`), '');
  L.push('## 七、结论与建议', '', cite(report.conclusion), '', report.advice ? `**建议**：${cite(report.advice)}` : '', '');
  L.push('## 附录 A：调查过程', '');
  for (const r of rounds) {
    L.push(`**第 ${r.round} 轮**　新增来源 ${r.newSources} 个`, '');
    if (r.queries.length) L.push(...r.queries.map((q) => `- 检索「${q.query}」${q.purpose ? `（${q.purpose}）` : ''}`));
    if (r.findings?.length) L.push(...r.findings.map((f) => `- 发现：${f}`));
    if (r.gaps?.length) L.push(...r.gaps.map((g) => `- 缺口：${g}`));
    L.push('');
  }
  L.push('## 附录 B：参考来源', '');
  for (const s of result.sources.filter((x) => x.assessed)) {
    L.push(`- [${s.id}] [${s.title || s.url}](${s.url})　${s.site || s.host}｜${s.tierLabel}｜${s.date || '日期未知'}`);
  }
  L.push('', '---', '', '*本报告由「查证 · AI侦探社」基于元宝搜索结果自动生成，所有引用均已在原文中逐字校验。*');
  return L.join('\n');
}

export async function deepInvestigate(input, { emit = noop, maxRounds = 3 } = {}) {
  if (!input?.trim()) throw new Error('请输入要调查的问题或事件');
  maxRounds = Math.min(Math.max(Number(maxRounds) || 3, 1), 5);
  const c = newCase(input);
  const rounds = [];

  emit({ type: 'round', round: 1, status: 'start', message: '第 1 轮：基础检索' });
  await decompose(c, emit);
  const firstTasks = initialSearchTasks(c);
  let ids = await runSearches(c, firstTasks, emit);
  await assessAll(c, ids, emit);
  trace(c, emit);
  score(c);
  rounds.push({ round: 1, queries: firstTasks.map((t) => ({ query: t.query, purpose: KIND_LABEL[t.kind] })), newSources: ids.length });

  for (let round = 2; round <= maxRounds; round++) {
    const gaps = await findGaps(c, round, maxRounds);
    const prev = rounds[rounds.length - 1];
    prev.findings = (gaps.findings || []).map(String);
    prev.gaps = (gaps.gaps || []).map(String);
    emit({ type: 'round', round: round - 1, status: 'done', findings: prev.findings, gaps: prev.gaps, verdict: VERDICT_LABEL[c.scores.verdict] });
    const searched = new Set(c.searchLog.map((l) => l.query));
    const next = (Array.isArray(gaps.next_queries) ? gaps.next_queries : [])
      .filter((q) => q?.query && !searched.has(q.query))
      .slice(0, 4);
    if (gaps.done || !next.length) break;
    emit({ type: 'round', round, status: 'start', message: `第 ${round} 轮：${next.map((q) => q.purpose || '补充检索').join('、')}`, queries: next });
    const tasks = next.map((q) => ({
      claimId: c.claims.some((cl) => cl.id === q.claim_id) ? q.claim_id : 'c1',
      kind: 'deep',
      query: String(q.query).slice(0, 40),
      mode: 0,
      cnt: 10,
      industry: ['gov', 'news', 'acad', 'finance'].includes(q.industry) ? q.industry : undefined,
      freshness: /^(d\d{0,2}|m\d{0,2}|y\d?)$/.test(q.freshness || '') ? q.freshness : undefined,
    }));
    ids = await runSearches(c, tasks, emit);
    // 深挖结果对所有主张都核对一遍
    for (const id of ids) {
      for (const cl of c.claims) if (!c.sources[id].foundBy.some((f) => f.claimId === cl.id)) c.sources[id].foundBy.push({ claimId: cl.id, kind: 'deep', query: '' });
    }
    await assessAll(c, ids, emit, 12);
    trace(c, emit);
    score(c);
    rounds.push({ round, queries: next.map((q) => ({ query: q.query, purpose: q.purpose })), newSources: ids.length });
  }
  const last = rounds[rounds.length - 1];
  if (!last.findings) emit({ type: 'round', round: last.round, status: 'done', verdict: VERDICT_LABEL[c.scores.verdict] });

  await earlierSearch(c, emit);
  trace(c, emit);
  score(c);
  await conclude(c, emit);

  emit({ type: 'stage', stage: 'report', status: 'start', message: '撰写调查报告' });
  const report = await writeReport(c, rounds);
  const reportId = newId('rp');
  const result = buildResult(c, { kind: 'deep', rounds, reportId });
  const markdown = reportMarkdown(result, report, rounds);
  saveDoc('reports', reportId, { id: reportId, resultId: result.id, title: report.title, input, createdAt: result.finishedAt, markdown, report });
  saveResult(result);
  emit({ type: 'stage', stage: 'report', status: 'done', message: '调查报告已生成' });
  return result;
}
