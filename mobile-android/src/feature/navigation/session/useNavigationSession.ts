import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  ARRIVAL_M, BACKGROUND_GAP_MS, HEARTBEAT_MS, NO_FIX_TIMEOUT_MS, RETRY_RESTORE_MS,
} from './constants';
import { computeGuidance, Guidance, haversine, isFixReliable } from './geometry';
import { evaluateRestoration, expire, finish, interrupt, replaceRoute, resume } from './sessionLogic';
import { loadSession, saveSession } from './sessionRepository';
import { checkOnline, finalize, hasSufficientLocalMaps } from './sessionService';
import { RouteSnapshot, SessionRecord } from './types';
import { flushObservations, recordObservation } from '../../traffic/observationCollector';

export function useNavigationSession(id: string) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [user, setUser] = useState<{ lat: number; lon: number } | null>(null);
  const ref = useRef<SessionRecord | null>(null);
  const lastFixAt = useRef(Date.now());
  const restoring = useRef(false);

  const commit = useCallback(async (next: SessionRecord) => {
    ref.current = next; setSession(next); await saveSession(next);
  }, []);

  const doFinish = useCallback(async (status: 'TERMINEE' | 'ANNULEE') => {
    if (!ref.current || ref.current.status !== 'EN_COURS') return;
    const done = await finalize(finish(ref.current, status, Date.now()));
    ref.current = done; setSession(done);
    flushObservations().catch(() => undefined);
  }, []);

  /** RES-005/006 : reprise seulement si GPS fiable ET cartes disponibles (réseau ou locales). */
  const attemptRestoration = useCallback(async () => {
    const s = ref.current;
    if (!s || s.status !== 'EN_COURS' || s.operationalState === 'ACTIVE' || restoring.current) return;
    restoring.current = true;
    try {
      let gpsReliable = false;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          gpsReliable = isFixReliable(
            { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }, Date.now());
          if (gpsReliable) setUser({ lat: p.coords.latitude, lon: p.coords.longitude });
        }
      } catch { gpsReliable = false; }
      const online = await checkOnline();
      const decision = evaluateRestoration(s, {
        now: Date.now(), gpsReliable, mapsSufficient: online || hasSufficientLocalMaps(),
      });
      if (decision.decision === 'RESUME') {
        lastFixAt.current = Date.now();
        await commit(resume(s, Date.now()));
      } else if (decision.decision === 'STAY_INTERRUPTED') {
        const withCause = decision.missing.includes('GPS')
          ? interrupt(s, 'GPS_INDISPONIBLE', Date.now())
          : interrupt(s, 'DONNEES_CARTOGRAPHIQUES_INDISPONIBLES', Date.now());
        await commit(withCause);
      } else {
        const done = await finalize(expire(s, Date.now(), decision.decision === 'EXPIRE_UNCERTAIN'));
        ref.current = done; setSession(done);
      }
    } finally {
      restoring.current = false;
    }
  }, [commit]);

  // Chargement + détection d'une fermeture de l'app (RES-008 : ce n'est pas une annulation).
  useEffect(() => {
    (async () => {
      let s = await loadSession(id);
      if (!s) return;
      if (s.status === 'EN_COURS' && s.operationalState === 'ACTIVE' && Date.now() - s.lastSeenAt > BACKGROUND_GAP_MS) {
        s = interrupt(s, 'APPLICATION_FERMEE', Date.now(), s.lastSeenAt); // T0 = dernier signe de vie
        await saveSession(s);
      }
      ref.current = s; setSession(s);
      if (s.operationalState !== 'ACTIVE') attemptRestoration();
    })();
  }, [id, attemptRestoration]);

  // Suivi GPS + guidage quand la session est active.
  const active = session?.status === 'EN_COURS' && session.operationalState === 'ACTIVE';
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let stopped = false;
    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
          async (loc) => {
            const s = ref.current;
            if (!s || s.status !== 'EN_COURS' || s.operationalState !== 'ACTIVE') return;
            const fix = { lat: loc.coords.latitude, lon: loc.coords.longitude, accuracy: loc.coords.accuracy, timestamp: loc.timestamp };
            if (!isFixReliable(fix, Date.now())) return; // NAV-011 : pas de guidage sur position douteuse
            lastFixAt.current = Date.now();
            // Collecte statistique : uniquement avec consentement (vérifié dans recordObservation), jamais bloquante.
            recordObservation({
              lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy, speed: loc.coords.speed,
              heading: loc.coords.heading, timestamp: loc.timestamp,
            }).catch(() => undefined);
            setUser({ lat: fix.lat, lon: fix.lon });
            const prev = s.lastKnownPosition;
            const step = prev ? haversine([prev.lon, prev.lat], [fix.lon, fix.lat]) : 0;
            const next: SessionRecord = {
              ...s, lastSeenAt: Date.now(), lastKnownPosition: { lat: fix.lat, lon: fix.lon, at: Date.now() },
              distanceTraveledMeters: s.distanceTraveledMeters + (step < 200 ? step : 0),
            };
            ref.current = next;
            const g = computeGuidance(s.route.coordinates, s.route.steps, s.route.distanceMeters, s.route.durationSeconds, [fix.lon, fix.lat]);
            setGuidance(g);
            if (haversine([fix.lon, fix.lat], [s.destination.lon, s.destination.lat]) <= ARRIVAL_M) {
              await doFinish('TERMINEE');
            }
          },
        );
        if (stopped) sub.remove();
      } catch {
        if (ref.current) await commit(interrupt(ref.current, 'GPS_INDISPONIBLE', Date.now()));
      }
    })();
    return () => { stopped = true; sub?.remove(); };
  }, [active, commit, doFinish]);

  // Battement de vie + détection d'absence de fix (GPS_INDISPONIBLE).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const s = ref.current;
      if (!s || s.status !== 'EN_COURS' || s.operationalState !== 'ACTIVE') return;
      if (Date.now() - lastFixAt.current > NO_FIX_TIMEOUT_MS) {
        await commit(interrupt(s, 'GPS_INDISPONIBLE', Date.now(), lastFixAt.current));
      } else {
        await commit({ ...s, lastSeenAt: Date.now() });
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [active, commit]);

  // Envoi périodique des observations en attente tant que la navigation est active.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { flushObservations().catch(() => undefined); }, 15_000);
    return () => clearInterval(t);
  }, [active]);

  // Retour au premier plan après un long écart, puis nouvelles tentatives périodiques si interrompue.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (st) => {
      const s = ref.current;
      if (st !== 'active' || !s || s.status !== 'EN_COURS') return;
      if (s.operationalState === 'ACTIVE' && Date.now() - s.lastSeenAt > BACKGROUND_GAP_MS) {
        await commit(interrupt(s, 'APPLICATION_FERMEE', Date.now(), s.lastSeenAt));
      }
      attemptRestoration();
    });
    const t = setInterval(attemptRestoration, RETRY_RESTORE_MS);
    return () => { sub.remove(); clearInterval(t); };
  }, [commit, attemptRestoration]);

  const applyRoute = useCallback(async (route: RouteSnapshot) => {
    if (ref.current) await commit(replaceRoute(ref.current, route));
  }, [commit]);

  return { session, guidance, user, finishNow: () => doFinish('TERMINEE'), retry: attemptRestoration, applyRoute };
}
