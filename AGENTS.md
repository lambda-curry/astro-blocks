# Astro Blocks — agent guide

Astro Blocks is a shadcn-compatible **source registry** of native `.astro` website sections. Installing an item copies ordinary, editable source into a project. Nothing stays linked to the registry: no runtime package, no updates pushed later.

## Using blocks in a site

- **The registry is optional.** Design for the site first: its audience, material and thesis. Reach for a block only when it is the fastest route to the structure you already want.
- After adding a block, the copy belongs to the site. Change its markup, styles and behavior freely. Compose blocks, cut parts you don't need, or write an original component when that fits better. Never measure success by how many blocks a site uses.
- Blocks read the site's semantic tokens (`--color-*`, `--font-*`, `--step-*`, `--space-*`, `--radius-*`). Restyle through the site's theme before editing a block's CSS. Keep the site's own tokens, CMS hooks, content and footer credit.
- Each catalog item states `useWhen` and `avoidWhen`. Respect `avoidWhen`; it encodes the taste judgment behind the item.

## Layout

- `registry.json`: the canonical shadcn registry. Every item is `registry:item` with `registry:file` targets equal to their repository paths, so relative imports work identically here and after install.
- `src/components/blocks/`: sections (headers, heroes, walkthroughs, features, footers). `src/components/ui/`: primitives. `src/styles/tokens.css`: the token contract.
- `src/components/examples/<item>.astro`: one usage example per item. The gallery renders it live and shows it as the usage code, so docs cannot drift from the preview.
- `src/pages/`, `src/components/gallery/`, `src/styles/gallery-*.css`, `src/data/`: the gallery site, synced to a Site Boulder draft.
- Generated, never hand-edited: `public/r/*.json` (`shadcn build`) and `src/data/catalog.json` (props, slots, usage and hashes derived from source).

## Conventions the build enforces

`npm run registry` regenerates outputs. `npm run check` fails if they are stale or if:

- a file is not a Site Boulder authorable path. Use `.astro` components and `.css` only, with no `.ts` or `.js` files.
- an item imports a file that neither it nor its dependencies install;
- a token is read without a fallback, or with a fallback different from `tokens.css`;
- a file lacks its one-line attribution banner, or an item lacks an example, `useWhen`, `avoidWhen` or tags;
- a dependency is not pinned as `lambda-curry/astro-blocks/<item>#v<package version>`.

Design rules the build cannot check:

- Lay out with container queries, so a block adapts to the column it is placed in.
- Use no client JavaScript unless the platform cannot do it. The popover attribute, `<details>` and CSS cover menus and disclosure.
- Give every target at least 44px, keep visible focus, and respect `prefers-reduced-motion` through `--duration`. Use one `h1` per page; heroes expose `headingLevel`.
- Props carry content (agents fill them reliably). Slots carry rich media.

## Commands

```sh
npm ci
npm run dev          # workbench and gallery at http://localhost:4321
npm run registry     # validate, shadcn build, derive catalog
npm run check        # generated files current + astro check
npm run validate     # shadcn registry validate
npm run shots -- --themes default,ink   # 390px and 1440px screenshots into qa/ (dev server running)
```

Release: set `version` in `package.json`, update every `#v…` dependency ref and changed `meta.version` in `registry.json`, run `npm run registry`, merge, then tag `v<version>`. Site Boulder pins a release with its own reviewed `sync-astro-blocks.mjs --ref v<version>`.

## Gallery sync

The gallery is a private Site Boulder draft built only through the customer MCP tools: `registry_add` installs the blocks (pinned to this version), and revisioned `edit_site` batches write the gallery files listed in `scripts/gallery-sync.mjs`. Repeat runs write only what changed, and the draft keeps its own `Base.astro` and `tokens.css`.

```sh
node scripts/gallery-sync.mjs login --mcp https://siteboulder.com/api/mcp   # one browser approval; token saved to ~/.config/astro-blocks
node scripts/gallery-sync.mjs sync --mcp https://siteboulder.com/api/mcp --site <draft id> --preview
```

Bump the platform's pinned registry before syncing a new version, or `registry_add` refuses the version.
