ALTER TABLE road_segments
  ADD COLUMN oneway boolean NOT NULL DEFAULT false,
  ADD COLUMN free_flow_kph double precision;   -- vitesse de référence (estimée par classe de route), NULL => état INCONNU
CREATE INDEX road_segments_geog_gist ON road_segments USING gist ((geom::geography));

-- Minimisation (spec §12.3) : aucune coordonnée brute n'est conservée. Seuls le segment apparié,
-- le sens, la vitesse et l'horodatage subsistent, avec l'identifiant pseudonyme pour pouvoir supprimer.
CREATE TABLE gps_observations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id       uuid NOT NULL REFERENCES driver_installations(id) ON DELETE CASCADE,
  client_obs_id         uuid NOT NULL,
  observed_at           timestamptz NOT NULL,
  received_at           timestamptz NOT NULL DEFAULT now(),
  segment_id            uuid NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
  direction             smallint NOT NULL CHECK (direction IN (-1, 0, 1)),
  speed_kph             real NOT NULL CHECK (speed_kph >= 0),
  consent_policy_version text NOT NULL,
  app_version           text,
  CONSTRAINT obs_dedup UNIQUE (installation_id, client_obs_id)
);
CREATE INDEX gps_obs_segment_time ON gps_observations (segment_id, direction, observed_at);
CREATE INDEX gps_obs_time ON gps_observations (observed_at);

CREATE TABLE traffic_statistics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id        uuid NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
  direction         smallint NOT NULL,
  window_start      timestamptz NOT NULL,
  window_end        timestamptz NOT NULL,
  mean_speed_kph    double precision NOT NULL,
  median_speed_kph  double precision NOT NULL,
  sample_count      integer NOT NULL,
  contributor_count integer NOT NULL,
  confidence        double precision NOT NULL,
  state             text NOT NULL CHECK (state IN ('FLUIDE','RALENTI','CONGESTIONNE','INCONNU')),
  source            text NOT NULL DEFAULT 'CROWDSOURCED_GPS',
  computed_at       timestamptz NOT NULL DEFAULT now(),
  valid_until       timestamptz NOT NULL,
  CONSTRAINT stat_unique UNIQUE (segment_id, direction, window_start)
);
CREATE INDEX traffic_stats_valid ON traffic_statistics (valid_until);

-- Seuils NON validés (spec §6.3) : à calibrer pendant le pilote.
INSERT INTO system_parameters (key, value, description) VALUES
 ('traffic.matchMaxDistanceMeters', '25', 'Distance max position -> segment pour l''appariement'),
 ('traffic.maxAccuracyMeters', '30', 'Précision GPS maximale acceptée'),
 ('traffic.maxSpeedMps', '45', 'Vitesse maximale plausible (m/s)'),
 ('traffic.maxObservationAgeSeconds', '600', 'Ancienneté maximale d''une observation'),
 ('traffic.windowMinutes', '5', 'Fenêtre d''agrégation'),
 ('traffic.minContributors', '3', 'Contributeurs distincts minimum avant publication (non-réidentification)'),
 ('traffic.minSamples', '6', 'Échantillons minimum avant publication'),
 ('traffic.validityMinutes', '15', 'Durée de fraîcheur après la fin de fenêtre'),
 ('traffic.fullContributors', '8', 'Contributeurs pour la confiance maximale'),
 ('traffic.fullSamples', '40', 'Échantillons pour la confiance maximale'),
 ('traffic.fluidRatio', '0.7', 'Vitesse/vitesse de référence au-dessus de laquelle la route est fluide'),
 ('traffic.slowRatio', '0.4', 'Ratio au-dessus duquel la route est ralentie (sinon congestionnée)'),
 ('traffic.rawRetentionHours', '24', 'Conservation des observations brutes — À VALIDER (juridique)'),
 ('traffic.statsRetentionDays', '30', 'Conservation des agrégats — À VALIDER');
