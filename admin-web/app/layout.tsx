import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = { title: 'RoadPulse · Console', description: 'Console d’exploitation RoadPulse', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="fr"><body className="min-h-screen antialiased">{children}</body></html>);
}
