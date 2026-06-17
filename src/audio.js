export function makeAudio() {
  let ctx = null;
  let master = null, bus = null, verb = null;
  let on = false;
  let timer = null, nextBar = 0, bar = 0;
  let sfxOut = null, sfxVerb = null, noiseBuf = null;

  const tempo = 80;
  const spb = 60 / tempo;            // seconds per beat
  const barDur = spb * 4;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // chords: low root for the pedal, a mid triad for the pulse and pad
  const CH = {
    F: { bass: 41, triad: [53, 57, 60] },
    G: { bass: 43, triad: [55, 59, 62] },
    Am: { bass: 45, triad: [57, 60, 64] },
    C: { bass: 48, triad: [60, 64, 67] },
  };

  // eight bars, rising and resolving, with a sparse high melody [note, beats]
  const song = [
    { c: 'F', m: [[69, 2], [72, 2]] },   // A5 .. C5
    { c: 'G', m: [[71, 2], [74, 2]] },   // B4 .. D5
    { c: 'Am', m: [[76, 4]] },           // E5 held, the lift
    { c: 'Am', m: [[72, 2], [69, 2]] },  // C5 .. A4
    { c: 'F', m: [[69, 2], [72, 2]] },
    { c: 'G', m: [[74, 2], [71, 2]] },   // D5 .. B4
    { c: 'C', m: [[67, 2], [72, 2]] },   // G4 .. C5
    { c: 'C', m: [[79, 4]] },            // G5, the soaring resolution
  ];

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // an additive organ voice: soft attack, long tail, a few harmonics
  function voice(freq, t, dur, level, partials, attack, dest) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setValueAtTime(level * 0.8, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    env.connect(dest);
    for (const [mult, g] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og); og.connect(env);
      o.start(t); o.stop(t + dur + 0.6);
    }
  }

  const pulseParts = [[1, 1], [2, 0.4]];
  const leadParts = [[1, 1], [2, 0.4], [3, 0.14]];
  const padParts = [[1, 0.7], [2, 0.3]];

  function scheduleBar(s, t) {
    const ch = CH[s.c];
    // low pedal
    voice(midi(ch.bass), t, barDur, 0.2, [[1, 1]], 0.4, bus);
    // sustained pad on the triad
    for (const n of ch.triad) voice(midi(n), t, barDur, 0.05, padParts, 1.2, bus);
    // the triplet organ pulse, rising through two octaves of the chord
    const full = [ch.triad[0], ch.triad[1], ch.triad[2], ch.triad[0] + 12, ch.triad[1] + 12, ch.triad[2] + 12];
    const trip = spb / 3;
    for (let k = 0; k < 12; k++) {
      voice(midi(full[k % 6]), t + k * trip, trip * 1.5, 0.07, pulseParts, 0.02, bus);
    }
    // the melody, sitting loud on top
    let off = 0;
    for (const [note, beats] of s.m) {
      voice(midi(note), t + off * spb, beats * spb, 0.26, leadParts, 0.08, bus);
      off += beats;
    }
  }

  function scheduler() {
    while (nextBar < ctx.currentTime + 0.4) {
      scheduleBar(song[bar % song.length], nextBar);
      nextBar += barDur;
      bar++;
    }
  }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function makeNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // a short noise sweep, the rush of flying through space. level 0..1 scales the
  // size: the seed jump is the biggest, a star smaller, a planet smaller still.
  function whoosh(level) {
    ensureCtx();
    if (!sfxOut) {
      sfxOut = ctx.createGain();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.ratio.value = 12; lim.attack.value = 0.003;
      sfxOut.connect(lim); lim.connect(ctx.destination);
      sfxVerb = ctx.createConvolver();
      sfxVerb.buffer = makeImpulse(3.2, 2.6);
      const wet = ctx.createGain(); wet.gain.value = 0.9;
      sfxVerb.connect(wet); wet.connect(sfxOut);
      noiseBuf = makeNoise(2);
    }
    const t = ctx.currentTime;
    const dur = 0.5 + level * 0.75;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8 + level * 0.9;
    const fLow = 220 + (1 - level) * 260;
    const fHigh = 800 + level * 2400;
    bp.frequency.setValueAtTime(fLow, t);
    bp.frequency.exponentialRampToValueAtTime(fHigh, t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(fLow * 0.7, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200;

    const g = ctx.createGain();
    const peak = 0.16 + level * 0.34;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(sfxOut);
    const send = ctx.createGain(); send.gain.value = 0.2 + level * 0.45;
    g.connect(send); send.connect(sfxVerb);
    src.start(t); src.stop(t + dur + 0.1);

    // a low drop gives the bigger jumps some weight
    if (level > 0.3) {
      const so = ctx.createOscillator();
      so.type = 'sine';
      so.frequency.setValueAtTime(110 * level + 45, t);
      so.frequency.exponentialRampToValueAtTime(42, t + dur);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.13 * level, t + 0.05);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
      so.connect(sg); sg.connect(sfxOut);
      so.start(t); so.stop(t + dur);
    }
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    bus = ctx.createGain();
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2800;
    warm.Q.value = 0.4;
    bus.connect(warm);
    const dry = ctx.createGain(); dry.gain.value = 0.5;
    warm.connect(dry); dry.connect(master);
    verb = ctx.createConvolver();
    verb.buffer = makeImpulse(5, 2.2);
    const wet = ctx.createGain(); wet.gain.value = 0.95;
    warm.connect(verb); verb.connect(wet); wet.connect(master);
  }

  function toggle() {
    ensureCtx();
    if (!master) build();
    on = !on;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(on ? 0.62 : 0, t + (on ? 2.2 : 1.0));
    if (on && !timer) {
      nextBar = ctx.currentTime + 0.2;
      timer = setInterval(scheduler, 40);
    } else if (!on && timer) {
      setTimeout(() => { if (!on && timer) { clearInterval(timer); timer = null; } }, 1300);
    }
    return on;
  }

  return { toggle, isOn: () => on, whoosh };
}
