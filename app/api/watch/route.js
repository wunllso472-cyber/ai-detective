import { listWatches, addWatch } from '../../../core/watch.mjs';
import { readBody, fail } from '../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listWatches().map(({ seen, ...w }) => ({ ...w, seenCount: seen.length })));
}

export async function POST(req) {
  const body = await readBody(req);
  try {
    return Response.json(addWatch(String(body.resultId || ''), { intervalMinutes: body.intervalMinutes }));
  } catch (e) {
    return fail(e.message);
  }
}
