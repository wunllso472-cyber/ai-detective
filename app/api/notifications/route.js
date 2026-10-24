import { listNotifications, markNotificationsRead } from '../../../core/watch.mjs';
import { readBody } from '../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(listNotifications().slice(0, 50));
}

// 标记已读：{ids:[...]}，不传 ids 表示全部已读
export async function POST(req) {
  const body = await readBody(req);
  markNotificationsRead(Array.isArray(body.ids) ? body.ids : null);
  return Response.json({ ok: true });
}
