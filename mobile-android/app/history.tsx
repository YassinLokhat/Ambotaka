import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../src/core/theme';
import { formatDistance, formatDuration } from '../src/feature/navigation/format';
import { deleteSummary, listSummaries } from '../src/feature/navigation/session/sessionRepository';
import { TripSummary } from '../src/feature/navigation/session/types';

const LABEL = { EN_COURS: 'En cours', TERMINEE: 'Terminée', ANNULEE: 'Annulée', EXPIREE: 'Expirée' } as const;
const fmt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export default function History() {
  const [items, setItems] = useState<TripSummary[]>([]);
  const load = useCallback(() => { listSummaries().then(setItems); }, []);
  useFocusEffect(load);

  const remove = (t: TripSummary) =>
    Alert.alert('Supprimer ce résumé ?', 'Seul ce résumé sera supprimé.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { await deleteSummary(t.id); load(); } },
    ]);

  return (
    <SafeAreaView style={s.root}>
      <Pressable onPress={() => router.back()}><Text style={s.back}>← Retour</Text></Pressable>
      <Text style={s.h1}>Historique</Text>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        ListEmptyComponent={<Text style={s.muted}>Aucun trajet pour le moment.</Text>}
        renderItem={({ item }) => (
          <Pressable style={s.card} onLongPress={() => remove(item)}>
            <Text style={s.status}>{LABEL[item.finalStatus]} · {fmt(item.startedAt)}</Text>
            <Text style={s.line}>Durée effective : {item.effectiveDurationSeconds != null ? formatDuration(item.effectiveDurationSeconds) : 'indisponible'}</Text>
            <Text style={s.line}>Distance : {item.distanceMeters != null ? formatDistance(item.distanceMeters) : 'indisponible'}</Text>
            {item.retainUntil && <Text style={s.muted}>Conservé jusqu’au {fmt(item.retainUntil)}</Text>}
            <Pressable onPress={() => remove(item)}><Text style={s.del}>Supprimer</Text></Pressable>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  back: { color: theme.accent, fontWeight: '700', marginBottom: 8 },
  h1: { color: theme.text, fontSize: 28, fontWeight: '800', marginBottom: 12 },
  card: { backgroundColor: theme.panel, borderColor: theme.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10, gap: 3 },
  status: { color: theme.text, fontWeight: '800' },
  line: { color: theme.text, fontSize: 14 },
  muted: { color: theme.muted, fontSize: 12 },
  del: { color: theme.danger, fontWeight: '700', marginTop: 6 },
});
