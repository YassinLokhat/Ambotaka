CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE driver_installations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  app_version   text
);

CREATE TABLE road_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id  text UNIQUE,
  name         text,
  direction    text,
  length_m     double precision,
  geom         geometry(LineString, 4326) NOT NULL
);
CREATE INDEX road_segments_geom_gist ON road_segments USING gist (geom);

CREATE TABLE statistical_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES driver_installations(id) ON DELETE CASCADE,
  granted         boolean NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  policy_version  text NOT NULL
);
CREATE INDEX statistical_consents_installation ON statistical_consents (installation_id, decided_at DESC);
