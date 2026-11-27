import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../../shared/database/database.service';
import { Actor, AuditService } from './audit.service';

export interface AdminPrincipal { adminId: string; sessionId: string; username: string; permissions: string[]; roles: string[] }

export const MAX_FAILED_ATTEMPTS = 5;      // par identifiant, sur la fenêtre ci-dessous
export const LOCK_WINDOW_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 12;
const ACCESS_TTL_SECONDS = 15 * 60;
const SESSION_TTL_HOURS = 8;                // inactivité maximale entre deux rafraîchissements
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const INVALID = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Identifiants invalides.' });

@Injectable()
export class AdminAuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: DatabaseService, private readonly jwt: JwtService,
    private readonly audit: AuditService, private readonly config: ConfigService,
  ) {}

  hashPassword(password: string) { return hash(password); }

  private async issue(adminId: string, sessionId: string, refreshToken: string) {
    return {
      accessToken: await this.jwt.signAsync({ sub: adminId, sid: sessionId }, { expiresIn: ACCESS_TTL_SECONDS }),
      refreshToken, expiresIn: ACCESS_TTL_SECONDS,
    };
  }

  async principalFor(adminId: string, sessionId: string): Promise<AdminPrincipal> {
    const { rows } = await this.db.query(
      `SELECT u.username,
              COALESCE(array_agg(DISTINCT rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
              COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM admin_users u
       LEFT JOIN admin_user_roles ur ON ur.admin_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE u.id = $1 GROUP BY u.username`, [adminId]);
    return { adminId, sessionId, username: rows[0]?.username, permissions: rows[0]?.permissions ?? [], roles: rows[0]?.roles ?? [] };
  }

  /** ADM-001 : authentification ; protection contre la force brute par identifiant (existant ou non). */
  async login(username: string, password: string, actor: Actor, userAgent?: string) {
    const u = username.trim().toLowerCase();
    const recent = await this.db.query(
      `SELECT count(*)::int AS n FROM authentication_attempts
       WHERE username=$1 AND success=false AND at > now() - make_interval(mins => $2)
         AND at > COALESCE((SELECT max(at) FROM authentication_attempts WHERE username=$1 AND success=true), '-infinity')`,
      [u, LOCK_WINDOW_MINUTES]);
    if (recent.rows[0].n >= MAX_FAILED_ATTEMPTS) {
      await this.audit.log({ ...actor, username: u }, 'LOGIN_LOCKED', 'admin_session');
      throw new HttpException({ code: 'TOO_MANY_ATTEMPTS', message: 'Trop de tentatives. Réessayez dans quelques minutes.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = (await this.db.query('SELECT id, password_hash, active FROM admin_users WHERE username=$1', [u])).rows[0];
    // Vérification toujours effectuée (même sans compte) pour ne pas révéler l'existence par le temps de réponse.
    this.dummyHash ??= hash('mot-de-passe-factice-pour-temps-constant');
    const ok = await verify(user?.password_hash ?? (await this.dummyHash), password).catch(() => false);
    const success = !!user && user.active && ok;

    await this.db.query(`INSERT INTO authentication_attempts (username, success, reason, ip) VALUES ($1,$2,$3,$4)`,
      [u, success, success ? null : !user ? 'UNKNOWN_USER' : !user.active ? 'INACTIVE' : 'BAD_PASSWORD', actor.ip ?? null]);
    if (!success) {
      await this.audit.log({ ...actor, username: u, adminId: user?.id }, 'LOGIN_FAILED', 'admin_session');
      throw INVALID();
    }

    const refreshToken = randomBytes(48).toString('base64url');
    const session = (await this.db.query(
      `INSERT INTO admin_sessions (admin_id, refresh_hash, expires_at, user_agent)
       VALUES ($1,$2, now() + make_interval(hours => $3), $4) RETURNING id`,
      [user.id, sha256(refreshToken), SESSION_TTL_HOURS, userAgent?.slice(0, 200) ?? null])).rows[0];
    await this.db.query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [user.id]);
    await this.audit.log({ ...actor, adminId: user.id, username: u }, 'LOGIN_SUCCEEDED', 'admin_session', { sessionId: session.id });
    const principal = await this.principalFor(user.id, session.id);
    return { ...(await this.issue(user.id, session.id, refreshToken)), admin: this.publicAdmin(principal) };
  }

  private publicAdmin(p: AdminPrincipal) {
    return { id: p.adminId, username: p.username, roles: p.roles, permissions: p.permissions };
  }

  /** Jeton de rafraîchissement rotatif : chaque usage en émet un nouveau ; rejouer un ancien révoque la session. */
  async refresh(refreshToken: string, actor: Actor) {
    const h = sha256(refreshToken);
    const s = (await this.db.query(
      `SELECT s.*, u.active, u.username FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
       WHERE s.refresh_hash=$1 OR s.previous_refresh_hash=$1`, [h])).rows[0];
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date() || !s.active) throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Session expirée.' });
    if (s.previous_refresh_hash === h && s.refresh_hash !== h) {
      await this.revokeSession(s.id, 'REFRESH_REUSE');
      await this.audit.log({ ...actor, adminId: s.admin_id, username: s.username }, 'REFRESH_REUSE_DETECTED', 'admin_session', { sessionId: s.id });
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Session révoquée.' });
    }
    const next = randomBytes(48).toString('base64url');
    await this.db.query(
      `UPDATE admin_sessions SET previous_refresh_hash=refresh_hash, refresh_hash=$2, last_used_at=now(),
         expires_at = now() + make_interval(hours => $3) WHERE id=$1`, [s.id, sha256(next), SESSION_TTL_HOURS]);
    const principal = await this.principalFor(s.admin_id, s.id);
    return { ...(await this.issue(s.admin_id, s.id, next)), admin: this.publicAdmin(principal) };
  }

  revokeSession(sessionId: string, reason: string) {
    return this.db.query(`UPDATE admin_sessions SET revoked_at=now(), revoked_reason=$2 WHERE id=$1 AND revoked_at IS NULL`, [sessionId, reason]);
  }
  revokeAllFor(adminId: string, reason: string) {
    return this.db.query(`UPDATE admin_sessions SET revoked_at=now(), revoked_reason=$2 WHERE admin_id=$1 AND revoked_at IS NULL`, [adminId, reason]);
  }

  /** ADM-005 : la déconnexion invalide la session côté serveur ; le jeton d'accès devient inutilisable immédiatement. */
  async logout(p: AdminPrincipal, actor: Actor) {
    await this.revokeSession(p.sessionId, 'LOGOUT');
    await this.audit.log({ ...actor, adminId: p.adminId, username: p.username }, 'LOGOUT', 'admin_session', { sessionId: p.sessionId });
  }

  /** Validation à CHAQUE requête : jeton valide + session non révoquée/expirée + compte actif (ADM-002). */
  async authenticate(token: string): Promise<AdminPrincipal> {
    let payload: { sub: string; sid: string };
    try { payload = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Authentification requise.' }); }
    const s = (await this.db.query(
      `SELECT s.id FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
       WHERE s.id=$1 AND s.admin_id=$2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active`, [payload.sid, payload.sub])).rows[0];
    if (!s) throw new UnauthorizedException({ code: 'SESSION_ENDED', message: 'Session terminée. Reconnectez-vous.' });
    return this.principalFor(payload.sub, payload.sid);
  }
}
