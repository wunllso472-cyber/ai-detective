'use client';
import { use, useEffect, useState } from 'react';
import Brand from '../../ui/Brand';
import ResultView from '../../ui/ResultView';

export default function ResultPage({ params }) {
  const { id } = use(params);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    fetch(`/api/result/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setResult(d);
      })
      .catch((e) => setError(e.message));
    fetch('/api/watch')
      .then((r) => r.json())
      .then((ws) => setWatching(ws.some((w) => w.active && w.rootResultId === id)))
      .catch(() => {});
  }, [id]);

  const onWatch = async () => {
    const res = await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId: id }) });
    if (res.ok) setWatching(true);
  };

  return (
    <div className="wrap">
      <header className="top">
        <a className="brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Brand size={44} />
          <div>
            <h1 style={{ fontSize: 26 }}>
              福尔摩搜<small>AI侦探社</small>
            </h1>
            <p>查证结果详情</p>
          </div>
        </a>
        <a className="btn ghost" href="/" style={{ textDecoration: 'none' }}>
          ← 新的查证
        </a>
      </header>
      {error && <div className="error-box">✘ {error}</div>}
      {!result && !error && <div className="empty">加载中…</div>}
      {result && (
        <div className="stage-area">
          <ResultView result={result} onWatch={result.kind === 'watch-check' ? null : onWatch} watching={watching} />
        </div>
      )}
    </div>
  );
}
