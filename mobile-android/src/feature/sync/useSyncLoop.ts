import { useEffect } from 'react';
import { AppState } from 'react-native';
import { registerBackgroundSync } from './backgroundSync';
import { recoverInterrupted } from './deletionRepository';
import { syncNow } from './syncService';

/** Déclencheurs de synchronisation en premier plan : démarrage, retour au premier plan, boucle de 30 s. */
export function useSyncLoop() {
  useEffect(() => {
    registerBackgroundSync();
    recoverInterrupted().then(() => syncNow()).catch(() => undefined);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') syncNow().catch(() => undefined); });
    const t = setInterval(() => { syncNow().catch(() => undefined); }, 30_000);
    return () => { sub.remove(); clearInterval(t); };
  }, []);
}
