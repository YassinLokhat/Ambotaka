CREATE TABLE system_parameters (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Valeurs initiales NON validées métier (spec INC-009 / §18) : à calibrer pendant le pilote.
INSERT INTO system_parameters (key, value, description) VALUES
 ('incident.matchRadiusMeters', '150', 'Rayon de rapprochement d''un signalement à un incident (m)'),
 ('incident.ttlMinutes', '60', 'Durée de vie d''un incident sans nouvelle activité positive'),
 ('incident.scoreForFullConfidence', '4', 'Score pour une confiance de 1'),
 ('incident.confirmThreshold', '0.5', 'Confiance minimale pour passer DETECTE -> CONFIRME'),
 ('incident.contestationWeight', '1.5', 'Poids d''une contestation dans le score'),
 ('incident.minContestationsToReject', '2', 'Contestations minimales avant rejet automatique'),
 ('incident.rejectScore', '0', 'Score au plus égal auquel un incident contesté expire'),
 ('report.maxPerWindow', '5', 'Signalements max par installation et par fenêtre'),
 ('report.windowMinutes', '10', 'Fenêtre anti-abus'),
 ('report.maxAgeSeconds', '600', 'Ancienneté maximale de l''observation déclarée');

CREATE TABLE incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type               text NOT NULL CHECK (type IN ('ACCIDENT','EMBOUTEILLAGE','ROUTE_BLOQUEE','TRAVAUX','DANGER','AUTRE')),
  description        text,
  status             text NOT NULL DEFAULT 'DETECTE' CHECK (status IN ('DETECTE','CONFIRME','EN_COURS','RESOLU','EXPIRE')),
  geom               geometry(Point, 4326) NOT NULL,
  confidence         double precision NOT NULL DEFAULT 0,
  reporter_count     integer NOT NULL DEFAULT 0,
  confirmation_count integer NOT NULL DEFAULT 0,
  contestation_count integer NOT NULL DEFAULT 0,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  expires_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_geom_gist ON incidents USING gist (geom);
CREATE INDEX incidents_geog_gist ON incidents USING gist ((geom::geography));
CREATE INDEX incidents_active ON incidents (status, expires_at);

CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES driver_installations(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('ACCIDENT','EMBOUTEILLAGE','ROUTE_BLOQUEE','TRAVAUX','DANGER','AUTRE')),
  description     text,
  geom            geometry(Point, 4326) NOT NULL,
  status          text NOT NULL DEFAULT 'SOUMIS' CHECK (status IN ('SOUMIS','EN_VERIFICATION','VALIDE','REJETE','EXPIRE')),
  incident_id     uuid REFERENCES incidents(id) ON DELETE SET NULL,  -- INC-004 : zéro ou un incident
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX reports_installation_created ON reports (installation_id, created_at DESC);
CREATE INDEX reports_incident ON reports (incident_id);
CREATE INDEX reports_geom_gist ON reports USING gist (geom);

CREATE TABLE incident_confirmations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES driver_installations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('CONFIRMATION','CONTESTATION')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_response_per_installation UNIQUE (incident_id, installation_id)  -- INC-006
);
