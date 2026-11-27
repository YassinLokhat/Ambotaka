import { angleDiff, classify, directionFor, trafficConfidence } from '../src/modules/traffic/traffic-logic';
import { PARAM_DEFAULTS as p } from '../src/shared/parameters/parameters.service';

describe('logique trafic', () => {
  it('écart angulaire circulaire', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
  });
  it('sens par rapport au tracé', () => {
    expect(directionFor(10, 0)).toBe(1);
    expect(directionFor(170, 0)).toBe(-1);
    expect(directionFor(null, 0)).toBe(0);
  });
  it('classification relative à la vitesse de référence ; INCONNU sans référence (NFR-014)', () => {
    expect(classify(45, 50, p)).toBe('FLUIDE');
    expect(classify(25, 50, p)).toBe('RALENTI');
    expect(classify(10, 50, p)).toBe('CONGESTIONNE');
    expect(classify(45, null, p)).toBe('INCONNU');
  });
  it('confiance croissante, bornée à 1', () => {
    expect(trafficConfidence(3, 6, p)).toBeLessThan(trafficConfidence(8, 40, p));
    expect(trafficConfidence(99, 999, p)).toBe(1);
  });
});
