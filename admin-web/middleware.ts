import { NextRequest, NextResponse } from 'next/server';

// Première barrière (confort de navigation) ; l'autorisation réelle est vérifiée par l'API à chaque requête.
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/application' || req.nextUrl.pathname.startsWith('/application/')) {
    return NextResponse.next();
  }
  if (!req.cookies.get('rp_refresh')) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!login|api|_next|favicon.ico).*)'] };
