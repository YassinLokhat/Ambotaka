-- Idempotence des signalements rejoués depuis la file hors ligne du téléphone.
ALTER TABLE reports ADD COLUMN client_report_id uuid;
CREATE UNIQUE INDEX reports_client_idem ON reports (installation_id, client_report_id) WHERE client_report_id IS NOT NULL;

-- Demandes de suppression (PRI-005..008). Pas de clé étrangère vers driver_installations : la trace de la
-- demande subsiste (sans donnée personnelle) même après effacement complet de l'installation.
CREATE TABLE deletion_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  types           text[] NOT NULL,
  status          text NOT NULL DEFAULT 'EN_COURS' CHECK (status IN ('EN_COURS','CONFIRMEE','ECHEC')),
  result          jsonb,
  attempts        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT deletion_idempotency UNIQUE (installation_id, idempotency_key)
);
