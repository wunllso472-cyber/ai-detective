'use client';
import { useMemo, useState } from 'react';

export const VERDICT_ICON = { verified: '✔', disputed: '?', false: '✘', insufficient: '…' };
const STANCE = { support: '支持', refute: '反驳', neutral: '提及', irrelevant: '无关' };

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export function VerdictTag({ verdict, label }) {
  return <span className={`tag v-${verdict}`}>{label}</span>;
}

function useLookup(result) {
  return useMemo(() => {
    const src = Object.fromEntries(result.sources.map((s) => [s.id, s]));
    const quoteOf = {};
    for (const a of result.assessments || []) {
      if (a.verified && a.quote && (a.stance === 'support' || a.stance === 'refute') && !quoteOf[a.sourceId]) quoteOf[a.sourceId] = a;
    }
    return { src, quoteOf };
  }, [result]);
}

function Cite({ id, lk }) {
  const s = lk.src[id];
  if (!s) return null;
  const q = lk.quoteOf[id];
  return (
    <a className="cite" href={s.url} target="_blank" rel="noreferrer" tabIndex={0}>
      {id}
      <span className="pop">
        <b>{s.title || s.url}</b>
        <span className="row small" style={{ gap: 6 }}>
          <span className={`tag t${s.tier}`}>{s.tierLabel}</span>
          <span>{s.site || s.host}</span>
          <span className="muted">{s.date ? fmtDate(s.dateISO || s.date) : '日期未知'}</span>
        </span>
        {q && <span className={`quote ${q.stance}`} style={{ display: 'block' }}>“{q.quote}”</span>}
        <span className="muted small">点击打开原文 ↗</span>
      </span>
    </a>
  );
}

/** 渲染带 [S数字] 引用的文本 */
export function CitedText({ text, lk }) {
  const parts = String(text || '').split(/(\[S\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[(S\d+)\]$/);
        return m ? <Cite key={i} id={m[1]} lk={lk} /> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

function SourceLine({ s }) {
  return (
    <span className="meta">
      <span className={`tag t${s.tier}`}>{s.tierLabel}</span>
      <a href={s.url} target="_blank" rel="noreferrer">
        {s.site || s.host}
      </a>
      <span>{s.date ? fmtDate(s.dateISO || s.date) : '日期未知'}</span>
      <span className="mono">[{s.id}]</span>
    </span>
  );
}

function Evidence({ list, kind, lk }) {
  if (!list.length) return <div className="muted small">暂无</div>;
  return list.slice(0, 6).map((e) => {
    const s = lk.src[e.sourceId];
    return (
      <div className="ev" key={e.sourceId}>
        <div className={`quote ${kind}`}>“{e.quote}”</div>
        <SourceLine s={s} />
      </div>
    );
  });
}

function Claim({ c, lk }) {
  const [showBlocked, setShowBlocked] = useState(false);
  return (
    <div className="claim">
      <div className="claim-h">
        <span className="mono">{c.id.toUpperCase()}</span>
        <span style={{ flex: 1, minWidth: 200 }}>{c.text}</span>
        <VerdictTag verdict={c.verdict} label={c.verdictLabel} />
        <span className="small muted">
          独立支持 {c.indepSupport} · 独立反驳 {c.indepRefute}
        </span>
      </div>
      <div className="claim-b">
        {c.explanation && (
          <p style={{ marginTop: 0 }}>
            <CitedText text={c.explanation} lk={lk} />
          </p>
        )}
        <div className="grid2">
          <div className="ev-col">
            <h4 className="s-support">▲ 支持证据（{c.support.length}）</h4>
            <Evidence list={c.support} kind="support" lk={lk} />
          </div>
          <div className="ev-col">
            <h4 className="s-refute">▼ 反驳证据（{c.refute.length}）</h4>
            <Evidence list={c.refute} kind="refute" lk={lk} />
          </div>
        </div>
        <div className="blocked">
          另有 {c.neutralCount} 个来源仅提及相关话题。
          {c.blocked?.length > 0 && (
            <>
              {' '}
              🛡 拦截 {c.blocked.length} 条无法在原文中逐字找到的引用，未计入证据。{' '}
              <button className="btn sm ghost" onClick={() => setShowBlocked(!showBlocked)}>
                {showBlocked ? '收起' : '查看'}
              </button>
              {showBlocked && (
                <ul>
                  {c.blocked.map((b) => (
                    <li key={b.sourceId}>
                      [{b.sourceId}] 模型声称「{STANCE[b.stance]}」，引用：“{b.rawQuote || '（未给出）'}” —— 原文中找不到
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Trace({ result, lk }) {
  const t = result.trace;
  if (!t || !t.timeline?.length) return <div className="muted">有效来源缺少发布时间，无法建立时间线。</div>;
  const first = t.firstSeen && lk.src[t.firstSeen];
  const auth = t.firstAuthoritative && lk.src[t.firstAuthoritative];
  const groupSize = Object.fromEntries(t.groups.map((g) => [g.id, g.members.length]));
  return (
    <>
      <div className="origin">
        {first && (
          <div>
            <div className="lbl">最早可查来源</div>
            <div style={{ fontWeight: 800 }}>
              <a href={first.url} target="_blank" rel="noreferrer">
                {first.title || first.url}
              </a>
            </div>
            <SourceLine s={first} />
          </div>
        )}
        {auth && auth.id !== first?.id && (
          <div>
            <div className="lbl">最早权威来源</div>
            <div style={{ fontWeight: 800 }}>
              <a href={auth.url} target="_blank" rel="noreferrer">
                {auth.title || auth.url}
              </a>
            </div>
            <SourceLine s={auth} />
          </div>
        )}
        <div>
          <div className="lbl">传播结构</div>
          <div>
            有效来源归并为 <b>{t.groups.length}</b> 个独立信源
          </div>
          <div className="small muted">{t.reposts} 组存在转载 / 同源内容，同组只按 1 个来源计分</div>
        </div>
      </div>
      <div className="timeline">
        {t.timeline.slice(0, 24).map((x) => {
          const s = lk.src[x.sourceId];
          return (
            <div key={x.sourceId} className={`tl ${x.stance}`}>
              <span className="d">{fmtDate(x.date)}</span>
              <span className={`tag t${s.tier}`}>{s.tierLabel}</span>{' '}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.site || s.host}
              </a>{' '}
              <span className={`small s-${x.stance}`}>· {STANCE[x.stance]}</span>{' '}
              {groupSize[x.group] > 1 && <span className="tag">同源组 {x.group} ×{groupSize[x.group]}</span>}
              <div className="small muted">{s.title}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Sources({ result }) {
  const [all, setAll] = useState(false);
  const stanceOf = useMemo(() => {
    const m = {};
    for (const a of result.assessments || []) {
      if (!a.verified) continue;
      if (a.stance === 'support' || a.stance === 'refute') m[a.sourceId] = a.stance;
      else m[a.sourceId] ||= a.stance;
    }
    return m;
  }, [result]);
  const list = all ? result.sources : result.sources.filter((s) => s.assessed).slice(0, 30);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className="src">
          <thead>
            <tr>
              <th>#</th>
              <th>标题</th>
              <th className="hide-m">网站</th>
              <th>分级</th>
              <th className="hide-m">日期</th>
              <th>立场</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.id}</td>
                <td className="t">
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url}
                  </a>
                </td>
                <td className="hide-m">{s.site || s.host}</td>
                <td>
                  <span className={`tag t${s.tier}`}>{s.tierLabel}</span>
                </td>
                <td className="hide-m mono">{s.date ? fmtDate(s.dateISO || s.date) : '—'}</td>
                <td className={`s-${stanceOf[s.id]}`}>{stanceOf[s.id] ? STANCE[stanceOf[s.id]] : '未核对'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.sources.length > list.length || all ? (
        <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
          {all ? '只看已核对的来源' : `展开全部 ${result.sources.length} 个来源`}
        </button>
      ) : null}
    </>
  );
}

function Screenshot({ result }) {
  const { extracted: ex, consistency: cs, image } = result.screenshot;
  return (
    <div className="card">
      <div className="card-h">
        <span>截图识别</span>
        <span className="sub">{ex.imageType}</span>
      </div>
      <div className="card-b shot-grid">
        {image ? <img src={image} alt="截图" /> : <div className="muted">（未保存原图）</div>}
        <div>
          <div className="row small" style={{ marginBottom: 6 }}>
            <span className="tag">平台：{ex.platform || '未识别'}</span>
            <span className="tag">发布者：{ex.publisher || '未识别'}</span>
            <span className="tag">图中时间：{ex.publishTime || '无'}</span>
          </div>
          <div>
            <b>核心说法：</b>
            {ex.coreClaim}
          </div>
          {ex.keyDetails.length > 0 && <div className="small muted">关键细节：{ex.keyDetails.join('、')}</div>}
          <details className="fold">
            <summary>识别到的文字</summary>
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {ex.ocrText}
            </div>
          </details>
          <div className={`cons ${cs.level}`}>
            <b>{cs.level === 'ok' ? '✔ 截图与来源基本一致' : cs.level === 'warn' ? '⚠ 截图出处存疑' : '✘ 截图内容与证据不符'}</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {cs.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {ex.visualFlags.map((f, i) => (
                <li key={`v${i}`}>视觉可疑点（仅供参考）：{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultView({ result, onWatch, watching }) {
  const lk = useLookup(result);
  const [copied, setCopied] = useState(false);
  const pct = Math.max(4, Math.min(100, result.confidence));
  const mock = result.engine?.search?.mock || result.engine?.llm?.mock;
  const copy = async () => {
    const text = `【查证】${result.input}\n结论：${result.verdictLabel}（置信度 ${result.confidence}）\n${result.summary.replace(/\[(S\d+)\]/g, (m, id) => (lk.src[id] ? `[${lk.src[id].url}]` : ''))}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 浏览器不允许时静默
    }
  };
  return (
    <div>
      {mock && <div className="mock-banner">⚠ 模拟模式：{result.engine.search.mock ? '搜索' : ''}{result.engine.search.mock && result.engine.llm.mock ? '与' : ''}{result.engine.llm.mock ? '模型' : ''}尚未配置密钥，以下为演示数据。</div>}
      <div className="tv">
        <div className="crt">
          <div className="q">这条消息，靠谱吗？ —— {result.input}</div>
          <div className={`verdict ${result.verdict}`}>
            {result.verdictLabel} {VERDICT_ICON[result.verdict]}
          </div>
          <div className="small">置信度 {result.confidence}</div>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="formula">
            <span>结论</span>+<span>依据 {result.claims.reduce((a, c) => a + c.support.length + c.refute.length, 0)}</span>+<span>来源 {result.stats.independentSources}</span>
          </div>
        </div>
        <div className="tv-side">
          <div className="lit">搜索</div>
          <div className="lit">核对</div>
          <div className="lit">溯源</div>
          <div className="small" style={{ fontSize: 11, letterSpacing: 0 }}>
            {result.engine?.search?.version || ''}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span>查证结论</span>
          <span className="row" style={{ gap: 6 }}>
            {onWatch && (
              <button className="btn sm warn" onClick={onWatch} disabled={watching}>
                {watching ? '👁 盯梢中' : '👁 持续盯梢'}
              </button>
            )}
            <a className="btn sm ghost" href={`/r/${result.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              🔗 详情页
            </a>
            {result.reportId && (
              <a className="btn sm ghost" href={`/report/${result.reportId}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                📄 调查报告
              </a>
            )}
            <button className="btn sm ghost" onClick={copy}>
              {copied ? '已复制' : '复制'}
            </button>
          </span>
        </div>
        <div className="card-b">
          <div className="summary">
            <CitedText text={result.summary} lk={lk} />
          </div>
          {result.caveats?.length > 0 && (
            <ul className="small muted" style={{ marginBottom: 0 }}>
              {result.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          <div className="stats" style={{ marginTop: 12 }}>
            <span className="stat">
              <b>{result.stats.searchCalls}</b>次检索
            </span>
            <span className="stat">
              <b>{result.stats.sourcesFound}</b>个来源
            </span>
            <span className="stat">
              <b>{result.stats.sourcesAssessed}</b>个已核对
            </span>
            <span className="stat">
              <b>{result.stats.independentSources}</b>个独立信源
            </span>
            <span className="stat">
              🛡<b>{result.stats.hallucinationBlocked}</b>条无据引用已拦截
            </span>
          </div>
        </div>
      </div>

      {result.screenshot && <Screenshot result={result} />}

      {result.rounds?.length > 0 && (
        <div className="card">
          <div className="card-h">
            <span>调查过程</span>
            <span className="sub">{result.rounds.length} 轮</span>
          </div>
          <div className="card-b">
            {result.rounds.map((r) => (
              <div key={r.round} style={{ marginBottom: 10 }}>
                <b>第 {r.round} 轮</b> <span className="small muted">新增来源 {r.newSources} 个</span>
                <div className="small">检索：{r.queries.map((q) => `「${q.query}」`).join(' ')}</div>
                {r.findings?.map((f, i) => (
                  <div key={i} className="small">
                    ▸ 发现：{f}
                  </div>
                ))}
                {r.gaps?.map((g, i) => (
                  <div key={i} className="small muted">
                    ▸ 缺口：{g}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <span>逐条核对</span>
          <span className="sub">引用均已在原文中逐字校验</span>
        </div>
        <div className="card-b">
          {result.claims.map((c) => (
            <Claim key={c.id} c={c} lk={lk} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span>溯源</span>
          <span className="sub">按发布时间排列，同源转载合并计算</span>
        </div>
        <div className="card-b">
          <Trace result={result} lk={lk} />
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span>来源清单</span>
          <span className="sub">SOURCES</span>
        </div>
        <div className="card-b">
          <Sources result={result} />
          <details className="fold" style={{ marginTop: 10 }}>
            <summary>检索记录（{result.searchLog.length} 次）</summary>
            <div className="log" style={{ maxHeight: 260 }}>
              {result.searchLog.map((l, i) => (
                <div key={i} className={l.error ? 'err' : ''}>
                  [{l.kindLabel}] {l.query} {l.params ? JSON.stringify(Object.fromEntries(Object.entries(l.params).filter(([k]) => k !== 'Query'))) : ''} →{' '}
                  {l.error ? l.error : `${l.count} 条`}
                  {l.requestId ? ` · ${l.requestId}` : ''}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div className="small muted" style={{ textAlign: 'right' }}>
        结果 ID {result.id} · {fmtTime(result.finishedAt)} · 模型 {result.engine?.llm?.model}
      </div>
    </div>
  );
}
