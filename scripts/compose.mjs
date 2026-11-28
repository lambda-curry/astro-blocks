// Write pages that compose items' published usage (catalog.json `usage`) into an installed Astro project,
// for the installed check in docs/quality-playbook.md: index (tokens.css), square (0px radii), bare (no tokens).
// Usage: node scripts/compose.mjs src/data/catalog.json <project dir> <item>...
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [catalogPath, project, ...names] = process.argv.slice(2);
const items = JSON.parse(readFileSync(catalogPath, "utf8")).items;
const imports = new Set();
const bodies = [];
for (const name of names) {
  const usage = items.find((item) => item.name === name)?.usage;
  if (!usage) throw new Error(`no usage for ${name}`);
  const [, front, body] = usage.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  for (const line of front.split("\n")) if (line.startsWith("import ")) imports.add(line);
  const rest = front.split("\n").filter((line) => !line.startsWith("import ") && line.trim() && !line.startsWith("//"));
  if (rest.length) throw new Error(`${name} usage has frontmatter code: ${rest.join(" | ")}`);
  bodies.push(`<!-- ${name} -->\n${body.trim()}`);
}
const page = (head) => `---\n${[...imports].join("\n")}\n---\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width" />\n    <title>Installed check</title>\n${head}\n  </head>\n  <body>\n${bodies.join("\n")}\n  </body>\n</html>\n`;
const base = `    <style is:global>\n      body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body, system-ui); }\n    </style>`;
mkdirSync(join(project, "src/pages"), { recursive: true });
writeFileSync(join(project, "src/pages/index.astro"), page(`    <style is:global>@import "../styles/tokens.css";</style>\n${base}`));
writeFileSync(join(project, "src/pages/square.astro"), page(`    <style is:global>@import "../styles/tokens.css"; :root { --radius-sm: 0px; --radius-lg: 0px; }</style>\n${base}`));
writeFileSync(join(project, "src/pages/bare.astro"), page(`    <style is:global>body { margin: 0; font-family: system-ui; }</style>`));
console.log(`composed ${names.join(", ")} into index, square (0px radii) and bare (no tokens)`);
