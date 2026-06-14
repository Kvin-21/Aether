// Names and lore, stitched from seeded word banks. Nothing here is downloaded;
// it is all picked deterministically so a world keeps its name forever.
import { pick, chance, range } from './rng.js';

const heads = ['Vel', 'Kae', 'Tyr', 'Zan', 'Oph', 'Cyg', 'Lyr', 'Dra', 'Cor', 'Mir',
  'Sol', 'Ari', 'Cas', 'Vir', 'Nor', 'Hel', 'Eos', 'Ner', 'Tal', 'Ux', 'Ith', 'Qel',
  'Vor', 'Ash', 'Rhe', 'Syl', 'Obs', 'Pyr', 'Wen', 'Fae'];

const mids = ['ar', 'en', 'is', 'or', 'un', 'el', 'ix', 'os', 'ae', 'yr', 'an', 'ed',
  'ul', 'ith', 'and', 'ess'];

const tails = ['a', 'us', 'is', 'ion', 'ara', 'ex', 'oth', 'een', 'iel', 'os', 'une',
  'yx', 'ora', 'ix', 'eth', 'ai'];

const designations = ['Majoris', 'Minoris', 'Prime', 'Borealis', 'Australis', 'Nadir',
  'Caelum', 'Veil', 'Reach', 'Gate', 'Cradle', 'Mourn'];

const greek = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Omega', 'Xi', 'Phi'];

const letters = 'ABCDEFGHJKLMNPRSTVXYZ';

const romanOnes = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const romanTens = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'];

export function roman(n) {
  if (n < 1) return 'I';
  return romanTens[(n / 10) | 0] + romanOnes[n % 10];
}

export function starName(rng) {
  const style = rng();
  if (style < 0.45) {
    // proper-ish name, two or three syllables
    let name = pick(rng, heads);
    if (chance(rng, 0.6)) name += pick(rng, mids);
    name += pick(rng, tails);
    if (chance(rng, 0.28)) name += ' ' + pick(rng, designations);
    return name;
  }
  if (style < 0.75) {
    // catalogue designation, greek + a three-letter code + number
    let code = '';
    for (let i = 0; i < 3; i++) code += letters[(rng() * letters.length) | 0];
    return pick(rng, greek) + ' ' + code + '-' + (100 + ((rng() * 8900) | 0));
  }
  // bare catalogue id, the cold survey style
  let code = '';
  for (let i = 0; i < 2; i++) code += letters[(rng() * letters.length) | 0];
  return code + '-' + (1000 + ((rng() * 8000) | 0));
}

const worldAdjectives = {
  terran: ['temperate', 'verdant', 'storm-laced', 'oceanic', 'mild', 'restless'],
  ocean: ['drowned', 'endless', 'tidal', 'glittering', 'fathomless'],
  desert: ['parched', 'rust-red', 'wind-scoured', 'sunbaked', 'dune-wrapped'],
  ice: ['frozen', 'glacial', 'pale', 'silent', 'crystalline'],
  lava: ['molten', 'smouldering', 'fractured', 'volcanic', 'glowing'],
  barren: ['airless', 'cratered', 'grey', 'lifeless', 'still'],
  gas: ['banded', 'churning', 'colossal', 'tempestuous', 'swirling'],
};

const skyWords = {
  None: 'a thin, breathless sky',
  Trace: 'a whisper of an atmosphere',
  Thin: 'thin, brittle air',
  Nitrogen: 'a pale nitrogen sky',
  'Carbon Dioxide': 'a heavy carbon haze',
  Oxygen: 'breathable, blue-tinged air',
  Methane: 'a bruised methane haze',
  Hydrogen: 'crushing hydrogen cloudbanks',
  Toxic: 'a sky thick with acid cloud',
};

const closers = [
  'No survey has ever returned from its far side.',
  'The catalogue lists it, and little else.',
  'Long-range scans flag it as worth a closer look.',
  'A handful of probes drift in its orbit, long silent.',
  'Nothing here remembers being watched.',
  'It turns, indifferent, exactly as it always has.',
  'Old charts mark it with a single warning glyph.',
  'Its day and night trade places without witness.',
  'A good place to be forgotten in.',
  'The light that reaches it left its star an age ago.',
  'Explorers note the view, and move on.',
];

const lifeHints = [
  'Faint organic signatures cling to the terminator line.',
  'Spectral lines hint at something stirring below.',
  'Chlorophyll-green glints back from the long valleys.',
  'Chemistry here sits right on the edge of becoming.',
  'Something down there is breathing, slowly.',
];

const deadHints = [
  'The scan finds no life, only the patience of stone.',
  'Nothing has ever drawn breath here.',
  'A clean, dead spectrum, top to bottom.',
];

function gravityNote(g) {
  if (g < 0.4) return 'You could almost step off it.';
  if (g < 0.85) return 'A light pull, easy on the bones.';
  if (g > 2.2) return 'Its gravity would pin you flat.';
  if (g > 1.4) return 'Heavy underfoot, every step earned.';
  return null;
}

function moonNote(n) {
  if (n === 0) return null;
  if (n === 1) return 'A single moon keeps it company.';
  return `${n} moons trade places across its skies.`;
}

function tempNote(c) {
  if (c < -120) return 'Cold enough to freeze the air itself.';
  if (c > 600) return 'Hot enough to run rock like water.';
  return null;
}

export function planetLore(rng, traits) {
  const adjs = worldAdjectives[traits.kind] || worldAdjectives.barren;
  const adj = pick(rng, adjs);
  const sky = skyWords[traits.atmosphere] || 'an uncertain sky';
  const lines = [];
  lines.push(`A ${adj} ${traits.kind === 'gas' ? 'giant' : 'world'} beneath ${sky}.`);

  const extras = [];
  extras.push(pick(rng, traits.habitable ? lifeHints : deadHints));
  const g = gravityNote(traits.gravity); if (g) extras.push(g);
  const t = tempNote(traits.tempC); if (t) extras.push(t);
  const m = moonNote(traits.moons); if (m && chance(rng, 0.7)) extras.push(m);
  extras.push(pick(rng, closers));

  // take one or two of the flavour lines, shuffled by the seed
  const wanted = chance(rng, 0.5) ? 2 : 1;
  for (let i = 0; i < wanted && extras.length; i++) {
    lines.push(extras.splice((rng() * extras.length) | 0, 1)[0]);
  }
  return lines;
}

// Used for the galaxy/system flavour line under a star's name.
const systemNotes = [
  'a quiet system on no major route',
  'charted once, then forgotten',
  'a waypoint for ships with nowhere to be',
  'older than most of the stars around it',
  'wrapped in the last light of its making',
];

export function systemNote(rng) {
  return pick(rng, systemNotes);
}
