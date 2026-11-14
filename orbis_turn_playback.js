'use strict';
/** Half-turn event playback queue (map pan + cards). */
window.ORBIS_PLAYBACK = (() => {
  const state = { running: false, skip: false, speed: 1, queue: [] };

  function canDom() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function' && document.body;
  }

  function enqueue(items) {
    if (!Array.isArray(items) || !items.length) return;
    if (!canDom()) return;
    state.queue.push(...items);
    if (!state.running) runQueue();
  }

  function flyTo(lon, lat) {
    if (typeof projectLonLatPoint !== 'function') return;
    const pt = projectLonLatPoint(lon, lat);
    if (state.mapProjection === 'globe' || (typeof window !== 'undefined' && window.state?.mapProjection === 'globe')) {
      if (window.state?.globe) {
        window.state.globe.lon = lon;
        window.state.globe.lat = lat;
        window.state.globe.zoom = Math.max(1.35, window.state.globe.zoom || 1);
        if (typeof updateMapVisuals === 'function') updateMapVisuals();
      }
    } else if (window.state?.mapTransform && pt?.visible) {
      const vp = document.getElementById('map-viewport');
      const cx = (vp?.clientWidth || 800) / 2;
      const cy = (vp?.clientHeight || 600) / 2;
      const scale = Math.max(1.25, window.state.mapTransform.scale || 1);
      window.state.mapTransform.scale = scale;
      window.state.mapTransform.x = cx - pt.x * scale;
      window.state.mapTransform.y = cy - pt.y * scale;
      if (typeof applyFlatTransform === 'function') applyFlatTransform();
      if (typeof updateMapVisuals === 'function') updateMapVisuals();
    }
  }

  function escapeCard(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function showCard(item) {
    let el = document.getElementById('turn-playback-card');
    if (!el) {
      el = document.createElement('div');
      el.id = 'turn-playback-card';
      el.className = 'turn-playback-card';
      document.body.appendChild(el);
    }
    const loc = item.location ? `<div class="tp-location">${escapeCard(item.location)}</div>` : '';
    const body = escapeCard(item.body || '').slice(0, 360);
    el.innerHTML = `<div class="tp-date">${escapeCard(item.date || '')}</div><strong>${escapeCard(item.headline || '')}</strong>${loc}<p>${body}</p>`;
    el.hidden = false;
    el.classList.add('visible');
  }

  function hideCard() {
    const el = document.getElementById('turn-playback-card');
    if (!el) return;
    el.classList.remove('visible');
    el.hidden = true;
    el.innerHTML = '';
  }

  function pulseRegion(stateId) {
    if (!stateId) return;
    const path = document.getElementById(`prov-${stateId}`);
    if (!path) return;
    path.classList.add('playback-pulse');
    setTimeout(() => path.classList.remove('playback-pulse'), 800 / state.speed);
  }

  async function runQueue() {
    state.running = true;
  if (typeof document !== 'undefined') document.body?.classList.add('turn-playback-active');
    const overlay = document.getElementById('turn-playback-overlay');
    if (overlay) overlay.hidden = false;
    while (state.queue.length) {
      if (state.skip) { state.queue = []; break; }
      const item = state.queue.shift();
      if (item.lon != null && item.lat != null) flyTo(item.lon, item.lat);
      if (item.stateId) pulseRegion(item.stateId);
      showCard(item);
      await new Promise(r => setTimeout(r, Math.round(1100 / state.speed)));
      hideCard();
    }
    state.running = false;
    state.skip = false;
    if (overlay) overlay.hidden = true;
    document.body?.classList.remove('turn-playback-active');
    globalThis.Orbis?.flushDeferredToasts?.();
  }

  function setSpeed(mult) { state.speed = Math.min(4, Math.max(1, mult)); }
  function skipAll() { state.skip = true; }

  return Object.freeze({ enqueue, setSpeed, skipAll, _state: state });
})();
