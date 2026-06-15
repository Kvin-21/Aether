// A soft ambient drone, built live from a few detuned oscillators through a
// slowly sweeping filter. It stays silent until the user toggles it, so it is
// autoplay-safe and never starts on its own.

export function makeAudio() {
  let ctx = null;
  let master = null;
  let on = false;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    filter.Q.value = 0.8;
    filter.connect(master);

    // a low, open chord, a couple of voices gently detuned for movement
    const voices = [55, 82.4, 110, 164.8];
    voices.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.32 : 0.16;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    });

    // slow sweep so the pad breathes
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
  }

  function toggle() {
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    on = !on;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(on ? 0.13 : 0, t + (on ? 1.6 : 0.5));
    return on;
  }

  return { toggle, isOn: () => on };
}
