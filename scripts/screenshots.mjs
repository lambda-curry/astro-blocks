// Capture gallery canvases at phone and desktop widths for visual review.
// Usage: node scripts/screenshots.mjs [--base http://localhost:4321] [--themes default,ink] [--out qa] [names...]
// Uses installed Google Chrome (or CHROME_PATH) through playwright-core.
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const base = option("--base", "http://localhost:4321");
const themes = option("--themes", "default").split(",");
const out = option("--out", "qa");
const fullPage = !args.includes("--viewport");
const names = args.filter((arg) => !arg.startsWith("--"));
const registry = JSON.parse(await readFile(new URL("../registry.json", import.meta.url), "utf8"));
const targets = names.length ? names : registry.items.filter(({ name }) => name !== "tokens").map(({ name }) => name);
const widths = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
const problems = [];
for (const viewport of widths) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  for (const name of targets) {
    for (const theme of themes) {
      const query = theme === "default" ? "" : `?theme=${theme}`;
      const response = await page.goto(`${base}/canvas/${name}${query}`, { waitUntil: "networkidle" });
      if (!response?.ok()) problems.push(`${name} ${theme} ${viewport.width}: HTTP ${response?.status()}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`${name} ${theme} ${viewport.width}: ${overflow}px horizontal overflow`);
      await page.screenshot({ path: `${out}/${name}-${theme}-${viewport.width}.png`, fullPage });
    }
  }
  await page.close();
}
await browser.close();
console.log(`captured ${targets.length * themes.length * widths.length} screenshots in ${out}/`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
