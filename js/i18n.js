// Tiny i18n: English (default), Português (Brasil) and Español. Strings live in strings.js as [en, pt, es].
import S from './strings.js';

export const LANGS = [
  { id: 'en', name: 'English', code: 'EN', locale: 'en-US' },
  { id: 'pt', name: 'Português', code: 'PT', locale: 'pt-BR' },
  { id: 'es', name: 'Español', code: 'ES', locale: 'es-419' },
];
const IDX = { en: 0, pt: 1, es: 2 };
const KEY = 't8:lang';

function stored() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return v in IDX ? v : null; } catch { return null; }
}

let current = stored() || 'en';

export const lang = () => current;
/** True once the person picked a language (first-run screens ask until then). */
export const langChosen = () => stored() !== null;
export const locale = () => LANGS[IDX[current]].locale;

export function setLang(id) {
  if (!(id in IDX)) return;
  current = id;
  try { localStorage.setItem(KEY, JSON.stringify(id)); } catch { /* storage blocked */ }
}

/** t('key', { name: 'Ana' }) → translated string with {placeholders} filled. Arrays are returned as-is. */
export function t(key, vars) {
  const row = S[key];
  if (!row) return key;
  const s = row[IDX[current]] ?? row[0];
  if (!vars || typeof s !== 'string') return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Plural: picks 'key.one' or 'key.other' and passes n as {n}. */
export const tn = (key, n, vars = {}) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });
