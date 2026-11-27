import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, BACKEND_URL, CSRF_HEADER, CSRF_VALUE, REFRESH_COOKIE, clearTokenCookies, refreshTokens, setTokenCookies } from './backend';

/**
 * Relais vers /admin/* de l'API. Le jeton d'accès vient du cookie httpOnly ; sur 401, un rafraîchissement
 * (jeton rotatif) est tenté une fois. Les chemins sont restreints à /admin et filtrés contre la traversée.
 */
export async function proxyToAdmin(req: NextRequest, segments: string[]) {
  if (!segments.length || segments.some((s) => !/^[a-zA-Z0-9._-]+$/.test(s) || s === '..' || s === '.')) {
    return NextResponse.json({ code: 'BAD_PATH', message: 'Chemin invalide.' }, { status: 400 });
  }
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return NextResponse.json({ code: 'CSRF', message: 'Requête refusée.' }, { status: 403 });
  }
  const url = `${BACKEND_URL}/admin/${segments.join('/')}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const call = (token: string) => fetch(url, {
    method: req.method, body, cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  });

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let upstream: Response | null = access ? await call(access).catch(() => null) : null;
  let renewed: Awaited<ReturnType<typeof refreshTokens>> = null;
  let refreshFailed = false;

  if ((!upstream || upstream.status === 401) && refresh) {
    renewed = await refreshTokens(refresh);
    if (renewed) upstream = await call(renewed.accessToken).catch(() => null);
    else refreshFailed = true;
  }
  if (!upstream) {
    // Aucun jeton du tout : c'est une session absente (401), pas une panne de l'API.
    if (!access && !refresh) return NextResponse.json({ code: 'AUTH_REQUIRED', message: 'Authentification requise.' }, { status: 401 });
    return NextResponse.json({ code: 'BACKEND_UNREACHABLE', message: 'API injoignable.' }, { status: 502 });
  }

  const text = await upstream.text();
  const res = new NextResponse(text || null, {
    status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
  if (renewed) setTokenCookies(res, renewed);
  if (refreshFailed || (upstream.status === 401 && !renewed)) clearTokenCookies(res);
  return res;
}
