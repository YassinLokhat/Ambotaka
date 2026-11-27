# RoadPulse — Lots 1 à 8 + préparation TomTom / production

Monorepo (spec v1.1). Ce lot fournit : backend NestJS (monolithe modulaire), PostgreSQL + PostGIS, Redis, Docker, CI, format d'erreur homogène, `/api/v1/health`, Swagger, migrations SQL versionnées.

## Démarrage

```bash
cp .env.example .env
docker compose up -d postgres redis
cd backend
npm install
npm run migrate
npm run start:dev
```

- Santé : http://localhost:3000/api/v1/health
- OpenAPI : http://localhost:3000/api/docs
- Tests : `npm test`
- Tout en Docker : `docker compose --profile full up --build`

## Application mobile (Lot 2)

```bash
cd mobile-android
cp .env.example .env      # EXPO_PUBLIC_API_URL = http://10.0.2.2:3000/api/v1 (émulateur)
npm install
npx expo run:android      # development build natif (MapLibre/Location : pas Expo Go)
```

Backend : renseigner `MAP_PROVIDER` (`mapbox` ou `tomtom`) et `MAP_API_KEY` dans `.env`.
Endpoints : `GET /api/v1/places/search?q=…&lat=…&lon=…` et `POST /api/v1/routes/search`.

## Lot 3 : navigation et restauration

Logique pure et testée dans `mobile-android/src/feature/navigation/session/` (`npm test` dans `mobile-android`) :
règle des 24 h (T0 = première interruption), expiration conservatrice si l'horloge est incohérente, durée effective, résumés sans trace GPS (30 jours), persistance SQLite.
L'état de session fait foi en local ; les endpoints serveur de sessions viendront avec la synchronisation (Lot 7).

## Lot 4 : signalements et incidents

- `POST /api/v1/reports` (en-tête `X-Installation-Id` = UUID aléatoire généré par l'app) : valide, rapproche d'un incident proche du même type (PostGIS, rayon configurable) ou en crée un.
- `GET /api/v1/incidents?lat&lon&radiusMeters` · `GET /api/v1/incidents/:id` · `POST /api/v1/incidents/:id/confirmations` (`CONFIRMATION` | `CONTESTATION`, une réponse par installation).
- Seuils (rayon, durée de vie, confiance, anti-abus) dans la table `system_parameters`, **valeurs initiales à calibrer au pilote**.
- Tests d'intégration PostGIS : `DATABASE_URL=... npm run migrate && npm test` dans `backend` (ignorés sans `DATABASE_URL`).

## Lot 5 : trafic communautaire

- `PUT /api/v1/consents/statistics` · `GET /api/v1/consents` : consentement statistique, distinct de la permission GPS. Le retrait supprime les observations brutes côté serveur (rejouable).
- `POST /api/v1/traffic-observations` : lots de 100 max, refusés (403) sans consentement ; validation, appariement PostGIS au segment le plus proche, déduplication. **Aucune coordonnée brute n'est stockée.**
- `GET /api/v1/traffic?lat&lon` : agrégats frais avec source, fraîcheur et confiance ; `DONNEES_INSUFFISANTES` si rien n'est publiable (jamais « fluide » par défaut).
- Publication d'un tronçon seulement à partir de N contributeurs distincts (paramètre, 3 par défaut).
- **Réseau routier requis** : importer un GeoJSON OSM d'Antananarivo avec
  `node backend/scripts/import-segments.js roads.geojson 150` (tronçons découpés à ~150 m ; vitesses de référence estimées par classe de route).
  Sans segments, aucune observation n'est appariée.

## Lot 6 : recommandations d'itinéraires

- `POST /api/v1/recommendations/evaluate` : l'appli envoie la partie restante de l'itinéraire ; le serveur calcule les alternatives, retrouve l'itinéraire courant parmi les candidats, estime les retards (trafic communautaire frais + incidents fiables) **avec la même méthode pour tous** et ne répond que si le gain, la confiance et les données le justifient.
- `PATCH /api/v1/recommendations/:id/decision` (`ACCEPTEE` | `IGNOREE`) : une recommandation expirée (120 s par défaut) ne peut plus être acceptée. `GET /api/v1/recommendations?sessionId=` pour l'historique.
- Aucune géométrie d'itinéraire n'est conservée côté serveur. Les pénalités d'incident (`reco.penalty.*`) sont des **estimations arbitraires** à calibrer au pilote.

## Lot 7 : confidentialité et synchronisation robuste

- `POST /api/v1/deletion-requests` (`idempotencyKey` + `types` : `GPS_OBSERVATIONS`, `INCIDENT_CONTRIBUTIONS`, `RECOMMENDATIONS` ou `ALL`) : idempotente, limitée à l'installation, « CONFIRMEE » seulement après exécution complète. `GET /deletion-requests[/:id]` pour le suivi.
- Registre d'effacement : chaque domaine déclare comment effacer ses données (pas de dépendance croisée).
- `POST /reports` accepte `clientReportId` : rejeu sans doublon (file hors ligne).
- Mobile : file persistante (SQLite) de suppressions et de signalements, backoff exponentiel avec gigue, suppressions prioritaires, aucune retransmission de données dont la suppression est en attente, notifications locales sans coordonnées (suppression confirmée / bloquée), tâche d'arrière-plan + reprise à l'ouverture, au retour au premier plan et toutes les 30 s.
- SDK 52 : `expo-background-fetch` ; à migrer vers `expo-background-task` en passant au SDK 53+.

## Lot 8 : console d'administration et supervision

**Premier administrateur** (automatique au démarrage de l'API après les migrations) : définir `ADMIN_BOOTSTRAP_USERNAME` (3–32 caractères : a-z, 0-9, `.`, `_`, `-`) et `ADMIN_BOOTSTRAP_PASSWORD` (12 caractères minimum) dans l'environnement du backend. Le compte reçoit le rôle `SUPER_ADMIN` uniquement si la base ne contient encore aucun administrateur ; les comptes existants et leurs mots de passe ne sont jamais modifiés. Retirer ces variables après la création initiale. Aucun identifiant ni mot de passe par défaut n'est codé dans l'application.

Création manuelle alternative (après `npm run migrate`) :
```bash
cd backend && node scripts/create-admin.js mon.admin 'un-mot-de-passe-de-12-caracteres-min'
```
**Console web** (`admin-web`, Next.js) :
```bash
cd admin-web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3001
```
- **Authentification** : mots de passe Argon2id, JWT d'accès 15 min, jeton de rafraîchissement **rotatif** (rejouer un ancien jeton révoque la session), verrouillage après 5 échecs / 15 min (aussi pour les comptes inexistants), sessions révoquées côté serveur à la déconnexion, au changement de mot de passe et à la désactivation.
- **Console = BFF** : les jetons restent dans des cookies `httpOnly` + `SameSite=Strict` ; le JavaScript de la page ne les voit jamais. En-tête anti-CSRF exigé sur toute écriture ; relais limité à `/admin/*`.
- **RBAC** : permissions relues en base à chaque requête (un changement de rôle s'applique au jeton déjà émis). Rôles initiaux : `SUPER_ADMIN` (protégé), `OPERATEUR`, `AUDITEUR`. Impossible de supprimer le dernier super administrateur actif.
- **Audit** : connexions, refus, gestion des comptes/rôles, changements de configuration (ancienne et nouvelle valeur), modération, traitement des incidents. Table **append-only** (triggers SQL interdisant UPDATE/DELETE/TRUNCATE).
- **Supervision** : métriques toutes les 60 s, règles d'anomalie (erreurs 5xx, latence p95, agrégation en retard, suppressions bloquées, Redis si activé, panne de base consignée au rétablissement), incidents techniques + alertes (acquittement), export Prometheus `GET /api/v1/metrics` (`docker compose --profile monitoring up`).
- **Production** : `JWT_SECRET` (≥ 32 car.) et `METRICS_TOKEN` obligatoires ; servir la console en HTTPS (cookies `Secure`).

## TomTom et mise en production

- Fournisseur par défaut : **TomTom Orbis** (Routing v3 + Search v1). Deux clés distinctes : serveur (secrète) et carte (embarquée, Maps seul).
- Vérification réelle à Antananarivo : `MAP_API_KEY=… node backend/scripts/tomtom-check.js`.
- Sauvegarde / restauration : `infrastructure/scripts/backup.sh` et `restore.sh`.
- Check-list complète, décisions à prendre et limites : **`docs/deploiement.md`**.

## Suite
Lot 0 (prototype fournisseur carte/routage/trafic) puis Lot 2 (carte + recherche d'itinéraire).
Note : la spec cite TomTom ; vous avez évoqué Mapbox — l'adaptateur `RoutingProvider` permettra de trancher sans toucher au métier.
