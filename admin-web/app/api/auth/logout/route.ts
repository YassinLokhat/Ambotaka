import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, BACKEND_URL, CSRF_HEADER, CSRF_VALUE, clearTokenCookies } from '@/lib/backend';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) return NextResponse.json({ code: 'CSRF', message: 'Requête refusée.' }, { status: 403 });
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (access) await fetch(`${BACKEND_URL}/admin/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${access}` }, cache: 'no-store' }).catch(() => null);
  const res = NextResponse.json({ ok: true });
  clearTokenCookies(res);   // la session est aussi révoquée côté serveur par l'API
  return res;
}
