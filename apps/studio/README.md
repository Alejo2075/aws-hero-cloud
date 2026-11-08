# Hero Studio

**Status:** Implemented, tested against a fake cloud; not yet exercised against a real AWS account.

The local web interface: `hero-cloud studio` serves it on `127.0.0.1` (random port) and opens it in the browser. A guided flow takes a person from "here is my app" to "here is your URL": choose a folder or upload a ZIP, read what Hero understood, review the plan, approve, watch progress, see health, and remove the deployment. The depth (`simple`, `guided`, `expert`) and language (English, Spanish) can be switched on any screen. There is no desktop app; Studio is the browser.

Studio talks only to the local server (`packages/server`), which holds the engine. It is not the public website (`apps/web`) and has no accounts. All wording comes from `@hero-cloud/presentation` (labels under `studio.*`, views for plans and results); text only goes into the page as text, never as markup.

## Interface library: Pixelact UI

Studio is React 18 with [Pixelact UI](https://pixelactui.com), a pixel-art component set built on shadcn/ui and Tailwind CSS v4. Pixelact is not an npm package (the old `pixelact-ui` package was unpublished); it is a shadcn registry whose components are copied into the project. They live in `src/components/ui/` (shadcn base: `button`, `label`, `alert`, `card`, `badge`) and `src/components/ui/pixelact-ui/` (`button`, `input`, `checkbox`, `label`, `alert`, `card`, `badge`, `spinner`). To update one, fetch `https://pixelactui.com/r/<name>.json` and review the diff.

Changes from upstream, on purpose:

- **No Google Fonts.** Upstream's stylesheet imports Press Start 2P from Google; Studio's page may load nothing from outside, so the font comes from `@fontsource/press-start-2p` and is embedded in `app.css`.
- **No inline `<style>`.** The spinner's keyframes moved into `styles/styles.css` because the page's content policy forbids inline style elements.
- **Native `<select>`** (in `src/fields.tsx`) instead of the Radix select, which injects inline styles and is less friendly to screen readers.
- **Readable body text.** The pixel font is used for headings, labels, buttons, and badges; paragraphs, lists, and tables use the system font.
- shadcn's `radix-ui` meta package was replaced by the three `@radix-ui/*` packages actually used, and `cn` points at `src/lib/utils.ts`.

## Build

`pnpm --filter @hero-cloud/studio build` writes `dist/` (`index.html`, `app.js` about 210 KB, `app.css` about 55 KB). esbuild bundles the scripts and the components' stylesheets, the Tailwind CLI generates the utility classes, and the two stylesheets are joined. The CLI build copies `dist/` to `apps/cli/dist/studio`.

## Accessibility

Skip link, one `h1`, labelled controls with hints tied to them, a real checkbox (Radix, keyboard and screen reader), a live region, visible focus, light and dark palettes that follow the system. The pixel font is hard to read at length, which is why it is limited to short text. Not yet checked with an automated WCAG audit or a screen reader.
