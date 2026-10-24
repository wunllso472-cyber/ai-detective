import { restoreCase, runSearches, assessAll, trace, score, conclude, buildResult, saveResult, VERDICT_LABEL, STANCE_LABEL } from './case.mjs';
import { list, get, upsert, update, remove, loadDoc, newId } from './store.mjs';
import { getConfig } from './config.mjs';

// 持续盯梢：对某次查证结果定期做增量检索（Freshness），有新证据或结论变化时生成网页内通知。

const noop = () => {};

export function listWatches() {
  return list('watches');
}

export function addWatch(resultId, { intervalMinutes } = {}) {
  const result = loadDoc('results', resultId);
  if (!result) throw new Error('找不到这次查证结果');
  const existing = list('watches').find((w) => w.rootResultId === resultId && w.active);
  if (existing) return existing;
  const interval = Math.max(1, Number(intervalMinutes) || getConfig().watch.defaultIntervalMinutes);
  const now = Date.now();
  return upsert('watches', {
    id: newId('w'),
    rootResultId: resultId,
    latestResultId: resultId,
    input: result.input,
    claims: result.claims.map((c) => ({ id: c.id, text: c.text })),
    verdict: result.verdict,
    verdictLabel: result.verdictLabel,
    seen: result.sources.map((s) => s.key),
    intervalMinutes: interval,
    active: true,
    createdAt: new Date(now).toISOString(),
    lastCheckedAt: null,
    nextCheckAt: new Date(now + interval * 60_000).toISOString(),
    checks: [],
  });
}

export function setWatchActive(id, active) {
  return update('watches', id, { active: !!active });
}

export function deleteWatch(id) {
  remove('watches', id);
}

function freshnessFor(minutes) {
  // 增量窗口至少 1 天（Freshness 最细粒度是天）
  const days = Math.min(30, Math.max(1, Math.ceil(minutes / 1440)));
  return `d${days}`;
}

const running = new Set();

/**
 * 立即检查一个盯梢任务。
 * @param {string} id
 * @param {{freshness?:string, emit?:Function}} opts freshness 可手动放宽，如 d7
 */
export async function checkWatch(id, { freshness, emit = noop } = {}) {
  const w = get('watches', id);
  if (!w) throw new Error('盯梢任务不存在');
  if (running.has(id)) throw new Error('这个任务正在检查中');
  running.add(id);
  try {
    const prev = loadDoc('results', w.latestResultId);
    if (!prev) throw new Error('盯梢依赖的查证结果已丢失');
    const c = restoreCase(prev);
    c.id = newId('r');
    c.createdAt = new Date().toISOString();
    const win = freshness && /^(d\d{1,2}|m\d{1,2}|y\d)$/.test(freshness) ? freshness : freshnessFor(w.intervalMinutes);
    const tasks = c.claims.flatMap((cl) =>
      [cl.queries.support[0], cl.queries.refute[0], cl.queries.origin[0]].filter(Boolean).map((q, i) => ({
        claimId: cl.id,
        kind: 'watch',
        query: q,
        mode: i === 2 ? 1 : 0,
        cnt: 10,
        freshness: win,
      })),
    );
    const seen = new Set(w.seen);
    const ids = (await runSearches(c, tasks, emit)).filter((sid) => !seen.has(c.sources[sid].key));
    let newEvidence = [];
    if (ids.length) {
      await assessAll(c, ids, emit, 10);
      newEvidence = Object.values(c.assessments).filter((a) => ids.includes(a.sourceId) && a.verified && (a.stance === 'support' || a.stance === 'refute'));
    }
    trace(c, emit);
    score(c);
    const changed = c.scores.verdict !== w.verdict;
    let resultId = w.latestResultId;
    if (ids.length) {
      await conclude(c, emit);
      const r = buildResult(c, { kind: 'watch-check', watchId: w.id, parentResultId: w.latestResultId });
      saveResult(r, { history: false });
      resultId = r.id;
    }
    const check = { at: new Date().toISOString(), window: win, newSources: ids.length, newEvidence: newEvidence.length, verdictFrom: w.verdict, verdictTo: c.scores.verdict };
    let notification = null;
    if (newEvidence.length || changed) {
      const items = newEvidence.slice(0, 5).map((a) => {
        const s = c.sources[a.sourceId];
        return { sourceId: s.id, title: s.title, url: s.url, site: s.site || s.host, date: s.date, tierLabel: s.tierLabel, stance: a.stance, stanceLabel: STANCE_LABEL[a.stance], quote: a.quote };
      });
      notification = upsert('notifications', {
        id: newId('n'),
        watchId: w.id,
        resultId,
        title: changed ? `结论变化：「${w.input}」` : `新进展：「${w.input}」`,
        body: changed
          ? `结论从「${VERDICT_LABEL[w.verdict]}」变为「${VERDICT_LABEL[c.scores.verdict]}」，新增 ${newEvidence.length} 条有效证据。`
          : `发现 ${newEvidence.length} 条新的有效证据，当前结论仍为「${VERDICT_LABEL[c.scores.verdict]}」。`,
        verdictFrom: w.verdict,
        verdictTo: c.scores.verdict,
        items,
        createdAt: new Date().toISOString(),
        read: false,
      });
    }
    const now = Date.now();
    update('watches', id, (cur) => ({
      latestResultId: resultId,
      verdict: c.scores.verdict,
      verdictLabel: VERDICT_LABEL[c.scores.verdict],
      seen: [...new Set([...cur.seen, ...Object.values(c.sources).map((s) => s.key)])],
      lastCheckedAt: new Date(now).toISOString(),
      nextCheckAt: new Date(now + cur.intervalMinutes * 60_000).toISOString(),
      checks: [check, ...(cur.checks || [])].slice(0, 30),
    }));
    return { check, notification };
  } finally {
    running.delete(id);
  }
}

export async function tickWatches() {
  const now = Date.now();
  for (const w of list('watches')) {
    if (!w.active || running.has(w.id) || new Date(w.nextCheckAt).getTime() > now) continue;
    try {
      await checkWatch(w.id);
    } catch (e) {
      console.error('[watch]', w.id, e.message);
      update('watches', w.id, (cur) => ({ nextCheckAt: new Date(Date.now() + cur.intervalMinutes * 60_000).toISOString(), lastError: e.message }));
    }
  }
}

export function startWatchScheduler() {
  if (globalThis.__detectiveWatchTimer) return;
  const sec = getConfig().watch.tickSeconds;
  globalThis.__detectiveWatchTimer = setInterval(() => tickWatches().catch((e) => console.error('[watch]', e)), sec * 1000);
  console.log(`[watch] 盯梢调度已启动，每 ${sec} 秒检查一次到期任务`);
}

// ---------- 通知 ----------
export function listNotifications() {
  return list('notifications');
}

export function markNotificationsRead(ids) {
  for (const n of list('notifications')) if (!ids || ids.includes(n.id)) update('notifications', n.id, { read: true });
}
