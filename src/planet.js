// Planets. Each is baked once into an offscreen canvas as an equirectangular
// albedo strip, then a per-pixel lookup turns that strip into a lit, rotating
// sphere. The geometry (normals, lighting, latitude, specular) is fixed; only
// the longitude we sample shifts each frame, so a cloud layer, sun glint and
// ring shadow all ride along for almost nothing.
import { mulberry32, hash2, range, intRange, pick, chance, weighted } from './rng.js';
import { makeNoise } from './noise.js';

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function mix3(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

const biomeNames = {
  terran: ['Temperate', 'Continental', 'Verdant', 'Tropical'],
  ocean: ['Oceanic', 'Archipelagic', 'Tidal'],
  desert: ['Arid', 'Desert', 'Dune Sea'],
  ice: ['Glacial', 'Frozen', 'Tundra'],
  lava: ['Volcanic', 'Molten', 'Cracked'],
  barren: ['Barren', 'Rocky', 'Cratered'],
  gas: ['Gas Giant', 'Ice Giant', 'Storm Giant'],
};

const atmoByKind = {
  terran: [{ a: 'Oxygen', w: 5 }, { a: 'Nitrogen', w: 4 }, { a: 'Carbon Dioxide', w: 1 }],
  ocean: [{ a: 'Nitrogen', w: 4 }, { a: 'Oxygen', w: 4 }, { a: 'Carbon Dioxide', w: 1 }],
  desert: [{ a: 'Carbon Dioxide', w: 4 }, { a: 'Thin', w: 3 }, { a: 'Toxic', w: 1 }],
  ice: [{ a: 'Trace', w: 4 }, { a: 'Thin', w: 3 }, { a: 'Nitrogen', w: 2 }],
  lava: [{ a: 'Toxic', w: 4 }, { a: 'Carbon Dioxide', w: 3 }, { a: 'Methane', w: 1 }],
  barren: [{ a: 'None', w: 5 }, { a: 'Trace', w: 3 }],
  gas: [{ a: 'Hydrogen', w: 5 }, { a: 'Methane', w: 2 }],
};

const atmoTint = {
  Oxygen: [136, 182, 255], Nitrogen: [150, 175, 230], 'Carbon Dioxide': [220, 180, 120],
  Methane: [150, 200, 180], Hydrogen: [210, 190, 230], Toxic: [180, 220, 120],
  Thin: [150, 170, 210], Trace: [140, 150, 180], None: [120, 130, 160],
};

const atmoStrength = {
  Oxygen: 0.6, Nitrogen: 0.5, 'Carbon Dioxide': 0.45, Methane: 0.46,
  Hydrogen: 0.62, Toxic: 0.42, Thin: 0.22, Trace: 0.12, None: 0.05,
};

const palettes = {
  terran: { deep: [14, 42, 92], sea: [30, 96, 156], beach: [196, 188, 150],
    low: [56, 116, 68], high: [122, 142, 78], peak: [126, 112, 96], ice: [236, 242, 250] },
  ocean: { deep: [10, 38, 90], sea: [24, 88, 154], beach: [180, 186, 156],
    low: [66, 122, 92], high: [108, 134, 96], peak: [150, 160, 150], ice: [232, 240, 250] },
  desert: { deep: [120, 60, 36], sea: [150, 84, 48], beach: [198, 138, 84],
    low: [212, 150, 88], high: [232, 184, 120], peak: [245, 224, 186], ice: [240, 222, 200] },
  ice: { deep: [120, 150, 190], sea: [150, 180, 214], beach: [186, 208, 234],
    low: [206, 224, 244], high: [228, 240, 250], peak: [245, 250, 255], ice: [255, 255, 255] },
  lava: { deep: [24, 16, 18], sea: [44, 28, 28], beach: [70, 40, 36],
    low: [38, 24, 24], high: [72, 44, 38], peak: [150, 70, 40], ice: [60, 40, 40] },
  barren: { deep: [42, 40, 46], sea: [64, 60, 64], beach: [96, 90, 88],
    low: [110, 104, 100], high: [142, 134, 126], peak: [176, 170, 160], ice: [202, 202, 208] },
};

const gasBands = [
  [[214, 198, 168], [178, 150, 110], [150, 116, 78], [118, 86, 58]],
  [[224, 228, 234], [172, 198, 222], [120, 158, 198], [84, 118, 168]],
  [[232, 202, 182], [202, 140, 110], [160, 96, 84], [118, 68, 70]],
  [[202, 212, 202], [150, 186, 168], [108, 150, 140], [78, 116, 112]],
];

const cloudCover = {
  terran: [0.34, 0.6], ocean: [0.4, 0.66], desert: [0.08, 0.28],
  ice: [0.22, 0.46], lava: [0, 0], barren: [0, 0], gas: [0, 0],
};

export function planetTraits(star, index, count, orbitNorm) {
  const rng = mulberry32(hash2(star.seed, index + 1, 0x71a, 0x9d));
  const dist = 0.32 + orbitNorm * 1.7;
  const insol = (star.cls.temp / 5600) / (dist * dist);
  const tempK = 278 * Math.pow(Math.max(0.02, insol), 0.25) * range(rng, 0.9, 1.12);
  const tempC = Math.round(tempK - 273);

  let kind;
  const giant = (orbitNorm > 0.5 && chance(rng, 0.5)) || chance(rng, 0.14);
  if (giant) kind = 'gas';
  else if (tempC > 430) kind = 'lava';
  else if (tempC < -75) kind = chance(rng, 0.7) ? 'ice' : 'barren';
  else if (tempC > 95) kind = chance(rng, 0.6) ? 'desert' : 'barren';
  else if (tempC > -20 && tempC < 55 && chance(rng, 0.62)) kind = chance(rng, 0.55) ? 'terran' : 'ocean';
  else kind = pick(rng, ['barren', 'desert', 'ice', 'terran']);

  const atmosphere = weighted(rng, atmoByKind[kind]).a;
  const habitable = (kind === 'terran' || kind === 'ocean') &&
    atmosphere === 'Oxygen' && tempC > -5 && tempC < 45;

  let radiusKm, gravity;
  if (kind === 'gas') {
    radiusKm = Math.round(range(rng, 24000, 72000));
    gravity = +(range(rng, 0.9, 2.7)).toFixed(2);
  } else {
    radiusKm = Math.round(range(rng, 2300, 8200));
    gravity = +clamp((radiusKm / 6371) * range(rng, 0.7, 1.3), 0.05, 3.4).toFixed(2);
  }

  const dayHours = chance(rng, 0.12)
    ? Math.round(range(rng, 200, 900))
    : Math.round(range(rng, kind === 'gas' ? 8 : 12, kind === 'gas' ? 22 : 70));

  const tilt = range(rng, 0.2, 0.44);
  const moonObjs = [];
  const mcount = kind === 'gas'
    ? intRange(rng, 0, 4)
    : weighted(rng, [{ v: 0, w: 5 }, { v: 1, w: 4 }, { v: 2, w: 2 }, { v: 3, w: 1 }]).v;
  let mo = 1.7;
  for (let i = 0; i < mcount; i++) {
    mo += range(rng, 0.55, 1.1);
    const g = 150 + ((rng() * 90) | 0);
    moonObjs.push({
      orbit: mo, size: range(rng, 0.1, 0.2), phase: rng() * TAU,
      speed: (chance(rng, 0.85) ? 1 : -1) * (0.25 + rng() * 0.4) / Math.sqrt(mo),
      col: `rgb(${g},${g - 8},${g - 16})`,
    });
  }

  const hasRings = kind === 'gas' ? chance(rng, 0.55) : chance(rng, 0.06);

  let colour;
  if (kind === 'gas') {
    const band = gasBands[hash2(star.seed, index, 7, 0) % gasBands.length][1];
    colour = `rgb(${band[0]},${band[1]},${band[2]})`;
  } else {
    const p = palettes[kind];
    const c = habitable ? p.low : kind === 'ice' ? p.high : p.beach;
    colour = `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  let biome = pick(rng, biomeNames[kind]);
  if (kind === 'gas') biome = tempC < -120 ? 'Ice Giant' : tempC > 80 ? 'Storm Giant' : 'Gas Giant';

  const cc = cloudCover[kind];
  return {
    star, index, kind, tempC, atmosphere, habitable, radiusKm, gravity,
    dayHours, moons: moonObjs.length, moonObjs, hasRings, colour, biome, tilt,
    cloudCover: range(rng, cc[0], cc[1]),
    seed: hash2(star.seed, index + 1, 0x55, 0x3),
    spin: (0.05 + (12 / dayHours) * 0.02) * (chance(rng, 0.5) ? 1 : -1),
    bake: null,
  };
}

// a seeded warm/cool and brightness grade so two worlds of the same kind never
// look quite alike
function colourGrade(seed, strength) {
  const r = mulberry32((seed ^ 0x6c1d) >>> 0);
  const warm = (r() * 2 - 1) * 0.2 * strength;
  const green = (r() * 2 - 1) * 0.12 * strength;
  const bright = 0.88 + r() * 0.22;
  return [
    Math.max(0, (1 + warm) * bright),
    Math.max(0, (1 + green) * bright),
    Math.max(0, (1 - warm) * bright),
  ];
}

const reliefBy = { barren: 7.5, desert: 5.5, terran: 4, ocean: 3, ice: 2.6, lava: 0 };

function buildAlbedo(traits, TW, TH) {
  const noise = makeNoise((traits.seed ^ 0x9e37) >>> 0);
  const out = new Uint8ClampedArray(TW * TH * 3);
  const spec = new Uint8Array(TW * TH);
  const kind = traits.kind;
  const tmp = [0, 0, 0];
  let p = 0, s = 0;

  if (kind === 'gas') {
    const bands = gasBands[(traits.seed >>> 3) % gasBands.length];
    const swirl = makeNoise((traits.seed ^ 0x1234) >>> 0);
    const grade = colourGrade(traits.seed, 0.6);
    // a great storm oval, like Jupiter's red spot, on most giants
    const sr = mulberry32((traits.seed ^ 0x57033) >>> 0);
    const hasStorm = sr() < 0.7;
    const slat = (sr() * 0.7 - 0.35) * Math.PI;
    const slon = sr() * TAU;
    const swl = 0.5 + sr() * 0.5, shl = 0.16 + sr() * 0.12;
    const storm = [220, 150, 110];
    for (let y = 0; y < TH; y++) {
      const lat = (y / TH - 0.5) * Math.PI;
      for (let x = 0; x < TW; x++, p += 3, s++) {
        const lon = (x / TW) * TAU;
        const warp = (swirl.sphere(lon, lat * 0.7, 2.0, 3) - 0.5) * 0.5;
        const v = Math.sin((lat * 5.5) + warp * 3.2) * 0.5 + 0.5;
        const turb = noise.sphere(lon, lat, 5.0, 4);
        const band = clamp(v * 3 + (turb - 0.5) * 1.1, 0, 3);
        mix3(bands[band | 0], bands[Math.min(3, (band | 0) + 1)], band - (band | 0), tmp);
        if (hasStorm) {
          let dl = Math.abs(lon - slon); if (dl > Math.PI) dl = TAU - dl;
          const ed = (dl / swl) ** 2 + ((lat - slat) / shl) ** 2;
          if (ed < 1) {
            const sw = noise.sphere(lon * 1.5, lat * 1.5, 6.0, 3);
            mix3(tmp, storm, smoothstep(1, 0.2, ed) * (0.6 + sw * 0.4), tmp);
          }
        }
        out[p] = tmp[0] * grade[0]; out[p + 1] = tmp[1] * grade[1]; out[p + 2] = tmp[2] * grade[2];
      }
    }
    return { albedo: out, spec };
  }

  const pal = palettes[kind];
  const grade = colourGrade(traits.seed, kind === 'terran' || kind === 'ocean' ? 0.7 : 1);
  const relief = reliefBy[kind] || 4;
  const seaLevel = kind === 'ocean' ? 0.62 : kind === 'desert' || kind === 'barren' ? 0.16 : 0.48;
  const hasWater = kind === 'terran' || kind === 'ocean';
  const iceCap = kind === 'ice' ? 0 : hasWater ? 0.74 : 0.9;

  function height(lon, lat) {
    let e = noise.sphere(lon, lat, 2.7, 4) * 0.78 + noise.sphere(lon, lat, 7.5, 3) * 0.22;
    if (kind === 'barren') {
      const r = noise.sphere(lon + 9, lat, 5.5, 3);
      e = e * 0.55 + (1 - Math.abs(r * 2 - 1)) * 0.45;     // pitted, cratered
    } else if (kind === 'desert') {
      const w = noise.sphere(lon, lat, 3.0, 2);
      e = e * 0.82 + (Math.sin(lat * 52 + w * 12) * 0.5 + 0.5) * 0.18;  // dunes
    } else if (kind === 'ice') {
      const f = noise.sphere(lon + 3, lat, 6.0, 2);
      e = e * 0.85 + (1 - Math.abs(f * 2 - 1)) * 0.15;     // ridged frost
    }
    return e;
  }

  // bake the height field once so the relief shading can read neighbours
  const H = new Float32Array(TW * TH);
  let hi = 0;
  for (let y = 0; y < TH; y++) {
    const lat = (y / TH - 0.5) * Math.PI;
    for (let x = 0; x < TW; x++) H[hi++] = height((x / TW) * TAU, lat);
  }

  for (let y = 0; y < TH; y++) {
    const lat = (y / TH - 0.5) * Math.PI;
    const latAbs = Math.abs(y / TH - 0.5) * 2;
    const row = y * TW;
    for (let x = 0; x < TW; x++, p += 3, s++) {
      const lon = (x / TW) * TAU;
      const e = H[row + x];
      let isWater = false;

      if (hasWater && e < seaLevel) {
        mix3(pal.deep, pal.sea, smoothstep(0.2, 1, e / seaLevel), tmp);
        isWater = true;
      } else {
        const t = (e - seaLevel) / (1 - seaLevel);
        if (kind === 'lava') {
          mix3(pal.low, pal.high, smoothstep(0, 0.6, t), tmp);
          const crack = noise.sphere(lon, lat, 9.0, 3);
          if (crack > 0.64) {
            const glow = smoothstep(0.64, 0.86, crack);
            tmp[0] = lerp(tmp[0], 255, glow);
            tmp[1] = lerp(tmp[1], 120, glow * 0.9);
            tmp[2] = lerp(tmp[2], 40, glow * 0.7);
          }
        } else if (hasWater) {
          if (t < 0.04) mix3(pal.beach, pal.low, t / 0.04, tmp);
          else if (t < 0.6) mix3(pal.low, pal.high, (t - 0.04) / 0.56, tmp);
          else mix3(pal.high, pal.peak, smoothstep(0.6, 1, t), tmp);
        } else {
          if (t < 0.4) mix3(pal.low, pal.high, t / 0.4, tmp);
          else mix3(pal.high, pal.peak, smoothstep(0.4, 1, t), tmp);
        }
      }

      // ice fractures, thin bright veins through the frost
      if (kind === 'ice') {
        const fr = noise.sphere(lon + 5, lat, 11.0, 2);
        if (fr > 0.68) mix3(tmp, [232, 244, 255], smoothstep(0.68, 0.82, fr) * 0.6, tmp);
      }

      // relief: shade the land by its local slope so terrain reads as 3D
      if (!isWater && relief > 0) {
        const east = H[row + (x + 1) % TW];
        const south = y < TH - 1 ? H[row + TW + x] : e;
        const sh = clamp(1 - ((east - e) + (south - e)) * relief, 0.62, 1.42);
        tmp[0] *= sh; tmp[1] *= sh; tmp[2] *= sh;
      }

      if (kind !== 'lava') {
        const edge = iceCap - noise.sphere(lon, lat, 4.0, 2) * 0.16;
        if (latAbs > edge) {
          mix3(tmp, pal.ice, smoothstep(edge, Math.min(1, edge + 0.12), latAbs), tmp);
          isWater = false;
        }
      }

      out[p] = tmp[0] * grade[0]; out[p + 1] = tmp[1] * grade[1]; out[p + 2] = tmp[2] * grade[2];
      spec[s] = isWater ? 255 : 0;
    }
  }
  return { albedo: out, spec };
}

function buildClouds(traits, TW, TH) {
  const cover = traits.cloudCover;
  const map = new Uint8Array(TW * TH);
  if (cover <= 0.001) return map;
  const noise = makeNoise((traits.seed ^ 0x5c10) >>> 0);
  const thresh = 1 - cover;
  let s = 0;
  for (let y = 0; y < TH; y++) {
    const lat = (y / TH - 0.5) * Math.PI;
    for (let x = 0; x < TW; x++, s++) {
      const lon = (x / TW) * TAU;
      let d = noise.sphere(lon, lat, 3.2, 5);
      d = d * 0.7 + noise.sphere(lon + 4, lat, 6.5, 3) * 0.3;
      map[s] = d > thresh ? Math.min(255, ((d - thresh) / (1 - thresh)) * 320) : 0;
    }
  }
  return map;
}

export function bakePlanet(traits, R) {
  R = Math.round(R);
  if (traits.bake && traits.bake.R === R) return traits.bake;
  const D = R * 2;
  const TW = 320, TH = 160;
  const { albedo, spec } = buildAlbedo(traits, TW, TH);
  const clouds = buildClouds(traits, TW, TH);
  const hasClouds = traits.cloudCover > 0.001;

  const cv = document.createElement('canvas');
  cv.width = cv.height = D;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(D, D);

  const N = D * D;
  const inside = new Uint8Array(N);
  const li = new Float32Array(N);
  const lon0 = new Float32Array(N);
  const rowBase = new Int32Array(N);
  const rim = new Float32Array(N);
  const specB = new Uint8Array(N);

  let lx = -0.55, ly = -0.6, lz = 0.58;
  const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  // half vector for a Blinn specular, viewer down +z
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const ambient = 0.08;

  let k = 0;
  for (let j = 0; j < D; j++) {
    const ny = (j - R + 0.5) / R;
    for (let i = 0; i < D; i++, k++) {
      const nx = (i - R + 0.5) / R;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) { inside[k] = 0; continue; }
      const nz = Math.sqrt(1 - d2);
      inside[k] = 1;
      const lambert = clamp(nx * lx + ny * ly + nz * lz, 0, 1);
      li[k] = ambient + (1 - ambient) * lambert;
      const lat = Math.asin(clamp(ny, -1, 1));
      let row = ((lat / Math.PI + 0.5) * TH) | 0;
      if (row >= TH) row = TH - 1;
      rowBase[k] = row * TW;
      lon0[k] = Math.atan2(nx, nz) / TAU;
      rim[k] = Math.pow(1 - nz, 2.6);
      const sp = nx * hx + ny * hy + nz * hz;
      specB[k] = sp > 0 ? (Math.pow(sp, 60) * 255) | 0 : 0;
    }
  }

  traits.bake = {
    R, D, cv, ctx, img, albedo, spec, clouds, hasClouds, TW, TH,
    inside, li, lon0, rowBase, rim, specB,
    tint: atmoTint[traits.atmosphere] || [150, 170, 210],
    atmK: atmoStrength[traits.atmosphere] != null ? atmoStrength[traits.atmosphere] : 0.3,
    cloudShift: Math.round(0.02 * TW),
  };
  return traits.bake;
}

function paintSurface(traits, time) {
  const b = traits.bake;
  const R = b.R;
  const rot = time * traits.spin;
  const rotC = rot * 1.25 + 0.05;     // clouds drift a touch faster
  const data = b.img.data;
  const { inside, li, lon0, rowBase, rim, specB, albedo, clouds, spec, TW, tint, atmK, hasClouds, cloudShift } = b;
  const N = b.D * b.D;
  const tr = tint[0], tg = tint[1], tb = tint[2];

  for (let k = 0, q = 0; k < N; k++, q += 4) {
    if (!inside[k]) { data[q + 3] = 0; continue; }
    const rb = rowBase[k];
    let u = lon0[k] + rot;
    u -= Math.floor(u);
    let tx = (u * TW) | 0; if (tx >= TW) tx = TW - 1;
    const texel = rb + tx;
    const ti = texel * 3;
    const l = li[k];

    let cr = albedo[ti], cg = albedo[ti + 1], cb = albedo[ti + 2];

    if (hasClouds) {
      let uc = lon0[k] + rotC;
      uc -= Math.floor(uc);
      let cx = (uc * TW) | 0; if (cx >= TW) cx = TW - 1;
      const cd = clouds[rb + cx] / 255;
      if (cd > 0) {
        // soft shadow cast onto the ground just sunward of the cloud
        let sx = cx - cloudShift; if (sx < 0) sx += TW;
        const sh = clouds[rb + sx] / 255;
        const dark = 1 - 0.4 * sh;
        cr = lerp(cr * dark, 245, cd);
        cg = lerp(cg * dark, 248, cd);
        cb = lerp(cb * dark, 255, cd);
      }
    }

    let r = cr * l, g = cg * l, bl = cb * l;

    // sun glint on water, killed under cloud
    const sb = specB[k];
    if (sb && spec[texel]) {
      const gl = sb * 0.85;
      r += gl; g += gl; bl += gl;
    }

    // atmosphere limb, brightest on the lit edge (forward scatter)
    const rm = rim[k] * atmK * (0.3 + 0.9 * l);
    r += tr * rm; g += tg * rm; bl += tb * rm;

    data[q] = r > 255 ? 255 : r;
    data[q + 1] = g > 255 ? 255 : g;
    data[q + 2] = bl > 255 ? 255 : bl;
    data[q + 3] = 255;
  }
  b.ctx.putImageData(b.img, 0, 0);
}

function drawRingArc(ctx, traits, cx, cy, R, near) {
  const b = traits.ringInfo;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, near ? cy : cy - R * 3, ctx.canvas.width, R * 3);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.scale(1, b.tilt);
  for (let i = 0; i < b.bands.length; i++) {
    const band = b.bands[i];
    ctx.globalAlpha = band.a;
    ctx.strokeStyle = b.colour;
    ctx.lineWidth = band.w * R;
    ctx.beginPath();
    ctx.arc(0, 0, band.r * R, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRingShadow(ctx, traits, cx, cy, R) {
  const b = traits.ringInfo;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 0.5, 0, TAU);
  ctx.clip();
  ctx.translate(cx, cy);
  // the shadow falls opposite the light (down and right), squashed onto the globe
  ctx.transform(1, 0, -0.35, b.tilt * 1.05, 0, R * 0.12);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < b.bands.length; i++) {
    const band = b.bands[i];
    ctx.globalAlpha = band.a * 0.7;
    ctx.strokeStyle = '#0a0c14';
    ctx.lineWidth = band.w * R;
    ctx.beginPath();
    ctx.arc(0, 0, band.r * R, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawMoon(ctx, m, mx, my, r, lx, ly) {
  const grd = ctx.createRadialGradient(mx - lx * r * 0.6, my - ly * r * 0.6, r * 0.1, mx, my, r);
  grd.addColorStop(0, m.col.replace('rgb', 'rgba').replace(')', ',1)'));
  grd.addColorStop(0.5, m.col);
  grd.addColorStop(1, '#0a0a12');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, TAU);
  ctx.fill();
}

export function drawPlanet(ctx, traits, cx, cy, time) {
  const b = traits.bake;
  if (!b) return;
  const R = b.R;
  paintSurface(traits, time);

  if (traits.hasRings && !traits.ringInfo) buildRing(traits);

  // moons behind the planet
  const lx = -0.55, ly = -0.6;
  const moons = traits.moonObjs;
  const placed = [];
  for (const m of moons) {
    const a = m.phase + time * m.speed * 0.6;
    const mx = cx + Math.cos(a) * m.orbit * R;
    const my = cy + Math.sin(a) * m.orbit * R * traits.tilt;
    placed.push({ m, mx, my, z: Math.sin(a) });
  }
  placed.sort((p, q) => p.z - q.z);
  for (const pm of placed) if (pm.z <= 0) drawMoon(ctx, pm.m, pm.mx, pm.my, pm.m.size * R, lx, ly);

  if (traits.hasRings) drawRingArc(ctx, traits, cx, cy, R, false);

  // soft atmosphere halo
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const tr = b.tint[0], tg = b.tint[1], tb = b.tint[2];
  const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.45);
  halo.addColorStop(0, `rgba(${tr},${tg},${tb},${0.5 * b.atmK + 0.05})`);
  halo.addColorStop(1, `rgba(${tr},${tg},${tb},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.45, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(b.cv, cx - R, cy - R);
  if (traits.hasRings) drawRingShadow(ctx, traits, cx, cy, R);

  // moons in front
  for (const pm of placed) if (pm.z > 0) drawMoon(ctx, pm.m, pm.mx, pm.my, pm.m.size * R, lx, ly);
  if (traits.hasRings) drawRingArc(ctx, traits, cx, cy, R, true);
}

function buildRing(traits) {
  const rng = mulberry32((traits.seed ^ 0x2a51) >>> 0);
  const base = traits.kind === 'gas' ? [222, 212, 190] : [200, 196, 206];
  const bands = [];
  let r = 1.34;
  const n = 5 + ((traits.seed >>> 4) & 3);
  for (let i = 0; i < n; i++) {
    bands.push({ r, w: range(rng, 0.04, 0.12), a: range(rng, 0.12, 0.42) });
    r += range(rng, 0.08, 0.2);
  }
  traits.ringInfo = {
    tilt: Math.max(0.16, traits.tilt * 0.8),
    colour: `rgb(${base[0]},${base[1]},${base[2]})`,
    bands,
  };
}
