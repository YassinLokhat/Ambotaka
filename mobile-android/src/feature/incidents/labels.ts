import { IncidentStatus, IncidentType } from '../../core/api';

export const TYPE_LABEL: Record<IncidentType, string> = {
  ACCIDENT: 'Accident', EMBOUTEILLAGE: 'Embouteillage', ROUTE_BLOQUEE: 'Route bloquée',
  TRAVAUX: 'Travaux', DANGER: 'Danger', AUTRE: 'Autre',
};
export const STATUS_LABEL: Record<IncidentStatus, string> = {
  DETECTE: 'Signalé, à confirmer', CONFIRME: 'Confirmé par des conducteurs', EN_COURS: 'En cours',
  RESOLU: 'Résolu', EXPIRE: 'Expiré',
};
export const TYPES = Object.keys(TYPE_LABEL) as IncidentType[];

export function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}
