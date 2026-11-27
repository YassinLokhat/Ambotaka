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

1. Dans Render, choisir **New > Blueprint** (pas **New > Web Service**), connecter le dépôt GitHub `YassinLokhat/Ambotaka`, sélectionner la branche `dev` et le Blueprint `/render.yaml` à la racine.
2. Si un service `roadpulse-api` a déjà été créé manuellement (Docker ou Node), ne crée pas un second service sans vérifier le plan de synchronisation Blueprint. Il doit utiliser le runtime Node et raccorder `roadpulse-db` et `roadpulse-redis`. Arrête-toi si Render propose de supprimer une base ou un stockage dont tu veux garder les données. Ne supprime jamais Postgres avant une sauvegarde vérifiée.
3. Le Blueprint choisit les plans `free` pour l'API, Postgres et Key Value dans la région Singapore. Ils conviennent à un essai, pas à une production durable : l'API s'endort après inactivité, la base expire après 30 jours et les données Key Value ne sont pas persistées.
4. Lors de la première synchronisation, saisir `MAP_API_KEY`, `ADMIN_BOOTSTRAP_USERNAME` et `ADMIN_BOOTSTRAP_PASSWORD` comme secrets/variables privés dans Render. Choisir un identifiant conforme (3–32 caractères : a-z, 0-9, `.`, `_`, `-`) et un mot de passe fort d'au moins 12 caractères. `JWT_SECRET` et `METRICS_TOKEN` sont générés par Render. Ne mets jamais ces valeurs ni la clé TomTom serveur dans GitHub.
5. Le build attendu exécute `npm ci --include=dev && npm run build && npm prune --omit=dev`. Au démarrage, `npm run migrate && npm run start` applique les migrations avant l'API. Cette commande est utilisée car Render Free ne propose pas `preDeployCommand`; les migrations sont versionnées et les migrations déjà appliquées sont ignorées au redémarrage. Les logs ne doivent pas montrer `load build definition from Dockerfile`. `/api/v1/health` renvoie 200 uniquement lorsque Postgres **et** Redis répondent. La migration active PostGIS, pris en charge par Render Postgres.
6. Après les migrations au démarrage, l'API crée automatiquement le compte configuré en `SUPER_ADMIN` uniquement si aucun administrateur n'existe. Se connecter à la console avec ces identifiants, puis retirer `ADMIN_BOOTSTRAP_USERNAME` et `ADMIN_BOOTSTRAP_PASSWORD` de l'environnement Render et redéployer. L'amorçage ne modifie jamais un compte existant ; sans ces variables, la création manuelle reste disponible avec `node backend/scripts/create-admin.js`.
7. Utiliser l'URL `https://roadpulse-api.onrender.com/api/v1` comme `EXPO_PUBLIC_API_URL` dans les profils EAS. Pour héberger aussi `admin-web`, définir son `BACKEND_URL` sur cette URL avec `/api/v1`.

**Diagnostic du déploiement précédent :** les premiers logs `load build definition from Dockerfile` et `node:20-alpine` venaient d'un Web Service Docker manuel. Les logs suivants en Node échouaient sur `nest: not found`, car `npm run build` était lancé sans `npm ci --include=dev`. Le `ECONNREFUSED localhost:5432` venait de l'absence de `DATABASE_URL`. En production, Nest et les scripts échouent maintenant avec un message explicite si une variable requise manque, au lieu d'utiliser localhost.

Le mode gratuit est uniquement destiné aux essais : ne stocke pas de données importantes dessus et exporte toute donnée à conserver avant l'expiration de Postgres. Le backend utilise le runtime Node natif; les fichiers Docker existants peuvent être conservés pour un usage local.

- [ ] PostgreSQL 16 **avec PostGIS** ; `npm run migrate` ; Redis (réservé pour BullMQ / limiteurs : voir paramètre `monitor.redisEnabled`).
- [ ] Variables : `DATABASE_URL`, `JWT_SECRET` (≥ 32 caractères : `openssl rand -base64 48`), `METRICS_TOKEN`, `MAP_*`, `CORS_ORIGINS`, `TRUST_PROXY` (nombre de proxys), `NODE_ENV=production`.
- [ ] HTTPS devant l'API (reverse proxy) ; l'API ne parle qu'en HTTP en interne.
- [ ] Importer le **réseau routier d'Antananarivo** : `node backend/scripts/import-segments.js roads.geojson 150` (export OpenStreetMap). Sans lui, aucune mesure de trafic.
- [ ] Créer le premier administrateur avec `ADMIN_BOOTSTRAP_USERNAME` et `ADMIN_BOOTSTRAP_PASSWORD` au démarrage, ou utiliser `node backend/scripts/create-admin.js <identifiant> '<mot de passe ≥ 12 car.>'`.
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
