// Importe un réseau routier GeoJSON (LineString/MultiLineString, p.ex. export OSM via Overpass ou
// Geofabrik) dans road_segments, en découpant les tronçons longs (~maxLen m) pour un appariement fin.
// Usage : node scripts/import-segments.js roads.geojson [maxLenMeters=150]
// Les vitesses de référence sont des ESTIMATIONS par classe de route (tag « highway ») : à valider.
const fs = require('fs');
const { Client } = require('pg');

const FREE_FLOW = { motorway: 90, trunk: 70, primary: 50, secondary: 40, tertiary: 35, unclassified: 30,
  residential: 25, living_street: 15, service: 15 };

(async () => {
  const [file, maxLenArg] = process.argv.slice(2);
  if (!file) { console.error('Usage: node scripts/import-segments.js roads.geojson [maxLen]'); process.exit(1); }
  const maxLen = Number(maxLenArg) || 150;
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://roadpulse:roadpulse@localhost:5432/roadpulse' });
  await client.connect();
  let ways = 0, inserted = 0;
  await client.query('BEGIN');
  for (const [i, f] of (fc.features || []).entries()) {
    const g = f.geometry;
    if (!g || !['LineString', 'MultiLineString'].includes(g.type)) continue;
    const props = f.properties || {};
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const ext = String(props['@id'] ?? props.id ?? f.id ?? `f${i}`);
    const hw = props.highway;
    const oneway = ['yes', '1', 'true'].includes(String(props.oneway));
    const ff = FREE_FLOW[hw] ?? null;
    ways++;
    for (const [li, coords] of lines.entries()) {
      const res = await client.query(
        `WITH src AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
              p AS (SELECT g, GREATEST(1, ceil(ST_Length(g::geography) / $2))::int AS parts FROM src)
         INSERT INTO road_segments (external_id, name, length_m, geom, oneway, free_flow_kph)
         SELECT $3 || ':' || $4 || ':' || n, $5, ST_Length(sub::geography), sub, $6, $7
         FROM p, generate_series(0, p.parts - 1) AS n,
              LATERAL (SELECT ST_LineSubstring(p.g, n::float8 / p.parts, (n + 1)::float8 / p.parts) AS sub) l
         ON CONFLICT (external_id) DO NOTHING`,
        [JSON.stringify({ type: 'LineString', coordinates: coords }), maxLen, ext, li, props.name ?? null, oneway, ff]);
      inserted += res.rowCount;
    }
  }
  await client.query('COMMIT');
  console.log(`${ways} tronçons lus, ${inserted} segments insérés.`);
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
