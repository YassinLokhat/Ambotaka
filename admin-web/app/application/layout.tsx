import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'RoadPulse · Application web',
  description: 'Planifier un trajet et consulter le trafic communautaire à Antananarivo.',
};

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  return children;
}