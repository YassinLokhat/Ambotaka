import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Demande la permission au moment où elle est utile (premier besoin de notification). Jamais bloquant. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('privacy', { name: 'Confidentialité', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch { return false; }
}

/** PRI-010 : le contenu ne doit JAMAIS contenir de coordonnées GPS ; seuls des textes fixes sont acceptés ici. */
export const NOTIFICATION_TEXTS = {
  deletionDone: { title: 'Données supprimées', body: 'Votre demande de suppression a été confirmée par le serveur.' },
  deletionBlocked: {
    title: 'Suppression en attente',
    body: 'Une demande de suppression n’a pas pu aboutir depuis plusieurs heures. Ouvrez RoadPulse pour la relancer.',
  },
} as const;

export async function notifyLocal(text: { title: string; body: string }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: text.title, body: text.body },
      trigger: Platform.OS === 'android' ? { channelId: 'privacy' } as any : null,
    });
  } catch { /* permission refusée : le statut reste visible dans l'écran Confidentialité */ }
}
