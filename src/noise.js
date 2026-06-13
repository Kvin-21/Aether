// Value noise with smooth interpolation, plus fbm on top. Seeded off the same
// hash as everything else so a region of space always looks the same.
import { hash2 } from './rng.js';

export function makeNoise(seed) {
  // hashed value at an integer lattice point, normalised to 0..1
  function lattice(x, y) {
    return (hash2(seed, x, y, 0x51ed) & 0xffff) / 65535;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = smooth(xf);
    const v = smooth(yf);
    const a = lattice(xi, yi);
    const b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1);
    const d = lattice(xi + 1, yi + 1);
    const top = a + (b - a) * u;
    const bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }

  function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Periodic-in-longitude sampling for spheres. Wrapping cos/sin keeps the
  // texture from showing a seam where the planet's far side meets itself.
  function sphere(lon, lat, freq, octaves = 4) {
    const cx = Math.cos(lon) * freq;
    const sx = Math.sin(lon) * freq;
    return (
      0.5 * fbm(cx + 11.3, lat * freq + 4.7, octaves) +
      0.5 * fbm(sx + 53.1, lat * freq + 88.2, octaves)
    );
  }

  return { noise2, fbm, sphere };
}
