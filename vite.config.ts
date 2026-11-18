import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths in the build, so the game works both at the site root and in a
  // sub-folder like https://<user>.github.io/HNH/ (GitHub Pages).
  base: './',
  server: { host: true },
  build: { target: 'es2022' },
});
