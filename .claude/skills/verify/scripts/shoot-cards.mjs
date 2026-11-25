// Shoot every card in the served preview, one PNG per card, theme, and width.
// Usage: node .claude/skills/verify/scripts/shoot-cards.mjs <preview url> <out dir>
// Chromium paints a card iframe only while it is on screen, so each card is scrolled into view,
// waited on until it has drawn, and cropped to its own height.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node shoot-cards.mjs <preview url> <out dir>");
  process.exit(2);
}

// The preview page pads the card, so the viewport is wider than the card it frames.
const MARGIN = 105;
const WIDTHS = [560, 375];
const THEMES = ["light", "dark"];

function cachedChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache/ms-playwright"),
    join(homedir(), "Library/Caches/ms-playwright"),
  ];
  const inner = [
    "chrome-linux64/chrome",
    "chrome-linux/chrome",
    "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .toSorted((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      for (const path of inner) if (existsSync(join(root, dir, path))) return join(root, dir, path);
    }
  }
  return undefined;
}

async function launch() {
  const tries = [
    ["VERIFY_CHROMIUM", () => (process.env.VERIFY_CHROMIUM ? { executablePath: process.env.VERIFY_CHROMIUM } : undefined)],
    // Claude Code cloud sessions ship Chrome for Testing and point CHROME_PATH at it.
    ["CHROME_PATH", () => (process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined)],
    ["playwright default", () => ({})],
    ["cached Chromium", () => (cachedChromium() ? { executablePath: cachedChromium() } : undefined)],
    ["installed Chrome", () => ({ channel: "chrome" })],
  ];
  const failures = [];
  for (const [name, options] of tries) {
    const chosen = options();
    if (!chosen) continue;
    try {
      const browser = await chromium.launch(chosen);
      console.log(`browser ${name}${chosen.executablePath ? ` ${chosen.executablePath}` : ""}`);
      return browser;
    } catch (error) {
      failures.push(`${name}: ${String(error).split("\n")[0]}`);
    }
  }
  throw new Error(`no Chromium could start:\n  ${failures.join("\n  ")}`);
}

mkdirSync(out, { recursive: true });
const browser = await launch();
let shots = 0;
const blank = [];
const labels = [];
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: width + MARGIN, height: 1200 } });
      await page.goto(`${url}?theme=${theme}&width=${width}`);
      const frames = page.locator("iframe");
      await frames.first().waitFor();
      const count = await frames.count();
      for (let i = 0; i < count; i++) {
        const element = frames.nth(i);
        await element.scrollIntoViewIfNeeded();
        const frame = await (await element.elementHandle()).contentFrame();
        const drawn = await frame
          .waitForFunction(
            () => document.body.innerText.trim() !== "" && !document.body.innerText.includes("Waiting for the result"),
            null,
            {
              timeout: 10_000,
            },
          )
          .then(() => true)
          .catch(() => false);
        const name = String(i + 1).padStart(2, "0");
        if (!drawn) blank.push(`${theme}-${width}-${name}`);
        const height = await frame.evaluate(() => document.documentElement.scrollHeight);
        const box = await element.boundingBox();
        const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, height + 2, 1200 - box.y) };
        await page.screenshot({ path: join(out, `${theme}-${width}-${name}.png`), clip });
        if (theme === THEMES[0] && width === WIDTHS[0]) {
          const label = await element.evaluate((node) => node.previousElementSibling?.textContent?.trim() ?? "");
          labels.push(`${name} ${label}`);
        }
        shots++;
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "cards.txt"), `${labels.join("\n")}\n`);
console.log(`shot ${shots} cards to ${out}; names in cards.txt`);
if (blank.length > 0) {
  console.error(`not drawn within 10 s: ${blank.join(", ")}`);
  process.exit(1);
}
