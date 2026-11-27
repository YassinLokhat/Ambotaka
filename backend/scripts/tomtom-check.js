#!/usr/bin/env node
// Lot 0 (spec §6.6) : vérifie avec VOTRE clé TomTom ce qui fonctionne réellement à Antananarivo.
// Usage : MAP_API_KEY=xxxx node scripts/tomtom-check.js
// (TOMTOM_BASE_URL permet de viser un serveur de test ; par défaut https://api.tomtom.com)
const KEY = process.env.MAP_API_KEY || process.argv[2];
const BASE = process.env.TOMTOM_BASE_URL || 'https://api.tomtom.com';
if (!KEY) { console.error('Clé manquante : MAP_API_KEY=… node scripts/tomtom-check.js'); process.exit(2); }

// Points approximatifs à Antananarivo : à ajuster si TomTom répond « point trop éloigné d'une route ».
const PLACES = {
  Analakely: { lat: -18.9100, lon: 47.5250 }, 'Aéroport d’Ivato': { lat: -18.7969, lon: 47.4788 },
  Isotry: { lat: -18.9215, lon: 47.5190 }, Ankorondrano: { lat: -18.8860, lon: 47.5230 }, Ambohimanarina: { lat: -18.8730, lon: 47.5040 },
};
const TRIPS = [['Analakely', 'Aéroport d’Ivato'], ['Isotry', 'Ankorondrano'], ['Analakely', 'Ambohimanarina']];
const QUERIES = ['Analakely', 'Aéroport Ivato', 'Isoraka', 'Ankorondrano', 'Marché Isotry', 'Rue Rainandriamampandry'];

const out = [];
const ok = (m) => console.log(`  ✔ ${m}`), ko = (m) => { console.log(`  ✘ ${m}`); out.push(m); }, info = (m) => console.log(`    ${m}`);
const h = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);
const ms = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };
const mask = (s) => String(s).replaceAll(KEY, '***');

async function style() {
  h('1. Carte (style Orbis pour MapLibre)');
  const url = `${BASE}/maps/orbis/assets/styles/0.*/style?key=${KEY}&apiVersion=1&map=basic_street-light`;
  try {
    const [r, t] = await ms(() => fetch(url));
    if (!r.ok) return ko(`Style : HTTP ${r.status} (clé invalide, ou service « Maps » non activé pour cette clé)`);
    const j = await r.json();
    ok(`Style reçu en ${t} ms (${Object.keys(j.sources || {}).length} source(s), ${(j.layers || []).length} couches)`);
    const tiles = JSON.stringify(j.sources || {});
    info(tiles.includes('key=') ? 'Les URL de tuiles contiennent déjà la clé : MapLibre fonctionnera avec EXPO_PUBLIC_TOMTOM_MAP_KEY.'
      : 'Les URL de tuiles ne contiennent PAS la clé : il faudra l’ajouter aux requêtes de tuiles (à tester sur l’appareil).');
  } catch (e) { ko(`Style injoignable : ${mask(e.message)}`); }
}

async function search() {
  h('2. Recherche de lieux à Madagascar (Search Orbis v1, countrySet=MG)');
  let empty = 0;
  for (const q of QUERIES) {
    const p = new URLSearchParams({ apiVersion: '1', limit: '3', countrySet: 'MG', geobias: 'point:-18.9137,47.5361' });
    try {
      const [r, t] = await ms(() => fetch(`${BASE}/maps/orbis/places/search/${encodeURIComponent(q)}.json?${p}`, { headers: { 'TomTom-Api-Key': KEY } }));
      if (!r.ok) { ko(`« ${q} » : HTTP ${r.status}`); continue; }
      const j = await r.json();
      const first = (j.results || [])[0];
      if (!first) { empty++; ko(`« ${q} » : aucun résultat (${t} ms)`); continue; }
      const pos = first.position || {};
      ok(`« ${q} » : ${j.results.length} résultat(s) en ${t} ms → ${first.poi?.name || first.address?.freeformAddress} @ ${pos.lat ?? pos.latitude},${pos.lon ?? pos.longitude}`);
    } catch (e) { ko(`« ${q} » : ${mask(e.message)}`); }
  }
  if (empty === QUERIES.length) info('Aucun résultat pour toutes les requêtes : la couverture Search/Geocoding de Madagascar est à confirmer auprès de TomTom.');
}

async function route(from, to, traffic) {
  const a = PLACES[from], b = PLACES[to];
  const body = { routePlanningLocations: { origin: { type: 'Point', coordinates: [a.lon, a.lat] }, destination: { type: 'Point', coordinates: [b.lon, b.lat] } },
    maxPathAlternativeRoutes: 2, traffic, routeType: 'fast', travelMode: 'car', guidance: 'instructions', instructionPhonetics: 'ipa' };
  const [r, t] = await ms(() => fetch(`${BASE}/maps/orbis/routing/routes/calculate?apiVersion=3`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'TomTom-Api-Key': KEY, Attributes: 'routes', 'Accept-Language': 'fr-FR' }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null), ms: t };
}

async function routing() {
  h('3. Itinéraires et trafic (Routing Orbis v3)');
  const verdicts = [];
  for (const [from, to] of TRIPS) {
    console.log(`\n  ${from} → ${to}`);
    try {
      const hist = await route(from, to, 'historical'), live = await route(from, to, 'live');
      for (const [label, r] of [['historical', hist], ['live', live]]) {
        if (r.status !== 200) { ko(`${from}→${to} (${label}) : HTTP ${r.status} ${r.body?.detailedError?.code || ''}`); continue; }
      }
      if (hist.status !== 200 || live.status !== 200) continue;
      const rh = hist.body.routes[0], rl = live.body.routes[0];
      ok(`${(rh.summary.lengthInMeters / 1000).toFixed(1)} km · ${Math.round(rh.summary.travelDurationInSeconds / 60)} min (historique) · ${hist.ms} ms`);
      info(`${hist.body.routes.length} itinéraire(s) dont alternatives ; ${(rh.instructions || []).length} instruction(s) de guidage${rh.instructions?.[0] ? ` — 1re : « ${rh.instructions[0].message} »` : ''}`);
      if (!rh.instructions?.length) ko(`${from}→${to} : aucune instruction de guidage reçue`);
      const dl = rl.summary.trafficDelayDurationInSeconds ?? 0, dd = rl.summary.travelDurationInSeconds - rh.summary.travelDurationInSeconds;
      info(`trafic « live » : retard ${dl} s, écart de durée vs historique ${dd} s`);
      verdicts.push({ delay: dl, diff: dd });
    } catch (e) { ko(`${from}→${to} : ${mask(e.message)}`); }
  }
  if (verdicts.length) {
    const any = verdicts.some((v) => v.delay > 0 || Math.abs(v.diff) > 0);
    h('Interprétation (à croiser avec la page « Market coverage » de TomTom)');
    console.log(any
      ? '  Des écarts live/historique existent : à vérifier sur le terrain avant d’activer MAP_TRAFFIC_VALIDATED=true.'
      : '  Aucun écart live/historique : aucune preuve de trafic temps réel. Garder MAP_TRAFFIC_VALIDATED=false (durée « de référence »).');
  }
}

(async () => {
  console.log(`Vérification TomTom — ${new Date().toISOString()} — ${BASE}`);
  await style(); await search(); await routing();
  h('Bilan');
  console.log(out.length ? `  ${out.length} point(s) à traiter :\n${out.map((m) => `   - ${m}`).join('\n')}` : '  Aucun problème détecté sur ces essais.');
  process.exit(out.length ? 1 : 0);
})();
