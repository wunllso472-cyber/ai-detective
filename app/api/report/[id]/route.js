import { loadDoc } from '../../../../core/store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 下载调查报告 Markdown
export async function GET(req, { params }) {
  const { id } = await params;
  const r = loadDoc('reports', id);
  if (!r) return Response.json({ error: '报告不存在' }, { status: 404 });
  const filename = encodeURIComponent(`调查报告-${r.input.slice(0, 20)}.md`);
  return new Response(r.markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
