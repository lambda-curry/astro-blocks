// Sync the gallery into a Site Boulder draft through the same MCP tools a customer's AI uses.
//
//   node scripts/gallery-sync.mjs login --mcp https://siteboulder.com/api/mcp [--resume | --code-url <redirected url>]
//   node scripts/gallery-sync.mjs sync --mcp https://siteboulder.com/api/mcp --create "Astro Blocks" [--preview] [--dry-run]
//   node scripts/gallery-sync.mjs sync --mcp https://siteboulder.com/api/mcp --site <site id> [--preview]
//
// Blocks are installed with registry_add, pinned to this repository's version, so the draft
// renders the exact registry files. Gallery files are written with revisioned edit_site batches.
// Nothing is overwritten that the draft changed since it was last synced from here, except gallery
// files this script owns. Tokens live in ~/.config/astro-blocks, never in the repository.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name) => {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
};
const mcpUrl = new URL(option("--mcp") ?? "https://siteboulder.com/api/mcp");
const tokenFile = join(homedir(), ".config", "astro-blocks", `${mcpUrl.host.replace(/[^a-z0-9.-]/gi, "_")}.json`);
const pendingFile = `${tokenFile}.pending`;
const scope = "openid offline_access site:read site:draft site:preview";
const receipt = { calls: 0, requestBytes: 0, responseBytes: 0, phases: {} };

// Gallery-owned files. Blocks arrive through registry_add; the draft keeps its own Base and tokens.
async function manifest() {
  const list = async (directory, pattern) =>
    (await readdir(join(root, directory)).catch(() => [])).filter((name) => pattern.test(name)).map((name) => `${directory}/${name}`);
  return [
    "DESIGN.md",
    "src/data/site.json",
    "src/data/catalog.json",
    "src/data/gallery-themes.json",
    "src/styles/theme.css",
    "src/styles/gallery-base.css",
    "src/styles/gallery-themes.css",
    "src/layouts/Canvas.astro",
    "src/components/SiteHeader.astro",
    "src/components/SiteFooter.astro",
    ...(await list("src/components/gallery", /\.astro$/)),
    ...(await list("src/components/examples", /\.astro$/)),
    "src/pages/index.astro",
    "src/pages/blocks/[name].astro",
    "src/pages/canvas/[name].astro",
    ...(await list("public/gallery", /\.svg$/)),
  ];
}

async function discover() {
  const resource = await (await fetch(new URL(`/.well-known/oauth-protected-resource${mcpUrl.pathname}`, mcpUrl))).json();
  const issuer = new URL(resource.authorization_servers[0]);
  const metadata = await fetch(new URL(`/.well-known/oauth-authorization-server${issuer.pathname}`, issuer));
  return { resource: resource.resource, ...(await (metadata.ok ? metadata : await fetch(new URL("/.well-known/oauth-authorization-server", issuer))).json()) };
}

async function saveSecret(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
const saveTokens = (tokens) => saveSecret(tokenFile, tokens);

async function login() {
  const server = await discover();
  const codeUrl = option("--code-url");
  // A browser on another machine can't reach the loopback redirect. Its final URL, pasted
  // with --code-url, completes the authorization started by the previous login run, and
  // --resume waits on the loopback again for that same authorization and client.
  const reuse = codeUrl || flag("--resume");
  const pending = reuse ? JSON.parse(await readFile(pendingFile, "utf8").catch(() => "null")) : await register(server);
  if (!pending) throw new Error("No pending authorization. Run login without --code-url or --resume first.");
  if (!codeUrl) announce(server, pending);
  const callback = codeUrl
    ? new URL(codeUrl)
    : await new Promise((resolve) => {
        const listener = createServer((request, response) => {
          const url = new URL(request.url, pending.redirect);
          if (url.pathname !== "/callback") return response.writeHead(404).end();
          response.writeHead(200, { "Content-Type": "text/plain" }).end("Site Boulder access approved. You can close this tab.");
          listener.close();
          resolve(url);
        }).listen(new URL(pending.redirect).port, "127.0.0.1");
      });
  if (callback.searchParams.get("state") !== pending.state) throw new Error("OAuth state mismatch; start the login again.");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`Authorization was not granted: ${callback.searchParams.get("error") ?? "no code"}`);
  const tokens = await tokenRequest(server, {
    grant_type: "authorization_code",
    client_id: pending.clientId,
    code,
    redirect_uri: pending.redirect,
    code_verifier: pending.verifier,
    resource: server.resource,
  });
  await saveTokens({ clientId: pending.clientId, ...tokens });
  await rm(pendingFile, { force: true });
  console.log(`Saved access for ${mcpUrl.origin} to ${tokenFile}.`);
}

async function register(server) {
  const redirect = `http://127.0.0.1:${Number(option("--port") ?? 8766)}/callback`;
  const registration = await fetch(server.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Astro Blocks gallery sync",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    }),
  });
  if (!registration.ok) throw new Error(`Client registration failed: HTTP ${registration.status} ${await registration.text()}`);
  const pending = { clientId: (await registration.json()).client_id, verifier: randomBytes(48).toString("base64url"), state: randomBytes(16).toString("hex"), redirect };
  await saveSecret(pendingFile, pending);
  return pending;
}

function announce(server, pending) {
  const authorize = new URL(server.authorization_endpoint);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: pending.clientId,
    redirect_uri: pending.redirect,
    scope,
    state: pending.state,
    resource: server.resource,
    code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }))
    authorize.searchParams.set(key, value);
  console.log(`Open this URL, sign in and approve access:\n\n${authorize}\n`);
  console.log(`Waiting on ${pending.redirect}. If the browser is on another machine, stop this and run login --code-url "<the URL it was redirected to>" within 10 minutes of approving.`);
}

async function tokenRequest(server, form) {
  const response = await fetch(server.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Token request failed: ${data.error ?? response.status} ${data.error_description ?? ""}`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? form.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, scope: data.scope };
}

async function accessToken() {
  if (process.env.SITEBOULDER_ACCESS_TOKEN) return process.env.SITEBOULDER_ACCESS_TOKEN;
  const saved = JSON.parse(await readFile(tokenFile, "utf8").catch(() => "null"));
  if (!saved) throw new Error(`No saved access for ${mcpUrl.origin}. Run: node scripts/gallery-sync.mjs login --mcp ${mcpUrl}`);
  if (saved.expiresAt - Date.now() > 60_000) return saved.accessToken;
  const server = await discover();
  const fresh = await tokenRequest(server, { grant_type: "refresh_token", client_id: saved.clientId, refresh_token: saved.refreshToken, resource: server.resource });
  await saveTokens({ clientId: saved.clientId, ...fresh });
  return fresh.accessToken;
}

let bearer;
async function tool(name, args) {
  const id = ++receipt.calls;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  receipt.requestBytes += Buffer.byteLength(body);
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", Authorization: `Bearer ${bearer}` },
    body,
  });
  const text = await response.text();
  receipt.responseBytes += Buffer.byteLength(text);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${text.slice(0, 300)}`);
  const messages = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        return data ? [JSON.parse(data)] : [];
      })
    : [JSON.parse(text)];
  const message = messages.find((item) => item.id === id);
  if (!message) throw new Error(`${name}: no JSON-RPC response for request ${id}`);
  if (message.error) throw new Error(`${name}: ${message.error.message}`);
  const result = message.result.structuredContent ?? JSON.parse(message.result.content[0].text);
  return { ...result, isError: Boolean(message.result.isError) };
}

async function phase(name, run) {
  const started = Date.now();
  const calls = receipt.calls;
  const value = await run();
  receipt.phases[name] = { ms: Date.now() - started, calls: receipt.calls - calls };
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (text) => Buffer.byteLength(text);
const maxBatchBytes = 120 * 1024;

async function sync() {
  bearer = await accessToken();
  const dryRun = flag("--dry-run");
  const catalog = JSON.parse(await readFile(join(root, "src/data/catalog.json"), "utf8"));
  let siteId = option("--site");
  if (!siteId && dryRun) throw new Error("--dry-run needs an existing --site; it never creates a draft.");
  if (!siteId) {
    const name = option("--create");
    if (!name) throw new Error("Pass --site <id> or --create <name>.");
    const brief = `The public gallery for Astro Blocks, an open-source library of Astro sections (${catalog.repository}). Visitors are Astro developers and Site Boulder customers choosing blocks. Primary action: open a block and see it live. Built from the canonical repository by scripts/gallery-sync.mjs.`;
    const created = await phase("create", () => tool("create_site", { name, brief }));
    if (!created.site) throw new Error(`create_site: ${created.error} ${created.message ?? ""}`);
    siteId = created.site.id;
    console.log(`${created.replayed ? "Found" : "Created"} draft ${created.site.name} (${siteId}).`);
  }

  // Install every block except the token file: the draft keeps its own tokens.
  const items = catalog.items.filter(({ name, usage }) => usage && name !== "tokens").map(({ name }) => name);
  if (!dryRun)
    await phase("registry", async () => {
      for (let start = 0; start < items.length; start += 4) {
        const added = await tool("registry_add", { siteId, items: items.slice(start, start + 4), version: catalog.version });
        if (added.isError) throw new Error(`registry_add ${items.slice(start, start + 4).join(", ")}: ${added.error} ${added.message ?? ""} ${JSON.stringify(added.conflicts ?? added.available ?? "")}`);
        const written = added.files.filter(({ status }) => status !== "identical");
        console.log(`registry_add ${items.slice(start, start + 4).join(", ")}: ${added.status}${written.length ? ` (${written.map(({ path, status }) => `${status} ${path}`).join(", ")})` : ""}`);
      }
    });

  const paths = await manifest();
  const current = new Map();
  await phase("read", async () => {
    for (let start = 0; start < paths.length; start += 6) {
      const read = await tool("inspect_site", { siteId, paths: paths.slice(start, start + 6) });
      if (read.isError) throw new Error(`inspect_site: ${read.error} ${read.message ?? ""}`);
      for (const file of read.files) current.set(file.path, file);
    }
  });
  const writes = [];
  for (const path of paths) {
    const content = await readFile(join(root, path), "utf8");
    const existing = current.get(path);
    if (existing?.content === content) continue;
    writes.push(existing ? { path, content, expectedRevision: existing.revision, expectedFileId: existing.fileId } : { path, content, expectedRevision: 0 });
  }
  console.log(`${paths.length} gallery files: ${writes.length} to write, ${paths.length - writes.length} unchanged.`);
  if (dryRun) {
    for (const { path, expectedRevision } of writes) console.log(`  ${expectedRevision ? "update" : "create"} ${path}`);
    return;
  }
  await phase("write", async () => {
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const saved = await tool("edit_site", { siteId, change: { type: "files", files: batch } });
      if (saved.isError) throw new Error(`edit_site: ${saved.error} ${saved.message ?? ""} ${JSON.stringify(saved.path ?? saved.current ?? "")}`);
      console.log(`edit_site: saved ${saved.files.map(({ path }) => path).join(", ")}`);
      batch = [];
    };
    for (const file of writes) {
      if (batch.length === 8 || batch.reduce((sum, { content }) => sum + bytes(content), 0) + bytes(file.content) > maxBatchBytes) await flush();
      batch.push(file);
    }
    await flush();
  });

  const digest = await phase("check", async () => {
    let check = await tool("check_site", { siteId, check: { action: "start" } });
    for (let attempt = 0; check.status && !["complete", "failed", "error"].includes(check.status) && check.jobId && attempt < 40; attempt += 1) {
      await sleep(3000);
      check = await tool("check_site", { siteId, check: { action: "poll", jobId: check.jobId } });
    }
    console.log(`check_site: ${check.status ?? check.error}${check.introduced ? `, ${JSON.stringify(check.introduced).slice(0, 400)}` : ""}`);
    return check.sourceDigest;
  });

  if (flag("--preview"))
    await phase("preview", async () => {
      let preview = await tool("preview_site", { siteId, request: { action: "start", ...(digest && { sourceDigest: digest }) } });
      const settled = ({ status, isError }) => isError || status === "ready" || /failed|retry|changed|unavailable|required|limited|not_found/.test(status ?? "");
      for (let attempt = 0; preview.releaseId && !settled(preview) && attempt < 60; attempt += 1) {
        await sleep(5000);
        preview = await tool("preview_site", { siteId, request: { action: "poll", releaseId: preview.releaseId } });
      }
      console.log(`preview_site: ${preview.status ?? preview.error}${preview.preview?.url ? ` ${preview.preview.url}` : ""}`);
    });
  console.log(JSON.stringify({ siteId, ...receipt }, null, 2));
}

if (command === "login") await login();
else if (command === "sync") await sync();
else {
  console.log("Usage: node scripts/gallery-sync.mjs login --mcp <url> [--resume | --code-url <redirected url>]\n       node scripts/gallery-sync.mjs sync --mcp <url> [--site <id> | --create <name>] [--preview] [--dry-run]");
  process.exitCode = 1;
}
