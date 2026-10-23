// Tiny Markdown → HTML renderer for the in-app README (Settings → About → Source code).
// Covers what README.md uses: headings, paragraphs, lists (with wrapped lines), tables, fenced code, rules,
// **bold**, *italic*, `code`, [links](…), ![images](…) and bare URLs. Everything is escaped first.
import { esc } from './ui.js';

/** `base`: where relative links point (images stay relative to the app, which serves the same files). */
export function markdown(src, { base = '' } = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = l => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const blockStart = l => /^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|---\s*$|\|)/.test(l);

  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^```(\w*)/))) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre class="md-code"><code>${esc(code.join('\n'))}</code></pre>`);
    } else if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const n = Math.min(m[1].length + 1, 6); // the page title is the h1, so README headings start one level down
      out.push(`<h${n}>${inline(m[2], base)}</h${n}>`);
      i++;
    } else if (/^---\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (l.trim().startsWith('|') && isTableSep(lines[i + 1] || '')) {
      const head = cells(l);
      i += 2;
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inline(c, base)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if ((m = l.match(/^\s*([-*]|\d+\.)\s+/))) {
      const ordered = /\d/.test(m[1]);
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^\s*([-*]|\d+\.)\s+(.*)$/)) && /\d/.test(m[1]) === ordered) {
        const text = [m[2]];
        for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) text.push(lines[i].trim());
        items.push(`<li>${inline(text.join(' '), base)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else {
      const text = [l.trim()];
      for (i++; i < lines.length && lines[i].trim() && !blockStart(lines[i]); i++) text.push(lines[i].trim());
      out.push(`<p>${inline(text.join(' '), base)}</p>`);
    }
  }
  return out.join('\n');
}

function href(url, base, image) {
  if (/^(https?:|mailto:|#)/.test(url)) return url;
  return image || !base ? url : base + url.replace(/^\.\//, '');
}

function inline(text, base) {
  const keep = [];
  const hold = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => hold(`<img src="${href(u, base, true)}" alt="${alt}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, u) => {
    const to = href(u, base, false);
    return hold(`<a class="link" href="${to}"${to.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${label}</a>`);
  });
  s = s.replace(/https?:\/\/[^\s<*)]+/g, u => hold(`<a class="link" href="${u}" target="_blank" rel="noopener">${u}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => keep[k]).replace(/\u0000(\d+)\u0000/g, (_, k) => keep[k]);
}
