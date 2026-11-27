import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../core/theme';

/** Demande du consentement statistique, distincte de la permission GPS système (PRI-001). Refuser ne bloque rien. */
export function ConsentPrompt({ visible, onChoose }: { visible: boolean; onChoose: (granted: boolean) => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onChoose(false)}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Aider à mesurer le trafic ?</Text>
          <Text style={s.text}>
            Pendant vos navigations, l’application peut envoyer votre vitesse et votre position pour estimer la fluidité des routes.
            Les coordonnées ne sont pas conservées : seuls le tronçon de route, la vitesse et l’heure le sont, et une route n’est
            publiée que si plusieurs conducteurs y ont contribué.
          </Text>
          <Text style={s.text}>Vous pouvez retirer votre accord à tout moment ; vos données brutes seront alors supprimées. La navigation fonctionne dans tous les cas.</Text>
          <Pressable style={s.yes} onPress={() => onChoose(true)}><Text style={s.yesText}>J’accepte de contribuer</Text></Pressable>
          <Pressable onPress={() => onChoose(false)}><Text style={s.no}>Non merci</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 22 },
  card: { backgroundColor: theme.panel, borderRadius: 20, padding: 18, gap: 10, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  text: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  yes: { backgroundColor: theme.accent, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 4 },
  yesText: { color: '#111', fontWeight: '800' },
  no: { color: theme.text, textAlign: 'center', fontWeight: '700', paddingVertical: 6 },
});
