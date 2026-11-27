import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { AdminAuthService, AdminPrincipal } from './admin-auth.service';
import { Actor, AuditService } from './audit.service';
import { CreateRoleDto, CreateUserDto, UpdateRoleDto, UpdateUserDto } from './dto/admin.dto';

const SUPER = 'SUPER_ADMIN';
const actorOf = (a: AdminPrincipal, ip?: string): Actor => ({ adminId: a.adminId, username: a.username, ip });

@Injectable()
export class AdminUsersService {
  constructor(private readonly db: DatabaseService, private readonly auth: AdminAuthService, private readonly audit: AuditService) {}

  async listUsers() {
    const { rows } = await this.db.query(
      `SELECT u.id, u.username, u.active, u.created_at, u.last_login_at,
              COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM admin_users u LEFT JOIN admin_user_roles ur ON ur.admin_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id ORDER BY u.username`);
    return { users: rows.map((r) => ({ id: r.id, username: r.username, active: r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at, roles: r.roles })) };
  }

  private async roleIds(names: string[]): Promise<Map<string, string>> {
    const { rows } = await this.db.query('SELECT id, name FROM roles WHERE name = ANY($1)', [names]);
    const m = new Map<string, string>(rows.map((r) => [r.name, r.id]));
    const unknown = names.filter((n) => !m.has(n));
    if (unknown.length) throw new UnprocessableEntityException({ code: 'UNKNOWN_ROLE', message: `Rôle inconnu : ${unknown.join(', ')}` });
    return m;
  }

  async createUser(by: AdminPrincipal, ip: string | undefined, dto: CreateUserDto) {
    const roles = await this.roleIds(dto.roles);
    const exists = await this.db.query('SELECT 1 FROM admin_users WHERE username=$1', [dto.username]);
    if (exists.rowCount) throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Cet identifiant existe déjà.' });
    const id = (await this.db.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2) RETURNING id',
      [dto.username, await this.auth.hashPassword(dto.password)])).rows[0].id;
    for (const rid of roles.values()) await this.db.query('INSERT INTO admin_user_roles (admin_id, role_id) VALUES ($1,$2)', [id, rid]);
    await this.audit.log(actorOf(by, ip), 'USER_CREATED', `admin_user:${id}`, { username: dto.username, roles: dto.roles }); // jamais le mot de passe
    return { id, username: dto.username, roles: dto.roles, active: true };
  }

  /** Empêche de se retrouver sans aucun SUPER_ADMIN actif. */
  private async assertNotLastSuper(userId: string, willStayActiveSuper: boolean) {
    if (willStayActiveSuper) return;
    const others = await this.db.query(
      `SELECT count(*)::int n FROM admin_users u JOIN admin_user_roles ur ON ur.admin_id=u.id JOIN roles r ON r.id=ur.role_id
       WHERE r.name=$1 AND u.active AND u.id <> $2`, [SUPER, userId]);
    if (others.rows[0].n === 0) throw new ConflictException({ code: 'LAST_SUPER_ADMIN', message: 'Il doit rester au moins un super administrateur actif.' });
  }

  async updateUser(by: AdminPrincipal, ip: string | undefined, id: string, dto: UpdateUserDto) {
    const u = (await this.db.query(
      `SELECT u.id, u.username, u.active, COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM admin_users u LEFT JOIN admin_user_roles ur ON ur.admin_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.id=$1 GROUP BY u.id`, [id])).rows[0];
    if (!u) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND', message: 'Administrateur introuvable.' });
    if (dto.active === false && id === by.adminId) throw new ConflictException({ code: 'CANNOT_DEACTIVATE_SELF', message: 'Vous ne pouvez pas désactiver votre propre compte.' });

    const newActive = dto.active ?? u.active;
    const newRoles: string[] = dto.roles ?? u.roles;
    await this.assertNotLastSuper(id, newActive && newRoles.includes(SUPER));

    const changed: Record<string, unknown> = {};
    if (dto.roles) {
      const roles = await this.roleIds(dto.roles);
      await this.db.query('DELETE FROM admin_user_roles WHERE admin_id=$1', [id]);
      for (const rid of roles.values()) await this.db.query('INSERT INTO admin_user_roles (admin_id, role_id) VALUES ($1,$2)', [id, rid]);
      changed.roles = { from: u.roles, to: dto.roles };
    }
    if (dto.active !== undefined && dto.active !== u.active) {
      await this.db.query('UPDATE admin_users SET active=$2 WHERE id=$1', [id, dto.active]);
      changed.active = dto.active;
    }
    if (dto.password) {
      await this.db.query('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [id, await this.auth.hashPassword(dto.password)]);
      changed.passwordChanged = true;
    }
    if (dto.password || dto.active === false) await this.auth.revokeAllFor(id, dto.password ? 'PASSWORD_CHANGED' : 'DEACTIVATED');
    await this.audit.log(actorOf(by, ip), 'USER_UPDATED', `admin_user:${id}`, { username: u.username, ...changed });
    return this.listUsers().then((r) => r.users.find((x) => x.id === id));
  }

  // ---- rôles et permissions (ADM-003 : gérés séparément des comptes) ----
  async listRoles() {
    const { rows } = await this.db.query(
      `SELECT r.id, r.name, r.description, r.protected,
              COALESCE(array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
              (SELECT count(*)::int FROM admin_user_roles ur WHERE ur.role_id = r.id) AS user_count
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`);
    return { roles: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, protected: r.protected, permissions: r.permissions, userCount: r.user_count })) };
  }

  async listPermissions() {
    return { permissions: (await this.db.query('SELECT code, description FROM permissions ORDER BY code')).rows };
  }

  private async assertPermissions(codes: string[]) {
    const { rows } = await this.db.query('SELECT code FROM permissions WHERE code = ANY($1)', [codes]);
    const known = new Set(rows.map((r) => r.code));
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length) throw new UnprocessableEntityException({ code: 'UNKNOWN_PERMISSION', message: `Permission inconnue : ${unknown.join(', ')}` });
  }

  async createRole(by: AdminPrincipal, ip: string | undefined, dto: CreateRoleDto) {
    await this.assertPermissions(dto.permissions);
    if ((await this.db.query('SELECT 1 FROM roles WHERE name=$1', [dto.name])).rowCount) {
      throw new ConflictException({ code: 'ROLE_EXISTS', message: 'Ce rôle existe déjà.' });
    }
    const id = (await this.db.query('INSERT INTO roles (name, description) VALUES ($1,$2) RETURNING id', [dto.name, dto.description ?? null])).rows[0].id;
    for (const p of dto.permissions) await this.db.query('INSERT INTO role_permissions VALUES ($1,$2)', [id, p]);
    await this.audit.log(actorOf(by, ip), 'ROLE_CREATED', `role:${id}`, { name: dto.name, permissions: dto.permissions });
    return { id, name: dto.name, permissions: dto.permissions };
  }

  async updateRole(by: AdminPrincipal, ip: string | undefined, id: string, dto: UpdateRoleDto) {
    const role = (await this.db.query('SELECT * FROM roles WHERE id=$1', [id])).rows[0];
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Rôle introuvable.' });
    if (role.protected && dto.permissions) throw new ConflictException({ code: 'ROLE_PROTECTED', message: 'Les permissions de ce rôle ne sont pas modifiables.' });
    const before = (await this.db.query('SELECT permission_code FROM role_permissions WHERE role_id=$1 ORDER BY 1', [id])).rows.map((r) => r.permission_code);
    if (dto.permissions) {
      await this.assertPermissions(dto.permissions);
      await this.db.query('DELETE FROM role_permissions WHERE role_id=$1', [id]);
      for (const p of dto.permissions) await this.db.query('INSERT INTO role_permissions VALUES ($1,$2)', [id, p]);
    }
    if (dto.description !== undefined) await this.db.query('UPDATE roles SET description=$2 WHERE id=$1', [id, dto.description]);
    await this.audit.log(actorOf(by, ip), 'ROLE_UPDATED', `role:${id}`, { name: role.name, permissionsFrom: before, permissionsTo: dto.permissions });
    return (await this.listRoles()).roles.find((r) => r.id === id);
  }

  async updatePermission(by: AdminPrincipal, ip: string | undefined, code: string, description: string) {
    const r = await this.db.query('UPDATE permissions SET description=$2 WHERE code=$1 RETURNING code, description', [code, description]);
    if (!r.rowCount) throw new NotFoundException({ code: 'PERMISSION_NOT_FOUND', message: 'Permission introuvable.' });
    await this.audit.log(actorOf(by, ip), 'PERMISSION_UPDATED', `permission:${code}`, { description });
    return r.rows[0];
  }
}
