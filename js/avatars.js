// Avatar library — 5 female + 5 male illustrated faces built from shared parts.
// Every shape stays inside the 64×64 circle (the shirt is closed with an arc of the circle), so the SVG needs no
// clipPath or ids and can be repeated anywhere: HTML avatars, sheets, or nested inside the chart SVGs.

const darken = (hex, k) => `#${[1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
const fill = (c, d) => `<path d="${d}" fill="${c}"/>`;
const dots = (c, list) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('');

/* ── Hair styles: back layer (behind the head) and front layer (over the forehead) ── */
const STYLE = {
  long: {
    back: c => fill(c, 'M18.4 30C17.6 16.5 24 10.6 32 10.6S46.4 16.5 45.6 30l1 17.6C41.5 50 22.5 50 17.4 47.6Z'),
    front: c => fill(c, 'M20.7 30.5C19.8 19.5 25 14.2 32 14.2s12.2 5.3 11.3 16.3c-.8-5-2.4-8.6-5.6-10.8-2.4 1-4.4-.6-5.7-2.6-1.3 2-3.3 3.6-5.7 2.6-3.2 2.2-4.8 5.8-5.6 10.8Z'),
  },
  curly: {
    back: c => `<ellipse cx="32" cy="26" rx="14.5" ry="13.5" fill="${c}"/>` + dots(c, [[20, 24, 8.5], [24.5, 15.5, 8.5], [32, 12, 9], [39.5, 15.5, 8.5], [44, 24, 8.5], [45.5, 33, 7], [18.5, 33, 7], [21, 40, 5.5], [43, 40, 5.5]]),
    front: c => dots(c, [[24.6, 19.6, 4.3], [29.4, 17.2, 4.5], [34.6, 17.2, 4.5], [39.4, 19.6, 4.3]]),
  },
  bob: {
    back: c => fill(c, 'M18.6 31C17.8 17.2 24.4 11.4 32 11.4S46.2 17.2 45.4 31l.4 9.6c.1 1.6-1 2.6-2.4 2.6H20.6c-1.4 0-2.5-1-2.4-2.6Z'),
    front: c => fill(c, 'M20.5 27.5C20 18.4 25.3 13.4 32 13.4s12 5 11.5 14.1c-1.6-2.6-3.8-3.8-6.8-4H27.3c-3 .2-5.2 1.4-6.8 4Z'),
  },
  bun: {
    ears: true,
    back: c => `<circle cx="32" cy="11" r="6.4" fill="${c}"/>`,
    front: c => fill(c, 'M20.8 29.5C19.6 19 25 13.4 32 13.4s12.4 5.6 11.2 16.1c-.7-4.8-2.3-8-5-9.6-3.6-1.4-8.8-1.4-12.4 0-2.7 1.6-4.3 4.8-5 9.6Z'),
  },
  wavy: {
    back: c => fill(c, 'M18.4 29C17.6 15.6 24.6 10.6 32.4 10.6c8.4 0 14.2 5.4 13.2 18.4-.3 4 1.9 7 .8 11-.8 3 1 5.4-.6 7.9-5.8 2.6-21.8 2.6-27.6 0-1.6-2.5.2-4.9-.6-7.9-1.1-4 1.1-7 .8-11Z'),
    front: c => fill(c, 'M20.7 30C19.6 18.6 25.6 13.6 33 13.6c7.6.2 11.4 6 10.2 16.4-.6-4-1.7-6.6-3.3-8.4-4.6 1-10.4-.6-14.4-3.8-2.4 3.2-4 7.2-4.8 12.2Z'),
  },
  short: {
    ears: true,
    front: c => fill(c, 'M20.6 29.2C19.4 18.4 25 12.6 32 12.6s12.6 5.8 11.4 16.6c-.7-3.8-1.9-6.4-3.7-8-4.6 1.4-11 1.4-15.4-.6-1.9 1.8-3.1 4.6-3.7 8.6Z'),
  },
  crop: {
    ears: true,
    front: c => fill(c, 'M20.8 28.6C19.8 18.2 25.2 12.8 32 12.8s12.2 5.4 11.2 15.8c-.9-3.6-2.2-6-4-7.4-4.4.6-10.2.6-14.4 0-1.8 1.4-3.1 3.8-4 7.4Z'),
  },
  coils: {
    ears: true,
    front: c => fill(c, 'M21 27.5C20.4 19.4 25.4 14.2 32 14.2s11.6 5.2 11 13.3c-1.6-3.6-5.2-5.6-11-5.6s-9.4 2-11 5.6Z')
      + dots(c, [[23.4, 20.4, 3.6], [26.6, 16.4, 3.9], [31.2, 14.4, 4.1], [36.2, 14.8, 4], [40.2, 17.8, 3.8], [42.2, 22.4, 3.3], [21.8, 24.6, 2.8]]),
  },
  bald: {
    ears: true,
    front: c => fill(c, 'M20.4 32c-1.6-6.4-.4-11.4 3.4-14-.9 3.8-.9 7.6.2 12ZM43.6 32c1.6-6.4.4-11.4-3.4-14 .9 3.8.9 7.6-.2 12Z')
      + '<ellipse cx="26.6" cy="19.6" rx="3.2" ry="1.5" fill="#fff" opacity=".35" transform="rotate(-24 26.6 19.6)"/>',
  },
  quiff: {
    ears: true,
    front: c => fill(c, 'M20.6 29.4C19 17.6 24.6 10.4 33 10.6c7.4.2 12 6 10.4 18.8-.6-3.8-1.7-6.4-3.3-8-3.2-.4-6.4-1.4-9-3.2-1.2 1.6-3.4 2.8-6.2 3.4-2 2-3.6 4.6-4.3 7.8Z'),
  },
};

/* ── Accessories ── */
const EXTRA = {
  glasses: '<g fill="#fff" fill-opacity=".18" stroke="#2d2a32" stroke-width="1.3"><rect x="23.3" y="26.4" width="8.3" height="6.4" rx="2.6"/><rect x="32.4" y="26.4" width="8.3" height="6.4" rx="2.6"/></g><path d="M31.6 28.6q.4-.7.8 0" fill="none" stroke="#2d2a32" stroke-width="1.2"/>',
  hoops: '<g fill="none" stroke="#f2b632" stroke-width="1.1"><circle cx="21" cy="34.4" r="1.8"/><circle cx="43" cy="34.4" r="1.8"/></g>',
  freckles: '<g fill="#b8663f" opacity=".55">' + [[24.6, 32.8], [26.2, 33.7], [24.9, 34.7], [39.4, 32.8], [37.8, 33.7], [39.1, 34.7]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".6"/>`).join('') + '</g>',
};
const beard = c => fill(c, 'M21.2 29.5c.2 9 4.6 13.6 10.8 13.6s10.6-4.6 10.8-13.6c-1 4-2.6 7.4-5.6 8.8-1.6-.8-3.4-1-5.2-.8-1.8-.2-3.6 0-5.2.8-3-1.4-4.6-4.8-5.6-8.8Z');
const moustache = c => fill(c, 'M27.4 35.8c1.6-2 3.4-2.2 4.6-1.2 1.2-1 3-.8 4.6 1.2-1.6-.2-3.2 0-4.6.6-1.4-.6-3-.8-4.6-.6Z');

function draw(a) {
  const st = STYLE[a.style];
  const shade = darken(a.skin, 0.13);
  const ink = a.dark ? '#140b08' : '#2a1b18';
  const lip = a.lip || (a.g === 'f' ? '#c2475a' : '#9a3b34');
  const brow = a.brow || (a.dark ? '#140b08' : darken(a.hair, 0.15));
  const has = k => (a.extras || []).includes(k);
  let s = `<circle cx="32" cy="32" r="32" fill="${a.bg}"/>`;
  if (st.back) s += st.back(a.hair);
  s += fill(a.shirt, 'M5.54 50C9 46.6 16 44.6 24 43.6h16c8 1 15 3 18.46 6.4A32 32 0 0 1 5.54 50Z');
  s += fill(shade, 'M27.4 35h9.2v9.4L32 49l-4.6-4.6Z');
  if (st.ears) s += `<circle cx="21.2" cy="30" r="2.7" fill="${shade}"/><circle cx="42.8" cy="30" r="2.7" fill="${shade}"/>`;
  if (has('hoops')) s += EXTRA.hoops;
  s += `<ellipse cx="32" cy="29" rx="11" ry="12.6" fill="${a.skin}"/>`;
  s += `<circle cx="25" cy="34.2" r="2.3" fill="#ff7a6b" opacity="${a.dark ? 0.16 : 0.24}"/><circle cx="39" cy="34.2" r="2.3" fill="#ff7a6b" opacity="${a.dark ? 0.16 : 0.24}"/>`;
  if (has('freckles')) s += EXTRA.freckles;
  s += `<ellipse cx="27.6" cy="29.6" rx="1.35" ry="1.65" fill="${ink}"/><ellipse cx="36.4" cy="29.6" rx="1.35" ry="1.65" fill="${ink}"/>`;
  s += '<circle cx="28.1" cy="29" r=".45" fill="#fff"/><circle cx="36.9" cy="29" r=".45" fill="#fff"/>';
  if (a.g === 'f') s += `<path d="M26.1 28.4l-1.1-.8M37.9 28.4l1.1-.8" stroke="${ink}" stroke-width=".9" stroke-linecap="round"/>`;
  s += `<path d="M25.2 25.7q2.3-1.3 4.6-.2M34.2 25.5q2.3-1.1 4.6.2" fill="none" stroke="${brow}" stroke-width="1.3" stroke-linecap="round"/>`;
  s += `<path d="M32.3 30.8q-1.3 2.8.5 3" fill="none" stroke="${darken(a.skin, 0.22)}" stroke-width="1.1" stroke-linecap="round"/>`;
  if (has('beard')) s += beard(a.beard || a.hair);
  if (has('beard') || has('moustache')) {
    s += moustache(a.beard || a.hair);
    s += `<path d="M29.8 37.4q2.2 1.6 4.4 0" fill="none" stroke="${lip}" stroke-width="1.3" stroke-linecap="round"/>`;
  } else {
    s += `<path d="M28.6 36.2q3.4 2.8 6.8 0" fill="none" stroke="${lip}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  if (st.front) s += st.front(a.hair);
  if (has('glasses')) s += EXTRA.glasses;
  return s;
}

export const AVATARS = [
  { id: 'f1', g: 'f', style: 'long',  bg: '#cfe3ff', skin: '#eab48c', hair: '#2a1d1f', shirt: '#eb6834' },
  { id: 'f2', g: 'f', style: 'curly', bg: '#ffe2a6', skin: '#7b4a2f', hair: '#1d1517', shirt: '#16a37a', dark: true, lip: '#7a2a2a' },
  { id: 'f3', g: 'f', style: 'bob',   bg: '#c9f0df', skin: '#f7d5bb', hair: '#a8461e', shirt: '#6a5bd6', extras: ['freckles'] },
  { id: 'f4', g: 'f', style: 'bun',   bg: '#ffd3e2', skin: '#c68a5f', hair: '#3a231e', shirt: '#2a78d6', extras: ['glasses', 'hoops'] },
  { id: 'f5', g: 'f', style: 'wavy',  bg: '#e2d8ff', skin: '#f2c7a4', hair: '#e0b04f', shirt: '#d6517f', brow: '#b8873a' },
  { id: 'm1', g: 'm', style: 'short', bg: '#ffd9c7', skin: '#e2a97f', hair: '#221b1d', shirt: '#2a78d6' },
  { id: 'm2', g: 'm', style: 'crop',  bg: '#c4eef2', skin: '#b4774c', hair: '#2f1e18', shirt: '#e04646', extras: ['beard'] },
  { id: 'm3', g: 'm', style: 'coils', bg: '#d8f3c4', skin: '#6b3f26', hair: '#161113', shirt: '#c98500', dark: true, lip: '#5a1f1a' },
  { id: 'm4', g: 'm', style: 'bald',  bg: '#dde3ee', skin: '#f0c5a2', hair: '#c4c6cf', shirt: '#0e9fb5', extras: ['glasses', 'moustache'], brow: '#9a9ca6' },
  { id: 'm5', g: 'm', style: 'quiff', bg: '#fff0b3', skin: '#d29a6c', hair: '#6b4226', shirt: '#16a37a' },
];

const cache = new Map();
/** Inner SVG markup for a 0 0 64 64 viewBox, or '' when the id is unknown. */
export function avatarInner(id) {
  if (!id) return '';
  if (!cache.has(id)) { const a = AVATARS.find(x => x.id === id); cache.set(id, a ? draw(a) : ''); }
  return cache.get(id);
}
export const avatarSvg = id => { const inner = avatarInner(id); return inner ? `<svg viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>` : ''; };
export const isAvatar = id => AVATARS.some(a => a.id === id);
