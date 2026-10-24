import { list } from '../../../core/store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(list('history').slice(0, 100));
}
