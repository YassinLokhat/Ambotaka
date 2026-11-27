export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000/api/v1';
export const ACCESS_COOKIE = 'rp_access';
export const REFRESH_COOKIE = 'rp_refresh';
export { CSRF_HEADER, CSRF_VALUE } from './backend-const';

export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number }

const cookieBase = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

/** Pose les jetons en cookies httpOnly + SameSite=Strict : inaccessibles au JavaScript de la page (anti-XSS) et non envoyés cross-site. */
export function setTokenCookies(res: { cookies: { set: (name: string, value: string, opts: object) => void } }, t: Tokens) {
  res.cookies.set(ACCESS_COOKIE, t.accessToken, { ...cookieBase, maxAge: t.expiresIn });
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, { ...cookieBase, maxAge: 8 * 3600 });
}
export function clearTokenCookies(res: { cookies: { set: (name: string, value: string, opts: object) => void } }) {
  res.cookies.set(ACCESS_COOKIE, '', { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { ...cookieBase, maxAge: 0 });
}

export async function refreshTokens(refreshToken: string): Promise<(Tokens & { admin: unknown }) | null> {
  try {
    const r = await fetch(`${BACKEND_URL}/admin/auth/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store',
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
