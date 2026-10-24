import { verify } from '../../../core/case.mjs';
import { readBody, streamOrJson, fail } from '../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  const body = await readBody(req);
  const input = String(body.input || '').trim();
  if (!input) return fail('请输入要查证的问题或消息');
  if (input.length > 1000) return fail('内容太长，请控制在 1000 字以内');
  return streamOrJson(req, body, (emit) => verify(input, { emit }));
}
