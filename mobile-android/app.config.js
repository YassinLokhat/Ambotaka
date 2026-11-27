// Configuration Expo. APP_ENV est fixé par les profils EAS (eas.json) : le trafic HTTP en clair
// (émulateur / serveur local) n'est autorisé que hors production.
const isProduction = process.env.APP_ENV === 'production';
const base = {
  "name": "RoadPulse",
  "slug": "ambotaka",
  "scheme": "roadpulse",
  "version": "0.1.0",
  "orientation": "portrait",
  "userInterfaceStyle": "dark",
  "android": {
    "package": "com.roadpulse.app",
    "permissions": [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION"
    ]
  },
  "plugins": [
    "expo-asset",
    "expo-sqlite",
    "expo-router",
    "expo-notifications",
    [
      "expo-location",
      {
        "locationWhenInUsePermission": "RoadPulse utilise votre position pour calculer vos itinéraires."
      }
    ],
    "@maplibre/maplibre-react-native"
  ]
};

module.exports = () => ({
  expo: {
    ...base,
    owner: 'zerotrust049s-team',
    plugins: [
      ...base.plugins,
      [
        'expo-build-properties',
        { android: { kotlinVersion: '1.9.25', usesCleartextTraffic: !isProduction } },
      ],
    ],
    extra: {
      "eas": {
        "projectId": "ebe76eb1-1496-4c9b-9e08-35e2806e3b5d"
      }
    },
  },
});
