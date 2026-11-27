import { computeConfidence, computeScore, nextStatus } from '../src/modules/incidents/confidence';
import { PARAM_DEFAULTS as p } from '../src/shared/parameters/parameters.service';

describe('confiance et transitions d’incident', () => {
  it('un seul signalement ne confirme pas l’incident (INC-010)', () => {
    const e = { reporters: 1, confirmations: 0, contestations: 0 };
    expect(computeConfidence(computeScore(e, p), p)).toBe(0.25);
    expect(nextStatus('DETECTE', e, p)).toBe('DETECTE');
  });
  it('deux déclarants distincts atteignent le seuil', () => {
    expect(nextStatus('DETECTE', { reporters: 2, confirmations: 0, contestations: 0 }, p)).toBe('CONFIRME');
  });
  it('une confirmation s’ajoute au score', () => {
    expect(nextStatus('DETECTE', { reporters: 1, confirmations: 1, contestations: 0 }, p)).toBe('CONFIRME');
  });
  it('rejet seulement avec assez de contestations', () => {
    expect(nextStatus('DETECTE', { reporters: 1, confirmations: 0, contestations: 1 }, p)).toBe('DETECTE');
    expect(nextStatus('DETECTE', { reporters: 1, confirmations: 0, contestations: 2 }, p)).toBe('EXPIRE');
  });
  it('états terminaux inchangés', () => {
    expect(nextStatus('RESOLU', { reporters: 9, confirmations: 9, contestations: 0 }, p)).toBe('RESOLU');
    expect(nextStatus('EXPIRE', { reporters: 9, confirmations: 9, contestations: 0 }, p)).toBe('EXPIRE');
  });
});
