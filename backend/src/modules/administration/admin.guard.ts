import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService, AdminPrincipal } from './admin-auth.service';
import { AuditService } from './audit.service';

const KEY = 'required_permissions';
export const RequirePermissions = (...codes: string[]) => SetMetadata(KEY, codes);
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().admin as AdminPrincipal);
export const clientActor = (req: any) => ({ ip: req.ip as string });

/** Authentifie puis autorise côté serveur à chaque opération protégée (ADM-002, NFR-001). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService, private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Authentification requise.' });
    }
    const principal = await this.auth.authenticate(header.slice(7));
    req.admin = principal;
    const required = this.reflector.getAllAndOverride<string[]>(KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((c) => !principal.permissions.includes(c));
    if (missing.length) {
      await this.audit.log({ adminId: principal.adminId, username: principal.username, ip: req.ip }, 'PERMISSION_DENIED', `${req.method} ${req.route?.path ?? req.url}`, { required });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Permission insuffisante.' });
    }
    return true;
  }
}
