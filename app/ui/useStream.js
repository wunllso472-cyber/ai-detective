'use client';
import { useCallback, useRef, useState } from 'react';

const initial = { running: false, active: null, done: [], logs: [], sources: [], claims: null, rounds: [], extracted: null, result: null, error: null };

function reduce(s, e) {
  switch (e.type) {
    case 'stage':
      if (e.status === 'start') return { ...s, active: e.stage, logs: [...s.logs, { kind: 'stage', text: `▶ ${e.message}` }] };
      return { ...s, active: null, done: s.done.includes(e.stage) ? s.done : [...s.done, e.stage], logs: [...s.logs, { kind: 'ok', text: `✓ ${e.message}` }] };
    case 'claims':
      return { ...s, claims: e.claims, logs: [...s.logs, ...e.claims.map((c) => ({ kind: 'info', text: `  主张 ${c.id}：${c.text}` }))] };
    case 'search':
      return {
        ...s,
        logs: [
          ...s.logs,
          e.error
            ? { kind: 'err', text: `  ✗ [${e.kindLabel}] ${e.query} — ${e.error}` }
            : { kind: 'info', text: `  ⌕ [${e.kindLabel}] ${e.query} → ${e.count} 条${e.added != null ? `（新增 ${e.added}）` : ''}${e.cached ? ' ·缓存' : ''}` },
        ],
      };
    case 'sources':
      return { ...s, sources: [...s.sources, ...e.sources].slice(-80) };
    case 'assessed': {
      const sup = e.results.filter((r) => r.stance === 'support' && r.verified).length;
      const ref = e.results.filter((r) => r.stance === 'refute' && r.verified).length;
      const blk = e.results.filter((r) => !r.verified).length;
      return { ...s, logs: [...s.logs, { kind: 'info', text: `  ⚖ 主张 ${e.claimId}：核对 ${e.results.length} 条，支持 ${sup}，反驳 ${ref}${blk ? `，拦截 ${blk}` : ''}` }] };
    }
    case 'round': {
      const rounds = [...s.rounds];
      const i = rounds.findIndex((r) => r.round === e.round);
      const cur = i >= 0 ? rounds[i] : { round: e.round };
      const next = { ...cur, ...(e.status === 'start' ? { message: e.message, queries: e.queries } : { findings: e.findings, gaps: e.gaps, verdict: e.verdict, finished: true }) };
      if (i >= 0) rounds[i] = next;
      else rounds.push(next);
      return { ...s, rounds, logs: e.status === 'start' ? [...s.logs, { kind: 'stage', text: `■ ${e.message}` }] : s.logs };
    }
    case 'extracted':
      return { ...s, extracted: e.extracted };
    case 'warn':
      return { ...s, logs: [...s.logs, { kind: 'warn', text: `  ! ${e.message}` }] };
    case 'result':
      return { ...s, result: e.result, running: false, active: null };
    case 'error':
      return { ...s, error: e.message, running: false, active: null };
    default:
      return s;
  }
}

/** 调用 SSE 接口并把事件累积成界面状态 */
export function useStream() {
  const [state, setState] = useState(initial);
  const ctrl = useRef(null);

  const run = useCallback(async (url, body) => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setState({ ...initial, running: true });
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `请求失败（HTTP ${res.status}）`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const e = JSON.parse(line.slice(6));
            setState((s) => reduce(s, e));
          } catch {
            // 忽略残缺事件
          }
        }
      }
      setState((s) => (s.running ? { ...s, running: false, error: s.result ? null : '连接意外中断，请重试' } : s));
    } catch (e) {
      if (e.name === 'AbortError') return;
      setState((s) => ({ ...s, running: false, error: e.message }));
    }
  }, []);

  const reset = useCallback(() => {
    ctrl.current?.abort();
    setState(initial);
  }, []);

  return { state, run, reset, setResult: (result) => setState({ ...initial, result }) };
}
