import { CanActivate, ExecutionContext, createParamDecorator, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Identifie une installation (identifiant aléatoire, sans compte — spec §4.1).
 * Ce n'est PAS une authentification forte : les abus sont limités par quotas et unicité des réponses.
 */
@Injectable()
export class InstallationGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-installation-id'];
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new UnauthorizedException({ code: 'INSTALLATION_ID_REQUIRED', message: 'Identifiant d’installation manquant ou invalide.' });
    }
    await this.db.query(
      `INSERT INTO driver_installations (id, last_seen_at) VALUES ($1, now())
       ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`, [id.toLowerCase()],
    );
    req.installationId = id.toLowerCase();
    return true;
  }
}

export const InstallationId = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().installationId as string);
