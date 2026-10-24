import { setWatchActive, deleteWatch } from '../../../../core/watch.mjs';
import { readBody, fail } from '../../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await readBody(req);
  return setWatchActive(id, body.active) ? Response.json({ ok: true }) : fail('盯梢任务不存在', 404);
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  deleteWatch(id);
  return Response.json({ ok: true });
}
