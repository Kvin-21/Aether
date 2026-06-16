// A slow, cinematic space drone, the kind of weightless organ pad you get in
// Interstellar or Project Hail Mary. It is all synthesised live: a stack of
// open fifths through a long synthetic reverb, with several slow LFOs breathing
// over the voices so it never quite repeats. Silent until the user asks for it.

export function makeAudio() {
  let ctx = null;
  let master = null;
  let on = false;

  // an impulse response made from decaying noise gives a believable big hall
  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function lfo(rate, depth, target, base) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = rate;
    g.gain.value = depth;
    osc.connect(g);
    g.connect(target);
    if (base != null) target.value = base;
    osc.start();
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    // a gentle limiter so the swelling voices never clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.4;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    // warm, dark filter the whole pad lives behind
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.6;
    lfo(0.03, 240, filter.frequency, 620);   // very slow sweep, it breathes

    // dry plus a long reverb send, mostly wet for that vast, distant feel
    const dry = ctx.createGain(); dry.gain.value = 0.55;
    const wet = ctx.createGain(); wet.gain.value = 0.95;
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(5.5, 2.4);
    filter.connect(dry); dry.connect(master);
    filter.connect(verb); verb.connect(wet); wet.connect(master);

    // open fifths on a low D, no thirds, so it stays vast and unresolved
    const voices = [
      { f: 36.71, g: 0.16, type: 'sine', rate: 0.045 },   // sub
      { f: 55.00, g: 0.20, type: 'sine', rate: 0.061 },   // A1
      { f: 73.42, g: 0.18, type: 'triangle', rate: 0.039 }, // D2
      { f: 110.0, g: 0.15, type: 'sine', rate: 0.052 },   // A2
      { f: 146.83, g: 0.12, type: 'triangle', rate: 0.071 }, // D3
      { f: 220.0, g: 0.09, type: 'sine', rate: 0.083 },   // A3
    ];
    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.f;
      const g = ctx.createGain();
      g.gain.value = v.g;
      lfo(v.rate, v.g * 0.55, g.gain, v.g);   // slow tremolo, each at its own pace
      lfo(v.rate * 0.5, 1.4, osc.detune, 0);  // tiny pitch drift for movement
      osc.connect(g);
      g.connect(filter);
      osc.start();
    }

    // a high shimmer that drifts in and out, almost all reverb
    const shimmerVerb = ctx.createGain(); shimmerVerb.gain.value = 0.5;
    shimmerVerb.connect(verb);
    [293.66, 440.0, 587.33].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      lfo(0.018 + i * 0.006, 0.05, g.gain, 0.05); // swells up and away
      osc.connect(g);
      g.connect(shimmerVerb);
      osc.start();
    });
  }

  function toggle() {
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    on = !on;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(on ? 0.42 : 0, t + (on ? 2.4 : 0.8));
    return on;
  }

  return { toggle, isOn: () => on };
}
