CREATE TABLE permissions (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, description text,
  protected boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code));

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE, password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz);
CREATE TABLE admin_user_roles (
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (admin_id, role_id));

-- Sessions côté serveur : la déconnexion les révoque (ADM-005). Seuls des empreintes de jetons sont stockées.
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL, previous_refresh_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, revoked_reason text, user_agent text);
CREATE INDEX admin_sessions_refresh ON admin_sessions (refresh_hash);
CREATE INDEX admin_sessions_prev ON admin_sessions (previous_refresh_hash);

-- Tentatives de connexion, y compris pour des identifiants inexistants (pas d'énumération de comptes).
CREATE TABLE authentication_attempts (
  id bigserial PRIMARY KEY, username text NOT NULL, success boolean NOT NULL, reason text,
  ip text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_attempts_user_time ON authentication_attempts (username, at DESC);

-- Journal d'audit append-only. Pas de clé étrangère : l'entrée survit à la suppression du compte.
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  admin_id uuid, admin_username text, action text NOT NULL, resource text, details jsonb NOT NULL DEFAULT '{}', ip text);
CREATE INDEX audit_logs_time ON audit_logs (at DESC, id DESC);
CREATE INDEX audit_logs_action ON audit_logs (action, at DESC);
CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs est en ajout seul (append-only)'; END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

CREATE TABLE configuration_history (
  id bigserial PRIMARY KEY, key text NOT NULL, old_value jsonb, new_value jsonb NOT NULL,
  admin_id uuid, admin_username text, at timestamptz NOT NULL DEFAULT now());

-- Supervision
CREATE TABLE system_metrics (
  id bigserial PRIMARY KEY, name text NOT NULL, value double precision NOT NULL, unit text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX system_metrics_name_time ON system_metrics (name, at DESC);

CREATE TABLE technical_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule text NOT NULL, service text NOT NULL, title text NOT NULL, description text,
  severity text NOT NULL CHECK (severity IN ('FAIBLE','MOYEN','ELEVE','CRITIQUE')),
  status text NOT NULL DEFAULT 'OUVERT' CHECK (status IN ('OUVERT','EN_COURS','RESOLU','CLOTURE')),
  opened_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1, resolved_at timestamptz, resolved_by text);
CREATE INDEX technical_incidents_open ON technical_incidents (rule, status);

CREATE TABLE technical_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES technical_incidents(id) ON DELETE CASCADE,
  message text NOT NULL, severity text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz, acknowledged_by text);

INSERT INTO permissions (code, description) VALUES
 ('admin.users.read', 'Lister les administrateurs'), ('admin.users.write', 'Créer et modifier les administrateurs'),
 ('admin.roles.read', 'Lister rôles et permissions'), ('admin.roles.write', 'Gérer les rôles et permissions'),
 ('admin.config.read', 'Consulter la configuration'), ('admin.config.write', 'Modifier la configuration'),
 ('admin.audit.read', 'Consulter le journal d''audit'), ('admin.metrics.read', 'Consulter métriques et santé des services'),
 ('admin.community.read', 'Consulter signalements et incidents'), ('admin.community.write', 'Modérer les incidents communautaires'),
 ('admin.traffic.read', 'Consulter le trafic agrégé'), ('admin.privacy.read', 'Superviser suppressions et synchronisation'),
 ('admin.tech.read', 'Consulter incidents techniques et alertes'), ('admin.tech.write', 'Traiter incidents techniques et alertes');

INSERT INTO roles (name, description, protected) VALUES
 ('SUPER_ADMIN', 'Tous les droits (rôle protégé)', true),
 ('OPERATEUR', 'Exploitation : supervision, modération, incidents techniques', false),
 ('AUDITEUR', 'Lecture seule : audit et métriques', false);
INSERT INTO role_permissions SELECT r.id, p.code FROM roles r, permissions p WHERE r.name = 'SUPER_ADMIN';
INSERT INTO role_permissions SELECT r.id, p.code FROM roles r, permissions p WHERE r.name = 'OPERATEUR'
  AND p.code IN ('admin.metrics.read','admin.community.read','admin.community.write','admin.traffic.read','admin.privacy.read','admin.tech.read','admin.tech.write','admin.config.read');
INSERT INTO role_permissions SELECT r.id, p.code FROM roles r, permissions p WHERE r.name = 'AUDITEUR'
  AND p.code IN ('admin.audit.read','admin.metrics.read','admin.tech.read');

-- Seuils de supervision NON validés : à calibrer avec l'exploitation réelle.
INSERT INTO system_parameters (key, value, description) VALUES
 ('monitor.redisEnabled', '0', 'Mettre à 1 quand Redis est réellement utilisé (BullMQ, limiteurs) : active la règle REDIS_DOWN'),
 ('monitor.errorRate', '0.05', 'Taux d''erreurs 5xx déclenchant une alerte (fenêtre de 5 min)'),
 ('monitor.latencyP95Ms', '2000', 'Latence p95 déclenchant une alerte (ms)'),
 ('monitor.minRequests', '20', 'Requêtes minimales dans la fenêtre avant d''évaluer erreurs/latence'),
 ('monitor.aggregationStaleMinutes', '10', 'Retard d''agrégation tolérable alors que des observations arrivent'),
 ('monitor.deletionStuckHours', '1', 'Âge au-delà duquel une suppression non confirmée est signalée'),
 ('monitor.metricsRetentionDays', '14', 'Conservation des métriques — À VALIDER');
