'use client';
import { useEffect, useRef } from 'react';

const STEPS = [
  { key: 'decompose', label: '拆解', icon: '✂' },
  { key: 'search', label: '搜索', icon: '⌕' },
  { key: 'assess', label: '核对', icon: '⚖' },
  { key: 'trace', label: '溯源', icon: '⛓' },
  { key: 'conclude', label: '结论', icon: '✔' },
];

export default function Progress({ state, extraSteps = [] }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.logs.length]);
  if (!state.running && !state.logs.length) return null;
  const steps = [...extraSteps.filter((s) => s.before), ...STEPS, ...extraSteps.filter((s) => !s.before)];
  return (
    <div className="card">
      <div className="card-h">
        <span>侦查进度</span>
        <span className="sub">{state.running ? '侦探正在工作…' : state.error ? '已中断' : '完成'}</span>
      </div>
      <div className="card-b">
        <div className="pipeline">
          {steps.map((s, i) => (
            <span key={s.key} className="row" style={{ gap: 6 }}>
              {i > 0 && <span className="pipe-arrow">→</span>}
              <span className={`pipe ${state.active === s.key ? 'active' : state.done.includes(s.key) ? 'done' : ''}`}>
                <span>{s.icon}</span>
                {s.label}
              </span>
            </span>
          ))}
        </div>
        <div className="log" ref={logRef}>
          {state.logs.map((l, i) => (
            <div key={i} className={l.kind === 'err' ? 'err' : l.kind === 'warn' ? 'warn' : ''}>
              {l.text}
            </div>
          ))}
          {state.running && <div>█</div>}
        </div>
        {state.sources.length > 0 && (
          <div className="stream-sources">
            {state.sources.slice(-40).map((s) => (
              <span key={s.id} className={`src-pop t${s.tier}`} title={s.title}>
                {s.site || '未知站点'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
