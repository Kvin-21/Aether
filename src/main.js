// Aether. One loop, one camera, four scenes (intro, galaxy, system, planet).
// Everything visible is generated from the seed; this file just wires the
// scenes together and handles input, warps and the URL.
import { hashString, mulberry32 } from './rng.js';
import { makeGalaxy } from './galaxy.js';
import { makeSystem } from './system.js';
import { bakePlanet, drawPlanet } from './planet.js';
import { planetLore, roman } from './lore.js';
import { ui, scanData } from './ui.js';
import { readState, writeState, shareLink, copy } from './share.js';
import { makeAudio } from './audio.js';

const TAU = Math.PI * 2;
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });
const audio = makeAudio();

const cam = {
  x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1, w: window.innerWidth, h: window.innerHeight,
  sx(wx) { return (wx - this.x) * this.zoom + this.w / 2; },
  sy(wy) { return (wy - this.y) * this.zoom + this.h / 2; },
  wx(sx) { return (sx - this.w / 2) / this.zoom + this.x; },
  wy(sy) { return (sy - this.h / 2) / this.zoom + this.y; },
  set(x, y, z) { this.x = this.tx = x; this.y = this.ty = y; this.zoom = this.tz = z; },
  ease(k) {
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * k;
  },
};

const state = {
  seed: '', seedHash: 0, scene: 'intro',
  galaxy: null, star: null, starId: null,
  system: null, planetIdx: null, planet: null,
  planetBg: null, warp: null, hover: null, loading: false,
};

// a quiet galaxy that drifts behind the intro screen
const introGalaxy = makeGalaxy(hashString('aether'));

// ---- canvas sizing ----
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cam.w = window.innerWidth;
  cam.h = window.innerHeight;
  canvas.width = Math.round(cam.w * dpr);
  canvas.height = Math.round(cam.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---- seed handling ----
function setSeed(seed) {
  state.seed = seed;
  state.seedHash = hashString(seed);
  state.galaxy = makeGalaxy(state.seedHash);
}

function findStart() {
  const r = mulberry32(state.seedHash ^ 0x51a2);
  let best = [0, 0], bd = -1;
  for (let i = 0; i < 48; i++) {
    const x = (r() * 2 - 1) * 5000;
    const y = (r() * 2 - 1) * 5000;
    const d = state.galaxy.density(x, y);
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

const seedWordsA = ['ember', 'violet', 'silent', 'hollow', 'azure', 'iron', 'lumen',
  'nova', 'dusk', 'quiet', 'vast', 'pale', 'amber', 'cobalt', 'ashen'];
const seedWordsB = ['drift', 'reach', 'tide', 'spire', 'vale', 'wake', 'crown',
  'fall', 'gate', 'song', 'verge', 'shore', 'expanse', 'hush'];
function randomSeed() {
  const r = Math.random;
  return seedWordsA[(r() * seedWordsA.length) | 0] + '-' +
    seedWordsB[(r() * seedWordsB.length) | 0] + '-' + (100 + ((r() * 899) | 0));
}

// ---- background stars for the system/planet scenes ----
function genStars(seed, n) {
  const r = mulberry32(seed >>> 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: r() * 2 - 1, y: r() * 2 - 1, a: 0.12 + r() * 0.6, s: r() < 0.1 ? 1.6 : 0.9, ph: r() * TAU });
  }
  return out;
}

function drawBackdrop(stars, time, tint) {
  ctx.fillStyle = '#04050b';
  ctx.fillRect(0, 0, cam.w, cam.h);
  if (tint) {
    const g = ctx.createRadialGradient(cam.w * 0.32, cam.h * 0.34, 0, cam.w * 0.32, cam.h * 0.34, Math.max(cam.w, cam.h) * 0.8);
    g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0.1)`);
    g.addColorStop(1, 'rgba(4,5,11,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.w, cam.h);
  }
  const maxR = Math.max(cam.w, cam.h);
  ctx.fillStyle = '#cdd6ff';
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(time * 1.3 + s.ph));
    ctx.fillRect(cam.w / 2 + s.x * maxR * 0.62, cam.h / 2 + s.y * maxR * 0.62, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

// ---- scene navigation ----
function warpTo(swap, dur = 0.72) {
  state.warp = { t: 0, dur, swapped: false, swap };
}

function enterUniverse(seed) {
  setSeed(seed);
  const [sx, sy] = findStart();
  cam.x = cam.tx = sx; cam.y = cam.ty = sy;
  cam.zoom = 0.9; cam.tz = 1.6;        // gentle push-in on arrival
  state.scene = 'galaxy';
  state.star = state.starId = state.system = null;
  ui.hideIntro();
  ui.showHud();
  ui.hideScan();
  state.loading = true;
  ui.showLoader();
  warpTo(() => {}, 0.9);
  commitState();
}

function enterStar(star) {
  state.star = star;
  state.starId = star.id;
  state.galaxy.nameOf(star);
  state.system = makeSystem(star);
  // remember where we were, then dive towards the star
  state.galaxyView = { x: cam.tx, y: cam.ty, zoom: cam.tz };
  cam.tx = star.x; cam.ty = star.y; cam.tz = cam.zoom * 4.5;
  warpTo(() => {
    state.scene = 'system';
    ui.hideTip();
    commitState();
  });
}

function enterPlanet(idx) {
  state.planetIdx = idx;
  const p = state.system.planets[idx];
  state.planet = p.traits;
  if (!state.planet.lore) {
    state.planet.lore = planetLore(mulberry32((state.planet.seed ^ 0xa17e) >>> 0), state.planet);
  }
  state.planetBg = genStars(state.planet.seed ^ 0x33, 150);
  state.loading = true;
  ui.showLoader();
  warpTo(() => {
    state.scene = 'planet';
    bakePlanet(state.planet, planetRadius());
    showScan();
    ui.hideTip();
    commitState();
  });
}

function goBack() {
  if (state.warp) return;
  if (state.scene === 'planet') {
    ui.hideScan();
    warpTo(() => { state.scene = 'system'; commitState(); }, 0.6);
  } else if (state.scene === 'system') {
    if (state.galaxyView) {
      cam.tx = state.galaxyView.x; cam.ty = state.galaxyView.y; cam.tz = state.galaxyView.zoom;
    }
    warpTo(() => { state.scene = 'galaxy'; commitState(); }, 0.6);
  } else if (state.scene === 'galaxy') {
    state.scene = 'intro';
    ui.setSeedInput(state.seed);
    ui.showIntro();
    ui.hideTip();
  }
}

function planetRadius() {
  return Math.min(Math.min(cam.w, cam.h) * 0.34, 210);
}

function systemScale() {
  return Math.min(cam.w, cam.h) * 0.44 / state.system.outer;
}

function showScan() {
  const t = state.planet;
  const name = state.star.name + ' ' + roman(t.index + 1);
  ui.showScan(scanData(name, t, t.lore));
}

// ---- URL state ----
function currentState() {
  const gx = state.galaxyView || { x: cam.tx, y: cam.ty, zoom: cam.tz };
  const galaxy = state.scene === 'galaxy' || state.scene === 'intro';
  return {
    seed: state.seed,
    scene: state.scene === 'intro' ? 'galaxy' : state.scene,
    x: galaxy ? cam.tx : gx.x,
    y: galaxy ? cam.ty : gx.y,
    zoom: galaxy ? cam.tz : gx.zoom,
    starId: state.starId,
    planetIdx: state.scene === 'planet' ? state.planetIdx : null,
  };
}

function commitState() {
  writeState(currentState());
}

function applyState(st) {
  setSeed(st.seed);
  cam.set(st.x, st.y, st.zoom || 1);
  ui.hideIntro();
  ui.showHud();
  state.loading = true;
  ui.showLoader();

  if ((st.scene === 'system' || st.scene === 'planet') && st.starId) {
    state.star = state.galaxy.starById(st.starId);
    state.starId = st.starId;
    state.galaxy.nameOf(state.star);
    state.galaxyView = { x: st.x, y: st.y, zoom: st.zoom || 1 };
    state.system = makeSystem(state.star);
    if (st.scene === 'planet' && st.planetIdx != null && state.system.planets[st.planetIdx]) {
      state.planetIdx = st.planetIdx;
      state.planet = state.system.planets[st.planetIdx].traits;
      state.planet.lore = planetLore(mulberry32((state.planet.seed ^ 0xa17e) >>> 0), state.planet);
      state.planetBg = genStars(state.planet.seed ^ 0x33, 150);
      bakePlanet(state.planet, planetRadius());
      state.scene = 'planet';
      showScan();
    } else {
      state.scene = 'system';
    }
  } else {
    state.scene = 'galaxy';
  }
  warpTo(() => {}, 0.6);
}

// ---- hover + click ----
let lastHud = '';
function updateHud() {
  let scene = 'Galaxy', info = '';
  if (state.scene === 'galaxy') {
    info = `${state.seed} · ${Math.round(cam.x)}, ${Math.round(cam.y)} · ×${cam.zoom.toFixed(1)}`;
  } else if (state.scene === 'system') {
    scene = 'System';
    info = `${state.star.name} · Class ${state.star.cls.c}`;
  } else if (state.scene === 'planet') {
    scene = 'Planet';
    info = `${state.star.name} ${roman(state.planet.index + 1)} · ${state.planet.biome}`;
  }
  const key = scene + info;
  if (key !== lastHud) { ui.setHud(scene, info); lastHud = key; }
}

function pointerLocal(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function updateHover(mx, my) {
  if (state.warp) { ui.hideTip(); return; }
  if (state.scene === 'galaxy') {
    const s = state.galaxy.pick(cam, mx, my);
    if (s) {
      ui.tip(state.galaxy.nameOf(s), 'Class ' + s.cls.c + ' star', cam.sx(s.x), cam.sy(s.y));
      canvas.classList.add('pointing');
      state.hover = s.id;
      return;
    }
  } else if (state.scene === 'system') {
    const idx = state.system.pick(cam.w / 2, cam.h / 2, systemScale(), time, mx, my);
    if (idx != null) {
      const p = state.system.planets[idx];
      const [px, py] = state.system.planetPos(p, time, cam.w / 2, cam.h / 2, systemScale());
      ui.tip(state.star.name + ' ' + roman(idx + 1), p.traits.biome, px, py);
      canvas.classList.add('pointing');
      state.hover = idx;
      return;
    }
  }
  ui.hideTip();
  canvas.classList.remove('pointing');
  state.hover = null;
}

function handleClick(mx, my) {
  if (state.warp) return;
  if (state.scene === 'galaxy') {
    const s = state.galaxy.pick(cam, mx, my);
    if (s) enterStar(s);
  } else if (state.scene === 'system') {
    const idx = state.system.pick(cam.w / 2, cam.h / 2, systemScale(), time, mx, my);
    if (idx != null) enterPlanet(idx);
  }
}

// ---- pointer input (mouse + touch unified) ----
const pointers = new Map();
let dragging = false, moved = 0, downX = 0, downY = 0, downT = 0;
let pinchDist = 0, pinchZoom = 0;
let commitT = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = pointerLocal(e);
  pointers.set(e.pointerId, { x, y });
  if (pointers.size === 1) {
    downX = x; downY = y; downT = performance.now(); moved = 0; dragging = false;
  } else if (pointers.size === 2) {
    const pts = [...pointers.values()];
    pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    pinchZoom = cam.zoom;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = pointerLocal(e);
  const p = pointers.get(e.pointerId);
  if (!p) { updateHover(x, y); return; }

  if (pointers.size === 1) {
    const dx = x - p.x, dy = y - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) dragging = true;
    if (dragging && state.scene === 'galaxy') {
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      cam.tx = cam.x; cam.ty = cam.y;
      canvas.classList.add('grabbing');
    }
    p.x = x; p.y = y;
  } else if (pointers.size === 2) {
    p.x = x; p.y = y;
    const pts = [...pointers.values()];
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (state.scene === 'galaxy' && pinchDist > 0) {
      zoomAt(mx, my, (pinchZoom * dist / pinchDist) / cam.zoom, false);
    }
    dragging = true;
  }
});

function endPointer(e) {
  const had = pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  canvas.classList.remove('grabbing');
  if (!had) return;
  if (pointers.size === 0) {
    if (!dragging && performance.now() - downT < 350) {
      handleClick(downX, downY);
    } else if (state.scene === 'galaxy') {
      scheduleCommit();
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function zoomAt(mx, my, factor, eased) {
  const bz = eased ? cam.tz : cam.zoom;
  const bx = eased ? cam.tx : cam.x;
  const by = eased ? cam.ty : cam.y;
  const wx = (mx - cam.w / 2) / bz + bx;
  const wy = (my - cam.h / 2) / bz + by;
  const nz = Math.max(0.35, Math.min(7, bz * factor));
  cam.tz = nz;
  cam.tx = wx - (mx - cam.w / 2) / nz;
  cam.ty = wy - (my - cam.h / 2) / nz;
  if (!eased) { cam.x = cam.tx; cam.y = cam.ty; cam.zoom = nz; }
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.scene !== 'galaxy' || state.warp) return;
  const [mx, my] = pointerLocal(e);
  zoomAt(mx, my, Math.exp(-e.deltaY * 0.0014), true);
  scheduleCommit();
}, { passive: false });

function scheduleCommit() {
  clearTimeout(commitT);
  commitT = setTimeout(commitState, 400);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') goBack();
});

// ---- warp overlay ----
const warpLines = [];
for (let i = 0; i < 90; i++) {
  warpLines.push({ a: Math.random() * TAU, r0: Math.random(), s: 0.6 + Math.random() * 1.1, len: 30 + Math.random() * 90 });
}
function drawWarp(t) {
  const cx = cam.w / 2, cy = cam.h / 2;
  const k = Math.sin(Math.min(1, t) * Math.PI);
  const maxR = Math.hypot(cam.w, cam.h) * 0.6;
  ctx.fillStyle = `rgba(3,4,10,${0.6 * k})`;
  ctx.fillRect(0, 0, cam.w, cam.h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.6;
  for (const L of warpLines) {
    const rr = (L.r0 + t * L.s) % 1;
    const dist = rr * maxR;
    const len = L.len * k * (0.4 + rr);
    const ca = Math.cos(L.a), sa = Math.sin(L.a);
    ctx.strokeStyle = `rgba(190,210,255,${0.55 * k * rr})`;
    ctx.beginPath();
    ctx.moveTo(cx + ca * dist, cy + sa * dist);
    ctx.lineTo(cx + ca * (dist - len), cy + sa * (dist - len));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---- main loop ----
let time = 0;
let lastT = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  time += dt;
  try {
    render(dt);
  } catch (err) {
    // never let one bad frame kill the whole loop
    console.error(err);
  }
  requestAnimationFrame(frame);
}

function render(dt) {
  cam.ease(0.16);

  if (state.warp) {
    const w = state.warp;
    w.t += dt / w.dur;
    if (!w.swapped && w.t >= 0.5) { w.swap(); w.swapped = true; }
    if (w.t >= 1) {
      state.warp = null;
      if (state.loading) { state.loading = false; ui.hideLoader(); }
    }
  }

  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, cam.w, cam.h);

  if (state.scene === 'intro') {
    cam.set(time * 5, Math.sin(time * 0.05) * 90, 1.08);
    introGalaxy.draw(ctx, cam, time, null);
  } else if (state.scene === 'galaxy') {
    state.galaxy.draw(ctx, cam, time, state.hover);
  } else if (state.scene === 'system') {
    state.system.draw(ctx, cam.w / 2, cam.h / 2, systemScale(), time, state.hover, cam.w, cam.h);
  } else if (state.scene === 'planet') {
    drawBackdrop(state.planetBg, time, state.planet.bake ? state.planet.bake.tint : null);
    bakePlanet(state.planet, planetRadius());
    drawPlanet(ctx, state.planet, cam.w / 2, cam.h * 0.47, time);
  }

  if (state.warp) drawWarp(state.warp.t);

  applyBloom();
  drawVignette();
  drawGrain();

  if (state.scene !== 'intro') updateHud();
}

// cheap bloom: a blurred, downscaled copy added back over the bright bits
let bloomCv = null, bloomCtx = null;
function applyBloom() {
  const bw = Math.max(1, (cam.w / 4) | 0);
  const bh = Math.max(1, (cam.h / 4) | 0);
  if (!bloomCv) { bloomCv = document.createElement('canvas'); bloomCtx = bloomCv.getContext('2d'); }
  if (bloomCv.width !== bw || bloomCv.height !== bh) { bloomCv.width = bw; bloomCv.height = bh; }
  bloomCtx.clearRect(0, 0, bw, bh);
  bloomCtx.drawImage(canvas, 0, 0, bw, bh);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.34;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bloomCv, 0, 0, cam.w, cam.h);
  ctx.restore();
}

// a few pre-baked grain tiles, dithered over the frame for a filmic feel
const grainTiles = [];
function makeGrain() {
  for (let n = 0; n < 4; n++) {
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const gc = g.getContext('2d');
    const id = gc.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 110 + ((Math.random() * 36) | 0);
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    gc.putImageData(id, 0, 0);
    grainTiles.push(g);
  }
}
let grainFrame = 0;
function drawGrain() {
  grainFrame++;
  if (grainFrame & 1) return;             // every other frame is plenty
  const t = grainTiles[(grainFrame >> 1) % grainTiles.length];
  const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  for (let y = -oy; y < cam.h; y += 128) {
    for (let x = -ox; x < cam.w; x += 128) ctx.drawImage(t, x, y);
  }
  ctx.restore();
}

let vignette = null, vigKey = '';
function drawVignette() {
  const key = cam.w + 'x' + cam.h;
  if (key !== vigKey) {
    vignette = ctx.createRadialGradient(cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.42, cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
    vigKey = key;
  }
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cam.w, cam.h);
}

// ---- boot ----
ui.on({
  enter: () => {
    const seed = ui.seedValue() || randomSeed();
    enterUniverse(seed);
  },
  random: () => ui.setSeedInput(randomSeed()),
  jump: (seed) => { ui.hideScan(); enterUniverse(seed); },
  share: async () => {
    const ok = await copy(shareLink(currentState()));
    ui.toast(ok ? 'Link copied to clipboard' : 'Could not copy link');
  },
  newU: () => {
    ui.setSeedInput(randomSeed());
    state.scene = 'intro';
    ui.showIntro();
    ui.hideScan();
    ui.hideTip();
  },
  audio: () => ui.setAudio(audio.toggle()),
  back: goBack,
});

window.addEventListener('hashchange', () => {
  const st = readState();
  if (!st) return;
  const cur = currentState();
  // replaceState (our own writes) never fires hashchange, so this only runs
  // when someone edits the hash or follows a link, browser back/forward included
  if (st.seed !== cur.seed || st.scene !== cur.scene ||
      st.starId !== cur.starId || st.planetIdx !== cur.planetIdx) {
    applyState(st);
  }
});

makeGrain();

const boot = readState();
if (boot) {
  applyState(boot);
} else {
  ui.setSeedInput(randomSeed());
  ui.showIntro();
}
requestAnimationFrame(frame);
