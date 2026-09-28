import { backendUrl } from '@/lib/backend-client';

type Params = { params: Promise<{ id: string; reportId: string }> };

/**
 * "Download report". Streams the backend's PDF through as-is (the shared JSON
 * proxy helper can't carry a binary body), keeping its Content-Disposition so
 * the file saves under the server's name.
 */
export async function GET(request: Request, { params }: Params) {
  const { id, reportId } = await params;
  const authorization = request.headers.get('authorization');
  if (!authorization) return Response.json({ message: 'Missing token' }, { status: 401 });
  const upstream = await fetch(
    `${backendUrl()}/team/clients/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}/pdf`,
    { headers: { authorization } },
  );
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
