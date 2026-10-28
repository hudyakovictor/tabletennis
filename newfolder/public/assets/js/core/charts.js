// Dependency-free SVG/canvas charts tuned for dense operational dashboards.
// All SVGs use `viewBox` + `preserveAspectRatio="none"` so they scale fluidly.

function norm(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1, points: [] };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max: max === min ? min + 1 : max, points: values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : min)) };
}

export function sparkline(values, { color = 'var(--brand)', height = 34, fill = true, showDot = true, width = 200 } = {}) {
  if (!values || values.length < 2) return `<div class="chart-empty">нет ряда</div>`;
  const { min, max, points } = norm(values);
  const stepX = width / (points.length - 1);
  const y = (v) => height - 3 - ((v - min) / (max - min)) * (height - 6);
  const coords = points.map((v, i) => [i * stepX, y(v)]);
  const line = coords.map(([x, yy], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = coords[coords.length - 1];
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Динамика">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${fill ? `<path d="${area}" fill="url(#${gid})"/>` : ''}
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${showDot ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="${color}"/>` : ''}
    </svg>`;
}

export function donut(segments, { size = 108, thickness = 11, center = '', centerSub = '' } = {}) {
  const total = segments.reduce((acc, s) => acc + (Number(s.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  if (!total) {
    return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Нет данных">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--bg-4)" stroke-width="${thickness}"/>
      </svg>`;
  }
  let offset = 0;
  const arcs = segments
    .map((s) => {
      const value = Number(s.value) || 0;
      const len = (value / total) * circumference;
      const dash = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
        stroke-dasharray="${len.toFixed(2)} ${(circumference - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        stroke-linecap="butt" transform="rotate(-90 ${c} ${c})"/>`;
      offset += len;
      return dash;
    })
    .join('');
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${center}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--bg-3)" stroke-width="${thickness}"/>
      ${arcs}
      ${center ? `<text x="${c}" y="${c + 2}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text)">${center}</text>` : ''}
      ${centerSub ? `<text x="${c}" y="${c + 17}" text-anchor="middle" font-size="8" fill="var(--text-3)">${centerSub}</text>` : ''}
    </svg>`;
}

export function barRows(items, { formatter = (v) => v, colorFor = null, maxOverride = null } = {}) {
  if (!items?.length) return `<div class="chart-empty">нет данных</div>`;
  const values = items.map((i) => Number(i.value) || 0);
  const max = maxOverride ?? Math.max(1, ...values);
  const rows = items
    .map((item) => {
      const value = Number(item.value) || 0;
      const width = Math.max(1.5, (value / max) * 100);
      const tone = colorFor ? colorFor(item, value) : item.tone || '';
      return `<div class="bar-row" title="${item.label}: ${formatter(value)}">
          <span class="bar-label">${item.label}</span>
          <span class="bar-track"><span class="bar-fill ${tone}" style="width:${width}%"></span></span>
          <span class="bar-value">${formatter(value)}</span>
        </div>`;
    })
    .join('');
  return `<div class="bars">${rows}</div>`;
}

/**
 * Hot-spot renderer for the racket contact oval (`along × across`).
 * Draws an oval reference, the density field and the sweet-spot ring.
 */
export function drawHeatmap(canvas, bins, rules = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cssWidth = canvas.clientWidth || 560;
  const cssHeight = Math.round(cssWidth * 0.56);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const bg = getComputedStyle(document.body).getPropertyValue('--bg-1').trim() || '#0a1019';
  const line = 'rgba(150,180,220,0.22)';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const cx = cssWidth / 2;
  const cy = cssHeight / 2;
  const ovalRx = cssWidth * 0.34;
  const ovalRy = cssHeight * 0.30;

  // Grid
  ctx.strokeStyle = 'rgba(150,180,220,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const x = (cssWidth / 6) * i;
    const y = (cssHeight / 6) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssHeight); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssWidth, y); ctx.stroke();
  }

  // Contact oval (MATCH_RULES geometry is expressed in px, normalized here)
  ctx.strokeStyle = 'rgba(47,227,176,0.55)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, ovalRx, ovalRy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const maxCount = Math.max(1, ...bins.map((b) => Number(b.total) || 0));
  const cellW = (ovalRx * 2) / 48;
  const cellH = (ovalRy * 2) / 28;
  bins.forEach((bin) => {
    const along = Number(bin.bin_along);
    const across = Number(bin.bin_across);
    const total = Number(bin.total) || 0;
    if (!Number.isFinite(along) || !Number.isFinite(across) || !total) return;
    const ratio = total / maxCount;
    // along → vertical (depth), across → horizontal (side), matching the paddle plane
    const x = cx + (across / 240) * ovalRx * 1.35;
    const y = cy - (along / 300) * ovalRy * 1.35;
    const hue = ratio > 0.72 ? 0 : ratio > 0.45 ? 32 : 165;
    const alpha = 0.18 + ratio * 0.72;
    ctx.fillStyle = `hsla(${hue}, ${ratio > 0.45 ? 92 : 74}%, ${ratio > 0.45 ? 56 : 62}%, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, cellW * 1.25, cellH * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Sweet spot ring
  const sweet = Number(rules.sweetRadius) || 0.15225;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(10, sweet * 120), 0, Math.PI * 2);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = 'rgba(160,180,205,0.75)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('+along (глубина)', 10, 14);
  ctx.fillText('across →', cssWidth - 66, cssHeight - 10);
}
