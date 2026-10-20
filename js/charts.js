// Hand-rolled, dependency-free SVG charts.
// Specs: bars ≤ 24px with 4px rounded data-ends, 2px lines, hairline solid grid, crosshair/hover tooltips,
// keyboard navigation (← →) and a table twin rendered by the views.
import { esc, compact, fmt, initials } from './ui.js';

/* ── Tooltip (one for the whole app) ── */
const tipEl = () => document.getElementById('tip');
export function showTip(x, y, html) {
  const t = tipEl();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 18;
  t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
export function hideTip() { const t = tipEl(); if (t) t.hidden = true; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('.chart')) hideTip(); }, { passive: true });
addEventListener('scroll', hideTip, { passive: true });

export const tipRow = (value, label, key = '') =>
  `<div class="tip-row">${key ? `<i class="tip-key ${key}"></i>` : ''}<b>${esc(value)}</b><span>${esc(label)}</span></div>`;

/* ── Scales ── */
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function ticksFor(max, n = 4) {
  if (!(max > 0)) max = 1;
  const step = niceStep(max / n);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(v);
  return { top, ticks };
}
function barPath(x, y, w, h, r = 4) {
  if (h <= 0.5) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}
const width = host => Math.max(260, Math.floor(host.clientWidth));

/** Shared keyboard + pointer behaviour for index-based charts */
function interactive(host, svg, n, { indexAt, anchor, onActive, tip }) {
  let active = -1;
  const set = (i, x, y) => {
    active = i;
    onActive(i);
    if (i < 0) return hideTip();
    const html = tip(i);
    if (!html) return hideTip();
    const a = x == null ? anchor(i) : { x, y };
    showTip(a.x, a.y, html);
  };
  svg.addEventListener('pointermove', e => { const i = indexAt(e); if (i !== null) set(i, e.clientX, e.clientY); });
  svg.addEventListener('pointerdown', e => { const i = indexAt(e); if (i !== null) set(i, e.clientX, e.clientY); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') set(-1); });
  host.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = active < 0 ? 0 : Math.max(0, Math.min(n - 1, active + (e.key === 'ArrowRight' ? 1 : -1)));
    set(next);
  });
  host.addEventListener('blur', () => set(-1));
}

/* ── Column chart (optional overlay line + goal reference) ── */
export function columnChart(host, o) {
  const values = o.values, N = values.length;
  const W = width(host), H = o.height || 210;
  const m = { l: 40, r: 12, t: 18, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const lineVals = o.line ? o.line.values : [];
  const max = Math.max(o.goal || 0, ...values.map(v => v || 0), ...lineVals.map(v => v || 0));
  const { top, ticks } = ticksFor(max * 1.06);
  const y = v => m.t + ph - (v / top) * ph;
  const band = pw / N, bw = Math.min(24, Math.max(3, band * 0.62));
  const cx = i => m.l + band * i + band / 2;
  const futureFrom = o.futureFrom ?? N;
  const emph = new Set([].concat(o.emphasis ?? []));

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.aria || '')}">`;
  ticks.forEach(t => {
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="tick" x="${m.l - 8}" y="${y(t)}" dy=".32em" text-anchor="end">${compact(t)}</text>`;
  });
  s += `<g class="bars">`;
  values.forEach((v, i) => {
    if (i >= futureFrom) { s += `<circle class="future-dot" cx="${cx(i)}" cy="${y(0) - 3}" r="1.6"/>`; return; }
    if (!v) return;
    s += `<path class="bar ${emph.has(i) ? 'emph' : ''}" data-i="${i}" d="${barPath(cx(i) - bw / 2, y(v), bw, y(0) - y(v))}"/>`;
  });
  s += `</g>`;
  if (o.line) {
    let d = '';
    lineVals.forEach((v, i) => { if (v == null || i >= futureFrom) return; d += `${d ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`; });
    if (d) s += `<path class="series-line ${o.line.cls || ''}" d="${d}"/>`;
  }
  if (o.goal) {
    s += `<line class="goal" x1="${m.l}" x2="${W - m.r}" y1="${y(o.goal)}" y2="${y(o.goal)}"/>`;
    s += `<text class="goal-label" x="${W - m.r}" y="${y(o.goal) - 6}" text-anchor="end">${esc(o.goalLabel || `Goal ${compact(o.goal)}`)}</text>`;
  }
  s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  // Selective direct labels (e.g. today / best)
  (o.labelIdx || []).forEach(i => {
    const v = values[i];
    if (!v || i >= futureFrom) return;
    s += `<text class="val-label" x="${cx(i)}" y="${y(v) - 6}" text-anchor="middle">${compact(v)}</text>`;
  });
  // X labels: thin out to fit, always keep emphasised ones
  const every = band >= 30 ? 1 : Math.max(1, Math.ceil(N / Math.max(3, Math.floor(pw / 46))));
  const keep = (o.forceLabels ?? [...emph]).filter(i => i >= 0 && i < N);
  o.xLabels.forEach((lab, i) => {
    const forced = keep.includes(i);
    if (!forced && (i % every || keep.some(k => Math.abs(k - i) * band < 34))) return;
    s += `<text class="tick ${forced ? 'strong' : ''}" x="${cx(i)}" y="${H - 7}" text-anchor="middle">${esc(lab)}</text>`;
  });
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg>`;

  host.innerHTML = s;
  host.tabIndex = 0;
  const svg = host.firstElementChild;
  const bars = [...svg.querySelectorAll('.bar')];
  interactive(host, svg, N, {
    indexAt: e => { const b = svg.getBoundingClientRect(); const i = Math.floor(((e.clientX - b.left) * (W / b.width) - m.l) / band); return i >= 0 && i < N ? i : null; },
    anchor: i => { const b = svg.getBoundingClientRect(); return { x: b.left + cx(i) * (b.width / W), y: b.top + y(values[i] || 0) * (b.height / H) }; },
    onActive: i => { svg.classList.toggle('hovering', i >= 0); bars.forEach(b => b.classList.toggle('on', +b.dataset.i === i)); },
    tip: o.tip,
  });
}

/* ── Line chart (cumulative vs goal pace) ── */
export function lineChart(host, o) {
  const N = o.labels.length;
  const W = width(host), H = o.height || 210;
  const m = { l: 44, r: 16, t: 18, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const max = Math.max(...o.series.flatMap(sr => sr.values.map(v => v || 0)));
  const { top, ticks } = ticksFor(max * 1.04);
  const x = i => m.l + (N === 1 ? pw / 2 : (i / (N - 1)) * pw);
  const y = v => m.t + ph - (v / top) * ph;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.aria || '')}">`;
  ticks.forEach(t => {
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="tick" x="${m.l - 8}" y="${y(t)}" dy=".32em" text-anchor="end">${compact(t)}</text>`;
  });
  s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  o.series.forEach(sr => {
    const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) return;
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    if (sr.area) s += `<path class="area ${sr.cls}" d="${d}L${pts[pts.length - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z"/>`;
    s += `<path class="series-line ${sr.cls}" d="${d}"/>`;
    if (sr.endLabel) {
      const [px, py] = pts[pts.length - 1];
      const v = sr.values[sr.values.map(v => v != null).lastIndexOf(true)];
      s += `<circle class="end-dot ${sr.cls}" cx="${px}" cy="${py}" r="4.5"/>`;
      const anchor = px > W - 70 ? 'end' : 'start';
      s += `<text class="val-label" x="${px + (anchor === 'end' ? -10 : 10)}" y="${py - 8}" text-anchor="${anchor}">${compact(v)}</text>`;
    }
  });
  const every = Math.max(1, Math.ceil(N / Math.max(3, Math.floor(pw / 52))));
  o.labels.forEach((lab, i) => {
    if (i % every && i !== N - 1) return;
    if (i !== N - 1 && N - 1 - i < every * 0.7) return;
    s += `<text class="tick" x="${x(i)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle'}">${esc(lab)}</text>`;
  });
  s += `<g class="xhair" visibility="hidden"><line class="xhair-line" y1="${m.t}" y2="${y(0)}"/>${o.series.map(sr => `<circle class="xhair-dot ${sr.cls}" r="4.5"/>`).join('')}</g>`;
  s += `<rect class="hit" x="${m.l - 6}" y="${m.t}" width="${pw + 12}" height="${ph}"/></svg>`;

  host.innerHTML = s;
  host.tabIndex = 0;
  const svg = host.firstElementChild;
  const xh = svg.querySelector('.xhair');
  const dots = [...xh.querySelectorAll('.xhair-dot')];
  interactive(host, svg, N, {
    indexAt: e => { const b = svg.getBoundingClientRect(); const px = (e.clientX - b.left) * (W / b.width); return Math.max(0, Math.min(N - 1, Math.round(((px - m.l) / pw) * (N - 1)))); },
    anchor: i => { const b = svg.getBoundingClientRect(); return { x: b.left + x(i) * (b.width / W), y: b.top + m.t + 20 }; },
    onActive: i => {
      if (i < 0) return xh.setAttribute('visibility', 'hidden');
      xh.setAttribute('visibility', 'visible');
      xh.querySelector('line').setAttribute('x1', x(i));
      xh.querySelector('line').setAttribute('x2', x(i));
      o.series.forEach((sr, k) => {
        const v = sr.values[i];
        dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
        if (v != null) { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); }
      });
    },
    tip: o.tip,
  });
}

/* ── Heatmap: members × days ── */
export const heatBin = v => (v == null ? 'n' : v < 2500 ? 1 : v < 5000 ? 2 : v < 7500 ? 3 : v < 10000 ? 4 : v < 15000 ? 5 : 6);

export function heatmap(host, o) {
  const { members, dates, goal, lastIdx, meId } = o;
  const W = width(host);
  const M = members.length, N = dates.length;
  const vertical = W < 640;
  const gap = 2, weekGap = 5;
  const weekBreak = i => i > 0 && new Date(dates[i] + 'T12:00').getDay() === 1;
  const breaksBefore = i => { let c = 0; for (let k = 1; k <= i; k++) if (weekBreak(k)) c++; return c; };
  const totalBreaks = breaksBefore(N - 1);
  let s, H;

  const cellClass = (v, i) => (i > lastIdx ? 'hc hc-f' : `hc hc-${heatBin(v)}`);
  const dot = (v, x0, y0, w, h) => (v != null && v >= goal ? `<circle class="hc-dot" cx="${x0 + w / 2}" cy="${y0 + h / 2}" r="${Math.min(2.4, Math.min(w, h) / 5)}"/>` : '');

  if (vertical) {
    const lw = 50, hh = 40, ch = 17;
    const cw = (W - lw - gap * (M - 1)) / M;
    H = hh + N * (ch + gap) + totalBreaks * weekGap;
    const yAt = i => hh + i * (ch + gap) + breaksBefore(i) * weekGap;
    s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.aria || '')}">`;
    members.forEach((m, k) => {
      const x0 = lw + k * (cw + gap);
      if (m.id === meId) s += `<rect class="me-band" x="${x0 - 2}" y="2" width="${cw + 4}" height="${H - 2}" rx="8"/>`;
      s += `<g class="hm-member" data-id="${esc(m.id)}" role="button" aria-label="${esc(m.name)}"><circle cx="${x0 + cw / 2}" cy="17" r="${Math.min(13, cw / 2 - 1)}" style="fill:${o.colorOf(m)}"/>
        <text class="hm-ini" x="${x0 + cw / 2}" y="17" dy=".35em" text-anchor="middle">${esc(initials(m.name))}</text></g>`;
    });
    dates.forEach((d, i) => {
      const y0 = yAt(i);
      s += `<text class="tick ${i === o.todayIdx ? 'strong' : ''}" x="${lw - 8}" y="${y0 + ch / 2}" dy=".34em" text-anchor="end">${esc(o.dayLabel(d))}</text>`;
      members.forEach((m, k) => {
        const v = m.daily[i], x0 = lw + k * (cw + gap);
        s += `<rect class="${cellClass(v, i)}" data-m="${k}" data-i="${i}" x="${x0}" y="${y0}" width="${cw}" height="${ch}" rx="3"/>${i <= lastIdx ? dot(v, x0, y0, cw, ch) : ''}`;
      });
    });
  } else {
    const lw = 96, hh = 22, ch = 22;
    const cw = (W - lw - gap * (N - 1) - totalBreaks * weekGap) / N;
    H = hh + M * (ch + gap);
    const xAt = i => lw + i * (cw + gap) + breaksBefore(i) * weekGap;
    s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.aria || '')}">`;
    dates.forEach((d, i) => {
      if (i % 2 && i !== o.todayIdx) return;
      s += `<text class="tick ${i === o.todayIdx ? 'strong' : ''}" x="${xAt(i) + cw / 2}" y="13" text-anchor="middle">${esc(o.numLabel(d))}</text>`;
    });
    members.forEach((m, k) => {
      const y0 = hh + k * (ch + gap);
      if (m.id === meId) s += `<rect class="me-band" x="2" y="${y0 - 2}" width="${W - 2}" height="${ch + 4}" rx="8"/>`;
      s += `<g class="hm-member" data-id="${esc(m.id)}" role="button" aria-label="${esc(m.name)}"><text class="hm-name" x="8" y="${y0 + ch / 2}" dy=".34em">${esc(m.first)}</text></g>`;
      dates.forEach((d, i) => {
        const v = m.daily[i], x0 = xAt(i);
        s += `<rect class="${cellClass(v, i)}" data-m="${k}" data-i="${i}" x="${x0}" y="${y0}" width="${cw}" height="${ch}" rx="3"/>${i <= lastIdx ? dot(v, x0, y0, cw, ch) : ''}`;
      });
    });
  }
  s += '</svg>';
  host.innerHTML = s;
  const svg = host.firstElementChild;
  let on = null;
  const pick = e => {
    const r = e.target.closest('rect.hc');
    if (on && on !== r) on.classList.remove('on');
    if (!r) return hideTip();
    on = r; r.classList.add('on');
    showTip(e.clientX, e.clientY, o.tip(members[+r.dataset.m], +r.dataset.i));
  };
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hideTip(); on && on.classList.remove('on'); } });
  svg.querySelectorAll('.hm-member').forEach(g => g.addEventListener('click', () => o.onMember && o.onMember(g.dataset.id)));
}

/* ── Mini bars (last 7 days) for list rows ── */
export function miniBars(values, goal, { w = 64, h = 24 } = {}) {
  const n = values.length;
  const max = Math.max(goal, ...values.map(v => v || 0));
  const band = w / n, bw = Math.min(6, band - 2);
  let s = `<svg class="mini" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
  s += `<line class="mini-goal" x1="0" x2="${w}" y1="${h - (goal / max) * (h - 2)}" y2="${h - (goal / max) * (h - 2)}"/>`;
  values.forEach((v, i) => {
    if (!v) return;
    const bh = Math.max(1.5, (v / max) * (h - 2));
    s += `<path class="mini-bar ${v >= goal ? 'hit-goal' : ''}" d="${barPath(i * band + (band - bw) / 2, h - bh, bw, bh, 2)}"/>`;
  });
  return s + '</svg>';
}

/* ── Table twin helper ── */
export function table(head, rows, { cls = '' } = {}) {
  return `<div class="table-wrap ${cls}"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, k) => `<td${k ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const fmtSteps = v => (v == null ? '—' : fmt(v));
