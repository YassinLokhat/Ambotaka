import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, CSRF_HEADER, CSRF_VALUE, setTokenCookies } from '@/lib/backend';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) return NextResponse.json({ code: 'CSRF', message: 'Requête refusée.' }, { status: 403 });
  const body = await req.text();
  const r = await fetch(`${BACKEND_URL}/admin/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': req.headers.get('user-agent') ?? '', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body, cache: 'no-store',
  }).catch(() => null);
  if (!r) return NextResponse.json({ code: 'BACKEND_UNREACHABLE', message: 'API injoignable.' }, { status: 502 });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  const res = NextResponse.json({ admin: data.admin });   // les jetons ne sont JAMAIS renvoyés au navigateur
  setTokenCookies(res, data);
  return res;
}
