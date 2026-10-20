// Reads the step count from a health-app screenshot (Samsung Health, Google Fit, Fitbit, Garmin, Apple Health…).
// Tesseract.js is loaded on demand only when someone imports a screenshot.
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Could not load the screenshot reader. Check your connection.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Downscale + grayscale + auto-invert dark-mode screenshots for better OCR. */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  ctx.putImageData(img, 0, 0);
  return cv;
}

export async function readSteps(file, onProgress = () => {}) {
  onProgress(0.05, 'Loading the reader…');
  const T = await loadTesseract();
  const canvas = await prepare(file);
  onProgress(0.15, 'Reading your screenshot…');
  const worker = await T.createWorker('eng', 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress(0.2 + m.progress * 0.8, 'Reading your screenshot…'); },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return extractSteps(data.text || '');
  } finally {
    worker.terminate();
  }
}

const KEYWORD = /\b(steps?|passos?|pasos?|pas|schritte|passi)\b/i;
const UNIT_AFTER = /^\s*(%|kcal|cal\b|km\b|mi\b|min\b|mins\b|h\b|hr|bpm|kg|lb|am\b|pm\b|floors?|pisos?|andares)/i;
const GOAL_BEFORE = /(\/|goal|meta|objetivo|target|of)\s*$/i;

/** Picks the most likely daily step count from OCR text. Exported for tests. */
export function extractSteps(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const found = [];
  const re = /\d{1,3}(?:[.,  ]\d{3})+|\d{3,6}/g;
  lines.forEach((line, li) => {
    let m;
    while ((m = re.exec(line))) {
      const raw = m[0];
      const n = Number(raw.replace(/\D/g, ''));
      if (n < 100 || n > 100000) continue;
      const before = line.slice(Math.max(0, m.index - 14), m.index);
      const after = line.slice(m.index + raw.length, m.index + raw.length + 14);
      if (UNIT_AFTER.test(after) || /^[:.,]\d/.test(after) || /\d[:.,]$/.test(before)) continue;
      let score = Math.log10(n);
      if (KEYWORD.test(after)) score += 6;
      if (KEYWORD.test(before)) score += 3;
      if (KEYWORD.test(lines[li + 1] || '') || KEYWORD.test(lines[li - 1] || '')) score += 2.5;
      if (GOAL_BEFORE.test(before)) score -= 6;
      if (/^(19|20)\d\d$/.test(raw)) score -= 3;            // looks like a year
      if ([6000, 8000, 10000, 12000, 15000].includes(n)) score -= 1.2; // typical goal values
      found.push({ n, score });
    }
  });
  found.sort((a, b) => b.score - a.score);
  const unique = [...new Set(found.map(f => f.n))];
  return { steps: unique[0] ?? null, alternatives: unique.slice(1, 4) };
}
