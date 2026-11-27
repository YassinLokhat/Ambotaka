import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'roadpulse.installationId';
let cached: string | null = null;

/** Identifiant aléatoire propre à l'installation (spec §4.1), conservé dans SecureStore. */
export async function getInstallationId(): Promise<string> {
  if (cached) return cached;
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, id);
  }
  cached = id;
  return id;
}
