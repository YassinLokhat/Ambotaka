import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { syncNow } from './syncService';

export const SYNC_TASK = 'roadpulse-sync';

// Doit être défini au niveau module (importé par le layout racine). Android limite et peut différer ces tâches :
// la synchronisation est aussi déclenchée à l'ouverture, au retour au premier plan et après chaque action.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const r = await syncNow();
    return r.didWork ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
    await BackgroundFetch.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 * 60, stopOnTerminate: false, startOnBoot: true });
  } catch { /* indisponible (restrictions du fabricant, mode économie d'énergie) : les autres déclencheurs suffisent */ }
}
