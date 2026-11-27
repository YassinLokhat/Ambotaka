import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import { DatabaseService } from '../../shared/database/database.service';
import { MIN_PASSWORD_LENGTH } from './admin-auth.service';

const BOOTSTRAP_LOCK = 7_340_129;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly config: ConfigService, private readonly db: DatabaseService) {}

  async onApplicationBootstrap() {
    if (this.config.get<string>('nodeEnv') === 'test') return;

    const username = this.config.get<string>('adminBootstrapUsername') ?? '';
    const password = this.config.get<string>('adminBootstrapPassword') ?? '';
    if (!username && !password) return;
    if (!username || !password) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME et ADMIN_BOOTSTRAP_PASSWORD doivent être définis ensemble.');
    }

    const normalizedUsername = username.toLowerCase();
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME doit contenir 3 à 32 caractères parmi a-z, 0-9, point, tiret et soulignement.');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`ADMIN_BOOTSTRAP_PASSWORD doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }

    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);

      const { rows: users } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM admin_users');
      if (Number(users[0].count) > 0) {
        const { rows: existing } = await client.query<{ id: string; is_super_admin: boolean }>(
          `SELECT u.id, EXISTS (
             SELECT 1 FROM admin_user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.admin_id = u.id AND r.name = 'SUPER_ADMIN'
           ) AS is_super_admin
           FROM admin_users u WHERE u.username = $1`,
          [normalizedUsername],
        );
        if (existing[0]?.is_super_admin) {
          this.logger.log(`Le compte administrateur initial « ${normalizedUsername} » existe déjà.`);
        } else {
          this.logger.warn('Amorçage ignoré : la base contient déjà un compte administrateur. Aucun compte ni mot de passe n’a été modifié.');
        }
        await client.query('COMMIT');
        return;
      }

      const { rows: roles } = await client.query<{ id: string }>(
        "SELECT id FROM roles WHERE name = 'SUPER_ADMIN'",
      );
      if (!roles[0]) {
        throw new Error('Le rôle SUPER_ADMIN est absent. Appliquez les migrations avant de démarrer l’API.');
      }

      const passwordHash = await hash(password);
      const { rows: created } = await client.query<{ id: string }>(
        'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [normalizedUsername, passwordHash],
      );
      await client.query('INSERT INTO admin_user_roles (admin_id, role_id) VALUES ($1, $2)', [created[0].id, roles[0].id]);
      await client.query(
        `INSERT INTO audit_logs (admin_id, admin_username, action, resource, details)
         VALUES ($1, $2, 'ADMIN_BOOTSTRAPPED', $3, $4)`,
        [created[0].id, normalizedUsername, `admin_user:${created[0].id}`, JSON.stringify({ role: 'SUPER_ADMIN' })],
      );
      await client.query('COMMIT');
      this.logger.log(`Compte administrateur initial « ${normalizedUsername} » créé avec le rôle SUPER_ADMIN.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
