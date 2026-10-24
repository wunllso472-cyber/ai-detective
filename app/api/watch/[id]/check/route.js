import { checkWatch } from '../../../../../core/watch.mjs';
import { readBody, fail } from '../../../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await readBody(req);
  try {
    return Response.json(await checkWatch(id, { freshness: body.freshness }));
  } catch (e) {
    return fail(e.message, 500);
  }
}
