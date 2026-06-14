// Thin wrapper over the DOM overlays: intro, HUD, scan panel, hover tip, toast.
// main.js owns the state; this just shows things and forwards clicks.

const $ = (id) => document.getElementById(id);

const els = {
  intro: $('intro'), seedInput: $('seedInput'), randomBtn: $('randomBtn'),
  enterBtn: $('enterBtn'), hud: $('hud'), backBtn: $('backBtn'),
  hudScene: $('hudScene'), hudInfo: $('hudInfo'), shareBtn: $('shareBtn'),
  newBtn: $('newBtn'), jumpInput: $('jumpInput'), scan: $('scan'),
  tip: $('tip'), toast: $('toast'),
};

export const ui = {
  el: els,

  on(handlers) {
    if (handlers.enter) els.enterBtn.addEventListener('click', handlers.enter);
    if (handlers.random) els.randomBtn.addEventListener('click', handlers.random);
    if (handlers.share) els.shareBtn.addEventListener('click', handlers.share);
    if (handlers.newU) els.newBtn.addEventListener('click', handlers.newU);
    if (handlers.back) els.backBtn.addEventListener('click', handlers.back);
    if (handlers.enter) {
      els.seedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handlers.enter();
      });
    }
    if (handlers.jump) {
      els.jumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && els.jumpInput.value.trim()) {
          handlers.jump(els.jumpInput.value.trim());
          els.jumpInput.value = '';
          els.jumpInput.blur();
        }
      });
    }
  },

  seedValue() {
    return els.seedInput.value.trim();
  },
  setSeedInput(v) {
    els.seedInput.value = v;
  },

  showIntro() {
    els.intro.classList.remove('hidden');
    els.seedInput.focus();
  },
  hideIntro() {
    els.intro.classList.add('hidden');
  },

  showHud() { els.hud.classList.remove('hidden'); },
  setHud(scene, info) {
    els.hudScene.textContent = scene;
    els.hudInfo.textContent = info || '';
  },
  setBack(visible) {
    els.backBtn.style.visibility = visible ? 'visible' : 'hidden';
  },

  tip(text, sub, x, y) {
    els.tip.innerHTML = sub ? `${text}<br><span class="small">${sub}</span>` : text;
    els.tip.style.left = x + 'px';
    els.tip.style.top = y + 'px';
    els.tip.classList.remove('hidden');
  },
  hideTip() { els.tip.classList.add('hidden'); },

  showScan(data) {
    const stats = data.stats.map((s) => `
      <div class="stat"><span class="k">${s.k}</span><span class="v">${s.v}</span></div>`).join('');
    const lore = data.lore.map((l) => l).join(' ');
    els.scan.innerHTML = `
      <h2>${data.name}</h2>
      <p class="sub">${data.sub}</p>
      <div class="grid">${stats}</div>
      <p class="lore">${lore}</p>`;
    els.scan.classList.remove('hidden');
  },
  hideScan() { els.scan.classList.add('hidden'); },

  toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    // force reflow so the transition runs every time
    void els.toast.offsetWidth;
    els.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      els.toast.classList.remove('show');
      setTimeout(() => els.toast.classList.add('hidden'), 280);
    }, 1700);
  },
};

// Format planet traits into the rows the scan panel shows.
export function scanData(name, t, lore) {
  const km = t.radiusKm.toLocaleString('en-GB');
  const day = t.dayHours >= 120
    ? (t.dayHours / 24).toFixed(1) + ' days'
    : t.dayHours + ' h';
  return {
    name,
    sub: t.habitable ? 'Habitable ' + t.biome : t.biome,
    stats: [
      { k: 'Radius', v: km + ' km' },
      { k: 'Gravity', v: t.gravity + ' g' },
      { k: 'Surface', v: t.tempC + ' °C' },
      { k: 'Atmosphere', v: t.atmosphere },
      { k: 'Day', v: day },
      { k: 'Moons', v: String(t.moons) },
    ],
    lore,
  };
}
