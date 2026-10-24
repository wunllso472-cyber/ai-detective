import { searchStatus } from '../../../core/search.mjs';
import { llmStatus } from '../../../core/llm.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ search: searchStatus(), llm: llmStatus() });
}
