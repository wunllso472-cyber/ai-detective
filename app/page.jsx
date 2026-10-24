'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Brand from './ui/Brand';
import Progress from './ui/Progress';
import ResultView, { VerdictTag, fmtTime } from './ui/ResultView';
import { useStream } from './ui/useStream';

const TABS = [
  { key: 'verify', label: '查证', icon: '🔍' },
  { key: 'deep', label: '深度调查', icon: '🕵' },
  { key: 'shot', label: '截图查证', icon: '🖼' },
  { key: 'watch', label: '持续盯梢', icon: '👁' },
  { key: 'history', label: '历史', icon: '📜' },
];

const VERIFY_EXAMPLES = ['喝咖啡会致癌吗？', '世卫组织是否把阿斯巴甜列为可能致癌物', '隔夜菜吃了会致癌是真的吗', '嫦娥六号是否带回了月球背面样品'];
const DEEP_EXAMPLES = ['阿斯巴甜致癌风波的来龙去脉', '“吃味精伤脑”的说法从何而来', '“手机充电时打电话会爆炸”是否有依据'];

function SearchBox({ value, onChange, onSubmit, disabled, placeholder, examples, button, children }) {
  return (
    <div className="searchbox">
      <div className="bar">
        <i />
        <i />
        <i />
      </div>
      <div className="field">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn" onClick={onSubmit} disabled={disabled || !value.trim()}>
            {button}
          </button>
          {children}
        </div>
      </div>
      {examples && (
        <div className="examples">
          <span className="small muted">试试：</span>
          {examples.map((x) => (
            <button key={x} className="chip" onClick={() => onChange(x)} disabled={disabled}>
              {x}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ stream, extraSteps, onWatch, watchedIds, emptyText }) {
  const { state } = stream;
  return (
    <>
      {state.error && <div className="error-box">✘ {state.error}</div>}
      <Progress state={state} extraSteps={extraSteps} />
      {state.result ? (
        <ResultView result={state.result} onWatch={() => onWatch(state.result.id)} watching={watchedIds.has(state.result.id)} />
      ) : (
        !state.running && !state.logs.length && <div className="empty">{emptyText}</div>
      )}
    </>
  );
}

function VerifyPanel(props) {
  const stream = useStream();
  const [q, setQ] = useState('');
  return (
    <>
      <SearchBox
        value={q}
        onChange={setQ}
        onSubmit={() => stream.run('/api/verify', { input: q })}
        disabled={stream.state.running}
        placeholder="输入一个问题，或粘贴一条要核实的消息……"
        examples={VERIFY_EXAMPLES}
        button={stream.state.running ? '查证中…' : '开始查证'}
      />
      <Shell stream={stream} {...props} emptyText="输入一个问题，侦探会用元宝搜索找到多方来源，逐条核对并追溯出处。" />
    </>
  );
}

function DeepPanel(props) {
  const stream = useStream();
  const [q, setQ] = useState('');
  const [rounds, setRounds] = useState(3);
  const { state } = stream;
  return (
    <>
      <SearchBox
        value={q}
        onChange={setQ}
        onSubmit={() => stream.run('/api/deep', { input: q, rounds })}
        disabled={state.running}
        placeholder="输入一个要深挖的事件或说法，侦探会多轮检索、补齐证据缺口，最后写成调查报告……"
        examples={DEEP_EXAMPLES}
        button={state.running ? '调查中…' : '开始调查'}
      >
        <select className="sel" value={rounds} onChange={(e) => setRounds(+e.target.value)} disabled={state.running}>
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              最多 {n} 轮
            </option>
          ))}
        </select>
      </SearchBox>
      {state.rounds.length > 0 && (
        <div className="card">
          <div className="card-h">
            <span>调查轮次</span>
            <span className="sub">检索 → 核对 → 找缺口 → 补充检索</span>
          </div>
          <div className="card-b">
            {state.rounds.map((r) => (
              <div key={r.round} style={{ marginBottom: 8 }}>
                <b>{r.finished ? '✔' : '▶'} 第 {r.round} 轮</b> <span className="small">{r.message}</span>
                {r.verdict && <span className="small muted">（当前判定：{r.verdict}）</span>}
                {r.findings?.map((f, i) => (
                  <div key={i} className="small">
                    ▸ {f}
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
      {state.result?.reportId && (
        <a className="btn" href={`/report/${state.result.reportId}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: 18, textDecoration: 'none' }}>
          📄 打开调查报告
        </a>
      )}
      <Shell stream={stream} {...props} extraSteps={[{ key: 'report', label: '报告', icon: '📄' }]} emptyText="深度调查会进行多轮检索，并生成一份带时间线、各方说法和参考来源的调查报告。" />
    </>
  );
}

// 浏览器端压缩截图，避免上传过大的图片
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('无法解析这张图片'));
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function ShotPanel({ active, ...props }) {
  const stream = useStream();
  const [image, setImage] = useState('');
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const { state } = stream;

  const load = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return setErr('请选择图片文件');
    setErr('');
    try {
      setImage(await compressImage(file));
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) load(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [active, load]);

  return (
    <>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          load(e.dataTransfer.files?.[0]);
        }}
      >
        {image ? (
          <img src={image} alt="待查证截图" />
        ) : (
          <div>
            <div style={{ fontSize: 40 }}>🖼</div>
            <b>点击上传 / 拖入 / 直接 Ctrl+V 粘贴截图</b>
            <div className="small muted">朋友圈、微博、聊天记录、新闻截图都可以</div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => load(e.target.files?.[0])} />
      </div>
      {err && <div className="error-box">✘ {err}</div>}
      <div className="row" style={{ marginBottom: 18 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可选：补充说明（如“群里说这是今天的通知”）"
          style={{ flex: 1, minWidth: 220, border: '3px solid var(--ink)', padding: '9px 12px' }}
        />
        <button className="btn" disabled={!image || state.running} onClick={() => stream.run('/api/screenshot', { image, note })}>
          {state.running ? '查证中…' : '查证这张截图'}
        </button>
        {image && (
          <button className="btn ghost" disabled={state.running} onClick={() => setImage('')}>
            换一张
          </button>
        )}
      </div>
      {state.extracted && !state.result && (
        <div className="card">
          <div className="card-h">截图识别结果</div>
          <div className="card-b">
            <div className="row small" style={{ marginBottom: 6 }}>
              <span className="tag">平台：{state.extracted.platform || '未识别'}</span>
              <span className="tag">发布者：{state.extracted.publisher || '未识别'}</span>
              <span className="tag">图中时间：{state.extracted.publishTime || '无'}</span>
            </div>
            <b>核心说法：</b>
            {state.extracted.coreClaim}
          </div>
        </div>
      )}
      <Shell stream={stream} {...props} extraSteps={[{ key: 'ocr', label: '读图', icon: '🖼', before: true }]} emptyText="上传一张网传截图：先识别图中说法与发布者、时间，再搜索核对，并检查截图与真实来源是否一致。" />
    </>
  );
}

function WatchPanel({ watches, notifications, refresh, active }) {
  const [busy, setBusy] = useState({});
  const [win, setWin] = useState({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (active && notifications.some((n) => !n.read)) {
      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => setTimeout(refresh, 3000));
    }
  }, [active, notifications, refresh]);

  const check = async (w) => {
    setBusy((b) => ({ ...b, [w.id]: true }));
    setMsg('');
    try {
      const res = await fetch(`/api/watch/${w.id}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ freshness: win[w.id] || 'd1' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(data.notification ? `「${w.input}」有新进展，已生成提醒` : `「${w.input}」暂无新进展（新增来源 ${data.check.newSources} 个）`);
    } catch (e) {
      setMsg(`检查失败：${e.message}`);
    } finally {
      setBusy((b) => ({ ...b, [w.id]: false }));
      refresh();
    }
  };
  const toggle = async (w) => {
    await fetch(`/api/watch/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !w.active }) });
    refresh();
  };
  const del = async (w) => {
    await fetch(`/api/watch/${w.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div>
        <h3 style={{ marginTop: 0 }}>👁 盯梢任务（{watches.length}）</h3>
        {msg && <div className="mock-banner" style={{ background: 'var(--mint)' }}>{msg}</div>}
        {!watches.length && <div className="empty">在任意查证结果上点「持续盯梢」，侦探会定期用增量搜索追踪新进展。</div>}
        {watches.map((w) => (
          <div key={w.id} className={`watch ${w.active ? '' : 'paused'}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ flex: 1 }}>{w.input}</b>
              <VerdictTag verdict={w.verdict} label={w.verdictLabel} />
            </div>
            <div className="small muted">
              每 {w.intervalMinutes} 分钟 · 已见 {w.seenCount} 个来源 · 上次检查 {w.lastCheckedAt ? fmtTime(w.lastCheckedAt) : '未检查'}
              {w.active ? ` · 下次 ${fmtTime(w.nextCheckAt)}` : ' · 已暂停'}
            </div>
            {w.checks?.slice(0, 3).map((c, i) => (
              <div key={i} className="small mono">
                {fmtTime(c.at)} [{c.window}] 新来源 {c.newSources} · 新证据 {c.newEvidence}
                {c.verdictFrom !== c.verdictTo ? ' · 结论变化' : ''}
              </div>
            ))}
            {w.lastError && <div className="small s-refute">上次出错：{w.lastError}</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <select className="sel" value={win[w.id] || 'd1'} onChange={(e) => setWin({ ...win, [w.id]: e.target.value })}>
                <option value="d1">最近 1 天</option>
                <option value="d7">最近 7 天</option>
                <option value="d30">最近 30 天</option>
              </select>
              <button className="btn sm" disabled={busy[w.id]} onClick={() => check(w)}>
                {busy[w.id] ? '检查中…' : '立即检查'}
              </button>
              <button className="btn sm ghost" onClick={() => toggle(w)}>
                {w.active ? '暂停' : '恢复'}
              </button>
              <a className="btn sm ghost" href={`/r/${w.latestResultId}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                最新结果
              </a>
              <button className="btn sm danger" onClick={() => del(w)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <h3 style={{ marginTop: 0 }}>🔔 提醒（{notifications.length}）</h3>
        {!notifications.length && <div className="empty">还没有提醒。盯梢发现新证据或结论变化时会出现在这里。</div>}
        {notifications.map((n) => (
          <div key={n.id} className={`noti ${n.read ? '' : 'unread'}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{n.title}</b>
              <span className="small muted">{fmtTime(n.createdAt)}</span>
            </div>
            <div>{n.body}</div>
            {n.items?.map((it) => (
              <div key={it.sourceId} className="small" style={{ marginTop: 4 }}>
                <span className={`s-${it.stance}`}>【{it.stanceLabel}】</span>
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>{' '}
                <span className="muted">
                  {it.site} · {it.tierLabel} · {it.date?.slice(0, 10)}
                </span>
              </div>
            ))}
            <a className="small" href={`/r/${n.resultId}`} target="_blank" rel="noreferrer">
              查看最新查证结果 →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

const KIND = { verify: '查证', deep: '深度调查', screenshot: '截图查证' };

function HistoryPanel({ active }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (active) fetch('/api/history').then((r) => r.json()).then(setItems).catch(() => setItems([]));
  }, [active]);
  if (!items) return <div className="empty">加载中…</div>;
  if (!items.length) return <div className="empty">还没有查证记录。</div>;
  return items.map((h) => (
    <div key={h.id} className="hist">
      <span className="tag">{KIND[h.kind] || h.kind}</span>
      <a href={`/r/${h.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
        {h.input}
      </a>
      <span className="row small">
        <VerdictTag verdict={h.verdict} label={h.verdictLabel} />
        {h.reportId && (
          <a href={`/report/${h.reportId}`} target="_blank" rel="noreferrer">
            报告
          </a>
        )}
        <span className="muted">{fmtTime(h.createdAt)}</span>
      </span>
    </div>
  ));
}

export default function Home() {
  const [tab, setTab] = useState('verify');
  const [status, setStatus] = useState(null);
  const [watches, setWatches] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const seen = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [w, n] = await Promise.all([fetch('/api/watch').then((r) => r.json()), fetch('/api/notifications').then((r) => r.json())]);
      setWatches(w);
      setNotifications(n);
      // 首次加载只记录已有通知；之后出现的新未读通知弹出提醒
      if (seen.current === null) seen.current = new Set(n.map((x) => x.id));
      else {
        const fresh = n.filter((x) => !x.read && !seen.current.has(x.id));
        fresh.forEach((x) => seen.current.add(x.id));
        if (fresh.length) {
          setToasts((t) => [...fresh, ...t].slice(0, 3));
          setTimeout(() => setToasts((t) => t.filter((x) => !fresh.includes(x))), 12000);
        }
      }
    } catch {
      // 服务暂时不可用时保持现状
    }
  }, []);

  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setStatus).catch(() => {});
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const watchedIds = new Set(watches.filter((w) => w.active).flatMap((w) => [w.rootResultId]));
  const onWatch = async (resultId) => {
    const res = await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId }) });
    if (res.ok) refresh();
  };
  const unread = notifications.filter((n) => !n.read).length;
  const common = { onWatch, watchedIds };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <Brand />
          <div>
            <h1>
              福尔摩搜<small>AI侦探社</small>
            </h1>
            <p>把结论的来路查清楚 · 搜索 · 核对 · 溯源</p>
          </div>
        </div>
        <div className="top-right">
          {status && (
            <>
              <span className={`engine ${status.search.mock ? 'mock' : 'live'}`}>元宝搜索：{status.search.mock ? '模拟' : status.search.version}</span>
              <span className={`engine ${status.llm.mock ? 'mock' : 'live'}`}>模型：{status.llm.mock ? '模拟' : status.llm.model}</span>
            </>
          )}
          <button className="bell" title="盯梢提醒" onClick={() => setTab('watch')}>
            🔔{unread > 0 && <span className="dot">{unread}</span>}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            <span>{t.icon}</span>
            {t.label}
            {t.key === 'watch' && unread > 0 && <span className="badge">{unread}</span>}
          </button>
        ))}
      </nav>
      <main className="stage-area">
        {/* 各面板保持挂载，切换标签不丢失进行中的任务 */}
        <div hidden={tab !== 'verify'}>
          <VerifyPanel {...common} />
        </div>
        <div hidden={tab !== 'deep'}>
          <DeepPanel {...common} />
        </div>
        <div hidden={tab !== 'shot'}>
          <ShotPanel active={tab === 'shot'} {...common} />
        </div>
        <div hidden={tab !== 'watch'}>
          <WatchPanel watches={watches} notifications={notifications} refresh={refresh} active={tab === 'watch'} />
        </div>
        <div hidden={tab !== 'history'}>
          <HistoryPanel active={tab === 'history'} />
        </div>
      </main>
      <div className="footer">AI切磋大会 · 1024 超能 Coding 周末 ｜ 少点幻觉，多点搜索：每条引用都在原文中逐字校验</div>

      <div className="toast-box">
        {toasts.map((n) => (
          <div key={n.id} className="toast">
            <div className="h">
              🔔 {n.title}
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setToasts((t) => t.filter((x) => x.id !== n.id))}>
                ×
              </button>
            </div>
            <div className="small">{n.body}</div>
            <a
              className="small"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setTab('watch');
              }}
            >
              查看详情 →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
