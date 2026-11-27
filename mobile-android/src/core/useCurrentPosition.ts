import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

export type PositionState =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'error' }
  | { status: 'ready'; lat: number; lon: number; accuracy: number | null };

/** NAV-002 / NAV-003 : permission au moment du besoin, position + précision exposées. */
export function useCurrentPosition() {
  const [state, setState] = useState<PositionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setState({ status: 'denied' });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setState({ status: 'ready', lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { position: state, refresh };
}
