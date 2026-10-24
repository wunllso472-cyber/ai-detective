import { loadDoc } from '../../../../core/store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { id } = await params;
  const r = loadDoc('results', id);
  return r ? Response.json(r) : Response.json({ error: '结果不存在' }, { status: 404 });
}
