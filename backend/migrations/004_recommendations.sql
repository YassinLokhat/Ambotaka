-- Aucune géométrie d'itinéraire n'est conservée (données de localisation) : seulement des métriques.
CREATE TABLE route_recommendations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id      uuid NOT NULL REFERENCES driver_installations(id) ON DELETE CASCADE,
  session_id           text NOT NULL,                 -- identifiant de session généré par l'appli (la session vit sur le téléphone)
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  current_duration_s   integer NOT NULL,
  current_adjusted_s   integer NOT NULL,
  proposed_duration_s  integer NOT NULL,
  proposed_adjusted_s  integer NOT NULL,
  gain_s               integer NOT NULL,
  confidence           double precision NOT NULL,
  motif                text NOT NULL,
  reasons              jsonb NOT NULL,
  proposed_hash        text NOT NULL,                 -- empreinte de l'itinéraire proposé (anti-répétition)
  decision             text NOT NULL DEFAULT 'EN_ATTENTE' CHECK (decision IN ('EN_ATTENTE','ACCEPTEE','IGNOREE','EXPIREE')),
  decided_at           timestamptz
);
CREATE INDEX reco_installation_session ON route_recommendations (installation_id, session_id, created_at DESC);

-- Valeurs NON validées métier (spec REC-004/005, §18) : pénalités d'incident = estimations arbitraires à calibrer.
INSERT INTO system_parameters (key, value, description) VALUES
 ('reco.ttlSeconds', '120', 'Durée de validité d''une recommandation'),
 ('reco.minGainSeconds', '120', 'Gain minimal (s) pour proposer une alternative'),
 ('reco.minGainRatio', '0.1', 'Gain minimal relatif à la durée ajustée de l''itinéraire courant'),
 ('reco.minConfidence', '0.5', 'Confiance minimale pour émettre une recommandation'),
 ('reco.minRouteMatch', '0.8', 'Part de l''itinéraire courant retrouvée parmi les candidats du fournisseur'),
 ('reco.matchToleranceMeters', '40', 'Tolérance d''appariement des itinéraires (m)'),
 ('reco.minTrafficConfidence', '0.3', 'Confiance minimale d''un agrégat de trafic pour être utilisé'),
 ('reco.minIncidentConfidence', '0.5', 'Confiance minimale d''un incident pour être pris en compte'),
 ('reco.penalty.ACCIDENT', '600', 'Retard estimé (s) — arbitraire, à calibrer'),
 ('reco.penalty.EMBOUTEILLAGE', '420', 'Retard estimé (s) — arbitraire, à calibrer'),
 ('reco.penalty.ROUTE_BLOQUEE', '1800', 'Retard estimé (s) — arbitraire, à calibrer'),
 ('reco.penalty.TRAVAUX', '240', 'Retard estimé (s) — arbitraire, à calibrer'),
 ('reco.penalty.DANGER', '60', 'Retard estimé (s) — arbitraire, à calibrer'),
 ('reco.penalty.AUTRE', '0', 'Retard estimé (s)'),
 ('reco.ignoreCooldownSeconds', '600', 'Délai avant de reproposer un itinéraire ignoré'),
 ('reco.minIntervalSeconds', '30', 'Intervalle minimal entre deux évaluations par installation'),
 ('reco.retentionHours', '24', 'Conservation des recommandations — À VALIDER');
