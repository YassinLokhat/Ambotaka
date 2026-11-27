export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
export function provenance(src: 'TRAFIC_RECENT' | 'DUREE_REFERENCE'): string {
  return src === 'TRAFIC_RECENT' ? 'Estimation avec trafic récent' : 'Durée de référence · trafic non vérifié';
}
