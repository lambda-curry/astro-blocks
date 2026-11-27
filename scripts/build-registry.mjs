// Validate registry.json against the repository, run `shadcn build`, and derive
// src/data/catalog.json: the compact, typed index the gallery and Site Boulder read.
// `--check` fails instead of writing when committed outputs are stale.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const read = (path) => readFileSync(join(root, path), "utf8");
const registry = JSON.parse(read("registry.json"));
const { version, name: packageName } = JSON.parse(read("package.json"));
const repository = "lambda-curry/astro-blocks";
const errors = [];
const fail = (message) => errors.push(message);

const categories = ["foundation", "primitive", "header", "hero", "walkthrough", "features", "footer"];
const placements = ["inline", "page-start", "section", "page-end"];
// Mirrors Site Boulder's authorable paths: no TypeScript or JavaScript files.
const authorable = /^(?:src\/(?:components\/.+\.astro|styles\/.+\.css|data\/.+\.(?:json|md))|public\/.+\.(?:svg|txt|css))$/;
const maxFileBytes = 32 * 1024;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Canonical token defaults, resolved through var() references inside tokens.css.
const tokenSource = read("src/styles/tokens.css");
const tokenRoot = tokenSource.slice(tokenSource.indexOf(":root {"), tokenSource.indexOf("}") + 1);
const tokens = Object.fromEntries([...tokenRoot.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
const resolveToken = (value) => value.replace(/^var\((--[\w-]+)\)$/, (_, key) => tokens[key] ?? value);
const normalizeCss = (value) => value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();

function checkTokenFallbacks(path, source) {
  for (const match of source.matchAll(/var\((--[a-z][\w-]*)(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g)) {
    const [, key, fallback] = match;
    if (!(key in tokens)) continue;
    if (fallback === undefined) {
      fail(`${path}: var(${key}) needs a fallback so the block works without tokens.css`);
      continue;
    }
    const expected = resolveToken(tokens[key]);
    // Font stacks may shorten to the stack's first generic family; everything else must match exactly.
    const font = key.startsWith("--font-") && normalizeCss(expected).startsWith(normalizeCss(fallback).split(",")[0]);
    if (!font && normalizeCss(fallback) !== normalizeCss(expected)) fail(`${path}: var(${key}, ${fallback}) should fall back to ${expected}`);
  }
}

// Props come from the frontmatter: `interface Props` (or a `type Props` built from local
// object types), defaults from destructuring Astro.props, and other local types verbatim.
function describeComponent(source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const file = ts.createSourceFile("frontmatter.ts", frontmatter, ts.ScriptTarget.Latest, true);
  const local = new Map();
  const defaults = new Map();
  file.forEachChild((node) => {
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) local.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isObjectBindingPattern(declaration.name) || declaration.initializer?.getText() !== "Astro.props") continue;
        for (const element of declaration.name.elements) {
          const key = (element.propertyName ?? element.name).getText();
          if (element.initializer) defaults.set(key, element.initializer.getText());
        }
      }
    }
  });
  const props = [];
  const passthrough = [];
  const seen = new Set();
  const doc = (member) =>
    ts
      .getJSDocCommentsAndTags(member)
      .map((comment) => (typeof comment.comment === "string" ? comment.comment : ""))
      .join(" ")
      .trim();
  const collect = (node, optional = false) => {
    if (!node) return;
    if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || seen.has(member.name.getText())) continue;
        const name = member.name.getText();
        if (member.type?.getText() === "undefined") continue;
        seen.add(name);
        props.push({
          name,
          type: member.type?.getText().replace(/\s+/g, " ") ?? "unknown",
          required: !optional && !member.questionToken,
          ...(defaults.has(name) && { default: defaults.get(name) }),
          ...(doc(member) && { description: doc(member) }),
        });
      }
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) return collect(node.type, optional);
    if (ts.isParenthesizedTypeNode(node)) return collect(node.type, optional);
    // A prop collected from one branch of a union is only required if every branch requires it; treat it as optional.
    if (ts.isUnionTypeNode(node)) return node.types.forEach((type) => collect(type, true));
    if (ts.isIntersectionTypeNode(node)) return node.types.forEach((type) => collect(type, optional));
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if (local.has(name)) return collect(local.get(name), optional);
      if (name === "Omit" || name === "HTMLAttributes") {
        const element = node.getText().match(/HTMLAttributes<"(\w+)">/)?.[1];
        if (element && !passthrough.includes(element)) passthrough.push(element);
      }
    }
  };
  collect(local.get("Props"));
  const types = Object.fromEntries(
    [...local.entries()]
      .filter(([name, node]) => name !== "Props" && ts.isInterfaceDeclaration(node) && seenType(name, props))
      .map(([name, node]) => [name, `{ ${node.members.map((member) => member.getText().replace(/\/\*\*[\s\S]*?\*\/\s*/g, "").replace(/;$/, "")).join("; ")} }`]),
  );
  const slots = [...new Set([...source.matchAll(/<slot(?:\s+name="([\w-]+)")?/g)].map(([, slot]) => slot ?? "default"))];
  return { props, ...(passthrough.length && { passthrough }), ...(Object.keys(types).length && { types }), slots, clientScript: /<script\b/.test(source) };
}
const seenType = (name, props) => props.some(({ type }) => new RegExp(`\\b${name}\\b`).test(type));

// Relative imports must resolve to files the install itself delivers.
function relativeImports(target, source) {
  return [...source.matchAll(/^import\s+(?:[\s\S]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["'];?$/gm)].map(([, specifier]) =>
    normalize(posix.join(posix.dirname(target), specifier)).split("\\").join("/"),
  );
}

const items = new Map(registry.items.map((item) => [item.name, item]));
const dependencyPattern = new RegExp(`^${repository}/([a-z0-9-]+)#v${version.replace(/\./g, "\\.")}$`);
const dependencyNames = (item) =>
  (item.registryDependencies ?? []).map((address) => {
    const name = address.match(dependencyPattern)?.[1];
    if (!name || !items.has(name)) fail(`${item.name}: dependency ${address} must be ${repository}/<item>#v${version} for an item in this registry`);
    return name;
  });
const closure = (name, found = new Set()) => {
  if (found.has(name) || !items.has(name)) return found;
  found.add(name);
  for (const dependency of dependencyNames(items.get(name))) if (dependency) closure(dependency, found);
  return found;
};

const catalog = [];
for (const item of registry.items) {
  const { name, title, description, categories: itemCategories = [], meta = {} } = item;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`${name}: names are kebab-case`);
  if (item.type !== "registry:item") fail(`${name}: use type registry:item so any Astro project can install it without components.json`);
  if (!title || !description) fail(`${name}: needs a title and description`);
  if (itemCategories.length !== 1 || !categories.includes(itemCategories[0])) fail(`${name}: needs exactly one category from ${categories.join(", ")}`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version ?? "")) fail(`${name}: meta.version must be semver`);
  if (!meta.useWhen || !meta.avoidWhen || !Array.isArray(meta.tags)) fail(`${name}: meta needs useWhen, avoidWhen and tags`);
  const category = itemCategories[0];
  const placement = meta.placement ?? (category === "foundation" ? undefined : "section");
  if (placement && !placements.includes(placement)) fail(`${name}: meta.placement must be one of ${placements.join(", ")}`);

  const files = [];
  const delivered = new Set([...closure(name)].flatMap((member) => items.get(member).files.map(({ target }) => target.replace(/^~\//, ""))));
  for (const file of item.files) {
    const target = file.target?.replace(/^~\//, "");
    if (file.type !== "registry:file" || file.target !== `~/${file.path}`) fail(`${name}: ${file.path} must be a registry:file whose target is ~/${file.path}`);
    if (!authorable.test(file.path)) fail(`${name}: ${file.path} is not an authorable Site Boulder path`);
    if (!existsSync(join(root, file.path))) {
      fail(`${name}: ${file.path} does not exist`);
      continue;
    }
    const content = read(file.path);
    const bytes = Buffer.byteLength(content);
    if (bytes > maxFileBytes) fail(`${name}: ${file.path} is ${bytes} bytes; keep files under ${maxFileBytes}`);
    const banner = file.path.endsWith(".astro") ? `---\n// Astro Blocks — ${name} — MIT — https://github.com/${repository}\n` : `/* Astro Blocks — ${name} — MIT — https://github.com/${repository}`;
    if (!content.startsWith(banner)) fail(`${name}: ${file.path} must start with the attribution line "${banner.trim()}"`);
    if (file.path !== "src/styles/tokens.css") checkTokenFallbacks(file.path, content);
    for (const imported of file.path.endsWith(".astro") ? relativeImports(target, content) : [])
      if (!delivered.has(imported)) fail(`${name}: ${file.path} imports ${imported}, which neither it nor its dependencies install`);
    files.push({ target, bytes, sha256: sha256(content), ...(file.path.endsWith(".astro") && { component: describeComponent(content) }) });
  }

  const examplePath = `src/components/examples/${name}.astro`;
  const hasExample = existsSync(join(root, examplePath));
  if (category !== "foundation" && !hasExample) fail(`${name}: add a usage example at ${examplePath}`);
  // The usage must work after installing only this item; page context belongs in <item>.stage.astro.
  if (hasExample)
    for (const imported of relativeImports(examplePath, read(examplePath)))
      if (!delivered.has(imported)) fail(`${name}: its usage example imports ${imported}, which installing ${name} does not deliver. Move page context into ${name}.stage.astro.`);
  const main = files.find(({ component }) => component);
  catalog.push({
    name,
    title,
    description,
    category,
    version: meta.version,
    tags: meta.tags,
    useWhen: meta.useWhen,
    avoidWhen: meta.avoidWhen,
    ...(placement && { placement }),
    dependencies: dependencyNames(item).filter(Boolean),
    files: files.map(({ target, bytes, sha256: hash }) => ({ target, bytes, sha256: hash })),
    ...(main && {
      import: main.target.replace(/^src\//, "../"),
      props: main.component.props,
      ...(main.component.passthrough && { passthrough: main.component.passthrough }),
      ...(main.component.types && { types: main.component.types }),
      slots: main.component.slots,
      clientScript: files.some(({ component }) => component?.clientScript),
    }),
    // Usage is the gallery example, with imports rewritten for a file in src/pages/.
    ...(hasExample && { usage: read(examplePath).replaceAll('from "../blocks/', 'from "../components/blocks/').replaceAll('from "../ui/', 'from "../components/ui/') }),
    install: `npx shadcn@latest add ${repository}/${name}#v${version}`,
  });
}

const output = `${JSON.stringify({ name: registry.name, version, repository, items: catalog }, null, 2)}\n`;
if (packageName !== registry.name) fail(`package.json name ${packageName} must match registry.json name ${registry.name}`);
if (errors.length) {
  console.error(`Registry check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

// shadcn build writes public/r; compare in a scratch directory when checking.
const scratch = check ? mkdtempSync(join(tmpdir(), "astro-blocks-")) : null;
const outputDir = scratch ?? join(root, "public/r");
execFileSync(join(root, "node_modules/.bin/shadcn"), ["build", "registry.json", "--output", outputDir], { cwd: root, stdio: check ? "ignore" : "inherit" });
if (check) {
  const stale = [];
  for (const entry of readdirSync(outputDir)) {
    const committed = join(root, "public/r", entry);
    if (!existsSync(committed) || readFileSync(committed, "utf8") !== readFileSync(join(outputDir, entry), "utf8")) stale.push(`public/r/${entry}`);
  }
  rmSync(outputDir, { recursive: true, force: true });
  if (!existsSync(join(root, "src/data/catalog.json")) || read("src/data/catalog.json") !== output) stale.push("src/data/catalog.json");
  if (stale.length) {
    console.error(`Stale generated files; run npm run registry:\n- ${stale.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Registry OK: ${catalog.length} items, generated files current.`);
} else {
  writeFileSync(join(root, "src/data/catalog.json"), output);
  console.log(`Wrote src/data/catalog.json (${catalog.length} items) and public/r/.`);
}
