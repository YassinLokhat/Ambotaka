import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Place } from '../src/core/api';
import { MAX_GPS_ACCURACY_M } from '../src/core/config';
import { theme } from '../src/core/theme';
import { useCurrentPosition } from '../src/core/useCurrentPosition';
import { RoadMap } from '../src/feature/map/RoadMap';
import { MapAttribution } from '../src/feature/map/MapAttribution';
import { formatDistance, formatDuration, provenance } from '../src/feature/navigation/format';
import { useRoutes } from '../src/feature/navigation/useRoutes';
import { acknowledgeExpired, startNavigation, startupHousekeeping } from '../src/feature/navigation/session/sessionService';
import { SessionRecord } from '../src/feature/navigation/session/types';
import { Incident } from '../src/core/api';
import { IncidentModal } from '../src/feature/incidents/IncidentModal';
import { ReportModal } from '../src/feature/incidents/ReportModal';
import { useTraffic } from '../src/feature/traffic/useTraffic';
import { useIncidents } from '../src/feature/incidents/useIncidents';
import { usePlaceSearch } from '../src/feature/search/usePlaceSearch';

export default function Home() {
  const { position, refresh } = useCurrentPosition();
  const user = position.status === 'ready' ? position : null;
  const reliable = !!user && (user.accuracy ?? Infinity) <= MAX_GPS_ACCURACY_M;

  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState<(Place | { id: string; name: string; address: string; lat: number; lon: number }) | null>(null);
  const places = usePlaceSearch(destination ? '' : query, user ?? undefined);
  const routes = useRoutes();
  const { incidents, upsert } = useIncidents(user);
  const traffic = useTraffic(user ?? null);
  const [reportOpen, setReportOpen] = useState(false);
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const openIncident = incidents.find((i) => i.id === openIncidentId) ?? null;
  const onReported = (i: Incident, merged: boolean) => {
    upsert(i); setReportOpen(false);
    setToast(merged ? 'Merci ! Votre signalement a été ajouté à un incident proche.' : 'Merci ! Incident signalé.');
    setTimeout(() => setToast(null), 4000);
  };
  const [resumable, setResumable] = useState<SessionRecord | null>(null);
  const [expiredNotices, setExpiredNotices] = useState(0);

  // À l'ouverture / retour sur l'écran : expiration éventuelle, session reprenable, notice groupée (RES-013).
  useFocusEffect(useCallback(() => {
    startupHousekeeping().then((r) => { setResumable(r.active); setExpiredNotices(r.expiredNotices); });
  }, []));

  const selectedRoute = routes.routes.find((r) => r.id === routes.selectedId);
  const start = async () => {
    if (!selectedRoute || !destination) return;
    const session = await startNavigation(selectedRoute, { name: destination.name, lat: destination.lat, lon: destination.lon });
    router.push({ pathname: '/navigation', params: { id: session.id } });
  };

  // Recalcule les itinéraires quand la destination change et que la position est fiable.
  useEffect(() => {
    if (destination && user && reliable) routes.search(user, destination, user.accuracy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, reliable]);

  const choose = (p: Place) => { setDestination(p); setQuery(p.name); places.clear(); };
  const pickOnMap = (c: { lat: number; lon: number }) => {
    setDestination({ id: 'map', name: 'Point sélectionné', address: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, ...c });
    setQuery('Point sélectionné'); places.clear();
  };
  const clear = () => { setDestination(null); setQuery(''); routes.reset(); };

  return (
    <View style={s.root}>
      <RoadMap user={user} destination={destination} routes={routes.routes} selectedId={routes.selectedId} onPressMap={pickOnMap} incidents={incidents} traffic={traffic.segments} onPressIncident={setOpenIncidentId} />

      <SafeAreaView edges={['top']} style={s.top} pointerEvents="box-none">
        <View style={s.searchBox}>
          <TextInput
            value={query}
            onChangeText={(t) => { setQuery(t); if (destination) { setDestination(null); routes.reset(); } }}
            placeholder="Où allez-vous ?"
            placeholderTextColor={theme.muted}
            style={s.input}
          />
          {query ? <Pressable onPress={clear}><Text style={s.clear}>✕</Text></Pressable> : null}
        </View>
        {places.loading ? <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} /> : null}
        {places.error ? <Text style={s.error}>{places.error}</Text> : null}
        {places.results.length > 0 && (
          <FlatList
            style={s.results}
            data={places.results}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={s.result} onPress={() => choose(item)}>
                <Text style={s.resultName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.resultAddr} numberOfLines={1}>{item.address}</Text>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>

      <Pressable style={s.fab} onPress={() => setReportOpen(true)}>
        <Text style={s.fabText}>⚠ Signaler</Text>
      </Pressable>
      {toast && <View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>}
      <ReportModal visible={reportOpen} position={reliable && user ? { lat: user.lat, lon: user.lon } : null} onClose={() => setReportOpen(false)} onDone={onReported}
        onQueued={() => { setReportOpen(false); setToast('Pas de réseau : votre signalement sera envoyé au retour de la connexion (10 min maximum).'); setTimeout(() => setToast(null), 5000); }} />
      <IncidentModal incident={openIncident} onClose={() => setOpenIncidentId(null)} onUpdated={upsert} />

      <SafeAreaView edges={['bottom']} style={s.sheet}>
        {position.status === 'denied' && (
          <Banner text="Localisation refusée : activez-la pour calculer un itinéraire depuis votre position." action="Réessayer" onPress={refresh} />
        )}
        {position.status === 'error' && <Banner text="Position introuvable." action="Réessayer" onPress={refresh} />}
        {user && !reliable && (
          <Banner text={`Position imprécise (±${Math.round(user.accuracy ?? 0)} m). Attendez un meilleur signal GPS.`} action="Actualiser" onPress={refresh} />
        )}
        {expiredNotices > 0 && (
          <Banner
            text={`${expiredNotices} navigation${expiredNotices > 1 ? 's ont' : ' a'} expiré (plus de 24 h d’interruption). Un résumé est dans l’historique.`}
            action="OK" onPress={async () => { await acknowledgeExpired(); setExpiredNotices(0); }}
          />
        )}
        {resumable && (
          <Banner
            text={`Navigation vers « ${resumable.destination.name} » ${resumable.operationalState === 'ACTIVE' ? 'en cours' : 'interrompue'}.`}
            action="Reprendre" onPress={() => router.push({ pathname: '/navigation', params: { id: resumable.id } })}
          />
        )}
        {routes.loading && <ActivityIndicator color={theme.accent} />}
        {routes.error && <Text style={s.error}>{routes.error}</Text>}

        {routes.routes.map((r, i) => {
          const active = r.id === routes.selectedId;
          return (
            <Pressable key={r.id} onPress={() => routes.setSelectedId(r.id)} style={[s.card, active && s.cardActive]}>
              <View style={{ flex: 1 }}>
                <Text style={s.duration}>{formatDuration(r.durationSeconds)}</Text>
                <Text style={s.meta}>{formatDistance(r.distanceMeters)} · {i === 0 ? 'Le plus rapide' : 'Alternative'}</Text>
                <Text style={s.prov}>{provenance(r.estimationSource)}</Text>
              </View>
            </Pressable>
          );
        })}
        {routes.routes.length > 0 && (
          <Pressable style={s.startOn} onPress={start}>
            <Text style={s.startOnText}>Démarrer la navigation</Text>
          </Pressable>
        )}
        {!destination && routes.routes.length === 0 && (
          <Text style={s.hint}>Recherchez une destination ou touchez la carte.</Text>
        )}
        <Text style={s.hint}>
          {traffic.status === 'OK'
            ? `Trafic communautaire · ${traffic.segments.length} tronçon${traffic.segments.length > 1 ? 's' : ''} mesuré${traffic.segments.length > 1 ? 's' : ''}`
            : traffic.status === 'DONNEES_INSUFFISANTES' ? 'Trafic : données insuffisantes dans cette zone'
            : traffic.status === 'ERREUR' ? 'Trafic indisponible' : 'Trafic : chargement…'}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24 }}>
          <Pressable onPress={() => router.push('/history')}><Text style={s.link}>Historique</Text></Pressable>
          <Pressable onPress={() => router.push('/privacy')}><Text style={s.link}>Confidentialité</Text></Pressable>
        </View>
        <MapAttribution />
      </SafeAreaView>
    </View>
  );
}

function Banner({ text, action, onPress }: { text: string; action: string; onPress: () => void }) {
  return (
    <View style={s.banner}>
      <Text style={s.bannerText}>{text}</Text>
      <Pressable onPress={onPress}><Text style={s.bannerAction}>{action}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, marginTop: 8 },
  input: { flex: 1, color: theme.text, fontSize: 16, paddingVertical: 14 },
  clear: { color: theme.muted, fontSize: 18, paddingLeft: 10 },
  results: { backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, marginTop: 6, maxHeight: 280 },
  result: { padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  resultName: { color: theme.text, fontSize: 15, fontWeight: '600' },
  resultAddr: { color: theme.muted, fontSize: 13, marginTop: 2 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  card: { flexDirection: 'row', backgroundColor: theme.bg, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14 },
  cardActive: { borderColor: theme.accent },
  duration: { color: theme.text, fontSize: 24, fontWeight: '800' },
  meta: { color: theme.text, fontSize: 14, marginTop: 2 },
  prov: { color: theme.muted, fontSize: 12, marginTop: 4 },
  start: { backgroundColor: theme.border, borderRadius: 14, padding: 14, alignItems: 'center' },
  startText: { color: theme.muted, fontWeight: '700' },
  startOn: { backgroundColor: theme.accent, borderRadius: 14, padding: 14, alignItems: 'center' },
  startOnText: { color: '#111', fontWeight: '800', fontSize: 16 },
  link: { color: theme.accent, textAlign: 'center', fontWeight: '700', paddingVertical: 4 },
  fab: { position: 'absolute', right: 14, top: 120, backgroundColor: theme.panel, borderColor: theme.danger, borderWidth: 1, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 16 },
  fabText: { color: theme.danger, fontWeight: '800' },
  toast: { position: 'absolute', left: 16, right: 16, top: 170, backgroundColor: theme.accent, borderRadius: 12, padding: 12 },
  toastText: { color: '#111', fontWeight: '700' },
  hint: { color: theme.muted, textAlign: 'center', paddingVertical: 8 },
  error: { color: theme.danger, marginTop: 6 },
  banner: { backgroundColor: '#2A2410', borderColor: theme.accent, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  bannerText: { color: theme.text, fontSize: 13 },
  bannerAction: { color: theme.accent, fontWeight: '700' },
});
