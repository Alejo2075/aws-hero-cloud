# Presentation

**Status:** Implemented (types only).

Optional and outside the engine: a product that only wants data never imports it. It owns the audience levels (`AudienceLevel`) and turns structured plans, analyses, and results into readable views at three depths (`simple`, `guided`, `expert`) and in any locale. It owns all human wording, so planners and providers emit codes instead of prose.

Renderers (terminal, Studio, Markdown, chat) live in the interfaces; this package produces the renderer-neutral `View`. Message catalogs are a low-barrier way to contribute, including translations. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#output-levels).
