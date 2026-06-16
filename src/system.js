// A single star system: the star (sometimes two), inclined orbits, planets,
// and the odd asteroid belt. Planets are shaded discs here and scale a little
// with depth so the plane reads as tilted; the heavy lit sphere only gets baked
// when you actually approach one.
import { mulberry32, range, chance, weighted, intRange } from './rng.js';
import { planetTraits } from './planet.js';

const TAU = Math.PI * 2;
const FLATTEN = 0.4;

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

const companionClasses = [
  { col: '#ffd199', r: 0.6 }, { col: '#ff9c66', r: 0.5 },
  { col: '#cdd8ff', r: 0.7 }, { col: '#fff2d6', r: 0.6 },
];

export function makeSystem(star) {
  const rng = mulberry32((star.seed ^ 0x515751) >>> 0);
  const starR = star.cls.r * 7 + 17;
  const count = weighted(rng, [
    { v: 2, w: 2 }, { v: 3, w: 4 }, { v: 4, w: 5 }, { v: 5, w: 3 }, { v: 6, w: 2 },
  ]).v;

  const planets = [];
  let orbit = starR + range(rng, 56, 90);
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

  // a binary companion, sitting close in so both suns share the centre
  let companion = null;
  if (chance(rng, 0.28)) {
    const cc = companionClasses[(rng() * companionClasses.length) | 0];
    companion = {
      col: cc.col, rgb: toRgb(cc.col), r: starR * cc.r,
      orbit: starR * range(rng, 2.0, 3.2), phase: rng() * TAU,
      speed: range(rng, 0.4, 0.8) / Math.sqrt(starR * 3),
    };
  }

  // an asteroid belt tucked into a gap
  let belt = null;
  if (chance(rng, 0.5) && planets.length >= 2) {
    const gap = 1 + ((rng() * (planets.length - 1)) | 0);
    const rad = (planets[gap - 1].orbit + planets[gap].orbit) / 2;
    const parts = [];
    const n = 220;
    for (let i = 0; i < n; i++) {
      parts.push({
        a: rng() * TAU, r: rad + range(rng, -16, 16),
        s: rng() < 0.15 ? 1.5 : 0.9, b: 0.3 + rng() * 0.6,
      });
    }
    belt = { rad, parts, speed: 0.16 / Math.sqrt(rad) };
  }

  const outer = orbit + (companion ? 0 : 0) + 26;

  const bg = [];
  const brng = mulberry32((star.seed ^ 0xbeef) >>> 0);
  for (let i = 0; i < 140; i++) {
    bg.push({ x: brng() * 2 - 1, y: brng() * 2 - 1, a: 0.15 + brng() * 0.6, s: brng() < 0.12 ? 1.6 : 0.9 });
  }

  function planetPos(p, time, cx, cy, scale) {
    const a = p.phase + time * p.speed;
    return [cx + Math.cos(a) * p.orbit * scale, cy + Math.sin(a) * p.orbit * scale * FLATTEN, a];
  }

  function drawStarBody(ctx, col, rgb, cx, cy, sr, time) {
    const pulse = 0.9 + 0.1 * Math.sin(time * 1.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // wide, soft corona
    const outer = ctx.createRadialGradient(cx, cy, sr * 0.5, cx, cy, sr * 7.5);
    outer.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.32)`);
    outer.addColorStop(0.28, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.1)`);
    outer.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(cx, cy, sr * 7.5, 0, TAU);
    ctx.fill();
    // tight, hot inner halo so the star reads as a bright source
    const inner = ctx.createRadialGradient(cx, cy, sr * 0.6, cx, cy, sr * 2.6 * pulse);
    inner.addColorStop(0, `rgba(255,255,250,0.55)`);
    inner.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.4)`);
    inner.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, sr * 2.6 * pulse, 0, TAU);
    ctx.fill();
    ctx.restore();

    const disc = ctx.createRadialGradient(cx - sr * 0.22, cy - sr * 0.22, sr * 0.1, cx, cy, sr);
    disc.addColorStop(0, '#fffefb');
    disc.addColorStop(0.5, col);
    disc.addColorStop(0.92, shade(rgb, 0.92));
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
      ctx.strokeStyle = 'rgba(220,210,190,0.5)';
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
      ctx.strokeStyle = 'rgba(235,225,205,0.6)';
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7, 0, Math.PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBelt(ctx, cx, cy, scale, time) {
    ctx.fillStyle = '#b9b3a4';
    for (const a of belt.parts) {
      const ang = a.a + time * belt.speed;
      const depth = Math.sin(ang);
      ctx.globalAlpha = a.b * (0.55 + 0.45 * (depth * 0.5 + 0.5));
      const x = cx + Math.cos(ang) * a.r * scale;
      const y = cy + Math.sin(ang) * a.r * scale * FLATTEN;
      const s = a.s * (0.8 + 0.4 * (depth * 0.5 + 0.5));
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
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
      ctx.strokeStyle = 'rgba(150,170,230,0.16)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, p.orbit * scale, p.orbit * scale * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    }

    if (belt) drawBelt(ctx, cx, cy, scale, time);

    const order = planets
      .map((p) => ({ p, pos: planetPos(p, time, cx, cy, scale) }))
      .sort((a, b) => Math.sin(a.pos[2]) - Math.sin(b.pos[2]));

    const depthR = (a) => 1 + 0.32 * Math.sin(a);
    for (const o of order) {
      if (Math.sin(o.pos[2]) > 0) break;
      drawDot(ctx, o.p, o.pos[0], o.pos[1], o.p.size * scale * depthR(o.pos[2]), cx, cy);
    }

    // companion behind, primary, companion in front
    let comp = null;
    if (companion) {
      const ca = companion.phase + time * companion.speed;
      comp = { x: cx + Math.cos(ca) * companion.orbit * scale, y: cy + Math.sin(ca) * companion.orbit * scale * FLATTEN, z: Math.sin(ca) };
    }
    if (comp && comp.z <= 0) drawStarBody(ctx, companion.col, companion.rgb, comp.x, comp.y, companion.r * scale, time);
    drawStarBody(ctx, star.cls.col, toRgb(star.cls.col), cx, cy, starR * scale * (1 + 0.02 * Math.sin(time * 1.3)), time);
    if (comp && comp.z > 0) drawStarBody(ctx, companion.col, companion.rgb, comp.x, comp.y, companion.r * scale, time);

    for (const o of order) {
      if (Math.sin(o.pos[2]) <= 0) continue;
      drawDot(ctx, o.p, o.pos[0], o.pos[1], o.p.size * scale * depthR(o.pos[2]), cx, cy);
    }

    if (hoverIdx != null && planets[hoverIdx]) {
      const pos = planetPos(planets[hoverIdx], time, cx, cy, scale);
      const r = planets[hoverIdx].size * scale * depthR(pos[2]);
      ctx.strokeStyle = 'rgba(180,205,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos[0], pos[1], r + 7 + Math.sin(time * 4), 0, TAU);
      ctx.stroke();
    }
  }

  function pick(cx, cy, scale, time, sx, sy) {
    let best = null, bestD = Infinity;
    for (const p of planets) {
      const pos = planetPos(p, time, cx, cy, scale);
      const r = p.size * scale * (1 + 0.32 * Math.sin(pos[2])) + 9;
      const d = (pos[0] - sx) ** 2 + (pos[1] - sy) ** 2;
      if (d < r * r && d < bestD) { bestD = d; best = p.index; }
    }
    return best;
  }

  return { star, planets, starR, outer, draw, pick, planetPos };
}
