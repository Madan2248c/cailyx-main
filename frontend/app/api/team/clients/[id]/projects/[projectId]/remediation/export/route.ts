import { backendUrl } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; projectId: string }> };

/**
 * The fix pack download. Streams the backend's Markdown, JSON or PDF
 * (one-page overview) response through as-is: the shared JSON proxy helper
 * can't carry a text or binary body.
 */
export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const authorization = request.headers.get('authorization');
  if (!authorization) return Response.json({ message: 'Missing token' }, { status: 401 });
  const requested = new URL(request.url).searchParams.get('format');
  const format = requested === 'json' || requested === 'pdf' ? requested : 'md';
  const upstream = await fetch(
    `${backendUrl()}/team/clients/${encodeURIComponent(id)}/projects/${encodeURIComponent(projectId)}/remediation/export?format=${format}`,
    { headers: { authorization } },
  );
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
