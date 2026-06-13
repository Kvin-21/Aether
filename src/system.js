// A single star system: the star, its orbits and the planets riding them.
// Planets are drawn as small shaded discs here; the heavy lit sphere only
// gets baked when you actually approach one.
import { mulberry32, range, chance, weighted } from './rng.js';
import { planetTraits } from './planet.js';

const TAU = Math.PI * 2;
const FLATTEN = 0.58;

function toRgb(str) {
  if (str[0] === '#') {
    const n = parseInt(str.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = str.match(/\d+/g);
  return [+m[0], +m[1], +m[2]];
}
function shade(rgb, f) {
  const c = (v) => Math.max(0, Math.min(255, v * f)) | 0;
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

export function makeSystem(star) {
  const rng = mulberry32((star.seed ^ 0x515751) >>> 0);
  const starR = star.cls.r * 7 + 17;
  const count = weighted(rng, [
    { v: 2, w: 2 }, { v: 3, w: 4 }, { v: 4, w: 5 }, { v: 5, w: 3 }, { v: 6, w: 2 },
  ]).v;

  const planets = [];
  let orbit = starR + range(rng, 54, 86);
  for (let i = 0; i < count; i++) {
    orbit += range(rng, 44, 88) * (1 + i * 0.16);
    const orbitNorm = count > 1 ? i / (count - 1) : 0.4;
    const t = planetTraits(star, i, count, orbitNorm);
    t.rgb = toRgb(t.colour);
    const size = t.kind === 'gas' ? range(rng, 13, 22) : range(rng, 5.5, 11);
    planets.push({
      index: i, orbit, size, traits: t,
      speed: (0.6 + rng() * 1.0) / Math.sqrt(orbit) * (chance(rng, 0.85) ? 1 : -1),
      phase: rng() * TAU,
    });
  }

  const outer = orbit + 24;

  const bg = [];
  const brng = mulberry32((star.seed ^ 0xbeef) >>> 0);
  for (let i = 0; i < 140; i++) {
    bg.push({ x: brng() * 2 - 1, y: brng() * 2 - 1, a: 0.15 + brng() * 0.6, s: brng() < 0.12 ? 1.6 : 0.9 });
  }

  function planetPos(p, time, cx, cy, scale) {
    const a = p.phase + time * p.speed;
    return [cx + Math.cos(a) * p.orbit * scale, cy + Math.sin(a) * p.orbit * scale * FLATTEN, a];
  }

  function drawStar(ctx, cx, cy, sr, time) {
    const rgb = toRgb(star.cls.col);
    const pulse = 1 + 0.02 * Math.sin(time * 1.3);
    sr *= pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy, sr * 0.4, cx, cy, sr * 6);
    glow.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`);
    glow.addColorStop(0.3, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`);
    glow.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, sr * 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    const disc = ctx.createRadialGradient(cx - sr * 0.25, cy - sr * 0.25, sr * 0.1, cx, cy, sr);
    disc.addColorStop(0, '#fffefb');
    disc.addColorStop(0.45, star.cls.col);
    disc.addColorStop(1, shade(rgb, 0.7));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, sr, 0, TAU);
    ctx.fill();
  }

  function drawDot(ctx, p, px, py, r, cx, cy) {
    const dl = Math.hypot(cx - px, cy - py) || 1;
    const dx = (cx - px) / dl, dy = (cy - py) / dl;
    if (p.traits.hasRings) {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 0.34);
      ctx.strokeStyle = `rgba(220,210,190,0.5)`;
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7, Math.PI, TAU);
      ctx.stroke();
      ctx.restore();
    }
    const grd = ctx.createRadialGradient(px + dx * r * 0.5, py + dy * r * 0.5, r * 0.1, px, py, r * 1.04);
    grd.addColorStop(0, shade(p.traits.rgb, 1.5));
    grd.addColorStop(0.55, p.traits.colour);
    grd.addColorStop(1, shade(p.traits.rgb, 0.4));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
    if (p.traits.hasRings) {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 0.34);
      ctx.strokeStyle = `rgba(235,225,205,0.6)`;
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7, 0, Math.PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(ctx, cx, cy, scale, time, hoverIdx, w, h) {
    const maxR = Math.max(w, h);
    ctx.fillStyle = '#cfd8ff';
    for (let i = 0; i < bg.length; i++) {
      const s = bg[i];
      ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(time + i));
      ctx.fillRect(cx + s.x * maxR * 0.62, cy + s.y * maxR * 0.62, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    ctx.lineWidth = 1;
    for (const p of planets) {
      ctx.strokeStyle = 'rgba(150,170,230,0.18)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, p.orbit * scale, p.orbit * scale * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    }

    const order = planets
      .map((p) => ({ p, pos: planetPos(p, time, cx, cy, scale) }))
      .sort((a, b) => Math.sin(a.pos[2]) - Math.sin(b.pos[2]));

    for (const o of order) if (Math.sin(o.pos[2]) <= 0) drawDot(ctx, o.p, o.pos[0], o.pos[1], o.p.size * scale, cx, cy);
    drawStar(ctx, cx, cy, starR * scale, time);
    for (const o of order) if (Math.sin(o.pos[2]) > 0) drawDot(ctx, o.p, o.pos[0], o.pos[1], o.p.size * scale, cx, cy);

    if (hoverIdx != null && planets[hoverIdx]) {
      const [px, py] = planetPos(planets[hoverIdx], time, cx, cy, scale);
      const r = planets[hoverIdx].size * scale;
      ctx.strokeStyle = 'rgba(180,205,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, r + 7 + Math.sin(time * 4), 0, TAU);
      ctx.stroke();
    }
  }

  function pick(cx, cy, scale, time, sx, sy) {
    let best = null, bestD = Infinity;
    for (const p of planets) {
      const [px, py] = planetPos(p, time, cx, cy, scale);
      const r = p.size * scale + 9;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < r * r && d < bestD) { bestD = d; best = p.index; }
    }
    return best;
  }

  return { star, planets, starR, outer, draw, pick, planetPos };
}
