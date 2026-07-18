import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const OUT = fileURLToPath(new URL("../../docs/images/", import.meta.url));

const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--window-size=1600,1000", "--force-device-scale-factor=1.5"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- login ---
await page.goto(`${BASE}/`, { waitUntil: "networkidle0", timeout: 60000 });
await sleep(500);

await page.type('input[type="text"], input[name="username"], input', "demo");
const inputs = await page.$$("input");
if (inputs.length > 1) await inputs[1].type("demo");
await shot("login");

await Promise.all([
  page.click('button[type="submit"], button'),
  page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
]);
await sleep(1500);

// --- chat (empty state with example prompts) ---
await page.goto(`${BASE}/`, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(1000);
await shot("chat");

// --- playground graph for task_agent ---
await page.goto(`${BASE}/playground`, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(2500);
await shot("playground");

// --- tests (eval) view ---
await page.goto(`${BASE}/tests`, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(1500);
await shot("tests");

// --- runs view ---
await page.goto(`${BASE}/runs`, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(1500);
await shot("runs");

await browser.close();
console.log("screenshots captured");
