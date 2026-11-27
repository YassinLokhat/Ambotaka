import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000/api/v1';
const ALLOWED_PATHS = new Set([
  'places/search', 'routes/search', 'incidents', 'reports', 'traffic',
  'consents/statistics', 'deletion-requests',
]);

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.join('/');
  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ message: 'Route indisponible.' }, { status: 404 });
  }

  const url = `${BACKEND_URL}/${path}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const headers: Record<string, string> = {};
  const contentType = req.headers.get('content-type');
  const installationId = req.headers.get('x-installation-id');
  if (contentType) headers['content-type'] = contentType;
  if (installationId) headers['x-installation-id'] = installationId;

  try {
    const upstream = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ code: 'BACKEND_UNREACHABLE', message: 'API indisponible.' }, { status: 502 });
  }
}

type Context = { params: { segments: string[] } };

export function GET(req: NextRequest, { params }: Context) {
  return forward(req, params.segments);
}

export function POST(req: NextRequest, { params }: Context) {
  return forward(req, params.segments);
}

export function PUT(req: NextRequest, { params }: Context) {
  return forward(req, params.segments);
}