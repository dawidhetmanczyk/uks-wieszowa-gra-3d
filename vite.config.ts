import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Ścieżki względne: ten sam build działa pod / (Vercel) i pod /gra3d/ po
  // integracji ze stroną klubu (faza F4) bez zmiany konfiguracji.
  base: './',
  build: {
    target: 'es2022',
    assetsDir: 'assets',
    // Raport rozmiaru gzip po buildzie – budżet 350 kB z CLAUDE.md.
    reportCompressedSize: true,
  },
  server: {
    // Telefon w tej samej sieci Wi-Fi łączy się po IP komputera.
    host: true,
  },
  test: {
    // Testy sim i ai chodzą w Node, bez DOM – to jest część granicy modułów.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
