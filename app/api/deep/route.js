import { deepInvestigate } from '../../../core/deep.mjs';
import { readBody, streamOrJson, fail } from '../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req) {
  const body = await readBody(req);
  const input = String(body.input || '').trim();
  if (!input) return fail('请输入要调查的问题或事件');
  if (input.length > 1000) return fail('内容太长，请控制在 1000 字以内');
  return streamOrJson(req, body, (emit) => deepInvestigate(input, { emit, maxRounds: body.rounds }));
}
