#!/usr/bin/env node
// Render samples/showcase.mind with this grammar (via Shiki) in a light and a
// dark theme, then capture PNG screenshots with headless Chrome/Chromium. Also
// rasterizes the SVG logo into the PNG icon the VS Code extension needs.
//
// Usage: node scripts/render-screenshots.mjs
// Needs Chrome or Chromium on PATH, or its path in the CHROME_BIN variable.
// Output: images/showcase-light.png, images/showcase-dark.png, images/icon.png
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHighlighter } from "shiki";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const grammar = JSON.parse(readFileSync(join(root, "source.mind.json"), "utf8"));
const source = readFileSync(join(root, "samples/showcase.mind"), "utf8").trimEnd();

const FONT_PX = 14;
const LINE_PX = 21;
const CHAR_PX = 8.45; // advance width of a 14px monospace glyph, rounded up
const PAD_PX = 24;

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "chromium", "chromium-browser"];
  for (const bin of candidates.filter(Boolean)) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      // try the next candidate
    }
  }
  throw new Error("Chrome/Chromium not found; set CHROME_BIN");
}

function page(html, background) {
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${background}}
pre.shiki{margin:0;padding:${PAD_PX}px;font:${FONT_PX}px/${LINE_PX}px "DejaVu Sans Mono","Menlo","Consolas",monospace;}
</style>${html}`;
}

const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: [{ ...grammar, name: "mind" }],
});

const lines = source.split("\n");
const width = Math.ceil(Math.max(...lines.map((l) => l.length)) * CHAR_PX) + 2 * PAD_PX;
const height = lines.length * LINE_PX + 2 * PAD_PX;
const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), "mind-grammar-shots-"));
mkdirSync(join(root, "images"), { recursive: true });

function capture(htmlFile, out, w, h, extra = []) {
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${join(work, "profile")}`,
    ...extra,
    `--window-size=${w},${h}`,
    `--screenshot=${out}`,
    pathToFileURL(htmlFile).href,
  ], { stdio: "ignore" });
  console.log(`wrote ${out}`);
}

try {
  for (const [theme, suffix] of [["github-light", "light"], ["github-dark", "dark"]]) {
    const html = highlighter.codeToHtml(source, { lang: "mind", theme });
    const bg = highlighter.getTheme(theme).bg;
    const file = join(work, `${suffix}.html`);
    writeFileSync(file, page(html, bg));
    const out = join(root, "images", `showcase-${suffix}.png`);
    capture(file, out, width, height, ["--force-device-scale-factor=2"]);
  }
  // 128x128 extension icon from the logo (light variant; a PNG cannot follow
  // the viewer's color scheme the way the SVG does).
  const icon = join(work, "icon.html");
  const logo = pathToFileURL(join(root, "images/mind-grammar.svg")).href;
  writeFileSync(icon, `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${logo}" width="128" height="128">`);
  capture(icon, join(root, "images/icon.png"), 128, 128, ["--default-background-color=00000000"]);
} finally {
  rmSync(work, { recursive: true, force: true });
}
