import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, Incident } from '../../core/api';
import { theme } from '../../core/theme';
import { ago, STATUS_LABEL, TYPE_LABEL } from './labels';

interface Props { incident: Incident | null; onClose: () => void; onUpdated: (i: Incident) => void }

export function IncidentModal({ incident, onClose, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!incident) return null;

  const mine = incident.myResponse;
  const respond = async (kind: 'CONFIRMATION' | 'CONTESTATION') => {
    setBusy(true); setError(null);
    try { onUpdated((await api.respondToIncident(incident.id, kind)).incident); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card}>
          <Text style={s.title}>{TYPE_LABEL[incident.type]}</Text>
          <Text style={s.status}>{STATUS_LABEL[incident.status]}</Text>
          {incident.description ? <Text style={s.text}>{incident.description}</Text> : null}
          <Text style={s.muted}>
            Mis à jour {ago(incident.updatedAt)} · confiance {Math.round(incident.confidence * 100)} % ·
            {' '}{incident.reporterCount} signalement{incident.reporterCount > 1 ? 's' : ''}, {incident.confirmationCount} confirmation{incident.confirmationCount > 1 ? 's' : ''}, {incident.contestationCount} contestation{incident.contestationCount > 1 ? 's' : ''}
          </Text>
          {error && <Text style={s.error}>{error}</Text>}
          {mine ? (
            <Text style={s.muted}>{mine === 'REPORTER' ? 'Vous avez signalé cet incident.' : mine === 'CONFIRMATION' ? 'Vous l’avez confirmé.' : 'Vous l’avez contesté.'}</Text>
          ) : busy ? <ActivityIndicator color={theme.accent} /> : (
            <View style={s.row}>
              <Pressable style={[s.btn, s.yes]} onPress={() => respond('CONFIRMATION')}><Text style={s.yesText}>Toujours là</Text></Pressable>
              <Pressable style={[s.btn, s.no]} onPress={() => respond('CONTESTATION')}><Text style={s.noText}>Plus là</Text></Pressable>
            </View>
          )}
          <Pressable onPress={onClose}><Text style={s.close}>Fermer</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: theme.panel, borderRadius: 20, padding: 18, gap: 8, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 22, fontWeight: '800' },
  status: { color: theme.accent, fontWeight: '700' },
  text: { color: theme.text },
  muted: { color: theme.muted, fontSize: 13 },
  error: { color: theme.danger },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  yes: { backgroundColor: theme.accent },
  yesText: { color: '#111', fontWeight: '800' },
  no: { borderWidth: 1, borderColor: theme.danger },
  noText: { color: theme.danger, fontWeight: '800' },
  close: { color: theme.muted, textAlign: 'center', paddingTop: 6, fontWeight: '600' },
});
