import type { Config } from 'tailwindcss';

// Thème « salle de contrôle routière » : fond quasi noir, signalisation jaune, données en monospace.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: '#0B0C0E', panel: '#14161A', panel2: '#1B1E24', line: '#262A31', signal: '#FFC400', danger: '#FF5A5F', ok: '#2ECC71', warn: '#FFA500', muted: '#8B93A1' },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config;
