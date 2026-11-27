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

- [ ] PostgreSQL 16 **avec PostGIS** ; `npm run migrate` ; Redis (réservé pour BullMQ / limiteurs : voir paramètre `monitor.redisEnabled`).
- [ ] Variables : `DATABASE_URL`, `JWT_SECRET` (≥ 32 caractères : `openssl rand -base64 48`), `METRICS_TOKEN`, `MAP_*`, `CORS_ORIGINS`, `TRUST_PROXY` (nombre de proxys), `NODE_ENV=production`.
- [ ] HTTPS devant l'API (reverse proxy) ; l'API ne parle qu'en HTTP en interne.
- [ ] Importer le **réseau routier d'Antananarivo** : `node backend/scripts/import-segments.js roads.geojson 150` (export OpenStreetMap). Sans lui, aucune mesure de trafic.
- [ ] Créer le premier administrateur : `node backend/scripts/create-admin.js <identifiant> '<mot de passe ≥ 12 car.>'`.
- [ ] Sauvegardes : planifier `infrastructure/scripts/backup.sh` (cron), **chiffrer et copier hors serveur**, et **tester la restauration** (`restore.sh`) sur une base vide au moins une fois avant le pilote. Aller-retour validé en local (6 migrations, données et PostGIS restaurés à l'identique).
- [ ] Supervision : `docker compose --profile monitoring up` (Prometheus + Grafana) ; créer les tableaux de bord Grafana (aucun n'est fourni).

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
- Pas de Dockerfile pour la console web ; pas de CD (déploiement automatique).
- Les alertes techniques sont visibles dans la console uniquement (pas de courriel/SMS).
- Pas de suivi GPS garanti en arrière-plan (limites Android) ; navigation hors ligne non disponible (cartes hors ligne non validées).
