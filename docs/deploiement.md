# Déploiement et mise en pilote — RoadPulse

Ce document liste **ce qui reste à faire hors du code**. Les éléments marqués ⚠ sont des décisions ou vérifications que le code ne peut pas prendre à votre place.

## 1. TomTom (fournisseur retenu : famille **Orbis**)

- [ ] Créer **deux clés** sur le portail TomTom :
  - **Clé serveur** (secrète) : services *Routing* et *Search* → `MAP_API_KEY` du backend.
  - **Clé carte** (embarquée dans l'app, donc visible) : service *Maps* **uniquement** → `EXPO_PUBLIC_TOMTOM_MAP_KEY`.
- [ ] Lancer `MAP_API_KEY=… node backend/scripts/tomtom-check.js` : il teste le style de carte, la recherche (Madagascar), 3 itinéraires, le guidage et l'écart trafic « live » / « historique ».
- [ ] ⚠ **Couverture Search/Geocoding de Madagascar** : non confirmée par les pages TomTom que j'ai consultées. Si la recherche ne renvoie rien, la sélection de destination par recherche est inutilisable : prévoir la sélection sur la carte (déjà disponible) ou un autre fournisseur de géocodage.
- [ ] ⚠ **Trafic temps réel** : TomTom ne l'indique pas pour Madagascar. Garder `MAP_TRAFFIC_VALIDATED=false` tant que le script et un test terrain ne montrent pas le contraire (l'app affiche alors « durée de référence »).
- [ ] Les points du script sont **approximatifs** : les ajuster s'ils sont rejetés comme « trop éloignés d'une route ».
- [ ] ⚠ **Conditions d'utilisation** : texte d'attribution à afficher (`EXPO_PUBLIC_MAP_ATTRIBUTION`, « © TomTom » par défaut), quotas, coûts, conservation et cache autorisés.
- [ ] Vérifier sur un appareil que les tuiles se chargent (le script indique si l'URL de tuiles contient la clé).

## 2. Backend

### Déployer sur Render sans Docker

Le Blueprint [`render.yaml`](../render.yaml) déclare l'API NestJS en runtime Node natif, Render Postgres et Render Key Value (compatible Redis/Valkey). Il n'utilise ni le Dockerfile du backend ni `docker-compose.yml`.

1. Pousser `dev` sur GitHub, puis dans Render choisir **New > Blueprint** et connecter le dépôt/la branche `dev`.
2. Vérifier les ressources et leurs coûts avant de confirmer : ce Blueprint choisit les plans payants `0.5c-512mb` (API), `0.5c-1g` (Postgres) et `256mb` (Key Value), dans la région Singapore.
3. Lors de la première synchronisation, saisir `MAP_API_KEY` comme secret. `JWT_SECRET` et `METRICS_TOKEN` sont générés par Render. La clé TomTom serveur ne doit jamais être mise dans le dépôt.
4. Render compile l'API, lance `npm run migrate` avant le démarrage et vérifie `/api/v1/health` (Postgres **et** Redis doivent répondre). La migration active PostGIS, disponible sur Render Postgres.
5. Après le premier déploiement, ouvrir le Shell du service `roadpulse-api` et créer le premier administrateur : `node scripts/create-admin.js <identifiant> '<mot de passe ≥ 12 caractères>'`.
6. Utiliser l'URL `https://roadpulse-api.onrender.com/api/v1` comme `EXPO_PUBLIC_API_URL` dans les profils EAS. Pour héberger aussi `admin-web`, définir son `BACKEND_URL` sur cette URL avec `/api/v1`.

Les plans gratuits ne sont pas adaptés à des données durables : le service web s'endort, la base Postgres gratuite expire après 30 jours et le Key Value gratuit perd ses données lors d'un redémarrage. Les prix exacts dépendent de Render et sont affichés avant la création. Le backend peut rester sur Render natif même si Docker est retiré du flux de déploiement; les fichiers Docker existants peuvent être conservés pour un usage local.

- [ ] PostgreSQL 16 **avec PostGIS** ; `npm run migrate` ; Redis (réservé pour BullMQ / limiteurs : voir paramètre `monitor.redisEnabled`).
- [ ] Variables : `DATABASE_URL`, `JWT_SECRET` (≥ 32 caractères : `openssl rand -base64 48`), `METRICS_TOKEN`, `MAP_*`, `CORS_ORIGINS`, `TRUST_PROXY` (nombre de proxys), `NODE_ENV=production`.
- [ ] HTTPS devant l'API (reverse proxy) ; l'API ne parle qu'en HTTP en interne.
- [ ] Importer le **réseau routier d'Antananarivo** : `node backend/scripts/import-segments.js roads.geojson 150` (export OpenStreetMap). Sans lui, aucune mesure de trafic.
- [ ] Créer le premier administrateur : `node backend/scripts/create-admin.js <identifiant> '<mot de passe ≥ 12 car.>'`.
- [ ] Sauvegardes : planifier `infrastructure/scripts/backup.sh` (cron), **chiffrer et copier hors serveur**, et **tester la restauration** (`restore.sh`) sur une base vide au moins une fois avant le pilote. Aller-retour validé en local (6 migrations, données et PostGIS restaurés à l'identique).
- [ ] Supervision : protéger `/api/v1/metrics` avec `METRICS_TOKEN` (fourni par Render) et configurer un collecteur Prometheus externe si nécessaire ; aucun service Prometheus/Grafana n'est créé par le Blueprint.

## 3. Console d'administration (`admin-web`)

- [ ] `BACKEND_URL` vers l'API ; la servir en **HTTPS** (cookies `Secure` en production) ; la restreindre par réseau/VPN si possible.
- [ ] Changer tout mot de passe d'amorçage ; créer des comptes nominatifs ; limiter `SUPER_ADMIN`.

## 4. Application Android (EAS Build)

- [ ] `eas.json` : profils `development`, `preview` (APK interne), `production` (AAB). Le trafic HTTP en clair n'est autorisé **que hors production** (`app.config.js`).
- [ ] Renseigner `EXPO_PUBLIC_API_URL` (**https**) et `EXPO_PUBLIC_TOMTOM_MAP_KEY` pour chaque profil (variables EAS ou `env` du profil).
- [ ] Premier `eas build --profile development --platform android` puis tests sur **appareils réels** (GPS arrière-plan, notifications, MapLibre).
- [ ] Google Play : fiche, politique de confidentialité publique, déclaration de collecte de la localisation.

## 5. Décisions à prendre (je ne peux pas les trancher)

| Sujet | Valeur actuelle | Décision attendue |
|---|---|---|
| ⚠ Conservation des observations brutes | 24 h (paramètre `traffic.rawRetentionHours`) | Avis juridique / produit |
| ⚠ Conservation des agrégats, journaux techniques, audit, métriques | 30 j / non purgés / non purgé / 14 j | Durées par catégorie |
| ⚠ Texte de politique de confidentialité et de consentement | version `2026-11-v1`, texte court dans l'app | Rédaction et validation |
| ⚠ Seuils métier (rayon d'incident, confiance, gain minimal, pénalités d'incident, contributeurs minimum) | valeurs de départ arbitraires | Calibrage pendant le pilote |
| ⚠ Authentification des conducteurs | aucun compte (identifiant d'installation) | Garder ou non pour la V1 |
| ⚠ Version Android minimale | non définie | Après essais sur appareils |

## 6. Ce qui n'a PAS été fait / vérifié

- Aucun essai sur téléphone ou émulateur (build natif, GPS arrière-plan, notifications, rendu de la carte).
- Aucun appel réel à TomTom (formats lus dans la documentation, testés avec des réponses simulées) : le script ci-dessus est fait pour combler ce manque.
- Pas de test de charge, pas d'audit de sécurité externe, pas de test d'intrusion.
- Le Blueprint Render déploie l'API depuis `dev` ; la console `admin-web` et l'application Android ne sont pas incluses dans ce déploiement.
- Les alertes techniques sont visibles dans la console uniquement (pas de courriel/SMS).
- Pas de suivi GPS garanti en arrière-plan (limites Android) ; navigation hors ligne non disponible (cartes hors ligne non validées).
