# Quality playbook

Use this before changing a block's defaults and before every release. It gathers evidence quickly and keeps the judgment with a person. The latest results are in [blocks-audit.md](blocks-audit.md).

## Who decides

- **The author** (a person or an agent) changes the block. They run the commands below and record evidence and a proposed verdict in the audit.
- **The design reviewer** (Jake, or whoever he names) makes the call: keep, polish, redesign or hold. They look at the contact sheets, not only at the problem list.
- **Consuming agents** never need this file. Blocks ship as editable source, and sites restyle them through their own tokens.

## Gather evidence

Run these with the dev server up (`npm run dev`):

```sh
npm run check                                   # registry invariants: files, examples, banners, exact token fallbacks
npm run shots -- --themes default,paper,ink --out qa/<run> --sheet --interact --stress [names...]
npm run shots -- --themes default,paper,ink,grove --contrast --out qa/<run>-contrast button
npm run shots -- --themes default --css ":root{--radius-sm:0px;--radius-lg:0px}" --out qa/<run>-0px --sheet [names...]
```

- `qa/<run>/sheet-<name>.png` holds one contact sheet per block. Each theme gets a row with the 390px and 1440px renders, the open menu, and the long-copy renders.
- The command prints problems and exits 1 when it finds any:
  - an HTTP error;
  - horizontal overflow, with normal or long copy;
  - a control under 44px;
  - a missing focus indicator;
  - a menu that won't open or won't close on Escape;
  - a token pair below its WCAG contrast minimum (`--contrast`).
- `--css` injects a site's own tokens. The example above writes a square theme as `0px`, which behaves differently from a unitless `0`.
- `qa/` is gitignored. Record what matters in the audit row, and name the run folder.

**Installed check:** for a block whose structure changed, and before each release, check it outside the gallery too. The gallery's global CSS can hide a dependency that a plain project doesn't share.

```sh
site=$(mktemp -d)/site    # outside the repo, so astro check never scans it
npm create astro@latest "$site" -- --template minimal --no-install --no-git --yes && (cd "$site" && npm install)
(cd "$site" && npx shadcn@4.23.1 add http://localhost:4321/r/tokens.json http://localhost:4321/r/<name>.json --yes)
node scripts/compose.mjs src/data/catalog.json "$site" header-floating <name> footer-cta   # writes /, /square (0px radii), /bare (no tokens)
(cd "$site" && npx astro build && npx astro preview --port 4400) &
npm run shots -- --base http://localhost:4400 --paths /,/square,/bare --interact --stress --sheet --out qa/<run>-installed
```

- shadcn writes the item's files byte for byte and resolves its dependencies from GitHub at their pinned tag.
- The usage examples point at gallery images (`/gallery/*.svg`), so they show as broken in an installed copy. A block has to survive that.

## Look for

These are six questions, not a checklist. Use them to decide what deserves a closer look.

1. **Shape.** Nested shapes are concentric: a container's radius is its children's radius plus the inset between them. A square theme stays square whether it's written as `0` or `0px`. Don't mix pill and square shapes inside one component.
2. **Hierarchy.** One primary action per view, with secondary actions visibly quieter. Headings and body copy come from the type scale. The block reads at a glance in its realistic context (the stage or a composed page), not only alone.
3. **Rhythm.** Sections pad half of `--section-gap` on each side, so neighbors add up to one gap. Internal spacing follows one consistent step.
4. **Copy.** Long, real copy wraps without overflow, clipping or orphaned controls, including a pasted URL and an image that fails to load. Short copy doesn't leave the layout looking empty.
5. **Interaction.** Menus open and close, including on Escape. Focus is visible on every control. Targets are 44px. Motion respects `prefers-reduced-motion` through `--duration`.
6. **Theme fidelity.** The block reads only tokens, with exact fallbacks, so `npm run check` passes. It looks intentional in square, rounded and dark themes, and every token pair passes contrast.

## Record

Give each block one row in `docs/blocks-audit.md`, with a verdict, the evidence (run folder and sheet), and the exact next action. A row needs a decision, not a paragraph. Fix shared causes (tokens, shape rules) once, at the shared level. Patching each block separately lets them drift apart again.
