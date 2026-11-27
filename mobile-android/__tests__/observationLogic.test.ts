import { isStale, MAX_AGE_MS, MIN_INTERVAL_MS, shouldRecord } from '../src/feature/traffic/observationLogic';

const fix = { lat: 0, lon: 0, accuracy: 10, speed: 8, heading: 90, timestamp: 1_000_000 };

describe('collecte des observations', () => {
  it('ne collecte rien sans consentement (TRF-004)', () => {
    expect(shouldRecord(fix, false, null)).toBe(false);
    expect(shouldRecord(fix, true, null)).toBe(true);
  });
  it('ignore position imprécise ou vitesse invalide', () => {
    expect(shouldRecord({ ...fix, accuracy: 80 }, true, null)).toBe(false);
    expect(shouldRecord({ ...fix, accuracy: null }, true, null)).toBe(false);
    expect(shouldRecord({ ...fix, speed: -1 }, true, null)).toBe(false);
    expect(shouldRecord({ ...fix, speed: null }, true, null)).toBe(false);
  });
  it('limite la fréquence', () => {
    expect(shouldRecord(fix, true, fix.timestamp - MIN_INTERVAL_MS + 1)).toBe(false);
    expect(shouldRecord(fix, true, fix.timestamp - MIN_INTERVAL_MS)).toBe(true);
  });
  it('périme les observations anciennes', () => {
    expect(isStale(0, MAX_AGE_MS)).toBe(false);
    expect(isStale(0, MAX_AGE_MS + 1)).toBe(true);
  });
});
