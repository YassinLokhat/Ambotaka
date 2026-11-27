import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../src/core/theme';
import { LocalDeletion, listDeletions, retryNow } from '../src/feature/sync/deletionRepository';
import { requestDeletion, syncNow } from '../src/feature/sync/syncService';
import { DeletionKind, isBlocked } from '../src/feature/sync/syncRules';
import { getConsent, LocalConsent, setStatisticsConsent } from '../src/feature/traffic/consentStore';
import { invalidateConsentCache } from '../src/feature/traffic/observationCollector';

const LABEL: Record<DeletionKind, string> = {
  GPS_OBSERVATIONS: 'Mes mesures de trafic',
  INCIDENT_CONTRIBUTIONS: 'Mes signalements et confirmations',
  RECOMMENDATIONS: 'Mes recommandations',
  ALL: 'Toutes mes données sur le serveur',
};
const fmt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function statusText(d: LocalDeletion, now: number): { text: string; color: string } {
  if (d.status === 'CONFIRMEE') return { text: `Supprimé et confirmé par le serveur · ${fmt(d.confirmedAt!)}`, color: theme.accent };
  if (isBlocked(d, now)) return { text: 'Bloquée depuis plusieurs heures — réessayez', color: theme.danger };
  if (d.status === 'EN_ECHEC_TEMPORAIRE') return { text: `Nouvelle tentative automatique vers ${fmt(d.nextAttemptAt)}`, color: theme.muted };
  return { text: 'En attente de confirmation du serveur…', color: theme.muted };
}

export default function Privacy() {
  const [consent, setConsent] = useState<LocalConsent | null>(null);
  const [requests, setRequests] = useState<LocalDeletion[]>([]);
  const load = useCallback(() => { getConsent().then(setConsent); listDeletions().then(setRequests); }, []);
  useFocusEffect(load);
  useEffect(() => { const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  const toggle = async (granted: boolean) => {
    const apply = async () => { await setStatisticsConsent(granted); invalidateConsentCache(); load(); };
    if (granted) return apply();
    Alert.alert('Retirer votre accord ?', 'La collecte s’arrête immédiatement et vos données brutes seront supprimées.', [
      { text: 'Annuler', style: 'cancel' }, { text: 'Retirer', style: 'destructive', onPress: apply },
    ]);
  };

  const ask = (type: DeletionKind) =>
    Alert.alert(`Supprimer : ${LABEL[type].toLowerCase()} ?`,
      'Les données locales concernées sont effacées tout de suite. La suppression côté serveur est répétée jusqu’à confirmation, même sans réseau.', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => { await requestDeletion([type]); load(); } },
      ]);

  const now = Date.now();
  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        <Pressable onPress={() => router.back()}><Text style={s.back}>← Retour</Text></Pressable>
        <Text style={s.h1}>Confidentialité</Text>

        <View style={s.card}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Contribuer aux statistiques de trafic</Text>
            <Text style={s.muted}>Indépendant de l’autorisation de localisation du téléphone. Désactivé, la navigation reste pleinement disponible.</Text>
            {consent && !consent.serverSynced && <Text style={s.pending}>Synchronisation avec le serveur en attente…</Text>}
          </View>
          <Switch value={consent?.granted === true} onValueChange={toggle} trackColor={{ true: theme.accent }} />
        </View>

        <Text style={s.h2}>Supprimer mes données</Text>
        {(['GPS_OBSERVATIONS', 'INCIDENT_CONTRIBUTIONS', 'ALL'] as DeletionKind[]).map((t) => (
          <Pressable key={t} style={s.action} onPress={() => ask(t)}>
            <Text style={s.actionText}>{LABEL[t]}</Text>
          </Pressable>
        ))}
        <Text style={s.muted}>L’historique de vos trajets se gère séparément, trajet par trajet, depuis l’écran Historique.</Text>

        {requests.length > 0 && <Text style={s.h2}>Demandes de suppression</Text>}
        {requests.map((d) => {
          const st = statusText(d, now);
          return (
            <View key={d.id} style={s.req}>
              <Text style={s.label}>{d.types.map((t) => LABEL[t]).join(', ')}</Text>
              <Text style={[s.muted, { color: st.color }]}>{st.text}</Text>
              <Text style={s.muted}>Demandée le {fmt(d.createdAt)} · {d.attempts} tentative{d.attempts > 1 ? 's' : ''}</Text>
              {d.status !== 'CONFIRMEE' && (
                <Pressable onPress={async () => { await retryNow(d.id); syncNow().catch(() => undefined); load(); }}>
                  <Text style={s.retry}>Réessayer maintenant</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  back: { color: theme.accent, fontWeight: '700' },
  h1: { color: theme.text, fontSize: 28, fontWeight: '800' },
  h2: { color: theme.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14 },
  label: { color: theme.text, fontWeight: '700', fontSize: 15 },
  muted: { color: theme.muted, fontSize: 13, marginTop: 2 },
  pending: { color: theme.accent, fontSize: 12, marginTop: 6 },
  action: { borderWidth: 1, borderColor: theme.danger, borderRadius: 14, padding: 14 },
  actionText: { color: theme.danger, fontWeight: '700' },
  req: { backgroundColor: theme.panel, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 2 },
  retry: { color: theme.accent, fontWeight: '700', marginTop: 6 },
});
