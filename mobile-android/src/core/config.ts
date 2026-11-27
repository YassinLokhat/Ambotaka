export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/api/v1';
// Clé TomTom DÉDIÉE À L'AFFICHAGE DE LA CARTE (Maps uniquement) : elle est embarquée dans l'application, donc visible
// de qui l'inspecte. La clé Routing/Search reste secrète côté serveur (MAP_API_KEY du backend).
const TOMTOM_MAP_KEY = process.env.EXPO_PUBLIC_TOMTOM_MAP_KEY;
// Style Orbis sans couches de trafic : TomTom ne liste pas le trafic temps réel pour Madagascar (spec §6.2).
export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL ??
  (TOMTOM_MAP_KEY
    ? `https://api.tomtom.com/maps/orbis/assets/styles/0.*/style?key=${TOMTOM_MAP_KEY}&apiVersion=1&map=basic_street-light`
    : 'https://demotiles.maplibre.org/style.json'); // carte de démonstration (sans les rues) : à ne pas livrer
// Mention de source de la carte : le texte exact est à confirmer dans les conditions d'utilisation TomTom.
export const MAP_ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? (TOMTOM_MAP_KEY ? '© TomTom' : '');
// Antananarivo : position de repli de la caméra (jamais utilisée comme origine d'itinéraire).
export const DEFAULT_CENTER = { lat: -18.8792, lon: 47.5079 };
export const MAX_GPS_ACCURACY_M = 100;
// Version de la politique de confidentialité présentée à l'utilisateur (à incrémenter si le texte change).
export const POLICY_VERSION = '2026-11-v1';
