// Render gallery canvases for visual review, plus the few checks a screenshot can't show.
// Usage: node scripts/screenshots.mjs [--base http://localhost:4321] [--themes default,paper,ink] [--out qa]
//          [--sheet] [--interact] [--stress] [--contrast] [--viewport] [names...]
//   --sheet     one contact sheet per item (themes × 390/1440) to look at
//   --interact  at 390px: open and close popover menus; at both widths: keyboard focus is visible, targets are 44px
//   --stress    long real-world copy, a pasted URL and images that fail to load, then overflow is re-checked and captured
//   --contrast  WCAG contrast of the token pairs blocks use, per theme
//   --css       extra CSS injected before capture, e.g. a site's tokens: --css ":root{--radius-sm:0px;--radius-lg:0px}"
//   --paths     check pages of any site instead of gallery canvases, e.g. an installed project: --base http://localhost:4400 --paths /,/square,/bare
// Uses installed Google Chrome (or CHROME_PATH) through playwright-core. Exits 1 when a check finds a problem.
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const flag = (name) => args.includes(name);
const base = option("--base", "http://localhost:4321");
const themes = option("--themes", "default").split(",");
const out = option("--out", "qa");
const fullPage = !flag("--viewport");
const css = option("--css", "");
const paths = option("--paths", "");
const names = args.filter((arg) => !arg.startsWith("--"));
const registry = JSON.parse(await readFile(new URL("../registry.json", import.meta.url), "utf8"));
const targets = paths ? paths.split(",") : names.length ? names : registry.items.filter(({ name }) => name !== "tokens").map(({ name }) => name);
const slug = (name) => name.replace(/^\//, "").replace(/[^\w-]+/g, "-") || "index";
const widths = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];
const url = (name, theme) => (paths ? `${base}${name}` : `${base}/canvas/${name}${theme === "default" ? "" : `?theme=${theme}`}`);
const open = async (page, name, theme) => {
  const response = await page.goto(url(name, theme), { waitUntil: "networkidle" });
  if (css) await page.addStyleTag({ content: css });
  return response;
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
const problems = [];
const shots = new Map();
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Long copy a real site writes: wordier headings, two-word nav labels, longer actions and paragraphs.
const stress = () => {
  const longer = { H1: " for teams that ship every single week", H2: " and everything else your visitors ask", H3: " with a longer label", A: " today", BUTTON: " now" };
  for (const element of document.querySelectorAll("main h1, main h2, main h3, header a, header button, main a, footer a, main p, main li"))
    for (const node of element.childNodes)
      if (node.nodeType === 3 && node.textContent.trim()) {
        node.textContent += element.tagName === "P" || element.tagName === "LI" ? ` ${node.textContent.trim()}` : (longer[element.tagName] ?? "");
        break;
      }
  // A pasted URL is one unbreakable word, and an image that fails to load leaves only its alt text.
  document.querySelector("main p, footer p")?.append(" https://example.com/reservations/spring/the-long-weekend-retreat-for-two");
  for (const image of document.querySelectorAll("img")) image.src = "/missing-image.png";
};

for (const viewport of widths) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  for (const name of targets) {
    for (const theme of themes) {
      const label = `${name} ${theme} ${viewport.width}`;
      const response = await open(page, name, theme);
      if (!response?.ok()) problems.push(`${label}: HTTP ${response?.status()}`);
      const overflow = await overflowOf(page);
      if (overflow > 0) problems.push(`${label}: ${overflow}px horizontal overflow`);
      const path = `${out}/${slug(name)}-${theme}-${viewport.width}.png`;
      await page.screenshot({ path, fullPage });
      shots.set(`${name}|${theme}|${viewport.width}`, path);

      if (flag("--interact")) {
        // Every control a visitor can tab to shows a focus indicator and is at least 44px tall.
        const controls = await page.evaluate(() => {
          const found = [];
          for (const element of document.querySelectorAll("a[href], button, summary")) {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const inline = style.display === "inline" && element.closest("p, li") && !element.closest("nav");
            if (box.width && box.height && !inline && box.height < 44) found.push(`${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 24)}" ${Math.round(box.height)}px`);
          }
          return found;
        });
        for (const control of controls) problems.push(`${label}: target under 44px: ${control}`);
        // Focus is visible when it changes pixels: compare the view focused and blurred. Computed styles
        // can't tell, because a ring can be clipped or drawn on a pseudo-element across a card.
        for (let step = 0; step < 4; step += 1) {
          await page.keyboard.press("Tab");
          await page.waitForTimeout(250);
          const focused = await page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement.textContent.trim().slice(0, 24) : null));
          if (!focused) continue;
          const shown = await page.screenshot();
          await page.evaluate(() => document.activeElement.blur());
          await page.waitForTimeout(250);
          if (shown.equals(await page.screenshot())) problems.push(`${label}: no visible focus on "${focused}"`);
        }
        if (viewport.width === 390 && (await page.$("[popovertarget]"))) {
          await page.click("[popovertarget]");
          await page.waitForTimeout(300);
          const open = await page.evaluate(() => Boolean(document.querySelector(":popover-open")));
          if (!open) problems.push(`${label}: menu did not open`);
          const menuPath = `${out}/${slug(name)}-${theme}-390-menu.png`;
          await page.screenshot({ path: menuPath });
          shots.set(`${name}|${theme}|menu`, menuPath);
          await page.keyboard.press("Escape");
          if (await page.evaluate(() => Boolean(document.querySelector(":popover-open")))) problems.push(`${label}: Escape did not close the menu`);
        }
      }

      if (flag("--stress")) {
        await open(page, name, theme);
        await page.evaluate(stress);
        const stressed = await overflowOf(page);
        if (stressed > 0) problems.push(`${label}: ${stressed}px horizontal overflow with long copy`);
        const stressPath = `${out}/${slug(name)}-${theme}-${viewport.width}-stress.png`;
        await page.screenshot({ path: stressPath, fullPage });
        shots.set(`${name}|${theme}|${viewport.width}-stress`, stressPath);
      }
    }
  }
  await page.close();
}

if (flag("--contrast")) {
  // Blocks color everything through these tokens, so their pairs bound the contrast a block can have.
  const pairs = [
    ["text", "bg", 4.5],
    ["muted", "bg", 4.5],
    ["text", "surface", 4.5],
    ["muted", "surface", 4.5],
    ["on-accent", "accent", 4.5],
    ["accent", "bg", 3],
  ];
  const page = await browser.newPage();
  for (const theme of themes) {
    await open(page, targets[0], theme);
    const ratios = await page.evaluate((pairs) => {
      const probe = document.body.appendChild(document.createElement("i"));
      const rgb = (token) => {
        probe.style.color = `var(--color-${token})`;
        return getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
      };
      const luminance = (channels) => {
        const [r, g, b] = channels.map((value) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return pairs.map(([foreground, background, minimum]) => {
        const [a, b] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((x, y) => y - x);
        return { pair: `${foreground}/${background}`, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, minimum };
      });
    }, pairs);
    console.log(`contrast ${theme}: ${ratios.map(({ pair, ratio }) => `${pair} ${ratio}`).join(", ")}`);
    for (const { pair, ratio, minimum } of ratios) if (ratio < minimum) problems.push(`contrast ${theme}: ${pair} is ${ratio}, needs ${minimum}`);
  }
  await page.close();
}

if (flag("--sheet")) {
  // One image per item: a row per theme, phone beside desktop (and the open menu, long copy when captured).
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const name of targets) {
    const cells = [];
    for (const theme of themes)
      for (const key of ["390", "1440", "menu", "390-stress", "1440-stress"]) {
        const path = shots.get(`${name}|${theme}|${key}`);
        if (path) cells.push({ theme, key, data: (await readFile(path)).toString("base64") });
      }
    const rows = themes.map((theme) => {
      const row = cells.filter((cell) => cell.theme === theme);
      return `<section><h2>${theme}</h2><div>${row.map(({ key, data }) => `<figure><img src="data:image/png;base64,${data}" style="width:${key.startsWith("1440") ? 640 : 195}px"><figcaption>${key}</figcaption></figure>`).join("")}</div></section>`;
    });
    await page.setContent(
      `<style>body{margin:16px;font:14px system-ui;background:#e9e9e6}h1{margin:0 0 8px}h2{margin:16px 0 6px;font-size:13px}div{display:flex;gap:12px;align-items:flex-start}figure{margin:0}img{display:block;border:1px solid #aaa;background:#fff}figcaption{font-size:11px;color:#555}</style><h1>${name}</h1>${rows.join("")}`,
      { waitUntil: "load" },
    );
    await page.screenshot({ path: `${out}/sheet-${slug(name)}.png`, fullPage: true });
  }
  await page.close();
}

await browser.close();
console.log(`captured ${shots.size} screenshots in ${out}/${flag("--sheet") ? ` and ${targets.length} contact sheets` : ""}`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
