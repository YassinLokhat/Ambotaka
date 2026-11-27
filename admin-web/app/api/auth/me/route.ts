import { NextRequest } from 'next/server';
import { proxyToAdmin } from '@/lib/proxy';

export const GET = (req: NextRequest) => proxyToAdmin(req, ['auth', 'me']);
