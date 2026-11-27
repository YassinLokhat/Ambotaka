import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../src/feature/sync/backgroundSync'; // définit la tâche d'arrière-plan au chargement
import { useSyncLoop } from '../src/feature/sync/useSyncLoop';

export default function Layout() {
  useSyncLoop();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0B0C0E' } }} />
    </>
  );
}
