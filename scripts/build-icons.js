// Renders build/icon.svg to build/icon.png (1024x1024) with Electron itself, so no image tools are needed.
// Run: npx electron scripts/build-icons.js   (electron-builder then makes .icns and .ico from the PNG)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a55"/><stop offset="1" stop-color="#070d22"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd43b"/><stop offset="1" stop-color="#e8590c"/></linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="190" y="250" width="644" height="400" rx="40" fill="none" stroke="url(#gold)" stroke-width="34"/>
  <rect x="452" y="650" width="120" height="70" fill="url(#gold)"/>
  <rect x="352" y="712" width="320" height="34" rx="17" fill="url(#gold)"/>
  <text x="512" y="510" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="190" font-weight="800" fill="#ffffff" letter-spacing="8">HTI</text>
  <text x="512" y="850" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="74" font-weight="600" fill="#ffd43b" letter-spacing="18">MEDIA</text>
</svg>`;

app.whenReady().then(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(path.join(BUILD, 'icon.svg'), SVG);
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent('<html><body style="margin:0;background:transparent">' + SVG + '</body></html>'));
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(BUILD, 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
  console.log('Wrote build/icon.png');
  app.quit();
});
