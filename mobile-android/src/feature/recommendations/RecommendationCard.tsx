import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Recommendation } from '../../core/api';
import { theme } from '../../core/theme';

export function RecommendationCard({ rec, error, onAccept, onIgnore }: {
  rec: Recommendation; error: string | null; onAccept: () => void; onIgnore: () => void;
}) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(rec.expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((new Date(rec.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [rec.expiresAt]);
  const mins = Math.max(1, Math.round(rec.gainSeconds / 60));

  return (
    <View style={s.card}>
      <Text style={s.title}>Itinéraire plus rapide · −{mins} min</Text>
      <Text style={s.text}>{rec.motif}</Text>
      <Text style={s.meta}>
        Confiance {Math.round(rec.confidence * 100)} % · durée du fournisseur ajustée par le trafic communautaire et les incidents · offre valable {left} s
      </Text>
      {error && <Text style={s.error}>{error}</Text>}
      <View style={s.row}>
        <Pressable style={[s.btn, s.yes]} disabled={left === 0} onPress={onAccept}><Text style={s.yesText}>Changer d’itinéraire</Text></Pressable>
        <Pressable style={[s.btn, s.no]} onPress={onIgnore}><Text style={s.noText}>Ignorer</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: theme.bg, borderColor: theme.accent, borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  title: { color: theme.accent, fontWeight: '800', fontSize: 16 },
  text: { color: theme.text, fontSize: 14 },
  meta: { color: theme.muted, fontSize: 12 },
  error: { color: theme.danger, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  yes: { backgroundColor: theme.accent },
  yesText: { color: '#111', fontWeight: '800' },
  no: { borderWidth: 1, borderColor: theme.border },
  noText: { color: theme.text, fontWeight: '700' },
});
