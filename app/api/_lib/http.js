// API 公共工具：SSE 流式响应 / 普通 JSON 响应二选一
import { formatResult } from '../../../core/format.mjs';

export function fail(message, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** 对外展示用的站点地址：部署在反向代理后面时用 PUBLIC_BASE_URL 指定 */
export function baseUrlOf(req) {
  return (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, '');
}

/**
 * body.stream === false 时等任务完成后一次性返回（供 Skill / 脚本调用）：
 * body.format === 'markdown' 返回 Markdown 文本，否则返回 JSON。其余情况返回 SSE 事件流。
 * @param {(emit:(e:object)=>void)=>Promise<object>} run
 */
export function streamOrJson(req, body, run) {
  if (body.stream === false) {
    return run(() => {})
      .then((result) =>
        body.format === 'markdown'
          ? new Response(formatResult(result, { baseUrl: baseUrlOf(req) }), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
          : Response.json(result),
      )
      .catch((e) => fail(e.message, 500));
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const write = (text) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(text));
        } catch {
          closed = true;
        }
      };
      const send = (e) => write(`data: ${JSON.stringify(e)}\n\n`);
      // 心跳，防止代理在长时间 LLM 调用期间断开连接
      const hb = setInterval(() => write(': ping\n\n'), 15000);
      try {
        send({ type: 'result', result: await run(send) });
      } catch (e) {
        send({ type: 'error', message: e.message });
      } finally {
        clearInterval(hb);
        if (!closed) ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
