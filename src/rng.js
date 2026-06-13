// Seeded PRNG and coordinate hashing. Every star, planet and word in Aether
// is grown from these, so the same seed always rebuilds the same universe.

export function hashString(str) {
  // xfnv1a, good enough spread for a 32-bit seed
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // a couple of avalanche steps so short seeds ("1", "a") still scatter well
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix a handful of integers (plus the universe seed) into a fresh 32-bit value.
// This is how a point in space gets its own deterministic identity.
export function hash2(seed, x, y, salt = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (y | 0), 0x165667b1) >>> 0;
  h = Math.imul(h ^ (salt | 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function rngFrom(seed, x, y, salt = 0) {
  return mulberry32(hash2(seed, x, y, salt));
}

// Small conveniences. They all take an rng() that returns [0,1).
export function range(rng, a, b) {
  return a + (b - a) * rng();
}

export function intRange(rng, a, b) {
  return Math.floor(a + (b - a + 1) * rng());
}

export function pick(rng, arr) {
  return arr[(rng() * arr.length) | 0];
}

export function chance(rng, p) {
  return rng() < p;
}

// Weighted pick: items is [{ w, ... }], returns the chosen item.
export function weighted(rng, items) {
  let total = 0;
  for (const it of items) total += it.w;
  let r = rng() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
