#!/usr/bin/env node
// Takes the entry's screenshots with a real browser: four deterministic scenes
// of Solara Bay, captured at exactly 1280x480 (the bounty's size), and written
// to screenshots/ as PNG or JPEG under the 256 KiB cap.
//
//   npm i puppeteer-core           # once, anywhere Node can resolve it
//   node tools/capture.mjs         # uses your installed Chrome/Chromium
//   CHROME_PATH=/path/to/chrome node tools/capture.mjs
//
// The game exposes each scene through ?shot=<name>&seed=<n> in game/index.html.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'screenshots');
const PORT = parseInt(process.env.PORT || '8099', 10);
const WIDTH = 1280;
const HEIGHT = 480;
const MAX_BYTES = 262144;

const SHOTS = [
  { name: '1-chase', shot: 'chase', seed: 1, title: 'A stolen coupe, three stars and the PCPD on the strip' },
  { name: '2-street', shot: 'street', seed: 2, title: 'Gunfight outside the club on Little Habana night' },
  { name: '3-pier', shot: 'pier', seed: 3, title: 'Centrico after dark with four stars' },
  { name: '4-title', shot: 'title', seed: 4, title: 'Rico and the car on the Sunset Strip promenade' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/tmp/chromium',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

async function loadPuppeteer() {
  for (const name of ['puppeteer-core', 'puppeteer']) {
    try {
      return require(name);
    } catch {
      /* try the next one */
    }
  }
  throw new Error('puppeteer-core is not installed: run `npm i puppeteer-core` (or `npm i puppeteer`)');
}

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

async function main() {
  const puppeteer = await loadPuppeteer();
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome/Chromium found: set CHROME_PATH');
  const server = await serve();
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('page error:', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console:', msg.text());
  });

  for (const spec of SHOTS) {
    const url = `http://127.0.0.1:${PORT}/game/index.html?shot=${spec.shot}&seed=${spec.seed}`;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__SHOT_READY__ === true', { timeout: 90000 });
    await new Promise((r) => setTimeout(r, 350));

    let body = await page.screenshot({ type: 'png' });
    let ext = 'png';
    if (body.length > MAX_BYTES) {
      body = await page.screenshot({ type: 'jpeg', quality: 88 });
      ext = 'jpg';
    }
    if (body.length > MAX_BYTES) {
      body = await page.screenshot({ type: 'jpeg', quality: 72 });
    }
    const file = join(outDir, `${spec.name}.${ext}`);
    await writeFile(file, body);
    console.log(`${spec.name}.${ext}  ${(body.length / 1024).toFixed(1)} KiB  — ${spec.title}`);
  }

  await browser.close();
  server.close();
  console.log(`\nscreenshots written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
