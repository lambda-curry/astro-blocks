# Astro Blocks

Polished website sections for Astro, distributed as source you own. Every block is a native `.astro` component with scoped CSS, typed props, semantic design tokens, and no client JavaScript.

Astro Blocks is a [shadcn](https://ui.shadcn.com/docs/registry)-compatible registry. Installing a block copies ordinary, editable files into your project. Nothing stays linked: no runtime package, no hidden updates. Change anything.

```sh
npx shadcn@latest add lambda-curry/astro-blocks/hero-split#v0.1.1
```

That writes `src/components/blocks/HeroSplit.astro` and its one dependency, `src/components/ui/Button.astro`. It works in any Astro project, without Tailwind, React or a `components.json`. Then:

```astro
---
import HeroSplit from "../components/blocks/HeroSplit.astro";
---

<HeroSplit
  title="Recover from injury with a plan you can follow"
  lede="One clinician for the whole course of care."
  actions={[{ label: "Book an assessment", href: "/book" }]}
  image={{ src: "/clinic.jpg", alt: "The treatment room" }}
/>
```

## The blocks

| Category | Items |
| --- | --- |
| Headers | `header-floating`, `header-editorial`, `header-transparent`, `header-minimal` |
| Heroes | `hero-split`, `hero-immersive`, `hero-typographic` |
| Walkthroughs | `steps-numbered`, `timeline`, `alternating-rows` |
| Features | `features-bento`, `features-editorial` |
| Footers | `footer-minimal`, `footer-columns`, `footer-wordmark`, `footer-cta` |
| Foundation | `button`, `tokens` |

List, search or inspect them from the CLI:

```sh
npx shadcn@latest list lambda-curry/astro-blocks#v0.1.1
npx shadcn@latest view lambda-curry/astro-blocks/timeline#v0.1.1
```

Each item in [`registry.json`](registry.json) says when to use it and, as importantly, when not to. A numbered list is for a real sequence, a bento grid is for related items of different weight, and a giant footer wordmark is for a short name on an otherwise quiet site.

## Design

- **Tokens, not themes.** Blocks read semantic custom properties: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-accent`, `--color-on-accent`, `--font-display`, `--font-body`, the `--step-*` type scale, `--space-*`, `--radius-sm` and `--radius-lg`. Set them once, in your own theme, and every block follows. Each block also falls back to the neutral defaults in [`tokens.css`](src/styles/tokens.css) (`npx shadcn@latest add lambda-curry/astro-blocks/tokens#v0.1.1`), so nothing breaks without them.
- **Container queries.** Blocks lay out from the width they are given, so they work full-width or inside a narrow column.
- **No client JavaScript.** Narrow-screen menus use the HTML `popover` attribute. The transparent header turns solid while scrolling through CSS scroll-driven animation where supported. The wordmark footer sizes the name with container units.
- **Accessible by default.** One `h1` per page (heroes take `headingLevel`), visible focus, 44px targets, landmarks, alt text through props, and motion that respects `prefers-reduced-motion`.
- **Props for content, slots for media.** Props are typed and documented, so people and AI agents fill them reliably. Slots accept a `<picture>`, video or SVG where a plain image isn't enough.

## Using blocks with AI agents

The registry is optional material, not a design system to comply with. Design for the site first, add a block only when it is the fastest route to the structure you already want, then restyle, cut, combine or replace it. [`AGENTS.md`](AGENTS.md) says the same for coding agents. [Site Boulder](https://siteboulder.com/) bundles a reviewed, pinned release of this registry for the AI that builds its customers' sites.

## Develop

```sh
npm ci
npm run dev        # the gallery and workbench at http://localhost:4321
npm run registry   # validate, build public/r with shadcn, and derive src/data/catalog.json
npm run check      # generated files current, plus astro check
```

[`AGENTS.md`](AGENTS.md) lists the conventions the build enforces and the release steps.

## License

[MIT](LICENSE) © Lambda Curry. Each installed file starts with a one-line attribution that points back to this license.
