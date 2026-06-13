// Read and write the whole exploration state to the URL hash, so a link drops
// someone into the exact same universe and spot. Nothing is stored server side.

export function readState() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const q = new URLSearchParams(h);
  const seed = q.get('s');
  if (!seed) return null;
  return {
    seed,
    scene: q.get('v') || 'galaxy',
    x: num(q.get('x'), 0),
    y: num(q.get('y'), 0),
    zoom: num(q.get('z'), 1),
    starId: q.get('star') || null,
    planetIdx: q.get('p') != null ? parseInt(q.get('p'), 10) : null,
  };
}

function num(v, d) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

export function stateToHash(st) {
  const q = new URLSearchParams();
  q.set('s', st.seed);
  q.set('v', st.scene);
  q.set('x', Math.round(st.x));
  q.set('y', Math.round(st.y));
  q.set('z', st.zoom.toFixed(3));
  if (st.starId) q.set('star', st.starId);
  if (st.planetIdx != null) q.set('p', st.planetIdx);
  return '#' + q.toString();
}

export function writeState(st) {
  const hash = stateToHash(st);
  if (hash !== location.hash) {
    history.replaceState(null, '', hash);
  }
}

export function shareLink(st) {
  return location.origin + location.pathname + stateToHash(st);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // older browsers / insecure context fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }
}
