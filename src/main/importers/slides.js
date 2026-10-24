// PDF and PowerPoint import.
//  PDF: every page is rendered to a 1920px PNG in a hidden window (pdf.js) and becomes an image slide.
//  PPTX/PPT/KEY/ODP: converted to PDF with whatever is installed (LibreOffice, Keynote, PowerPoint),
//  then imported as a PDF. If no converter is available, slide text is imported instead (PPTX only).
const { BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readZip } = require('./zip.js');

const OFFICE_EXTENSIONS = ['.pptx', '.ppt', '.key', '.odp', '.pps', '.ppsx'];

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs || 180000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().trim().split('\n').pop()));
      else resolve(stdout.toString());
    });
  });
}

// ---------- PDF rendering ----------

class PdfRenderer {
  constructor(preloadPath, htmlPath) {
    this.preloadPath = preloadPath;
    this.htmlPath = htmlPath;
    this.win = null;
    this.readyPromise = null;
    this.jobs = new Map();
    this.nextJob = 1;
    ipcMain.on('pdf:ready', () => this._ready && this._ready());
    ipcMain.on('pdf:progress', (e, p) => { const j = this.jobs.get(p.jobId); if (j && j.onProgress) j.onProgress({ phase: 'pages', total: p.total, done: p.done }); });
    ipcMain.on('pdf:page', (e, p) => {
      const j = this.jobs.get(p.jobId);
      if (!j) return;
      j.pages[p.index] = { png: Buffer.from(p.png), text: p.text, width: p.width, height: p.height };
      if (j.onProgress) j.onProgress({ phase: 'pages', total: j.total || 0, done: j.pages.filter(Boolean).length });
    });
    ipcMain.on('pdf:done', (e, p) => {
      const j = this.jobs.get(p.jobId);
      if (!j) return;
      this.jobs.delete(p.jobId);
      if (p.error) j.reject(new Error(p.error)); else j.resolve(j.pages);
    });
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.readyPromise;
    this.readyPromise = new Promise((resolve) => { this._ready = resolve; });
    this.win = new BrowserWindow({
      show: false, width: 400, height: 300,
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: false }
    });
    this.win.loadFile(this.htmlPath);
    this.win.on('closed', () => { this.win = null; });
    return this.readyPromise;
  }

  async render(pdfBuffer, { width, onProgress }) {
    await this.ensure();
    const jobId = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject, pages: [], onProgress });
      this.win.webContents.send('pdf:render', { jobId, data: new Uint8Array(pdfBuffer), width: width || 1920 });
    });
  }

  dispose() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

// ---------- Office -> PDF ----------

function findSoffice() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/opt/homebrew/bin/soffice', '/usr/local/bin/soffice']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
      : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
  return candidates.find(c => fs.existsSync(c)) || null;
}

const appExists = (name) => fs.existsSync('/Applications/' + name + '.app');
const asString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

async function viaLibreOffice(file, outDir) {
  const soffice = findSoffice();
  if (!soffice) throw new Error('LibreOffice not installed');
  const profile = 'file://' + (process.platform === 'win32' ? '/' : '') + path.join(outDir, 'lo-profile').replace(/\\/g, '/');
  await run(soffice, ['-env:UserInstallation=' + profile, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, file], 240000);
  const pdf = path.join(outDir, path.basename(file, path.extname(file)) + '.pdf');
  if (!fs.existsSync(pdf)) throw new Error('LibreOffice did not produce a PDF');
  return pdf;
}

async function viaKeynote(file, outDir) {
  if (process.platform !== 'darwin' || !appExists('Keynote')) throw new Error('Keynote not installed');
  const pdf = path.join(outDir, 'converted.pdf');
  const script = [
    'set inFile to POSIX file ' + asString(file),
    'set outFile to POSIX file ' + asString(pdf),
    'tell application "Keynote"',
    '  set theDoc to open inFile',
    '  export theDoc to outFile as PDF',
    '  close theDoc saving no',
    'end tell'
  ].join('\n');
  await run('osascript', ['-e', script], 240000);
  if (!fs.existsSync(pdf)) throw new Error('Keynote did not produce a PDF');
  return pdf;
}

async function viaPowerPointMac(file, outDir) {
  if (process.platform !== 'darwin' || !appExists('Microsoft PowerPoint')) throw new Error('PowerPoint not installed');
  const pdf = path.join(outDir, 'converted.pdf');
  const script = [
    'tell application "Microsoft PowerPoint"',
    '  open POSIX file ' + asString(file),
    '  set thePres to active presentation',
    '  save thePres in POSIX file ' + asString(pdf) + ' as save as PDF',
    '  close thePres saving no',
    'end tell'
  ].join('\n');
  await run('osascript', ['-e', script], 240000);
  if (!fs.existsSync(pdf)) throw new Error('PowerPoint did not produce a PDF');
  return pdf;
}

async function viaPowerPointWindows(file, outDir) {
  if (process.platform !== 'win32') throw new Error('Not Windows');
  const pdf = path.join(outDir, 'converted.pdf');
  const ps = [
    '$ErrorActionPreference = "Stop"',
    '$pp = New-Object -ComObject PowerPoint.Application',
    '$pres = $pp.Presentations.Open(' + psQuote(file) + ', $true, $false, $false)',
    '$pres.SaveAs(' + psQuote(pdf) + ', 32)',
    '$pres.Close()',
    'if ($pp.Presentations.Count -eq 0) { $pp.Quit() }'
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], 240000);
  if (!fs.existsSync(pdf)) throw new Error('PowerPoint did not produce a PDF');
  return pdf;
}

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/** Tries the converters available on this platform; returns {pdf, via} or throws with every reason. */
async function officeToPdf(file) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'htimedia-convert-'));
  const ext = path.extname(file).toLowerCase();
  const order = process.platform === 'win32'
    ? [['PowerPoint', viaPowerPointWindows], ['LibreOffice', viaLibreOffice]]
    : ext === '.key'
      ? [['Keynote', viaKeynote]]
      : [['LibreOffice', viaLibreOffice], ['Keynote', viaKeynote], ['PowerPoint', viaPowerPointMac]];
  const reasons = [];
  for (const [name, fn] of order) {
    try { return { pdf: await fn(file, outDir), via: name, outDir }; } catch (e) { reasons.push(name + ': ' + e.message); }
  }
  const err = new Error('No presentation converter worked. ' + reasons.join(' · '));
  err.reasons = reasons;
  throw err;
}

// ---------- PPTX text fallback ----------

function xmlText(xml) {
  return xml.split(/<\/a:p>/).map(p => (p.match(/<a:t>([^<]*)<\/a:t>|<a:t\s[^>]*>([^<]*)<\/a:t>/g) || [])
    .map(t => t.replace(/<[^>]+>/g, '')).join(''))
    .map(s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
    .filter(Boolean).join('\n');
}

/** Returns [{text, notes}] in slide order from a .pptx file. */
function pptxSlidesText(file) {
  const zip = readZip(fs.readFileSync(file));
  const slides = zip.entries.map(e => e.name).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  return slides.map(name => {
    const text = xmlText(zip.read(name).toString('utf8'));
    let notes = '';
    const rels = zip.read(name.replace('slides/', 'slides/_rels/') + '.rels');
    const m = rels && /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels.toString('utf8'));
    if (m) {
      const n = zip.read('ppt/notesSlides/' + m[1]);
      if (n) notes = xmlText(n.toString('utf8')).replace(/^\d+$/m, '').trim();
    }
    return { text, notes };
  });
}

module.exports = { PdfRenderer, officeToPdf, pptxSlidesText, findSoffice, OFFICE_EXTENSIONS };
