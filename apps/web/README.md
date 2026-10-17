# Hero Cloud public site

A single-page, static public site built with Astro and one React application. Navigation uses section anchors; the only client interactions are the optional setup disclosure and copying commands. It never imports or runs the engine, asks for credentials, or sends analytics.

```bash
pnpm install
pnpm dev
```

The site runs at `http://localhost:4321`. Production output is `apps/web/dist`:

```bash
pnpm --filter @hero-cloud/web typecheck
pnpm --filter @hero-cloud/web build
pnpm --filter @hero-cloud/web preview
```

## Content and assets

- `src/data/project.ts`: GitHub URL, setup commands, and the three-step explanation.
- `src/components/App.tsx`: single-page layout and browser interactions.
- `src/styles/global.css`: palette, responsive layouts, and accessibility styles.
- The hero is text only. `public/placeholders/cloud.svg` is an unused placeholder kept for future artwork.
- `public/vendor/github-invertocat-black.svg`: unchanged official GitHub Invertocat from [GitHub’s logo kit](https://brand.github.com/foundations/logo). GitHub retains the rights to its marks.
- The text wordmark and `public/favicon.svg` are temporary brand placeholders. Replace them with approved brand assets when ready.
- `public/fonts/`: self-hosted Press Start 2P and its SIL Open Font License. No font service is contacted at runtime.

Copy follows `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and the current root README. Keep the alpha and AWS validation notices accurate as the project progresses. No deployment occurs on this site. Setup commands are kept in a disclosure so the main explanation stays accessible to nontechnical readers. Commands start from source rather than assuming npm availability. GitHub links use the repository’s `main` branch.

## Pixelact UI

Buttons and the alpha notice use the [Pixelact UI](https://github.com/pixelact-ui/pixelact-ui) registry components already adopted by this repository, built on shadcn, Radix, and Tailwind. Their source lives in `src/components/ui/pixelact-ui/`; base components live beside it. See [the official registry](https://pixelactui.com/r/button.json). The global theme adapts them to Hero’s blue, yellow, and red palette. Its font is served locally instead of importing Google Fonts.

This is the public project site, separate from the planned local Studio interface. Host `dist/` on any static host; no server, environment variables, or SPA route fallback is required.
