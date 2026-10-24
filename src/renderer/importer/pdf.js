// Hidden window: renders each PDF page to a PNG with pdf.js and hands the images back to main.
import * as pdfjs from '../../../node_modules/pdfjs-dist/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const ASSETS = new URL('../../../node_modules/pdfjs-dist/', import.meta.url).toString();

window.htiImport.onRender(async ({ jobId, data, width }) => {
  try {
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: ASSETS + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: ASSETS + 'standard_fonts/'
    }).promise;
    window.htiImport.progress({ jobId, total: doc.numPages, done: 0 });
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const png = new Uint8Array(await blob.arrayBuffer());
      const text = (await page.getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      window.htiImport.page({ jobId, index: n - 1, png, text, width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    window.htiImport.done({ jobId, pages: doc.numPages });
    doc.destroy();
  } catch (e) {
    window.htiImport.done({ jobId, error: e.message || String(e) });
  }
});

window.htiImport.ready();
