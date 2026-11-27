import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../src/core/theme';
import { RoadMap } from '../src/feature/map/RoadMap';
import { MapAttribution } from '../src/feature/map/MapAttribution';
import { formatDistance, formatDuration } from '../src/feature/navigation/format';
import { deadline, effectiveDurationSeconds } from '../src/feature/navigation/session/sessionLogic';
import { InterruptionCause } from '../src/feature/navigation/session/types';
import { Incident } from '../src/core/api';
import { IncidentModal } from '../src/feature/incidents/IncidentModal';
import { ReportModal } from '../src/feature/incidents/ReportModal';
import { useIncidents } from '../src/feature/incidents/useIncidents';
import { ConsentPrompt } from '../src/feature/traffic/ConsentPrompt';
import { getConsent, setStatisticsConsent } from '../src/feature/traffic/consentStore';
import { invalidateConsentCache } from '../src/feature/traffic/observationCollector';
import { RecommendationCard } from '../src/feature/recommendations/RecommendationCard';
import { useRecommendation } from '../src/feature/recommendations/useRecommendation';
import { useNavigationSession } from '../src/feature/navigation/session/useNavigationSession';

const CAUSES: Record<InterruptionCause, string> = {
  GPS_INDISPONIBLE: 'Signal GPS indisponible ou imprécis',
  RESEAU_INDISPONIBLE: 'Réseau indisponible',
  DONNEES_CARTOGRAPHIQUES_INDISPONIBLES: 'Données cartographiques indisponibles',
  APPLICATION_FERMEE: 'Application fermée ou mise en veille',
  SYSTEME_INDISPONIBLE: 'Système indisponible',
};
const time = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export default function NavigationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, guidance, user, finishNow, retry, applyRoute } = useNavigationSession(String(id));
  const reco = useRecommendation(session, user, guidance, applyRoute);
  const center = user ?? (session?.lastKnownPosition ? { lat: session.lastKnownPosition.lat, lon: session.lastKnownPosition.lon } : null);
  const { incidents, upsert } = useIncidents(center);
  const [reportOpen, setReportOpen] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { getConsent().then((c) => { if (c === null) setAskConsent(true); }); }, []);
  const chooseConsent = async (granted: boolean) => {
    setAskConsent(false); await setStatisticsConsent(granted); invalidateConsentCache();
  };
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const openIncident = incidents.find((i) => i.id === openIncidentId) ?? null;
  if (!session) return <View style={s.root} />;

  const route = {
    id: session.route.id, distanceMeters: session.route.distanceMeters, durationSeconds: session.route.durationSeconds,
    geometry: { type: 'LineString' as const, coordinates: session.route.coordinates },
    estimationSource: 'DUREE_REFERENCE' as const,
  };
  const interrupted = session.status === 'EN_COURS' && session.operationalState !== 'ACTIVE';
  const ended = session.status !== 'EN_COURS';
  const last = session.lastKnownPosition;
  const dl = deadline(session);
  const confirmEnd = () =>
    Alert.alert('Terminer la navigation ?', undefined, [{ text: 'Continuer', style: 'cancel' }, { text: 'Terminer', style: 'destructive', onPress: finishNow }]);

  return (
    <View style={s.root}>
      <RoadMap
        user={user ?? (last ? { lat: last.lat, lon: last.lon } : null)}
        destination={session.destination}
        routes={reco.rec ? [route, {
          id: reco.rec.proposedRoute.id, distanceMeters: reco.rec.proposedRoute.distanceMeters,
          durationSeconds: reco.rec.proposedRoute.durationSeconds, geometry: reco.rec.proposedRoute.geometry,
          estimationSource: 'DUREE_REFERENCE' as const,
        }] : [route]}
        selectedId={route.id}
        follow={!interrupted && !ended ? user : null}
        onPressMap={() => undefined}
        incidents={incidents} onPressIncident={setOpenIncidentId}
      />
      {!interrupted && !ended && (
        <Pressable style={s.fab} onPress={() => setReportOpen(true)}><Text style={s.fabText}>⚠ Signaler</Text></Pressable>
      )}
      {/* Signalement uniquement avec une position GPS fiable (user n'est renseigné que pour un fix valide). */}
      <ReportModal visible={reportOpen} position={user} onClose={() => setReportOpen(false)} onDone={(i: Incident) => { upsert(i); setReportOpen(false); }}
        onQueued={() => { setReportOpen(false); setToast('Pas de réseau : signalement mis en file, envoi au retour de la connexion.'); setTimeout(() => setToast(null), 5000); }} />
      {toast && <View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>}
      <ConsentPrompt visible={askConsent} onChoose={chooseConsent} />
      <IncidentModal incident={openIncident} onClose={() => setOpenIncidentId(null)} onUpdated={upsert} />

      {!interrupted && !ended && (
        <SafeAreaView edges={['top']} style={s.top} pointerEvents="none">
          <View style={s.instruction}>
            <Text style={s.instrMain} numberOfLines={2}>
              {guidance?.nextStep?.instruction ?? (guidance ? `Continuez vers ${session.destination.name}` : 'Recherche de votre position…')}
            </Text>
            {guidance?.distanceToNextStepMeters != null && <Text style={s.instrDist}>dans {formatDistance(guidance.distanceToNextStepMeters)}</Text>}
            {guidance && guidance.offRouteMeters > 60 && <Text style={s.warn}>Vous semblez hors de l’itinéraire</Text>}
          </View>
        </SafeAreaView>
      )}

      <SafeAreaView edges={['bottom']} style={s.sheet}>
        {interrupted && (
          <>
            <Text style={s.title}>Navigation interrompue</Text>
            {session.episodes[session.episodes.length - 1]?.causes.map((c) => (
              <Text key={c.cause} style={s.line}>• {CAUSES[c.cause]}</Text>
            ))}
            {last && <Text style={s.stale}>Dernière position connue (obsolète) : {time(last.at)}</Text>}
            {dl && <Text style={s.line}>Restauration possible jusqu’au {time(dl)}</Text>}
            <Text style={s.muted}>Aucune instruction n’est donnée tant que la position n’est pas fiable.</Text>
            <Pressable style={s.btn} onPress={retry}><Text style={s.btnText}>Réessayer la reprise</Text></Pressable>
          </>
        )}
        {!interrupted && !ended && reco.rec && (
          <RecommendationCard rec={reco.rec} error={reco.error} onAccept={reco.accept} onIgnore={reco.ignore} />
        )}
        {!interrupted && !ended && (
          <View style={s.row}>
            <View>
              <Text style={s.big}>{guidance ? formatDuration(guidance.remainingSeconds) : '—'}</Text>
              <Text style={s.muted}>{guidance ? formatDistance(guidance.remainingMeters) : 'en attente du GPS'}</Text>
            </View>
            <Pressable style={s.end} onPress={confirmEnd}><Text style={s.endText}>Terminer</Text></Pressable>
          </View>
        )}
        {ended && (
          <>
            <Text style={s.title}>
              {session.status === 'TERMINEE' ? 'Navigation terminée' : session.status === 'EXPIREE' ? 'Session expirée' : 'Navigation annulée'}
            </Text>
            <Text style={s.line}>Durée effective : {effectiveDurationSeconds(session) != null ? formatDuration(effectiveDurationSeconds(session)!) : 'indisponible'}</Text>
            {session.distanceTraveledMeters > 0 && <Text style={s.line}>Distance : {formatDistance(session.distanceTraveledMeters)}</Text>}
            {session.status === 'EXPIREE' && <Text style={s.muted}>Elle n’est plus restaurable. Vous pouvez démarrer une nouvelle navigation.</Text>}
            <Pressable style={s.btn} onPress={() => router.replace('/')}><Text style={s.btnText}>Retour à la carte</Text></Pressable>
          </>
        )}
        <MapAttribution />
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: 12 },
  instruction: { backgroundColor: theme.accent, borderRadius: 16, padding: 16 },
  instrMain: { color: '#111', fontSize: 20, fontWeight: '800' },
  instrDist: { color: '#111', fontSize: 15, marginTop: 4, fontWeight: '600' },
  warn: { color: '#7A1010', marginTop: 6, fontWeight: '700' },
  fab: { position: 'absolute', right: 14, top: 150, backgroundColor: theme.panel, borderColor: theme.danger, borderWidth: 1, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 16 },
  toast: { position: 'absolute', left: 16, right: 16, top: 210, backgroundColor: theme.accent, borderRadius: 12, padding: 12 },
  toastText: { color: '#111', fontWeight: '700' },
  fabText: { color: theme.danger, fontWeight: '800' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: theme.border, padding: 16, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { color: theme.text, fontSize: 28, fontWeight: '800' },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  line: { color: theme.text, fontSize: 14 },
  stale: { color: theme.danger, fontSize: 13, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 13 },
  btn: { backgroundColor: theme.accent, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#111', fontWeight: '800' },
  end: { backgroundColor: theme.bg, borderColor: theme.danger, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20 },
  endText: { color: theme.danger, fontWeight: '800' },
});
