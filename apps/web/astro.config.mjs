import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  // GitHub Pages serves the project under its repository name.
  site: 'https://alejo2075.github.io',
  base: '/aws-hero-cloud',
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
