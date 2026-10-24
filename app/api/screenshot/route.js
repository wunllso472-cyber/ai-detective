import { verifyScreenshot } from '../../../core/screenshot.mjs';
import { readBody, streamOrJson, fail } from '../_lib/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  const body = await readBody(req);
  const image = String(body.image || '');
  if (!image) return fail('请上传截图');
  if (image.length > 12_000_000) return fail('图片太大，请压缩到 8MB 以内');
  return streamOrJson(req, body, (emit) => verifyScreenshot(image, { emit, note: String(body.note || '').slice(0, 300) }));
}
