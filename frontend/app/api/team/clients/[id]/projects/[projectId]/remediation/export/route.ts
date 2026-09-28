const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

type Params = { params: Promise<{ id: string; projectId: string }> };

/**
 * The fix pack download. Streams the backend's Markdown (or JSON) response
 * through as-is: the shared JSON proxy helper can't carry a text body.
 */
export async function GET(request: Request, { params }: Params) {
  const { id, projectId } = await params;
  const authorization = request.headers.get('authorization');
  if (!authorization) return Response.json({ message: 'Missing token' }, { status: 401 });
  const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'md';
  const upstream = await fetch(`${BACKEND_URL}/team/clients/${id}/projects/${projectId}/remediation/export?format=${format}`, {
    headers: { authorization },
  });
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
