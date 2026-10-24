#!/usr/bin/env node
// 「查证 · AI侦探社」Skill 客户端：零依赖，调用 Web 服务的 HTTP API。
// 服务地址：环境变量 DETECTIVE_API，默认 http://localhost:3000
import fs from 'node:fs';
import path from 'node:path';

const API = (process.env.DETECTIVE_API || 'http://localhost:3000').replace(/\/$/, '');

const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  } else pos.push(args[i]);
}
const [cmd, ...rest] = pos;

async function call(method, p, body, { text = false } = {}) {
  let res;
  try {
    res = await fetch(API + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(process.env.DETECTIVE_TIMEOUT_MS || 900_000)),
    });
  } catch (e) {
    throw new Error(`连不上查证服务 ${API}（${e.cause?.code || e.message}）。请先启动服务，或用 DETECTIVE_API 指定地址。`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return text ? res.text() : res.json();
}

// 查证类请求：默认要 Markdown，--json 时要完整 JSON
const run = (p, body) => call('POST', p, { ...body, stream: false, format: flags.json ? 'json' : 'markdown' }, { text: !flags.json });
const print = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

function imageDataUrl(file) {
  const abs = path.resolve(file || '');
  if (!fs.existsSync(abs)) throw new Error(`找不到图片：${abs}`);
  const ext = path.extname(abs).slice(1).toLowerCase().replace('jpg', 'jpeg');
  if (!['png', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) throw new Error('只支持 png/jpg/webp/gif/bmp 图片');
  const buf = fs.readFileSync(abs);
  if (buf.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB，请先压缩');
  return `data:image/${ext};base64,${buf.toString('base64')}`;
}

const HELP = `用法：
  detective.mjs status                                  查看服务与引擎状态
  detective.mjs verify "问题或消息"                       基础查证
  detective.mjs deep "调查对象" [--rounds 3]              深度调查（生成报告）
  detective.mjs screenshot 图片路径 [--note 备注]          截图查证
  detective.mjs watch <结果ID> [--interval 分钟]          持续盯梢
  detective.mjs check <盯梢ID> [--freshness d1|d7|d30]    立即检查盯梢
  detective.mjs watches                                 列出盯梢任务
  detective.mjs notifications                           查看提醒
通用参数：--json 输出完整 JSON
服务地址：DETECTIVE_API=${API}`;

try {
  switch (cmd) {
    case 'status': {
      const s = await call('GET', '/api/status');
      print(`服务：${API}\n元宝搜索：${s.search.mock ? '模拟（未配置密钥）' : `真实（${s.search.version}）`}\n模型：${s.llm.mock ? '模拟（未配置密钥）' : s.llm.model}`);
      break;
    }
    case 'verify':
      print(await run('/api/verify', { input: rest.join(' ') }));
      break;
    case 'deep':
      print(await run('/api/deep', { input: rest.join(' '), rounds: Number(flags.rounds) || 3 }));
      break;
    case 'screenshot':
      print(await run('/api/screenshot', { image: imageDataUrl(rest[0]), note: flags.note || '' }));
      break;
    case 'watch': {
      const w = await call('POST', '/api/watch', { resultId: rest[0], intervalMinutes: flags.interval });
      print(flags.json ? w : `已开始盯梢「${w.input}」，盯梢 ID：${w.id}，每 ${w.intervalMinutes} 分钟检查一次。\n管理页面：${API}/（持续盯梢标签）`);
      break;
    }
    case 'check': {
      const r = await call('POST', `/api/watch/${rest[0]}/check`, { freshness: flags.freshness });
      if (flags.json) print(r);
      else if (r.notification) {
        const n = r.notification;
        print(
          [`🔔 ${n.title}`, n.body, ...n.items.map((i) => `- 【${i.stanceLabel}】${i.title}（${i.site}，${i.date}）${i.url}`), `最新结果：${API}/r/${n.resultId}`].join('\n'),
        );
      } else print(`暂无新进展（检索窗口 ${r.check.window}，新增来源 ${r.check.newSources} 个，无新的有效证据）。`);
      break;
    }
    case 'watches': {
      const ws = await call('GET', '/api/watch');
      print(flags.json ? ws : ws.map((w) => `${w.id}｜${w.active ? '盯梢中' : '已暂停'}｜${w.verdictLabel}｜${w.input}｜上次检查 ${w.lastCheckedAt || '无'}`).join('\n') || '没有盯梢任务');
      break;
    }
    case 'notifications': {
      const ns = await call('GET', '/api/notifications');
      print(
        flags.json
          ? ns
          : ns
              .slice(0, 10)
              .map((n) => `${n.read ? '  ' : '● '}${new Date(n.createdAt).toLocaleString('zh-CN', { hour12: false })} ${n.title}\n  ${n.body}\n  ${API}/r/${n.resultId}`)
              .join('\n') || '没有提醒',
      );
      break;
    }
    default:
      print(HELP);
  }
} catch (e) {
  console.error(`出错：${e.message}`);
  process.exit(1);
}
