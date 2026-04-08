import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "..", "store-generated");
mkdirSync(outputDir, { recursive: true });

const pages = [
  { file: "icon.html", output: "icon-128.png", width: 128, height: 128 },
  { file: "screenshot-light.html", output: "screenshot-1-light.png", width: 1280, height: 800 },
  { file: "screenshot-dark.html", output: "screenshot-2-dark.png", width: 1280, height: 800 },
  { file: "screenshot-beyond-limit.html", output: "screenshot-3-limit.png", width: 1280, height: 800 },
  { file: "small-promo.html", output: "small-promo-440x280.png", width: 440, height: 280 },
  { file: "hero-annotated.html", output: "hero-annotated.png", width: 1280, height: 800 },
];

const browser = await puppeteer.launch({ headless: true });

for (const page of pages) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: page.width, height: page.height, deviceScaleFactor: 1 });

  const filePath = join(__dirname, page.file);
  await tab.goto(`file://${filePath}`, { waitUntil: "networkidle0" });

  // Brief pause for web font loading
  await new Promise((r) => setTimeout(r, 1500));

  const outputPath = join(outputDir, page.output);
  await tab.screenshot({ path: outputPath, type: "png", omitBackground: false });
  console.log(`✓ ${page.output} (${page.width}x${page.height})`);
  await tab.close();
}

await browser.close();
console.log(`\nAll assets saved to: ${outputDir}`);
