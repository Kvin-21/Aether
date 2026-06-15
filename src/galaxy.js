// Infinite star map. Space is sliced into cells; each cell hashes to its own
// stars, so the field is endless and identical for a given seed. Nebulae are
// baked to a small offscreen buffer and stretched, so they stay cheap.
import { hash2, mulberry32, rngFrom, weighted } from './rng.js';
import { makeNoise } from './noise.js';
import { starName } from './lore.js';

const TAU = Math.PI * 2;
const CELL = 30;

const CLASSES = [
  { c: 'O', col: '#9db4ff', w: 0.4, r: 2.7, temp: 33000 },
  { c: 'B', col: '#aac6ff', w: 1.1, r: 2.1, temp: 19000 },
  { c: 'A', col: '#cdd8ff', w: 2.2, r: 1.75, temp: 9000 },
  { c: 'F', col: '#f4f3ff', w: 3.8, r: 1.5, temp: 6800 },
  { c: 'G', col: '#fff2d6', w: 6.5, r: 1.35, temp: 5600 },
  { c: 'K', col: '#ffd199', w: 9.0, r: 1.2, temp: 4400 },
  { c: 'M', col: '#ff9c66', w: 15.0, r: 1.0, temp: 3200 },
];

const palettes = [
  [[30, 12, 58], [104, 44, 150], [58, 96, 210]],
  [[8, 38, 64], [22, 104, 150], [86, 196, 210]],
  [[58, 18, 32], [150, 54, 62], [224, 128, 86]],
  [[18, 26, 66], [70, 58, 158], [150, 120, 232]],
  [[12, 46, 42], [30, 124, 106], [120, 206, 160]],
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

function makeGlow(col) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const rgb = hexToRgb(col);
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, rgba(rgb, 1));
  grd.addColorStop(0.22, rgba(rgb, 0.5));
  grd.addColorStop(1, rgba(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return c;
}

export function makeGalaxy(seed) {
  const noise = makeNoise((seed ^ 0x5bd1c3) >>> 0);
  const glows = CLASSES.map((cl) => makeGlow(cl.col));
  const cache = new Map();

  function density(wx, wy) {
    return noise.fbm(wx * 0.0017 + 9.2, wy * 0.0017 + 4.1, 4);
  }

  function makeStar(cx, cy, i) {
    const rng = rngFrom(seed, cx, cy, 0x200 + i * 31);
    const wx = (cx + rng()) * CELL;
    const wy = (cy + rng()) * CELL;
    const d = density(wx, wy);
    // bias hotter, brighter classes towards dense regions
    const items = CLASSES.map((cl, k) => ({
      cl,
      w: cl.w * (k < 4 ? 1 + d * 1.6 : 1),
    }));
    const cls = weighted(rng, items).cl;
    return {
      cx, cy, i,
      id: cx + '|' + cy + '|' + i,
      x: wx, y: wy,
      cls,
      glow: glows[CLASSES.indexOf(cls)],
      twPhase: rng() * TAU,
      twSpeed: 0.6 + rng() * 1.4,
      seed: hash2(seed, cx, cy, i + 17),
      name: null,
    };
  }

  function cellStars(cx, cy) {
    const key = cx + ',' + cy;
    let arr = cache.get(key);
    if (arr) return arr;
    const rng = rngFrom(seed, cx, cy, 0x1a3f);
    const d = density(cx * CELL + CELL / 2, cy * CELL + CELL / 2);
    arr = [];
    const p = Math.max(0, d - 0.34) * 1.9;
    if (rng() < p) {
      const count = d > 0.64 && rng() < 0.32 ? 2 : 1;
      for (let i = 0; i < count; i++) arr.push(makeStar(cx, cy, i));
    }
    cache.set(key, arr);
    if (cache.size > 20000) cache.clear();
    return arr;
  }

  function nameOf(star) {
    if (!star.name) {
      star.name = starName(rngFrom(seed, star.cx, star.cy, 0x300 + star.i));
    }
    return star.name;
  }

  function starById(id) {
    const [cx, cy, i] = id.split('|').map(Number);
    return cellStars(cx, cy)[i] || makeStar(cx, cy, i);
  }

  // gather stars whose cells touch the viewport (plus a margin for glow)
  function visible(cam, margin = 60) {
    const x0 = cam.wx(-margin), y0 = cam.wy(-margin);
    const x1 = cam.wx(cam.w + margin), y1 = cam.wy(cam.h + margin);
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    const out = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const arr = cellStars(cx, cy);
        for (let k = 0; k < arr.length; k++) out.push(arr[k]);
      }
    }
    return out;
  }

  // ---- nebula buffer ----
  const neb = document.createElement('canvas');
  const nebCtx = neb.getContext('2d');
  let nebImg = null;
  let nebW = 0, nebH = 0;
  let last = { x: 1e9, y: 1e9, zoom: 0, t: -1 };

  function sizeNebula(cam) {
    const w = Math.max(80, Math.min(240, Math.round(cam.w / 7)));
    const h = Math.max(50, Math.round(w * cam.h / cam.w));
    if (w !== nebW || h !== nebH) {
      nebW = neb.width = w;
      nebH = neb.height = h;
      nebImg = nebCtx.createImageData(w, h);
    }
  }

  const PAR = 0.34;

  function renderNebula(cam, time) {
    const data = nebImg.data;
    const cxw = cam.x * PAR;
    const cyw = cam.y * PAR;
    const spanX = cam.w / cam.zoom;
    const spanY = cam.h / cam.zoom;
    const drift = time * 1.6;
    let p = 0;
    for (let j = 0; j < nebH; j++) {
      const wy = cyw + (j / nebH - 0.5) * spanY + drift;
      for (let i = 0; i < nebW; i++) {
        const wx = cxw + (i / nebW - 0.5) * spanX + drift * 0.5;
        let f = noise.fbm(wx * 0.011 + 2.3, wy * 0.011 + 7.7, 5);
        f = (f - 0.46) * 2.3;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        f = f * f;
        const region = noise.fbm(wx * 0.0009 + 40, wy * 0.0009 + 12, 2);
        const pal = palettes[Math.min(palettes.length - 1, (region * palettes.length) | 0)];
        let r, g, b;
        if (f < 0.5) {
          const t = f * 2;
          r = pal[0][0] + (pal[1][0] - pal[0][0]) * t;
          g = pal[0][1] + (pal[1][1] - pal[0][1]) * t;
          b = pal[0][2] + (pal[1][2] - pal[0][2]) * t;
        } else {
          const t = (f - 0.5) * 2;
          r = pal[1][0] + (pal[2][0] - pal[1][0]) * t;
          g = pal[1][1] + (pal[2][1] - pal[1][1]) * t;
          b = pal[1][2] + (pal[2][2] - pal[1][2]) * t;
        }
        const bright = f * 1.15;
        data[p] = r * bright;
        data[p + 1] = g * bright;
        data[p + 2] = b * bright;
        data[p + 3] = 255;
        p += 4;
      }
    }
    nebCtx.putImageData(nebImg, 0, 0);
  }

  function drawNebula(ctx, cam, time) {
    sizeNebula(cam);
    const moved =
      Math.abs(cam.x - last.x) * cam.zoom * PAR > 5 ||
      Math.abs(cam.y - last.y) * cam.zoom * PAR > 5 ||
      Math.abs(cam.zoom - last.zoom) > last.zoom * 0.04 ||
      time - last.t > 0.16;
    if (moved) {
      renderNebula(cam, time);
      last = { x: cam.x, y: cam.y, zoom: cam.zoom, t: time };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(neb, 0, 0, cam.w, cam.h);
    ctx.globalAlpha = 1;
  }

  // faint parallax dust between the foreground stars, three depths
  function drawDust(ctx, cam, time) {
    const layers = [
      { par: 0.32, step: 38, a: 0.32, col: '#9fb0e8' },
      { par: 0.5, step: 48, a: 0.5, col: '#c2cdf2' },
      { par: 0.72, step: 64, a: 0.78, col: '#e2e8ff' },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.col;
      const offx = cam.x * (1 - L.par);
      const offy = cam.y * (1 - L.par);
      const x0 = cam.wx(0) - offx, x1 = cam.wx(cam.w) - offx;
      const y0 = cam.wy(0) - offy, y1 = cam.wy(cam.h) - offy;
      const gx0 = Math.floor(x0 / L.step), gx1 = Math.floor(x1 / L.step);
      const gy0 = Math.floor(y0 / L.step), gy1 = Math.floor(y1 / L.step);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const h = hash2(seed, gx, gy, 0x9d + (L.step | 0));
          if ((h & 7) > 2) continue;
          const px = (gx + (h & 255) / 255) * L.step;
          const py = (gy + ((h >> 8) & 255) / 255) * L.step;
          const sx = cam.sx(px + offx);
          const sy = cam.sy(py + offy);
          const tw = 0.6 + 0.4 * Math.sin(time * 1.5 + h);
          ctx.globalAlpha = L.a * tw;
          ctx.fillRect(sx, sy, 1.3, 1.3);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw(ctx, cam, time, highlightId) {
    drawNebula(ctx, cam, time);
    drawDust(ctx, cam, time);

    const stars = visible(cam);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < stars.length; k++) {
      const s = stars[k];
      const sx = cam.sx(s.x), sy = cam.sy(s.y);
      const tw = 0.82 + 0.18 * Math.sin(time * s.twSpeed + s.twPhase);
      const gs = s.cls.r * 13 * tw * Math.min(1.6, 0.7 + cam.zoom * 0.5);
      ctx.globalAlpha = 0.9 * tw;
      ctx.drawImage(s.glow, sx - gs / 2, sy - gs / 2, gs, gs);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let k = 0; k < stars.length; k++) {
      const s = stars[k];
      const sx = cam.sx(s.x), sy = cam.sy(s.y);
      const cr = Math.max(0.8, s.cls.r * Math.min(2.2, 0.6 + cam.zoom * 0.6));
      ctx.fillStyle = '#fbfcff';
      ctx.beginPath();
      ctx.arc(sx, sy, cr, 0, TAU);
      ctx.fill();
    }

    if (highlightId) {
      const s = starById(highlightId);
      const sx = cam.sx(s.x), sy = cam.sy(s.y);
      ctx.strokeStyle = 'rgba(180,205,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 16 + 2 * Math.sin(time * 4), 0, TAU);
      ctx.stroke();
    }
  }

  function pick(cam, sx, sy) {
    const stars = visible(cam, 40);
    let best = null;
    let bestD = 20 * 20;
    for (let k = 0; k < stars.length; k++) {
      const s = stars[k];
      const dx = cam.sx(s.x) - sx;
      const dy = cam.sy(s.y) - sy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  return { draw, pick, starById, nameOf, density, CLASSES, CELL };
}
