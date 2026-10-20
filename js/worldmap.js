// Team map — where Team 8 walks.
// NASA imagery on a WebGL globe that unrolls into a flat map of the team's home cities: live day/night terminator
// (city lights on the night side), great-circle arcs between the cities and every member's avatar pinned on their
// home state. Views re-render often, so there is one map for the whole app: its DOM (with the GL context, textures
// and camera) moves into each new host instead of being rebuilt.
// Assets: assets/map/ (tools/make_map.py). project() mirrors the vertex shader, so pins and lines sit on the imagery.
import { CONFIG } from './config.js';
import { CITY, haversine } from './metrics.js';
import { t, locale } from './i18n.js';
import { esc, fmt, compact, avatar, ring, reducedMotion } from './ui.js';
import { showTip, hideTip, tipRow } from './charts.js';

const DEG = Math.PI / 180;
const ASSETS = 'assets/map/';
const INSET = [-125, -25, 38, -58];   // west, east, north, south of the sharp latam-*.webp window (tools/make_map.py)
const GOLD = '255, 204, 92';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = d => ((((d + 180) % 360) + 360) % 360) - 180;
const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/* ═════════════ Places ═════════════ */
// Home cities ([lat, lon] from metrics.js). Members pick theirs in config.js (ROSTER[].city); others fall back to the capital.
export const PLACES = {
  cdmx: { cc: 'MX', ll: CITY.cdmx, tz: 'America/Mexico_City' },
  bog: { cc: 'CO', ll: CITY.bog, tz: 'America/Bogota' },
  rio: { cc: 'BR', ll: CITY.rio, tz: 'America/Sao_Paulo' },
  sp: { cc: 'BR', ll: CITY.sp, tz: 'America/Sao_Paulo' },
  mvd: { cc: 'UY', ll: CITY.mvd, tz: 'America/Montevideo' },
};
const CAPITAL = { MX: 'cdmx', CO: 'bog', BR: 'sp', UY: 'mvd' };
const HOME = Object.fromEntries(CONFIG.ROSTER.filter(r => r.city).map(r => [r.id, r.city]));
export const placeOf = m => (PLACES[HOME[m.id]] ? HOME[m.id] : CAPITAL[m.country] || null);
export const placeName = id => t(`city.${id}`);

let names = null;
export function countryName(cc) {
  try {
    if (!names || names.loc !== locale()) names = { loc: locale(), dn: new Intl.DisplayNames([locale()], { type: 'region' }) };
    return names.dn.of(cc) || cc;
  } catch { return cc; }
}

/** Countries ranked by average steps per member over the whole challenge. */
export function countryStats(members) {
  const by = new Map();
  members.forEach(m => {
    const p = placeOf(m);
    if (!p) return;
    const cc = PLACES[p].cc;
    if (!by.has(cc)) by.set(cc, { cc, name: countryName(cc), n: 0, total: 0, places: [] });
    const c = by.get(cc);
    c.n += 1;
    c.total += m.s.total;
    if (!c.places.includes(p)) c.places.push(p);
  });
  return [...by.values()].map(c => ({ ...c, avg: c.total / c.n })).sort((a, b) => b.avg - a.avg || b.n - a.n || a.name.localeCompare(b.name));
}

/** Longest straight-line distance between two members' cities, in km. */
export function spanKm(members) {
  const ids = [...new Set(members.map(placeOf).filter(Boolean))];
  let best = 0;
  ids.forEach(a => ids.forEach(b => { best = Math.max(best, haversine(PLACES[a].ll, PLACES[b].ll)); }));
  return best;
}

/* ═════════════ Sun ═════════════ */
const unit = (lat, lon) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
/** Earth-fixed unit vector towards the sun (low-precision almanac, ≈0.01°). */
function sunVector(ms = Date.now()) {
  const d = ms / 864e5 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * DEG;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 3.6e-7 * d) * DEG;
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) * 15) * DEG;
  return unit(decl / DEG, (ra - gmst) / DEG);
}
const sunUp = ([lat, lon], s) => { const n = unit(lat, lon); return n[0] * s[0] + n[1] * s[1] + n[2] * s[2] > -0.02; };
function localTime(tz) {
  try { return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch { return ''; }
}

/* ═════════════ Projection ═════════════ */
// Camera: centre (lon, lat), k = CSS px per degree, m = morph from orthographic globe (0) to plate carrée (1).
// Both projections share the centre and scale (globe radius = k px per degree), so mixing them "unrolls" the globe.
function project(cam, W, H, lon, lat, out) {
  const dl = wrap(lon - cam.lon), l = dl * DEG, p = lat * DEG, p0 = cam.lat * DEG, R = cam.k / DEG;
  const cp = Math.cos(p), sp = Math.sin(p), c0 = Math.cos(p0), s0 = Math.sin(p0), cl = Math.cos(l);
  const ox = R * cp * Math.sin(l), oy = R * (c0 * sp - s0 * cp * cl);
  const ex = cam.k * dl, ey = cam.k * (lat - cam.lat);
  out.x = W / 2 + ox + (ex - ox) * cam.m;
  out.y = H / 2 - (oy + (ey - oy) * cam.m);
  out.z = s0 * sp + c0 * cp * cl; // > 0: facing the viewer on the globe
  return out;
}
const facing = (z, m) => (m > 0.5 ? true : z > 0.08);

/** Smooth zoom+pan between two flat views (van Wijk & Nuij 2003, as in d3.interpolateZoom). View: [lon, lat, width in °]. */
function vanWijk([ux0, uy0, w0], [ux1, uy1, w1]) {
  const rho = 1.3, r2 = rho * rho, r4 = r2 * r2;
  const dx = wrap(ux1 - ux0), dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  if (d2 < 1e-9) {
    const S = Math.log(w1 / w0) / rho;
    return { S: Math.abs(S), f: s => [ux0, uy0, w0 * Math.exp(rho * s * S)] };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1), b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
  const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (q1 - q0) / rho;
  return {
    S, f: s => {
      const u = (w0 / (r2 * d1)) * (Math.cosh(q0) * Math.tanh(rho * s * S + q0) - Math.sinh(q0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * Math.cosh(q0)) / Math.cosh(rho * s * S + q0)];
    },
  };
}

/* ═════════════ WebGL ═════════════ */
const VS = `
attribute vec2 aP;          // (longitude relative to the camera, latitude) in degrees
uniform vec4 uCam;          // lon, lat, k (px/deg), morph
uniform vec2 uView;         // viewport in CSS px
varying vec2 vLL;
varying float vZ;
const float D = 0.017453292519943295;
void main() {
  float l = aP.x * D, p = aP.y * D, p0 = uCam.y * D, R = uCam.z / D, cp = cos(p);
  float z = sin(p0) * sin(p) + cos(p0) * cp * cos(l);
  vec2 o = R * vec2(cp * sin(l), cos(p0) * sin(p) - sin(p0) * cp * cos(l));
  vec2 e = uCam.z * vec2(aP.x, aP.y - uCam.y);
  gl_Position = vec4(mix(o, e, uCam.w) * 2.0 / uView, z * (uCam.w - 1.0) * 0.5, 1.0);
  vLL = vec2(aP.x + uCam.x, aP.y);
  vZ = z;
}`;
const FS = prec => `
precision ${prec} float;
uniform sampler2D uDay, uNight, uDayIn, uNightIn;
uniform vec4 uInset;        // west, east, north, south
uniform vec3 uSun;
uniform vec4 uFlags;        // night ready, day inset ready, night inset ready, morph
varying vec2 vLL;
varying float vZ;
const float D = 0.017453292519943295;
void main() {
  vec2 uv = vec2(vLL.x / 360.0 + 0.5, (90.0 - vLL.y) / 180.0);
  float lon = mod(vLL.x + 180.0, 360.0) - 180.0;
  vec2 iv = vec2((lon - uInset.x) / (uInset.y - uInset.x), (uInset.z - vLL.y) / (uInset.z - uInset.w));
  vec2 edge = smoothstep(0.0, 0.02, iv) * smoothstep(0.0, 0.02, 1.0 - iv);
  float w = edge.x * edge.y;
  vec3 day = mix(texture2D(uDay, uv).rgb, texture2D(uDayIn, iv).rgb, w * uFlags.y);
  vec3 night = mix(texture2D(uNight, uv).rgb, texture2D(uNightIn, iv).rgb, w * uFlags.z);
  float p = vLL.y * D, l = vLL.x * D;
  float s = dot(vec3(cos(p) * cos(l), cos(p) * sin(l), sin(p)), uSun);
  float n = smoothstep(0.12, -0.16, s) * uFlags.x;              // civil → nautical twilight
  vec3 c = mix(day * 1.06, night * 1.45 + vec3(0.0, 0.006, 0.02), n);
  c += vec3(0.9, 0.5, 0.25) * 0.035 * smoothstep(1.0, 0.0, abs(n * 2.0 - 1.0)) * uFlags.x; // faint dusk glow
  float shade = mix(0.3 + 0.7 * smoothstep(-0.05, 0.8, vZ), 1.0, uFlags.w);
  gl_FragColor = vec4(c * shade, 1.0);
}`;
const TEX = { 'world-day': 0, 'world-night': 1, 'latam-day': 2, 'latam-night': 3 };

function setupGL(s) {
  const g = s.glc.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!g || g.getParameter(g.MAX_TEXTURE_SIZE) < 2048) return false;
  const hp = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
  const sh = (type, src) => {
    const o = g.createShader(type);
    g.shaderSource(o, src);
    g.compileShader(o);
    if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o));
    return o;
  };
  const p = g.createProgram();
  g.attachShader(p, sh(g.VERTEX_SHADER, VS));
  g.attachShader(p, sh(g.FRAGMENT_SHADER, FS(hp && hp.precision > 0 ? 'highp' : 'mediump')));
  g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
  g.useProgram(p);
  // 2° grid in (relative longitude, latitude): the mesh never crosses the antimeridian.
  const STEP = 2, NX = 360 / STEP + 1, NY = 180 / STEP + 1;
  const pos = new Float32Array(NX * NY * 2);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { pos[(j * NX + i) * 2] = -180 + i * STEP; pos[(j * NX + i) * 2 + 1] = 90 - j * STEP; }
  const idx = new Uint16Array((NX - 1) * (NY - 1) * 6);
  let n = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, c = a + NX;
    idx.set([a, c, a + 1, a + 1, c, c + 1], n);
    n += 6;
  }
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, pos, g.STATIC_DRAW);
  const aP = g.getAttribLocation(p, 'aP');
  g.enableVertexAttribArray(aP);
  g.vertexAttribPointer(aP, 2, g.FLOAT, false, 0, 0);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ELEMENT_ARRAY_BUFFER, idx, g.STATIC_DRAW);
  const U = {};
  ['uCam', 'uView', 'uInset', 'uSun', 'uFlags', 'uDay', 'uNight', 'uDayIn', 'uNightIn'].forEach(k => { U[k] = g.getUniformLocation(p, k); });
  g.uniform1i(U.uDay, 0); g.uniform1i(U.uNight, 1); g.uniform1i(U.uDayIn, 2); g.uniform1i(U.uNightIn, 3);
  g.enable(g.DEPTH_TEST);
  g.depthFunc(g.LEQUAL);
  const aniso = g.getExtension('EXT_texture_filter_anisotropic');
  s.tex = Object.keys(TEX).map(() => {
    const tx = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, tx);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGB, 1, 1, 0, g.RGB, g.UNSIGNED_BYTE, new Uint8Array([3, 8, 22]));
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return tx;
  });
  Object.assign(s, { gl: g, U, nIdx: idx.length, aniso, has: {} });
  return true;
}

function upload(s, name, img) {
  const g = s.gl, unitNo = TEX[name];
  g.activeTexture(g.TEXTURE0 + unitNo);
  g.bindTexture(g.TEXTURE_2D, s.tex[unitNo]);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, img);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, name.startsWith('world') ? g.REPEAT : g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.generateMipmap(g.TEXTURE_2D);
  if (s.aniso) g.texParameterf(g.TEXTURE_2D, s.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, g.getParameter(s.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
}

/* ═════════════ The map (one per app) ═════════════ */
let S = null;
export const mapMode = () => (S ? (S.mode === 'world' ? 'world' : 'team') : 'team');
export const mapFocus = () => (S && S.mode === 'focus' ? S.focusCC : null);

/** Moves the map into `host` and shows `opts.members` ({ members, goal, idx, meId }). */
export function attachMap(host, opts) {
  if (!S) S = create();
  if (S.root.parentNode !== host) host.appendChild(S.root);
  setData(opts);
  resize();
  if (S.W) layout(); // place the rebuilt pins before the next paint
  S.dirty.gl = true;
  syncControls();
  kick();
}

/** 'team' (flat map fitted to the team) or 'world' (spinning globe). */
export function setMapMode(mode) {
  if (!S) return;
  if (mode === 'world') go('world');
  else go('team');
}

/** Flies to a country (again: back to the whole team). */
export function focusCountry(cc) {
  if (!S) return;
  if (S.mode === 'focus' && S.focusCC === cc) go('team');
  else go('focus', cc);
  const r = S.root.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight - 90) S.root.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
}

function create() {
  const root = document.createElement('div');
  root.className = 'wmap';
  root.dataset.mode = 'team';
  root.innerHTML = `
    <canvas class="wm-gl" aria-hidden="true"></canvas>
    <canvas class="wm-lines" aria-hidden="true"></canvas>
    <canvas class="wm-fx" aria-hidden="true"></canvas>
    <div class="wm-pins"><div class="wm-people"></div><div class="wm-stacks"></div></div>
    <span class="wm-live"><i aria-hidden="true"></i><span></span></span>
    <div class="wm-zoom"><button type="button" data-zoom="1">+</button><button type="button" data-zoom="-1">−</button></div>
    <span class="wm-hint"></span>
    <span class="wm-credit"></span>
    <div class="wm-loading"><span class="wm-spinner" aria-hidden="true"></span><span class="wm-loading-t"></span></div>`;
  const $ = sel => root.querySelector(sel);
  const s = {
    root, glc: $('.wm-gl'), lc: $('.wm-lines'), fc: $('.wm-fx'), pinsEl: $('.wm-pins'), peopleEl: $('.wm-people'), stacksEl: $('.wm-stacks'),
    gl: null, b2: null, imgs: {}, geo: null, mainland: {},
    W: 0, H: 0, dpr: 1, pinR: 18,
    cam: { lon: 30, lat: 12, k: 1, m: 0 }, mode: 'team', focusCC: null, anim: null, userMoved: false,
    intro: !reducedMotion(), visible: false, ratio: 0, raf: 0, last: 0, lastFx: 0,
    dirty: { gl: true, lines: true, layout: true },
    sun: sunVector(), sunAt: Date.now(),
    members: [], groups: new Map(), placeIds: [], arcs: [], anchors: {}, arcPts: [], items: [], stackEls: new Map(), pinEls: new Map(),
    people: true, pinsOn: false, pinsAt: 0, arcT0: 0, ripples: [], prevSteps: new Map(), spun: false,
    ptrs: new Map(), drag: null, pinch: null, dragged: false, pt: { x: 0, y: 0, z: 0 },
  };
  s.lctx = s.lc.getContext('2d');
  s.fctx = s.fc.getContext('2d');
  try { setupGL(s); } catch (e) { console.warn('worldmap: WebGL unavailable', e); s.gl = null; }
  if (!s.gl) { s.b2 = s.glc.getContext('2d'); s.cam.m = 1; }

  s.ro = new ResizeObserver(() => { resize(); kick(); });
  s.ro.observe(root);
  s.io = new IntersectionObserver(es => {
    const e = es[es.length - 1];
    s.visible = e.isIntersecting;
    s.ratio = e.intersectionRatio;
    if (s.visible) { maybeIntro(); kick(); }
  }, { threshold: [0, 0.2, 0.45] });
  s.io.observe(root);
  s.glc.addEventListener('webglcontextlost', e => { e.preventDefault(); s.lost = true; });
  s.glc.addEventListener('webglcontextrestored', () => { s.lost = false; setupGL(s); load(true); });
  wire(s);
  S = s;
  load(false);
  return s;
}

/* ── Assets ── */
function load(texturesOnly) {
  const s = S;
  const img = name => new Promise((res, rej) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = `${ASSETS}${name}.webp`;
  });
  const put = (name, i) => {
    if (s.gl) { upload(s, name, i); s.has[name] = true; } else s.imgs[name] = i;
    s.dirty.gl = true;
    kick();
  };
  if (!texturesOnly) {
    fetch(`${ASSETS}geo.json`).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(geo => {
      s.geo = geo;
      for (const [cc, rings] of Object.entries(geo.countries)) {
        const big = rings.reduce((a, r) => (r.length > a.length ? r : a), []);
        s.mainland[cc] = bounds(decode(big, geo.q));
      }
      s.dirty.lines = true;
      if (!s.anim && !s.userMoved && s.mode === 'focus') Object.assign(s.cam, viewFor('focus', s.focusCC));
      kick();
    }).catch(() => {});
  }
  img('world-day').then(i => {
    put('world-day', i);
    s.ready = true;
    s.root.classList.add('ready');
    maybeIntro();
    return Promise.all(['world-night', 'latam-day', 'latam-night'].map(n => img(n).then(j => put(n, j)).catch(() => {})));
  }).catch(() => {
    s.root.classList.add('failed');
    s.root.querySelector('.wm-loading-t').textContent = t('map.offline');
  });
}
const decode = (r, q) => { const out = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; out.push([x / q, y / q]); } return out; };
function bounds(pts) {
  let w = 180, e = -180, n = -90, s = 90;
  pts.forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); n = Math.max(n, y); s = Math.min(s, y); });
  return [w, e, n, s];
}

/* ── Data ── */
function setData({ members, goal, idx, meId }) {
  const s = S;
  s.goal = goal;
  s.idx = idx;
  s.meId = meId;
  const placed = members.filter(m => placeOf(m));
  const today = m => (idx >= 0 ? m.daily[idx] : null);
  // Live celebration: someone's steps went up since the last render.
  const bursts = [];
  placed.forEach(m => {
    const v = today(m), prev = s.prevSteps.get(m.id);
    if (prev !== undefined && v != null && v > (prev || 0)) bursts.push({ id: m.id, delta: v - (prev || 0) });
    s.prevSteps.set(m.id, v);
  });
  s.members = placed;
  s.groups = new Map();
  placed.slice().sort((a, b) => (today(b) || 0) - (today(a) || 0)).forEach(m => {
    const p = placeOf(m);
    if (!s.groups.has(p)) s.groups.set(p, []);
    s.groups.get(p).push(m);
  });
  const ids = [...s.groups.keys()];
  if (ids.join() !== s.placeIds.join()) { s.placeIds = ids; s.arcs = spanningTree(ids); }
  buildPins();
  bursts.forEach(b => {
    const el = s.pinEls.get(b.id);
    if (!el || !s.pinsOn || !s.people) return;
    el.querySelector('.wm-pin-b').insertAdjacentHTML('beforeend', `<span class="wm-burst">+${compact(b.delta)}</span>`);
    const burst = el.querySelector('.wm-burst');
    setTimeout(() => burst.remove(), 2700);
    s.ripples.push({ place: placeOf(s.members.find(m => m.id === b.id)), t0: performance.now() });
  });
  const txt = (sel, v) => { const el = s.root.querySelector(sel); if (el.textContent !== v) el.textContent = v; };
  txt('.wm-live span', t('map.live'));
  txt('.wm-hint', t('map.dragHint'));
  txt('.wm-credit', t('map.credit'));
  txt('.wm-loading-t', t(s.root.classList.contains('failed') ? 'map.offline' : 'map.loading'));
  s.root.querySelector('[data-zoom="1"]').setAttribute('aria-label', t('map.zoomIn'));
  s.root.querySelector('[data-zoom="-1"]').setAttribute('aria-label', t('map.zoomOut'));
  s.root.setAttribute('role', 'group');
  s.root.setAttribute('aria-label', t('map.aria'));
  s.dirty.layout = s.dirty.lines = true;
}

/** Minimum spanning tree of the team's cities (great-circle km): the arcs that link everyone. */
function spanningTree(ids) {
  const out = [], inTree = new Set(ids.slice(0, 1));
  while (inTree.size < ids.length) {
    let best = null;
    inTree.forEach(a => ids.forEach(b => {
      if (inTree.has(b)) return;
      const d = haversine(PLACES[a].ll, PLACES[b].ll);
      if (!best || d < best.d) best = { a, b, d };
    }));
    out.push([best.a, best.b]);
    inTree.add(best.b);
  }
  return out;
}

function buildPins() {
  const s = S, D = s.pinR * 2;
  let i = 0;
  const html = [];
  s.groups.forEach(list => list.forEach(m => {
    const v = s.idx >= 0 ? m.daily[s.idx] : null;
    const done = v != null && v >= s.goal, me = m.id === s.meId, p = placeOf(m);
    const label = `${m.name} — ${placeName(p)}, ${countryName(PLACES[p].cc)}: ${v == null ? t('mate.notYet') : `${fmt(v)} ${t('unit.steps')}`}`;
    html.push(`<button type="button" class="wm-pin${me ? ' me' : ''}${v == null ? ' idle' : ''}${done ? ' done' : ''}" data-action="member" data-id="${esc(m.id)}" style="--i:${i++};--d:${D}px" aria-label="${esc(label)}">
      <span class="wm-pin-b"><span class="wm-pin-c">${ring((v || 0) / s.goal, { size: D + 8, stroke: 3, label })}${avatar(m, D, { flagged: false })}${done ? '<span class="wm-ok" aria-hidden="true">✓</span>' : ''}</span>
      <span class="wm-name">${esc(m.first)}${me ? ` · ${esc(t('common.you'))}` : ''}</span></span></button>`);
  }));
  s.peopleEl.innerHTML = html.join('');
  s.pinEls = new Map([...s.peopleEl.children].map(el => [el.dataset.id, el]));
  s.stacksEl.innerHTML = '';
  s.stackEls = new Map();
}

/* ── Size ── */
function resize() {
  const s = S, r = s.root.getBoundingClientRect();
  const W = Math.round(r.width), H = Math.round(r.height);
  if (!W || !H || (W === s.W && H === s.H)) return;
  s.W = W; s.H = H;
  s.dpr = Math.min(2, devicePixelRatio || 1);
  [s.glc, s.lc, s.fc].forEach(c => { c.width = Math.round(W * s.dpr); c.height = Math.round(H * s.dpr); });
  const R = W < 420 ? 16 : W < 700 ? 18 : 21;
  if (R !== s.pinR) { s.pinR = R; buildPins(); }
  if (s.intro) Object.assign(s.cam, viewFor('world'), { lon: wrap(teamCenter()[0] + 120), lat: 14 });
  else if (!s.anim) {
    if (s.mode === 'world') Object.assign(s.cam, viewFor('world'), { lon: s.cam.lon, lat: s.cam.lat });
    else if (!s.userMoved) Object.assign(s.cam, viewFor(s.mode, s.focusCC));
  }
  camChanged();
}

/* ── Views ── */
function teamBounds(ids = S.placeIds) {
  if (!ids.length) return [-105, -40, 25, -40];
  const pts = ids.map(id => [PLACES[id].ll[1], PLACES[id].ll[0]]);
  const [w, e, n, s] = bounds(pts);
  return [w - 1.5, e + 1.5, n + 1.5, s - 1.5];
}
const teamCenter = () => { const [w, e, n, s] = teamBounds(); return [(w + e) / 2, (n + s) / 2]; };

function fit([w, e, n, s], maxK) {
  const { W, H, pinR: r } = S;
  const side = 2 * r + 14, pad = { t: 4 * r + 42, r: side, b: 34, l: side }; // room for pins stacked above the cities
  const k = clamp(Math.min((W - pad.l - pad.r) / Math.max(1, e - w), (H - pad.t - pad.b) / Math.max(1, n - s)), 1, maxK);
  return { lon: (w + e) / 2 + (pad.r - pad.l) / 2 / k, lat: (n + s) / 2 + (pad.t - pad.b) / 2 / k, k, m: 1 };
}
const minK = () => Math.max(S.W / 360, S.H / 170);

function viewFor(mode, cc) {
  const { W, H } = S;
  if (mode === 'world') {
    if (!S.gl) return { lon: teamCenter()[0] + 40, lat: 8, k: minK(), m: 1 };
    return { lon: teamCenter()[0], lat: -8, k: Math.min(W, H) * 0.4 * DEG, m: 0 };
  }
  if (mode === 'focus' && cc) {
    const ids = S.placeIds.filter(id => PLACES[id].cc === cc);
    let b = teamBounds(ids);
    const land = S.mainland[cc];
    if (land) b = [Math.min(b[0], land[0]), Math.max(b[1], land[1]), Math.max(b[2], land[2]), Math.min(b[3], land[3])];
    return fit(b, 16);
  }
  return fit(teamBounds(), 30);
}

/* ── Transitions ── */
// A transition is a list of segments; each captures the camera when it starts.
const spin = (to, dur) => ({ dur, start: from => { const dl = wrap(to.lon - from.lon); return e => ({ ...from, lon: wrap(from.lon + dl * e), lat: from.lat + (to.lat - from.lat) * e }); } });
const morph = (to, dur) => ({
  dur, start: from => {
    const dl = wrap(to.lon - from.lon);
    return e => ({ lon: wrap(from.lon + dl * e), lat: from.lat + (to.lat - from.lat) * e, k: from.k * (to.k / from.k) ** e, m: from.m + (to.m - from.m) * e });
  },
});
const glide = to => ({
  dur: 0, start(from) {
    const vw = vanWijk([from.lon, from.lat, S.W / from.k], [to.lon, to.lat, S.W / to.k]);
    this.dur = clamp(vw.S * 650, 450, 2000);
    return e => { const [lon, lat, w] = vw.f(e); return { lon: wrap(lon), lat, k: S.W / w, m: 1 }; };
  },
});
const pause = dur => ({ dur, start: from => () => from });

function go(mode, cc = null, { intro = false } = {}) {
  const s = S;
  if (!s.W) { s.mode = mode; s.focusCC = cc; return; }
  const to = viewFor(mode, cc);
  const from = s.cam;
  const segs = [];
  if (mode === 'world') {
    if (from.m > 0) segs.push(morph({ ...to, lon: from.lon }, 1300));
    else segs.push(spin(to, 900));
  } else if (from.m < 1) {
    if (intro) segs.push(pause(350));
    segs.push(spin({ ...to, lat: -6 }, intro ? 1700 : 1000), morph(to, intro ? 1900 : 1500));
  } else segs.push(glide(to));
  s.mode = mode;
  s.focusCC = cc;
  s.userMoved = false;
  s.intro = false;
  hidePins();
  syncControls();
  const done = () => { showPins(true); if (mode === 'world') s.spinAt = performance.now(); };
  if (reducedMotion()) { Object.assign(s.cam, to); s.anim = null; camChanged(); done(); }
  else s.anim = { segs, i: 0, t0: 0, f: null, done };
  kick();
}

function maybeIntro() {
  const s = S;
  if (!s || !s.ready || !s.W) return;
  if (s.intro && s.ratio >= 0.4) go('team', null, { intro: true });
  else if (!s.intro && !s.pinsOn && !s.anim) showPins(false);
}

function syncControls() {
  const s = S;
  s.root.dataset.mode = s.mode;
  const view = mapMode();
  document.querySelectorAll('[data-action="map-mode"]').forEach(b => {
    const on = b.dataset.k === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  document.querySelectorAll('[data-action="map-focus"]').forEach(b => b.classList.toggle('on', s.mode === 'focus' && b.dataset.cc === s.focusCC));
}

function showPins(drop) {
  const s = S;
  s.pinsOn = true;
  s.pinsAt = performance.now();
  if (!s.arcT0) s.arcT0 = s.pinsAt;
  s.pinsEl.classList.add('show');
  clearTimeout(s.dropT);
  if (drop && !reducedMotion()) {
    s.pinsEl.classList.add('drop');
    s.dropT = setTimeout(() => s.pinsEl.classList.remove('drop'), 2000);
  }
  s.dirty.layout = true;
}
function hidePins() {
  S.pinsOn = false;
  S.pinsEl.classList.remove('show', 'drop');
  hideTip();
}

/* ── Interaction ── */
function wire(s) {
  const root = s.root;
  const zoomAt = (x, y, f) => {
    const c = s.cam, k = clamp(c.k * f, minK(), 40);
    const lon = c.lon + (x - s.W / 2) / c.k, lat = c.lat - (y - s.H / 2) / c.k;
    c.lon = wrap(lon - (x - s.W / 2) / k);
    c.lat = clamp(lat + (y - s.H / 2) / k, -70, 70);
    c.k = k;
    s.userMoved = true;
    camChanged();
    kick();
  };
  const local = e => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  root.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.wm-zoom')) return;
    s.ptrs.set(e.pointerId, local(e));
    if (s.ptrs.size === 1) s.drag = { p0: local(e), cam: { ...s.cam }, moved: false, id: e.pointerId };
    if (s.ptrs.size === 2 && s.cam.m === 1) {
      const [a, b] = [...s.ptrs.values()];
      s.pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k0: s.cam.k };
      s.drag = null;
    }
  });
  root.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && !s.ptrs.size) {
      const pin = e.target.closest('.wm-pin');
      if (pin && s.pinsOn) showTip(e.clientX, e.clientY, tipHtml(pin.dataset.id)); else hideTip();
    }
    if (!s.ptrs.has(e.pointerId)) return;
    s.ptrs.set(e.pointerId, local(e));
    if (s.pinch && s.ptrs.size >= 2) {
      const [a, b] = [...s.ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      s.anim = null;
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (s.pinch.k0 * (d / s.pinch.d0)) / s.cam.k);
      return;
    }
    const g = s.drag;
    if (!g || g.id !== e.pointerId) return;
    const [x, y] = local(e), dx = x - g.p0[0], dy = y - g.p0[1];
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      g.moved = true;
      s.anim = null;
      g.cam = { ...s.cam };
      g.p0 = [x, y];
      try { root.setPointerCapture(e.pointerId); } catch { /* already released */ }
      hideTip();
      root.classList.add('grabbing');
      return;
    }
    const c = s.cam;
    if (c.m < 1) {
      const R = c.k / DEG;
      c.lon = wrap(g.cam.lon - dx / R / DEG);
      c.lat = clamp(g.cam.lat + dy / R / DEG, -65, 65);
      s.spun = true;
      root.classList.add('spun');
    } else {
      c.lon = wrap(g.cam.lon - dx / c.k);
      c.lat = clamp(g.cam.lat + dy / c.k, -70, 70);
      s.userMoved = true;
    }
    if (!s.pinsOn && !s.anim) showPins(false);
    camChanged();
    kick();
  });
  const end = e => {
    s.ptrs.delete(e.pointerId);
    if (s.ptrs.size < 2) s.pinch = null;
    if (s.drag && s.drag.id === e.pointerId) {
      if (s.drag.moved) { s.dragged = true; setTimeout(() => { s.dragged = false; }, 0); }
      s.drag = null;
      s.spinAt = performance.now() + 1500; // let the globe rest a moment after a spin
      root.classList.remove('grabbing');
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
  // A drag that started on a pin must not open it.
  root.addEventListener('click', e => {
    if (s.dragged) { e.stopPropagation(); e.preventDefault(); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) {
      const f = z.dataset.zoom === '1' ? 1.8 : 1 / 1.8;
      const to = { ...s.cam, k: clamp(s.cam.k * f, minK(), 40), m: 1 };
      s.userMoved = true;
      if (reducedMotion()) { Object.assign(s.cam, to); camChanged(); } else s.anim = { segs: [glide(to)], i: 0, t0: 0, done: () => {} };
      kick();
      return;
    }
    const st = e.target.closest('.wm-stack');
    if (st) {
      e.stopPropagation();
      if (s.mode === 'world') return go('team');
      const ids = st.dataset.k.split('+');
      const to = fit(teamBounds(ids), 24);
      s.userMoved = true;
      hidePins();
      s.anim = { segs: [glide(to)], i: 0, t0: 0, done: () => showPins(true) };
      kick();
    }
  }, true);
  root.addEventListener('wheel', e => {
    if (!e.ctrlKey || s.cam.m < 1) return; // trackpad pinch / ctrl+wheel; plain wheel keeps scrolling the page
    e.preventDefault();
    s.anim = null;
    const [x, y] = local(e);
    zoomAt(x, y, Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
}

function tipHtml(id) {
  const m = S.members.find(x => x.id === id);
  if (!m) return '';
  const pid = placeOf(m), P = PLACES[pid];
  const v = S.idx >= 0 ? m.daily[S.idx] : null;
  return `<div class="tip-h">${esc(m.name)}</div>
    <div class="tip-muted">📍 ${esc(placeName(pid))} · ${esc(countryName(P.cc))}</div>
    <div class="tip-muted">${sunUp(P.ll, S.sun) ? '☀️' : '🌙'} ${esc(t('map.localTime', { time: localTime(P.tz) }))}</div>
    ${tipRow(v == null ? t('mate.notYet') : fmt(v), v != null && v >= S.goal ? t('tip.stepsGoal') : t('common.today'), 'k-series')}`;
}

/* ═════════════ Frame loop ═════════════ */
function camChanged() { S.dirty.gl = S.dirty.lines = S.dirty.layout = true; }
function kick() { if (S && !S.raf && S.root.isConnected) S.raf = requestAnimationFrame(frame); }

function frame(now) {
  const s = S;
  s.raf = 0;
  if (!s.root.isConnected || !s.W) return;
  const dt = Math.min(64, now - (s.last || now));
  s.last = now;
  let moving = false;
  if (s.anim) {
    const a = s.anim;
    if (!a.f) { a.f = a.segs[a.i].start({ ...s.cam }); a.t0 = now; }
    const seg = a.segs[a.i], x = Math.min(1, (now - a.t0) / Math.max(1, seg.dur));
    Object.assign(s.cam, a.f(ease(x)));
    if (x >= 1) {
      a.i += 1;
      a.f = null;
      if (a.i >= a.segs.length) { s.anim = null; a.done(); }
    }
    camChanged();
    moving = true;
  } else if (s.mode === 'world' && s.cam.m === 0 && !s.drag && s.visible && !reducedMotion() && now > (s.spinAt || 0)) {
    s.cam.lon = wrap(s.cam.lon - dt * 0.006); // ≈ one turn a minute
    s.cam.lat += (-8 - s.cam.lat) * Math.min(1, dt * 0.002);
    camChanged();
    moving = true;
  }
  if (Date.now() - s.sunAt > 60000) { s.sun = sunVector(); s.sunAt = Date.now(); s.dirty.gl = true; }
  if (s.dirty.layout) layout();
  if (s.dirty.gl) drawBase();
  if (s.dirty.lines) drawLines();
  if (moving || now - s.lastFx > 30) { drawFx(now); s.lastFx = now; }
  const animated = moving || !reducedMotion() || s.ripples.length;
  if (s.visible && document.visibilityState === 'visible' && animated) s.raf = requestAnimationFrame(frame);
}

/* ── Imagery ── */
function drawBase() {
  const s = S, c = s.cam;
  s.dirty.gl = false;
  if (s.gl) {
    if (s.lost) return;
    const g = s.gl, U = s.U;
    g.viewport(0, 0, s.glc.width, s.glc.height);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.uniform4f(U.uCam, c.lon, c.lat, c.k, c.m);
    g.uniform2f(U.uView, s.W, s.H);
    g.uniform4f(U.uInset, ...INSET);
    g.uniform3f(U.uSun, ...s.sun);
    g.uniform4f(U.uFlags, s.has['world-night'] ? 1 : 0, s.has['latam-day'] ? 1 : 0, s.has['latam-night'] ? 1 : 0, c.m);
    s.tex.forEach((tx, i) => { g.activeTexture(g.TEXTURE0 + i); g.bindTexture(g.TEXTURE_2D, tx); });
    g.drawElements(g.TRIANGLES, s.nIdx, g.UNSIGNED_SHORT, 0);
    return;
  }
  // No WebGL: flat map only, daylight imagery.
  const b = s.b2, day = s.imgs['world-day'], ins = s.imgs['latam-day'];
  b.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  b.clearRect(0, 0, s.W, s.H);
  if (!day) return;
  const x0 = s.W / 2 + c.k * wrap(-180 - c.lon), y0 = s.H / 2 - c.k * (90 - c.lat);
  [-360, 0, 360].forEach(o => b.drawImage(day, x0 + o * c.k, y0, 360 * c.k, 180 * c.k));
  if (ins && c.k * s.dpr > 6) {
    const [w, e, n, so] = INSET;
    b.drawImage(ins, s.W / 2 + c.k * wrap(w - c.lon), s.H / 2 - c.k * (n - c.lat), (e - w) * c.k, (n - so) * c.k);
  }
}

/* ── Borders, countries, home areas, labels ── */
function trace(ctx, rings, q) {
  const { cam, W, H, pt } = S;
  const zMin = cam.m > 0.5 ? -2 : 0.03, jump = 90 * cam.k;
  ctx.beginPath();
  for (const r of rings) {
    let x = 0, y = 0, pen = false, lx = 0;
    for (let i = 0; i < r.length; i += 2) {
      x += r[i]; y += r[i + 1];
      project(cam, W, H, x / q, y / q, pt);
      const vis = pt.z > zMin;
      if (vis && pen && Math.abs(pt.x - lx) < jump) ctx.lineTo(pt.x, pt.y);
      else if (vis) ctx.moveTo(pt.x, pt.y);
      pen = vis;
      lx = pt.x;
    }
  }
}

function drawLines() {
  const s = S, c = s.lctx, { cam, W, H, geo } = s;
  s.dirty.lines = false;
  c.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  if (!geo) return;
  const fade = (2 * cam.m - 1) ** 2;      // lines step aside while the globe unrolls
  if (fade < 0.02) return;
  const flat = cam.m > 0.9, q = geo.q;
  const team = [...new Set(s.placeIds.map(id => PLACES[id].cc))];
  c.lineJoin = c.lineCap = 'round';
  c.globalAlpha = fade;

  if (flat && cam.k > 3) {
    for (const cc of team) {
      if (!geo.states[cc]) continue;
      trace(c, geo.states[cc], q);
      c.setLineDash([2, 3]);
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.lineWidth = 0.7;
      c.stroke();
      c.setLineDash([]);
    }
  }
  trace(c, geo.borders, q);
  c.strokeStyle = `rgba(255,255,255,${flat ? 0.34 : 0.22})`;
  c.lineWidth = 0.8;
  c.stroke();

  for (const cc of team) {
    if (!geo.countries[cc]) continue;
    const on = s.mode !== 'focus' || s.focusCC === cc;
    trace(c, geo.countries[cc], q);
    if (flat) { c.fillStyle = `rgba(${GOLD},${on ? 0.08 : 0.03})`; c.fill('evenodd'); }
    c.strokeStyle = `rgba(${GOLD},${on ? 0.16 : 0.06})`;
    c.lineWidth = 5;
    c.stroke();
    c.strokeStyle = `rgba(${GOLD},${on ? 0.8 : 0.35})`;
    c.lineWidth = 1.2;
    c.stroke();
  }
  if (flat && cam.k > 2.4) {
    for (const id of s.placeIds) {
      if (!geo.places[id]) continue;
      trace(c, geo.places[id], q);
      c.fillStyle = `rgba(${GOLD},0.34)`;
      c.fill('evenodd');
      c.strokeStyle = `rgba(${GOLD},0.95)`;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  if (flat && cam.k > 2.2) labels(c, team);
  c.globalAlpha = 1;
}

function labels(c, team) {
  const s = S, { geo, pt, items } = s;
  const size = s.cam.k > 7 ? 12 : 10.5;
  c.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  if ('letterSpacing' in c) c.letterSpacing = '0.16em';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const cc of team) {
    const at = geo.labels[cc];
    if (!at) continue;
    project(s.cam, s.W, s.H, at[0], at[1], pt);
    const text = countryName(cc).toLocaleUpperCase(locale());
    const w = c.measureText(text).width + 8, h = size + 6;
    const free = (x, y) => x - w / 2 > 4 && x + w / 2 < s.W - 4 && y - h / 2 > 4 && y + h / 2 < s.H - 30
      && !items.some(it => it.vis && it.hw && overlapX(it, { x, hw: w / 2 }, 0) > 0 && overlapY(it, { y, top: h / 2, bot: h / 2 }, 0) > 0);
    const spot = [[0, 0], [0, 26], [0, -26], [w / 2 + 24, 0], [-w / 2 - 24, 0], [0, 48], [0, -48], [w / 2 + 24, 30], [-w / 2 - 24, 30], [0, 72]].map(([dx, dy]) => [pt.x + dx, pt.y + dy]).find(([x, y]) => free(x, y));
    if (!spot) continue;
    c.shadowColor = 'rgba(0,0,0,0.75)';
    c.shadowBlur = 6;
    c.fillStyle = s.mode === 'focus' && s.focusCC !== cc ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.9)';
    c.fillText(text, spot[0], spot[1]);
    c.shadowBlur = 0;
  }
  if ('letterSpacing' in c) c.letterSpacing = '0px';
}

/* ── Pins: anchors, packing, collisions ── */
const tagWidth = m => (m.first.length + (m.id === S.meId ? t('common.you').length + 3 : 0)) * 6.3 + 16;

function packOffsets(n, sp) {
  const fixed = {
    1: [[0, 0]], 2: [[-0.55, 0], [0.55, 0]], 3: [[-0.55, 0.3], [0.55, 0.3], [0, -0.62]],
    4: [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]],
  }[n];
  if (fixed) return fixed.map(([x, y]) => [x * sp, y * sp]);
  return Array.from({ length: n }, (_, i) => { const r = 0.62 * Math.sqrt(i + 0.5), a = i * 2.39996; return [Math.cos(a) * r * sp, Math.sin(a) * r * sp]; });
}

function layout() {
  const s = S, { cam, W, H, pinR: r } = s;
  s.dirty.layout = false;
  const pt = s.pt;
  s.anchors = {};
  for (const id of s.placeIds) {
    const [lat, lon] = PLACES[id].ll;
    project(cam, W, H, lon, lat, pt);
    s.anchors[id] = { x: pt.x, y: pt.y, z: pt.z, vis: facing(pt.z, cam.m) && pt.x > -20 && pt.x < W + 20 && pt.y > -20 && pt.y < H + 20 };
  }
  s.arcPts = s.arcs.map(([a, b]) => arcPoints(a, b));
  const people = cam.m > 0.95 && cam.k >= 2.6;
  if (people !== s.people) { s.people = people; s.root.classList.toggle('stacked', !people); }
  const items = [];
  if (people) {
    s.groups.forEach((list, pid) => {
      const A = s.anchors[pid], sp = 2 * r + 16;
      const offs = packOffsets(list.length, sp), low = Math.max(...offs.map(o => o[1]));
      list.forEach((m, i) => items.push({
        el: s.pinEls.get(m.id), ax: A.x, ay: A.y, vis: A.vis, core: r + 4, half: r + 4,
        hw: Math.max(r + 4, tagWidth(m) / 2), top: r + 4, bot: r + 22,
        px: A.x + offs[i][0], py: A.y - (r + 18 + low) + offs[i][1],
      }));
    });
  } else {
    // Group nearby cities into stacks of faces.
    const clusters = [];
    s.placeIds.filter(id => s.anchors[id].vis).forEach(id => {
      const A = s.anchors[id];
      const c = clusters.find(k => Math.hypot(k.x - A.x, k.y - A.y) < 2 * r + 14);
      if (c) { c.ids.push(id); c.x = (c.x * (c.ids.length - 1) + A.x) / c.ids.length; c.y = (c.y * (c.ids.length - 1) + A.y) / c.ids.length; }
      else clusters.push({ ids: [id], x: A.x, y: A.y });
    });
    const keep = new Set();
    clusters.forEach(c => {
      const key = c.ids.sort().join('+');
      keep.add(key);
      let el = s.stackEls.get(key);
      const list = c.ids.flatMap(id => s.groups.get(id));
      if (!el) {
        s.stacksEl.insertAdjacentHTML('beforeend', `<button type="button" class="wm-stack" data-k="${key}" aria-label="${esc(list.map(m => m.first).join(', '))}">
          <span class="wm-faces">${list.slice(0, 3).map(m => avatar(m, 26, { flagged: false })).join('')}</span>${list.length > 1 ? `<b>${list.length}</b>` : ''}</button>`);
        el = s.stacksEl.lastElementChild;
        s.stackEls.set(key, el);
      }
      const w = el._w || (el._w = el.offsetWidth) || 34, h = el._h || (el._h = el.offsetHeight) || 34;
      c.ids.forEach(id => items.push({ el: null, ax: s.anchors[id].x, ay: s.anchors[id].y, vis: true, link: key }));
      items.push({ el, key, ax: null, ay: null, vis: true, hw: w / 2 + 3, top: h / 2 + 3, bot: h / 2 + 3, core: h / 2, px: c.x, py: c.y - h / 2 - 18, halfW: w / 2, halfH: h / 2 });
    });
    s.stackEls.forEach((el, key) => { if (!keep.has(key)) { el.remove(); s.stackEls.delete(key); } });
  }
  relax(items.filter(it => it.el), W, H);
  // Stack leader lines follow their stack.
  items.filter(it => it.link).forEach(it => { const st = items.find(x => x.key === it.link); it.x = st.x; it.y = st.y; it.core = st.core; });
  items.forEach(it => {
    if (!it.el) return;
    const hw = it.halfW || it.half, hh = it.halfH || it.half;
    it.el.style.transform = `translate3d(${(it.x - hw).toFixed(1)}px, ${(it.y - hh).toFixed(1)}px, 0)`;
    it.el.style.zIndex = Math.round(it.y);
    it.el.classList.toggle('off', !it.vis);
  });
  s.items = items;
  s.dirty.lines = true; // labels dodge the pins
}

// Each pin is a box (bubble + name tag below it): spring towards its spot, then push overlapping boxes apart
// along the axis that overlaps least, keep the city dots uncovered and everything inside the frame.
const overlapX = (a, b, gap) => a.hw + b.hw + gap - Math.abs(a.x - b.x);
const overlapY = (a, b, gap) => Math.min(a.y + a.bot, b.y + b.bot) - Math.max(a.y - a.top, b.y - b.top) + gap;
function relax(items, W, H) {
  items.forEach(it => { it.x = it.px; it.y = it.py; });
  const live = items.filter(it => it.vis);
  const dots = S.placeIds.map(id => S.anchors[id]).filter(a => a.vis).map(a => ({ ...a, hw: 6, top: 6, bot: 6 }));
  for (let n = 0; n < 90; n++) {
    for (const it of live) {
      it.x += (it.px - it.x) * 0.04;
      it.y += (it.py - it.y) * 0.04;
      for (const a of dots) {
        if (a.x === it.ax && a.y === it.ay) continue;
        const ox = overlapX(it, a, 2), oy = overlapY(it, a, 2);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) it.x += it.x < a.x ? -ox : ox; else it.y += it.y < a.y ? -oy : oy;
      }
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], ox = overlapX(a, b, 3), oy = overlapY(a, b, 3);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) { const d = (a.x < b.x || (a.x === b.x && i % 2) ? -ox : ox) / 2; a.x += d; b.x -= d; }
      else { const d = (a.y < b.y ? -oy : oy) / 2; a.y += d; b.y -= d; }
    }
    for (const it of live) {
      it.x = clamp(it.x, it.hw + 2, W - it.hw - 2);
      it.y = clamp(it.y, it.top + 2, H - it.bot - 26);
    }
  }
}

/** Great-circle arc between two cities, lifted into a bow in screen space. */
function arcPoints(a, b) {
  const s = S, N = 40;
  const A = unit(...PLACES[a].ll), B = unit(...PLACES[b].ll);
  const om = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)), so = Math.sin(om) || 1;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N, wa = Math.sin((1 - f) * om) / so, wb = Math.sin(f * om) / so;
    const x = wa * A[0] + wb * B[0], y = wa * A[1] + wb * B[1], z = wa * A[2] + wb * B[2];
    project(s.cam, s.W, s.H, Math.atan2(y, x) / DEG, Math.asin(clamp(z, -1, 1)) / DEG, s.pt);
    pts.push({ x: s.pt.x, y: s.pt.y, v: facing(s.pt.z, s.cam.m) });
  }
  const p0 = pts[0], p1 = pts[N];
  let nx = -(p1.y - p0.y), ny = p1.x - p0.x;
  const len = Math.hypot(nx, ny) || 1;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const lift = Math.min(0.22 * len, 90);
  pts.forEach((p, i) => { const h = Math.sin((Math.PI * i) / N) * lift; p.x += (nx / len) * h; p.y += (ny / len) * h; });
  return pts;
}

/* ── Effects: atmosphere, arcs with comets, city pulses, leader lines ── */
function drawFx(now) {
  const s = S, c = s.fctx, { cam, W, H } = s;
  c.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const still = reducedMotion();
  const fade = (2 * cam.m - 1) ** 2;

  if (s.gl && cam.m < 1) {
    const R = cam.k / DEG, a = (1 - cam.m) ** 2;
    if (R < 5000 && a > 0.01) {
      const g = c.createRadialGradient(W / 2, H / 2, R * 0.9, W / 2, H / 2, R * 1.2);
      g.addColorStop(0, 'rgba(120,180,255,0)');
      g.addColorStop(0.3, `rgba(120,180,255,${0.5 * a})`);
      g.addColorStop(0.55, `rgba(80,140,255,${0.16 * a})`);
      g.addColorStop(1, 'rgba(80,140,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
  }
  if (!s.arcT0 || fade < 0.02) return;
  c.globalAlpha = fade;
  c.lineCap = 'round';

  // Arcs: dotted trail that keeps flowing, drawn in on first show, with a comet riding each one.
  const reveal = still ? 1 : clamp((now - s.arcT0) / 1400, 0, 1);
  s.arcPts.forEach((pts, k) => {
    const upto = Math.floor(ease(reveal) * (pts.length - 1));
    c.beginPath();
    let pen = false;
    for (let i = 0; i <= upto; i++) {
      const p = pts[i];
      if (!p.v) { pen = false; continue; }
      if (pen) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
      pen = true;
    }
    c.setLineDash([2, 6]);
    c.lineDashOffset = still ? 0 : -now / 45;
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1.6;
    c.stroke();
    c.setLineDash([]);
    if (still || reveal < 1) return;
    const period = 2600 + k * 450, u = ((now / period + k * 0.37) % 1) * 1.25; // 25% rest between laps
    if (u > 1) return;
    for (let j = 14; j >= 0; j--) {
      const f = u - j * 0.014;
      if (f < 0) continue;
      const fi = f * (pts.length - 1), i0 = Math.floor(fi), p = pts[i0], q = pts[Math.min(pts.length - 1, i0 + 1)];
      if (!p.v || !q.v) continue;
      const x = p.x + (q.x - p.x) * (fi - i0), y = p.y + (q.y - p.y) * (fi - i0);
      if (j === 0) {
        const g = c.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, `rgba(${GOLD},0.95)`);
        g.addColorStop(1, `rgba(${GOLD},0)`);
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, 10, 0, 2 * Math.PI); c.fill();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(x, y, 2.2, 0, 2 * Math.PI); c.fill();
      } else {
        c.fillStyle = `rgba(${GOLD},${(1 - j / 15) * 0.75})`;
        c.beginPath(); c.arc(x, y, 2.4 - j * 0.12, 0, 2 * Math.PI); c.fill();
      }
    }
  });

  // Leader lines from each city to its pins.
  const shown = s.pinsOn ? clamp((now - s.pinsAt - 250) / 500, 0, 1) : 0;
  if (shown > 0) {
    c.strokeStyle = `rgba(255,255,255,${0.85 * shown})`;
    c.lineWidth = 1.3;
    c.beginPath();
    s.items.forEach(it => {
      if (!it.vis || it.ax == null) return;
      const dx = it.x - it.ax, dy = it.y - it.ay, d = Math.hypot(dx, dy);
      if (d <= it.core + 2) return;
      c.moveTo(it.ax, it.ay);
      c.lineTo(it.x - (dx / d) * it.core, it.y - (dy / d) * it.core);
    });
    c.stroke();
  }

  // City dots with a radar ping (and a big gold one when someone just logged steps).
  s.ripples = s.ripples.filter(r => now - r.t0 < 2200);
  s.placeIds.forEach((id, k) => {
    const A = s.anchors[id];
    if (!A || !A.vis) return;
    if (!still) {
      const f = ((now / 2600) + k * 0.23) % 1;
      c.strokeStyle = `rgba(${GOLD},${0.75 * (1 - f)})`;
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(A.x, A.y, 4 + f * 18, 0, 2 * Math.PI); c.stroke();
    }
    s.ripples.filter(r => r.place === id).forEach(r => {
      const f = (now - r.t0) / 2200;
      c.strokeStyle = `rgba(${GOLD},${1 - f})`;
      c.lineWidth = 3 * (1 - f) + 1;
      c.beginPath(); c.arc(A.x, A.y, 6 + f * 60, 0, 2 * Math.PI); c.stroke();
    });
    c.fillStyle = `rgb(${GOLD})`;
    c.strokeStyle = '#fff';
    c.lineWidth = 1.6;
    c.beginPath(); c.arc(A.x, A.y, 4, 0, 2 * Math.PI); c.fill(); c.stroke();
  });
  c.globalAlpha = 1;
}
