import { computeGuidance, isFixReliable, projectOnRoute } from '../src/feature/navigation/session/geometry';

const line: [number, number][] = [[47.5, -18.9], [47.5, -18.89], [47.5, -18.88]]; // vers le nord, ~2.2 km

describe('géométrie / guidage', () => {
  it('progression et distance à la route', () => {
    const p = projectOnRoute(line, [47.5003, -18.895]);
    expect(p.progressM).toBeGreaterThan(500);
    expect(p.progressM).toBeLessThan(600);
    expect(p.distanceToRouteM).toBeGreaterThan(25);
    expect(p.distanceToRouteM).toBeLessThan(40);
  });

  it('prochaine instruction = première étape devant la position', () => {
    const steps = [
      { instruction: 'Départ', distanceMeters: 0, location: [47.5, -18.9] as [number, number] },
      { instruction: 'Tournez à droite', distanceMeters: 0, location: [47.5, -18.89] as [number, number] },
    ];
    const g = computeGuidance(line, steps, 2224, 300, [47.5, -18.8955]);
    expect(g.nextStep?.instruction).toBe('Tournez à droite');
    expect(g.distanceToNextStepMeters).toBeGreaterThan(450);
    expect(g.remainingSeconds).toBeGreaterThan(0);
  });

  it('refuse une position imprécise ou obsolète (NAV-011)', () => {
    const now = 1_000_000;
    expect(isFixReliable({ lat: 0, lon: 0, accuracy: 10, timestamp: now - 1000 }, now)).toBe(true);
    expect(isFixReliable({ lat: 0, lon: 0, accuracy: 200, timestamp: now }, now)).toBe(false);
    expect(isFixReliable({ lat: 0, lon: 0, accuracy: 10, timestamp: now - 60_000 }, now)).toBe(false);
    expect(isFixReliable({ lat: 0, lon: 0, accuracy: null, timestamp: now }, now)).toBe(false);
  });
});

import { remainingCoordinates } from '../src/feature/navigation/session/geometry';

describe('partie restante de l’itinéraire', () => {
  const route: [number, number][] = [[47.5, -18.9], [47.5, -18.89], [47.5, -18.88]];
  it('commence au point projeté et conserve la fin', () => {
    const r = remainingCoordinates(route, [47.5002, -18.895]);
    expect(r[0][1]).toBeCloseTo(-18.895, 3);
    expect(r[r.length - 1]).toEqual([47.5, -18.88]);
    expect(r).toHaveLength(3); // point projeté + 2 sommets restants
  });
  it('réduit à maxPoints en gardant début et fin', () => {
    const long: [number, number][] = Array.from({ length: 1000 }, (_, i) => [47.5, -18.9 + i * 0.00001]);
    const r = remainingCoordinates(long, [47.5, -18.9], 100);
    expect(r).toHaveLength(100);
    expect(r[r.length - 1]).toEqual(long[999]);
  });
});
