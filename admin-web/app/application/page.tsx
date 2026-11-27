'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowUpRight, Check, Clock3, LoaderCircle, LocateFixed, Map as MapIcon, MapPin, Navigation,
  Search, ShieldCheck, Trash2, TriangleAlert, WifiOff, X,
} from 'lucide-react';
import styles from './page.module.css';
import type { MapIncident, MapPoint, MapTraffic } from '@/components/application-map';

const ApplicationMap = dynamic(() => import('@/components/application-map'), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>Chargement de la carte…</div>,
});

type Tab = 'map' | 'history' | 'privacy';
type Place = MapPoint & { id: string; name: string; address: string };
type RouteOption = {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: { coordinates: [number, number][] };
  estimationSource?: string;
};
type Trip = { id: string; destination: string; startedAt: string; distanceMeters: number; durationSeconds: number };
type IncidentType = 'ACCIDENT' | 'EMBOUTEILLAGE' | 'ROUTE_BLOQUEE' | 'TRAVAUX' | 'DANGER' | 'AUTRE';
type Incident = {
  id: string; type: IncidentType; description: string | null; status: string;
  latitude: number; longitude: number; confidence: number; reporterCount: number;
  confirmationCount: number; contestationCount: number; distanceMeters?: number;
  myResponse?: null | 'REPORTER' | 'CONFIRMATION' | 'CONTESTATION';
};
type DeletionRequest = {
  id: string; status: 'EN_COURS' | 'CONFIRMEE' | 'ECHEC'; types: string[]; createdAt: string; completedAt: string | null;
};

const DEFAULT_ORIGIN: MapPoint = { lat: -18.8792, lon: 47.5079 };
const POLICY_VERSION = '2026-11-v1';
const DEMO_PLACES: Place[] = [
  { id: 'analakely', name: 'Analakely', address: 'Centre-ville, Antananarivo', lat: -18.9087, lon: 47.5256 },
  { id: 'anosy', name: 'Lac Anosy', address: 'Anosy, Antananarivo', lat: -18.9148, lon: 47.5213 },
  { id: 'ivandry', name: 'Ivandry', address: 'Ivandry, Antananarivo', lat: -18.8792, lon: 47.535 },
  { id: 'ivato', name: 'Aéroport international Ivato', address: 'Ivato, Antananarivo', lat: -18.7967, lon: 47.4788 },
  { id: 'ambohitrarahaba', name: 'Ambohitrarahaba', address: 'Nord d’Antananarivo', lat: -18.85, lon: 47.52 },
  { id: 'andraharo', name: 'Andraharo', address: 'Andraharo, Antananarivo', lat: -18.884, lon: 47.5 },
];

const TYPE_LABELS: Record<IncidentType, string> = {
  ACCIDENT: 'Accident', EMBOUTEILLAGE: 'Embouteillage', ROUTE_BLOQUEE: 'Route bloquée',
  TRAVAUX: 'Travaux', DANGER: 'Danger', AUTRE: 'Autre',
};
const INCIDENT_STATUS_LABELS: Record<string, string> = {
  DETECTE: 'Détecté', CONFIRME: 'Confirmé', EN_COURS: 'En cours', RESOLU: 'Résolu', EXPIRE: 'Expiré',
};
const DELETION_STATUS_LABELS: Record<DeletionRequest['status'], string> = {
  EN_COURS: 'En cours', CONFIRMEE: 'Confirmée', ECHEC: 'Échec',
};

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function apiRequest<T>(path: string, installationId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/application/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-installation-id': installationId, ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? 'API indisponible');
  return body as T;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function demoRoutes(origin: MapPoint, destination: MapPoint): RouteOption[] {
  const latDelta = destination.lat - origin.lat;
  const lonDelta = destination.lon - origin.lon;
  const makeCoordinates = (bend: number): [number, number][] => [
    [origin.lon, origin.lat],
    [origin.lon + lonDelta * 0.28 + bend, origin.lat + latDelta * 0.25],
    [origin.lon + lonDelta * 0.55 + bend, origin.lat + latDelta * 0.52],
    [origin.lon + lonDelta * 0.78, origin.lat + latDelta * 0.78 - bend],
    [destination.lon, destination.lat],
  ];
  const direct = Math.hypot(latDelta * 111_000, lonDelta * 105_000);
  const distance = Math.max(900, direct * 1.35);
  return [
    { id: 'demo-fast', distanceMeters: distance, durationSeconds: Math.max(240, distance / 6.3), geometry: { coordinates: makeCoordinates(0.0014) }, estimationSource: 'DEMO' },
    { id: 'demo-alt', distanceMeters: distance * 1.18, durationSeconds: Math.max(300, distance / 5.2), geometry: { coordinates: makeCoordinates(-0.0017) }, estimationSource: 'DEMO' },
  ];
}

export default function ApplicationPage() {
  const [tab, setTab] = useState<Tab>('map');
  const [origin, setOrigin] = useState<MapPoint>(DEFAULT_ORIGIN);
  const [originLabel, setOriginLabel] = useState('Centre d’Antananarivo · démo');
  const [installationId, setInstallationId] = useState('');
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState<Place | null>(null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [trafficSegments, setTrafficSegments] = useState<MapTraffic[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [trafficStatus, setTrafficStatus] = useState<'CHARGEMENT' | 'OK' | 'DONNEES_INSUFFISANTES' | 'ERREUR'>('CHARGEMENT');
  const [apiOnline, setApiOnline] = useState(false);
  const [apiChecking, setApiChecking] = useState(true);
  const [searching, setSearching] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationStartedAt, setNavigationStartedAt] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<IncidentType>('DANGER');
  const [reportDescription, setReportDescription] = useState('');
  const [toast, setToast] = useState('');

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  const routeCoordinates = selectedRoute?.geometry.coordinates ?? [];
  const mapIncidents = incidents.map((incident) => ({
    id: incident.id, lat: incident.latitude, lon: incident.longitude, status: incident.status,
  }));

  useEffect(() => {
    let id = localStorage.getItem('roadpulse-web-installation');
    if (!id) {
      id = newId();
      localStorage.setItem('roadpulse-web-installation', id);
    }
    setInstallationId(id);
    try {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const saved = JSON.parse(localStorage.getItem('roadpulse-web-trips') ?? '[]') as Trip[];
      const retained = saved.filter((trip) => new Date(trip.startedAt).getTime() >= cutoff);
      setTrips(retained);
      localStorage.setItem('roadpulse-web-trips', JSON.stringify(retained));
    } catch {
      localStorage.removeItem('roadpulse-web-trips');
    }
  }, []);

  useEffect(() => {
    if (!installationId) return;
    let cancelled = false;
    const query = `lat=${origin.lat}&lon=${origin.lon}&radiusMeters=5000`;
    setApiChecking(true);
    setTrafficStatus('CHARGEMENT');
    void Promise.allSettled([
      apiRequest<{ incidents: Incident[] }>(`incidents?${query}`, installationId),
      apiRequest<{ status: 'OK' | 'DONNEES_INSUFFISANTES'; segments: MapTraffic[] }>(`traffic?${origin.lat ? `lat=${origin.lat}&lon=${origin.lon}` : ''}&radiusMeters=3000`, installationId),
    ]).then(([incidentResult, trafficResult]) => {
      if (cancelled) return;
      const incidentsOk = incidentResult.status === 'fulfilled';
      const trafficOk = trafficResult.status === 'fulfilled';
      if (incidentsOk) setIncidents(incidentResult.value.incidents);
      if (trafficOk) {
        setTrafficSegments(trafficResult.value.segments);
        setTrafficStatus(trafficResult.value.status);
      } else {
        setTrafficSegments([]);
        setTrafficStatus('ERREUR');
      }
      setApiOnline(incidentsOk || trafficOk);
      setApiChecking(false);
    });
    return () => { cancelled = true; };
  }, [origin, installationId]);

  useEffect(() => {
    if (!installationId) return;
    let cancelled = false;
    void Promise.allSettled([
      apiRequest<{ statistics: { granted: boolean | null } }>('consents', installationId),
      apiRequest<{ requests: DeletionRequest[] }>('deletion-requests', installationId),
    ]).then(([consentResult, deletionResult]) => {
      if (cancelled) return;
      if (consentResult.status === 'fulfilled') setConsent(consentResult.value.statistics.granted);
      if (deletionResult.status === 'fulfilled') setDeletionRequests(deletionResult.value.requests);
    });
    return () => { cancelled = true; };
  }, [installationId]);

  useEffect(() => {
    if (query.trim().length < 2 || !installationId || destination?.name === query.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await apiRequest<{ places: Place[] }>(
          `places/search?q=${encodeURIComponent(query.trim())}&lat=${origin.lat}&lon=${origin.lon}`,
          installationId,
        );
        if (!cancelled) {
          setSuggestions(result.places);
          setApiOnline(true);
        }
      } catch {
        if (!cancelled) {
          const needle = query.trim().toLocaleLowerCase('fr');
          setSuggestions(DEMO_PLACES.filter((place) => `${place.name} ${place.address}`.toLocaleLowerCase('fr').includes(needle)));
          setApiOnline(false);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, origin, installationId, destination]);

  useEffect(() => {
    if (!destination || !installationId) {
      setRoutes([]);
      setSelectedRouteId(null);
      return;
    }
    let cancelled = false;
    const searchRoutes = async () => {
      try {
        const result = await apiRequest<{ routes: RouteOption[] }>('routes/search', installationId, {
          method: 'POST',
          body: JSON.stringify({ origin, destination: { lat: destination.lat, lon: destination.lon } }),
        });
        if (cancelled) return;
        if (!result.routes.length) throw new Error('Aucun itinéraire');
        setRoutes(result.routes);
        setSelectedRouteId(result.routes[0].id);
        setApiOnline(true);
      } catch {
        if (cancelled) return;
        const demo = demoRoutes(origin, destination);
        setRoutes(demo);
        setSelectedRouteId(demo[0].id);
        setApiOnline(false);
      }
    };
    void searchRoutes();
    return () => { cancelled = true; };
  }, [destination, origin, installationId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function chooseDestination(place: Place) {
    setDestination(place);
    setQuery(place.name);
    setSuggestions([]);
    setTab('map');
    setNavigationActive(false);
  }

  function chooseMapPoint(point: MapPoint) {
    chooseDestination({
      ...point,
      id: `map-${Date.now()}`,
      name: 'Point sélectionné',
      address: `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`,
    });
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setToast('La géolocalisation n’est pas disponible dans ce navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setOrigin({ lat: coords.latitude, lon: coords.longitude });
        setOriginLabel('Ma position');
      },
      () => setToast('Position refusée ou indisponible. Le point de démonstration est conservé.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function clearDestination() {
    setDestination(null);
    setQuery('');
    setRoutes([]);
    setSelectedRouteId(null);
  }

  function finishNavigation() {
    if (!selectedRoute || !destination) return;
    const elapsed = navigationStartedAt ? Math.max(60, Math.round((Date.now() - navigationStartedAt) / 1000)) : selectedRoute.durationSeconds;
    const trip: Trip = {
      id: newId(), destination: destination.name,
      startedAt: new Date(navigationStartedAt ?? Date.now()).toISOString(),
      distanceMeters: selectedRoute.distanceMeters, durationSeconds: elapsed,
    };
    const next = [trip, ...trips];
    setTrips(next);
    localStorage.setItem('roadpulse-web-trips', JSON.stringify(next));
    setNavigationActive(false);
    setNavigationStartedAt(null);
    setToast('Trajet ajouté à votre historique local.');
    setTab('history');
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (originLabel !== 'Ma position') {
      setToast('Utilise ta position réelle avant d’envoyer un signalement.');
      return;
    }
    try {
      const result = await apiRequest<{ incident: Incident }>('reports', installationId, {
        method: 'POST',
        body: JSON.stringify({ type: reportType, description: reportDescription || undefined, lat: origin.lat, lon: origin.lon, clientReportId: newId() }),
      });
      setIncidents((current) => [result.incident, ...current.filter((item) => item.id !== result.incident.id)]);
      setApiOnline(true);
      setReportOpen(false);
      setReportDescription('');
      setToast('Signalement transmis et associé à un incident.');
    } catch (error) {
      setApiOnline(false);
      setToast(error instanceof Error ? `Signalement non transmis : ${error.message}` : 'Signalement non transmis. Vérifiez la connexion.');
    }
  }

  async function updateConsent(granted: boolean) {
    try {
      const result = await apiRequest<{ statistics: { granted: boolean | null } }>('consents/statistics', installationId, {
        method: 'PUT', body: JSON.stringify({ granted, policyVersion: POLICY_VERSION }),
      });
      setConsent(result.statistics.granted);
      setApiOnline(true);
      setToast('Préférence enregistrée.');
    } catch {
      setToast('Préférence non enregistrée : le serveur est indisponible.');
    }
  }

  async function requestDataDeletion() {
    if (!window.confirm('Demander la suppression de toutes vos données côté serveur ?')) return;
    try {
      const result = await apiRequest<{ request: DeletionRequest }>('deletion-requests', installationId, {
        method: 'POST', body: JSON.stringify({ idempotencyKey: newId(), types: ['ALL'] }),
      });
      setDeletionRequests((current) => [result.request, ...current.filter((request) => request.id !== result.request.id)]);
      setToast('Demande de suppression transmise au serveur.');
    } catch {
      setToast('API indisponible : la demande n’a pas été transmise.');
    }
  }

  function removeTrip(id: string) {
    const next = trips.filter((trip) => trip.id !== id);
    setTrips(next);
    localStorage.setItem('roadpulse-web-trips', JSON.stringify(next));
  }

  async function respondToIncident(kind: 'CONFIRMATION' | 'CONTESTATION') {
    if (!selectedIncidentId) return;
    try {
      const result = await apiRequest<{ incident: Incident }>(`incidents/${selectedIncidentId}/confirmations`, installationId, {
        method: 'POST', body: JSON.stringify({ kind }),
      });
      setIncidents((current) => current.map((incident) => incident.id === result.incident.id ? result.incident : incident));
      setToast(kind === 'CONFIRMATION' ? 'Incident confirmé.' : 'Incident contesté.');
      setApiOnline(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Réponse non transmise.');
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof MapIcon }[] = [
    { id: 'map', label: 'Carte', icon: MapIcon },
    { id: 'history', label: 'Trajets', icon: Clock3 },
    { id: 'privacy', label: 'Confidentialité', icon: ShieldCheck },
  ];

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="/application" aria-label="RoadPulse, accueil">
          <span className={styles.brandMark}><Navigation size={19} strokeWidth={2.7} /></span>
          <span><strong>RoadPulse</strong><small>Trajets communautaires</small></span>
        </a>
        <nav className={styles.tabs} aria-label="Navigation principale">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`} onClick={() => setTab(id)}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className={`${styles.connection} ${apiOnline ? styles.connectionOnline : ''}`}>
          {apiChecking ? <LoaderCircle size={14} className={styles.connectionSpinner} /> : apiOnline ? <Check size={14} /> : <WifiOff size={14} />}
          {apiChecking ? 'Connexion à l’API…' : apiOnline ? 'API connectée' : 'Mode démo'}
        </div>
      </header>

      <div className={`${styles.workspace} ${tab !== 'map' ? styles.workspaceSingle : ''}`}>
        {tab === 'map' && (
          <>
            <aside className={styles.sidebar}>
              {navigationActive && selectedRoute && destination ? (
                <section className={styles.navigationPanel}>
                  <div className={styles.eyebrow}>APERÇU NAVIGATEUR</div>
                  <div className={styles.navDestination}><Navigation size={20} /><span>Vers {destination.name}</span></div>
                  <p className={styles.navHint}>La navigation GPS en temps réel est disponible dans l’application mobile.</p>
                  <div className={styles.navStats}><strong>{formatDuration(selectedRoute.durationSeconds)}</strong><span>{formatDistance(selectedRoute.distanceMeters)}</span></div>
                  <button type="button" className={styles.primaryButton} onClick={finishNavigation}><Check size={17} /> Terminer l’aperçu</button>
                </section>
              ) : (
                <>
                  <div className={styles.sidebarHeading}>
                    <span className={styles.eyebrow}>ANTANANARIVO</span>
                    <h1>Planifier un trajet</h1>
                  </div>
                  <div className={styles.originRow}>
                    <span className={styles.originDot} />
                    <div><small>Départ</small><strong>{originLabel}</strong></div>
                    <button className={styles.iconButton} type="button" onClick={locateMe} aria-label="Utiliser ma position" title="Utiliser ma position"><LocateFixed size={18} /></button>
                  </div>
                  <div className={styles.searchWrap}>
                    <Search className={styles.searchIcon} size={18} />
                    <input
                      aria-label="Destination"
                      value={query}
                      onChange={(event) => { setQuery(event.target.value); setDestination(null); setRoutes([]); setSuggestions([]); }}
                      placeholder="Où allez-vous ?"
                    />
                    {query && <button type="button" className={styles.clearButton} onClick={clearDestination} aria-label="Effacer la destination"><X size={16} /></button>}
                  </div>

                  {suggestions.length > 0 && (
                    <div className={styles.suggestions}>
                      <div className={styles.listLabel}>{searching ? 'Recherche…' : 'Suggestions de destination'}</div>
                      {suggestions.map((place) => (
                        <button key={place.id} type="button" className={styles.suggestion} onClick={() => chooseDestination(place)}>
                          <span className={styles.placeIcon}><MapPin size={16} /></span>
                          <span><strong>{place.name}</strong><small>{place.address}</small></span>
                          <ArrowUpRight size={15} />
                        </button>
                      ))}
                    </div>
                  )}

                  {destination && (
                    <section className={styles.routeSection}>
                      <div className={styles.sectionTitle}><h2>Itinéraires</h2><span>{routes.length || '…'}</span></div>
                      {routes.length === 0 && <p className={styles.loadingRoutes}>Calcul des itinéraires…</p>}
                      {routes.map((route, index) => (
                        <button key={route.id} type="button" className={`${styles.routeOption} ${selectedRouteId === route.id ? styles.routeSelected : ''}`} onClick={() => setSelectedRouteId(route.id)}>
                          <span className={styles.routeRadio}>{selectedRouteId === route.id && <span />}</span>
                          <span className={styles.routeDetails}>
                            <strong>{formatDuration(route.durationSeconds)}</strong>
                            <small>{formatDistance(route.distanceMeters)} · {index === 0 ? 'Le plus rapide' : 'Alternative'}</small>
                          </span>
                          <span className={styles.routeTag}>
                            {route.estimationSource === 'DEMO' ? 'DÉMO' : route.estimationSource === 'TRAFIC_RECENT' ? 'TRAFIC MESURÉ' : 'DURÉE DE RÉFÉRENCE'}
                          </span>
                        </button>
                      ))}
                      {selectedRoute && <button type="button" className={styles.primaryButton} onClick={() => { setNavigationActive(true); setNavigationStartedAt(Date.now()); }}><Navigation size={17} /> Démarrer l’aperçu</button>}
                    </section>
                  )}

                  {!destination && <p className={styles.mapHint}>Choisissez une destination ou touchez directement la carte.</p>}
                  <div className={styles.sidebarSpacer} />
                  <button type="button" className={styles.reportButton} onClick={() => setReportOpen(true)}><TriangleAlert size={17} /> Signaler un incident</button>
                  <section className={styles.nearbyIncidents}>
                    <div className={styles.sectionTitle}><h2>Incidents proches</h2><span>{incidents.length}</span></div>
                    {incidents.length === 0 ? (
                      <p className={styles.loadingRoutes}>Aucun incident actif dans le rayon consulté.</p>
                    ) : incidents.slice(0, 5).map((incident) => (
                      <button key={incident.id} type="button" className={styles.incidentRow} onClick={() => setSelectedIncidentId(incident.id)}>
                        <span className={styles.incidentDot} />
                        <span><strong>{TYPE_LABELS[incident.type]}</strong><small>{INCIDENT_STATUS_LABELS[incident.status] ?? incident.status}{incident.distanceMeters == null ? '' : ` · ${formatDistance(incident.distanceMeters)}`}</small></span>
                      </button>
                    ))}
                  </section>
                </>
              )}
              <footer className={styles.sidebarFooter}><span>© OpenStreetMap</span><span>RoadPulse · Web</span></footer>
            </aside>
            <section className={styles.mapStage} aria-label="Carte des environs">
              <ApplicationMap
                origin={origin}
                destination={destination}
                routeCoordinates={routeCoordinates}
                incidents={mapIncidents}
                traffic={trafficSegments}
                onMapPick={chooseMapPoint}
                onPressIncident={setSelectedIncidentId}
              />
              <div className={styles.mapBadge}>
                <span className={`${styles.liveDot} ${trafficStatus === 'OK' ? '' : trafficStatus === 'ERREUR' ? styles.liveDotError : styles.liveDotWarning}`} /> Antananarivo <span>·</span>
                {trafficStatus === 'OK' ? `${trafficSegments.length} tronçons mesurés` : trafficStatus === 'DONNEES_INSUFFISANTES' ? 'Données trafic insuffisantes' : trafficStatus === 'ERREUR' ? 'Trafic indisponible' : 'Chargement du trafic'}
              </div>
              <button type="button" className={styles.mapLocate} onClick={locateMe} aria-label="Centrer sur ma position" title="Centrer sur ma position"><LocateFixed size={19} /></button>
            </section>
          </>
        )}

        {tab === 'history' && (
          <section className={styles.contentPanel}>
            <div className={styles.contentHeading}><span className={styles.eyebrow}>SUR CET APPAREIL · 30 JOURS</span><h1>Aperçus de trajets</h1><p>Le navigateur ne suit pas une navigation GPS en arrière-plan; ces entrées sont des aperçus locaux, pas des traces de trajets réels.</p></div>
            {trips.length === 0 ? (
              <div className={styles.emptyState}><Clock3 size={27} /><strong>Aucun aperçu enregistré</strong><span>Les aperçus terminés apparaîtront ici.</span></div>
            ) : (
              <div className={styles.tripList}>{trips.map((trip) => (
                <article key={trip.id} className={styles.tripRow}>
                  <span className={styles.tripIcon}><Navigation size={18} /></span>
                  <div className={styles.tripMain}><strong>Aperçu vers {trip.destination}</strong><span>{new Date(trip.startedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
                  <div className={styles.tripMetric}><strong>{formatDuration(trip.durationSeconds)}</strong><span>{formatDistance(trip.distanceMeters)}</span></div>
                  <button className={styles.iconButton} type="button" onClick={() => removeTrip(trip.id)} aria-label="Supprimer le trajet"><Trash2 size={16} /></button>
                </article>
              ))}</div>
            )}
          </section>
        )}

        {tab === 'privacy' && (
          <section className={styles.contentPanel}>
            <div className={styles.contentHeading}><span className={styles.eyebrow}>VOS CHOIX</span><h1>Confidentialité</h1><p>Gérez les données de ce navigateur et vos contributions serveur.</p></div>
            <div className={styles.privacyRow}>
              <div><strong>Contribuer aux statistiques de trafic</strong><p>{consent === true ? 'Votre accord est actif.' : 'Aucun accord actif n’est confirmé par le serveur. La navigation reste indépendante de ce choix.'}</p></div>
              <label className={styles.switch}>
                <input type="checkbox" checked={consent === true} onChange={(event) => void updateConsent(event.target.checked)} aria-label="Contribuer aux statistiques de trafic" />
                <span />
              </label>
            </div>
            <div className={styles.privacySection}><h2>Données serveur</h2><p>Une demande nécessite une connexion au backend. L’historique local peut être supprimé trajet par trajet.</p>
              <button type="button" className={styles.deleteButton} onClick={() => void requestDataDeletion()}><Trash2 size={16} /> Demander la suppression de mes données serveur</button>
            </div>
            {deletionRequests.length > 0 && (
              <div className={styles.deletionList}>
                <h2>Demandes de suppression</h2>
                {deletionRequests.map((request) => (
                  <div key={request.id} className={styles.deletionRow}>
                    <strong>{request.types.join(', ')}</strong>
                    <span>{DELETION_STATUS_LABELS[request.status]} · {new Date(request.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.privacyFootnote}>Identifiant local de cette installation : <code>{installationId ? `${installationId.slice(0, 8)}…` : 'initialisation'}</code></div>
          </section>
        )}
      </div>

      {selectedIncident && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedIncidentId(null); }}>
          <section className={styles.reportModal} role="dialog" aria-modal="true" aria-labelledby="incident-title">
            <div className={styles.modalHeading}>
              <div><span className={styles.eyebrow}>INCIDENT COMMUNAUTAIRE</span><h2 id="incident-title">{TYPE_LABELS[selectedIncident.type]}</h2></div>
              <button type="button" className={styles.iconButton} onClick={() => setSelectedIncidentId(null)} aria-label="Fermer"><X size={19} /></button>
            </div>
            <p className={styles.incidentDescription}>{selectedIncident.description || 'Aucun détail fourni.'}</p>
            <div className={styles.incidentFacts}>
              <span>{INCIDENT_STATUS_LABELS[selectedIncident.status] ?? selectedIncident.status}</span>
              <span>Confiance {Math.round(selectedIncident.confidence * 100)} %</span>
              <span>{selectedIncident.reporterCount} signalement(s)</span>
              <span>{selectedIncident.confirmationCount} confirmation(s) · {selectedIncident.contestationCount} contestation(s)</span>
            </div>
            {selectedIncident.myResponse ? (
              <p className={styles.alreadyResponded}>Votre réponse : {selectedIncident.myResponse === 'REPORTER' ? 'vous avez signalé cet incident' : selectedIncident.myResponse === 'CONFIRMATION' ? 'confirmé' : 'contesté'}.</p>
            ) : ['DETECTE', 'CONFIRME', 'EN_COURS'].includes(selectedIncident.status) ? (
              <div className={styles.incidentActions}>
                <button type="button" className={styles.primaryButton} onClick={() => void respondToIncident('CONFIRMATION')}><Check size={16} /> Confirmer</button>
                <button type="button" className={styles.deleteButton} onClick={() => void respondToIncident('CONTESTATION')}>Contester</button>
              </div>
            ) : <p className={styles.alreadyResponded}>Cet incident n’est plus actif.</p>}
          </section>
        </div>
      )}

      {reportOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportOpen(false); }}>
          <form className={styles.reportModal} onSubmit={(event) => void submitReport(event)}>
            <div className={styles.modalHeading}><div><span className={styles.eyebrow}>CONTRIBUTION</span><h2>Signaler un incident</h2></div><button type="button" className={styles.iconButton} onClick={() => setReportOpen(false)} aria-label="Fermer"><X size={19} /></button></div>
            <label className={styles.fieldLabel}>Type d’incident
              <select value={reportType} onChange={(event) => setReportType(event.target.value as IncidentType)}>
                {(Object.keys(TYPE_LABELS) as IncidentType[]).map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
              </select>
            </label>
            <label className={styles.fieldLabel}>Détail <span className={styles.optional}>facultatif</span>
              <textarea value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} maxLength={240} rows={3} placeholder="Précisez la situation…" />
            </label>
            <div className={styles.reportLocation}><MapPin size={15} /> Position : {originLabel} · {origin.lat.toFixed(4)}, {origin.lon.toFixed(4)}</div>
            {originLabel !== 'Ma position' && <button type="button" className={styles.locationAction} onClick={locateMe}><LocateFixed size={15} /> Utiliser ma position réelle</button>}
            <button type="submit" className={styles.primaryButton}><TriangleAlert size={17} /> Envoyer le signalement</button>
          </form>
        </div>
      )}

      {toast && <div className={styles.toast} role="status"><Check size={16} />{toast}</div>}
    </main>
  );
}