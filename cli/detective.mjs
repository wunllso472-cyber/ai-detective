#!/usr/bin/env node
// 项目内 CLI：直接调用 core，不依赖 Web 服务。用法见 README。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}
process.env.DATA_DIR ||= path.join(root, 'data');

const { verify } = await import('../core/case.mjs');
const { deepInvestigate } = await import('../core/deep.mjs');
const { verifyScreenshot } = await import('../core/screenshot.mjs');
const { addWatch, checkWatch, listWatches } = await import('../core/watch.mjs');
const { formatResult } = await import('../core/format.mjs');

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
const text = rest.join(' ');
const emit = flags.quiet
  ? () => {}
  : (e) => {
      if (e.type === 'stage' && e.status === 'done') console.error(`  ✓ ${e.message}`);
      else if (e.type === 'round' && e.status === 'start') console.error(`▶ ${e.message}`);
      else if (e.type === 'search' && e.error) console.error(`  ✗ 搜索「${e.query}」失败：${e.error}`);
      else if (e.type === 'warn') console.error(`  ! ${e.message}`);
    };
const out = (r) => console.log(flags.json ? JSON.stringify(r, null, 2) : formatResult(r));

try {
  if (cmd === 'verify') out(await verify(text, { emit }));
  else if (cmd === 'deep') out(await deepInvestigate(text, { emit, maxRounds: flags.rounds }));
  else if (cmd === 'screenshot') {
    const file = path.resolve(rest[0] || '');
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    const dataUrl = `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
    out(await verifyScreenshot(dataUrl, { emit, note: flags.note || '' }));
  } else if (cmd === 'watch-add') console.log(JSON.stringify(addWatch(rest[0], { intervalMinutes: flags.interval }), null, 2));
  else if (cmd === 'watch-check') console.log(JSON.stringify(await checkWatch(rest[0], { freshness: flags.freshness, emit }), null, 2));
  else if (cmd === 'watch-list') console.log(JSON.stringify(listWatches().map(({ seen, ...w }) => w), null, 2));
  else {
    console.log(`用法：
  node cli/detective.mjs verify "要查证的问题"        基础查证
  node cli/detective.mjs deep "调查对象" [--rounds 3]  深度调查（生成报告）
  node cli/detective.mjs screenshot 图片路径 [--note 备注]  截图查证
  node cli/detective.mjs watch-add <结果ID> [--interval 分钟]
  node cli/detective.mjs watch-check <盯梢ID> [--freshness d7]
  node cli/detective.mjs watch-list
  通用参数：--json 输出完整 JSON；--quiet 不打印进度`);
  }
} catch (e) {
  console.error(`出错：${e.message}`);
  process.exit(1);
}
