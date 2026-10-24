// 把查证结果格式化成 Markdown 文本，供 CLI 和 Skill 使用。

const ICON = { verified: '✅', disputed: '⚠️', false: '❌', insufficient: '❓' };

export function formatResult(r, { baseUrl = '' } = {}) {
  const src = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  const used = new Set();
  const cite = (t) =>
    String(t || '').replace(/\[(S\d+)\]/g, (m, id) => {
      if (!src[id]) return '';
      used.add(id);
      return `[${id}]`;
    });
  const L = [];
  L.push(`## ${ICON[r.verdict] || ''} ${r.verdictLabel}（置信度 ${r.confidence}）`, '');
  L.push(`**查证对象**：${r.input}`, '');
  if (r.screenshot) {
    const ex = r.screenshot.extracted;
    L.push(`**截图识别**：${ex.platform || '未知平台'}｜${ex.publisher || '未知发布者'}｜${ex.publishTime || '无时间'}`);
    L.push(`**核心说法**：${ex.coreClaim}`);
    for (const n of r.screenshot.consistency.notes) L.push(`- ${n}`);
    if (ex.visualFlags.length) L.push(`- 视觉可疑点（仅供参考）：${ex.visualFlags.join('；')}`);
    L.push('');
  }
  L.push(cite(r.summary), '');
  for (const cl of r.claims) {
    L.push(`### ${cl.id.toUpperCase()} ${cl.text} → ${cl.verdictLabel}`);
    if (cl.explanation) L.push(cite(cl.explanation));
    for (const e of cl.support.slice(0, 3)) {
      used.add(e.sourceId);
      L.push(`- 支持 [${e.sourceId}] ${src[e.sourceId].site || src[e.sourceId].host}：“${e.quote}”`);
    }
    for (const e of cl.refute.slice(0, 3)) {
      used.add(e.sourceId);
      L.push(`- 反驳 [${e.sourceId}] ${src[e.sourceId].site || src[e.sourceId].host}：“${e.quote}”`);
    }
    L.push('');
  }
  if (r.trace?.firstSeen) {
    const s = src[r.trace.firstSeen];
    used.add(s.id);
    L.push(`**溯源**：最早可查来源 [${s.id}] ${s.site || s.host}（${s.date}）；${r.trace.groups.length} 个独立信源，${r.trace.reposts} 组同源转载`, '');
  }
  if (r.caveats?.length) L.push(...r.caveats.map((c) => `> 注意：${c}`), '');
  L.push('**来源**');
  for (const id of [...used].sort((a, b) => +a.slice(1) - +b.slice(1))) {
    const s = src[id];
    L.push(`- [${id}] ${s.title || s.url} — ${s.site || s.host}｜${s.tierLabel}｜${s.date || '日期未知'}  ${s.url}`);
  }
  L.push('', `统计：检索 ${r.stats.searchCalls} 次 · 来源 ${r.stats.sourcesFound} 个 · 独立信源 ${r.stats.independentSources} 个 · 拦截无据引用 ${r.stats.hallucinationBlocked} 条`);
  if (baseUrl) {
    L.push(`详情页：${baseUrl}/r/${r.id}`);
    if (r.reportId) L.push(`调查报告：${baseUrl}/report/${r.reportId}`);
  } else if (r.reportId) L.push(`调查报告 ID：${r.reportId}`);
  if (r.engine?.search?.mock || r.engine?.llm?.mock) L.push('', `⚠ 当前为模拟模式（搜索：${r.engine.search.mock ? '模拟' : '真实'}，模型：${r.engine.llm.mock ? '模拟' : '真实'}），结果仅用于演示。`);
  return L.join('\n');
}
