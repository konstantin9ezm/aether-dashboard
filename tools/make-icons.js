// Erzeugt die PNG-Icons aus icons/icon.svg (nur bei Änderungen am Icon nötig).
// Aufruf: node tools/make-icons.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');
const targets = [
  ['apple-touch-icon.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.1]
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, pad] of targets) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - 2 * pad));
    const off = Math.round(size * pad);
    await page.setContent(`<html><body style="margin:0;background:#07090f">
      <div style="position:absolute;left:${off}px;top:${off}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
    await page.screenshot({ path: path.join(root, 'icons', name), omitBackground: false });
  }
  await browser.close();
})();
