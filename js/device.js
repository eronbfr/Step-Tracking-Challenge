// This device's signing key (ECDSA P-256 via WebCrypto). The private key is created non-extractable and kept in
// IndexedDB, so it never leaves the browser; only the public key goes into the ledger.
import { b64u, kidOf } from './ledger.js';

const DB = 't8-device', STORE = 'keys', SLOT = 'device';
const LS_FALLBACK = 't8:device-jwk'; // browsers that can't store a CryptoKey in IndexedDB
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };

let current = null; // Promise<{ kid, pub, privateKey }>

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { open.result.close(); resolve(req && req.result); };
      tx.onerror = tx.onabort = () => { open.result.close(); reject(tx.error); };
    };
  });
}

async function describe(privateKey, publicKey) {
  const pub = b64u(await crypto.subtle.exportKey('raw', publicKey));
  return { kid: await kidOf(pub), pub, privateKey };
}

async function load() {
  try {
    const saved = await idb('readonly', s => s.get(SLOT));
    if (saved && saved.privateKey) return saved;
  } catch { /* no IndexedDB */ }
  try {
    const jwk = JSON.parse(localStorage.getItem(LS_FALLBACK) || 'null');
    if (jwk) {
      const privateKey = await crypto.subtle.importKey('jwk', jwk.priv, ALG, false, ['sign']);
      const publicKey = await crypto.subtle.importKey('jwk', jwk.pub, ALG, true, ['verify']);
      return describe(privateKey, publicKey);
    }
  } catch { /* corrupted: make a new one */ }

  const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const key = await describe(pair.privateKey, pair.publicKey);
  try {
    await idb('readwrite', s => s.put(key, SLOT));
    const back = await idb('readonly', s => s.get(SLOT));
    if (back && back.privateKey) return back;
  } catch { /* fall through */ }
  // Fallback: an extractable pair in localStorage (still never sent anywhere).
  const exp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  localStorage.setItem(LS_FALLBACK, JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', exp.privateKey), pub: await crypto.subtle.exportKey('jwk', exp.publicKey) }));
  return describe(exp.privateKey, exp.publicKey);
}

/** { kid, pub } of this device (created on first use). */
export async function key() {
  if (!current) current = load().catch(e => { current = null; throw e; });
  const { kid, pub } = await current;
  return { kid, pub };
}

export async function sign(text) {
  await key();
  const { privateKey } = await current;
  return b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text)));
}

/** Forget this device's key (sign-out). The next sign-in creates a fresh one. */
export async function forget() {
  current = null;
  try { await idb('readwrite', s => s.delete(SLOT)); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_FALLBACK); } catch { /* ignore */ }
}

/** Short human label shown when approving a new device: "iPhone · Safari", "Android · Chrome (app)"… */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Browser';
  const br = /edg\//i.test(ua) ? 'Edge' : /samsungbrowser/i.test(ua) ? 'Samsung' : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /crios|chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return `${os}${br ? ` · ${br}` : ''}${app ? ' (app)' : ''}`;
}
