import * as Crypto from 'expo-crypto';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, Incident, IncidentType } from '../../core/api';
import { enqueueReport } from '../sync/reportQueue';
import { theme } from '../../core/theme';
import { TYPE_LABEL, TYPES } from './labels';

interface Props {
  visible: boolean;
  position: { lat: number; lon: number } | null; // position fiable requise
  onClose: () => void;
  onDone: (incident: Incident, merged: boolean) => void;
  /** Pas de réseau : le signalement est mis en file et sera envoyé au retour de la connexion. */
  onQueued?: () => void;
}

export function ReportModal({ visible, position, onClose, onDone, onQueued }: Props) {
  const [type, setType] = useState<IncidentType | null>(null);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!type || !position) return;
    setSending(true); setError(null);
    const clientReportId = Crypto.randomUUID(); // même identifiant à chaque rejeu : jamais de doublon côté serveur
    const observedAt = Date.now();
    const text = description.trim() || undefined;
    try {
      const r = await api.createReport({ type, description: text, ...position, clientReportId, observedAt: new Date(observedAt).toISOString() });
      setType(null); setDescription('');
      if (r.incident) onDone(r.incident, r.report.mergedIntoExisting);
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
        await enqueueReport({ clientReportId, type, description: text, ...position, observedAt });
        setType(null); setDescription('');
        onQueued?.();
      } else {
        setError(e.message);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title}>Signaler un incident</Text>
          {!position && <Text style={s.error}>Position fiable requise pour signaler.</Text>}
          <View style={s.grid}>
            {TYPES.map((t) => (
              <Pressable key={t} onPress={() => setType(t)} style={[s.chip, type === t && s.chipOn]}>
                <Text style={[s.chipText, type === t && s.chipTextOn]}>{TYPE_LABEL[t]}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={description} onChangeText={setDescription} maxLength={300}
            placeholder="Précision (facultatif)" placeholderTextColor={theme.muted} style={s.input}
          />
          {error && <Text style={s.error}>{error}</Text>}
          <Pressable disabled={!type || !position || sending} onPress={send} style={[s.send, (!type || !position) && { opacity: 0.4 }]}>
            {sending ? <ActivityIndicator color="#111" /> : <Text style={s.sendText}>Envoyer</Text>}
          </Pressable>
          <Pressable onPress={onClose}><Text style={s.cancel}>Annuler</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.bg },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontWeight: '700' },
  chipTextOn: { color: '#111' },
  input: { color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, backgroundColor: theme.bg },
  send: { backgroundColor: theme.accent, borderRadius: 14, padding: 14, alignItems: 'center' },
  sendText: { color: '#111', fontWeight: '800', fontSize: 16 },
  cancel: { color: theme.muted, textAlign: 'center', fontWeight: '600', paddingVertical: 4 },
  error: { color: theme.danger },
});
