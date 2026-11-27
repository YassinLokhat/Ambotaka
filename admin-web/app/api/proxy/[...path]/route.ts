import { NextRequest } from 'next/server';
import { proxyToAdmin } from '@/lib/proxy';

type Ctx = { params: { path: string[] } };
export const GET = (req: NextRequest, { params }: Ctx) => proxyToAdmin(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => proxyToAdmin(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => proxyToAdmin(req, params.path);
export const PUT = (req: NextRequest, { params }: Ctx) => proxyToAdmin(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => proxyToAdmin(req, params.path);
