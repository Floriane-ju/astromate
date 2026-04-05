/**
 * app.js — Point d'entrée principal d'AstroMate
 * Projection gnomonique (perspective) — style Stellarium
 */

import { julianDate, lst, raToDeg, equatorialToHorizontal, messierTypeStyle } from './astro.js';
import { SkyRenderer } from './renderer.js';
import { project, unproject } from './projection.js';
import { loadCatalog, filterStarsByMag, findNearestObject } from './catalog.js';

const DEG = Math.PI / 180;

// ─── État global ───────────────────────────────────────────────────────────────

const state = {
  // Observateur
  lat: 48.8566,
  lon: 2.3522,
  locationName: 'Paris, France (défaut)',

  // Direction de vue (caméra)
  viewAz:  180,   // regarder vers le Sud par défaut
  viewAlt:  30,   // sera recalculé dynamiquement après resize()
  fovDeg:   90,   // champ de vision horizontal
  fovMin:    8,
  fovMax:  300,

  // Catalogues
  allStars:       [],
  constellLines:  [],
  constellLabels: [],
  messierObjects: [],

  // Objets avec coordonnées horizontales calculées
  visibleStars:     [],
  visibleMessier:   [],
  constellSegments: [],
  computedLabels:   [],

  // Filtres
  filters: { stars: true, constellations: true, messier: true, labels: true, grid: false },
  magLimit: 6.5,
  showMilkyWay: true,

  // Sélection
  selected: null,

  // Boucle
  animFrameId:   null,
  lastFrameTime: 0,
  catalogReady:  false,

  // Drag en cours
  drag: { active: false, startX: 0, startY: 0, startAz: 0, startAlt: 0 },
  pinch: { active: false, dist: 0, startFov: 0 },
};

// ─── Canvas & renderer ────────────────────────────────────────────────────────

const canvas   = document.getElementById('sky-canvas');
const renderer = new SkyRenderer(canvas);

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init() {
  renderer.resize();
  state.viewAlt = renderer.defaultViewAlt(state.fovDeg);
  updateProgress('Catalogue stellaire…', 20);

  const catalog = await loadCatalog((label, pct) => updateProgress(label, pct));
  state.allStars        = catalog.stars.stars         || [];
  state.constellLines   = catalog.constellations.lines  || [];
  state.constellLabels  = catalog.constellations.labels || [];
  state.messierObjects  = catalog.messier.objects       || [];
  state.catalogReady    = true;

  document.getElementById('star-count-info').textContent =
    `${state.allStars.length} étoiles · ${state.messierObjects.length} objets Messier`;

  updateProgress('GPS…', 95);
  await initGPS();

  updateProgress('Prêt !', 100);
  setTimeout(hideLoading, 600);

  setupEventListeners();
  startRenderLoop();
  startTimeClock();
}

function updateProgress(label, pct) {
  const bar = document.getElementById('loading-progress');
  const sub = document.querySelector('.loading-sub');
  if (bar) bar.style.width = pct + '%';
  if (sub) sub.textContent = label;
}

function hideLoading() {
  const screen = document.getElementById('loading-screen');
  screen.classList.add('fade-out');
  setTimeout(() => screen.remove(), 900);
}

// ─── GPS ──────────────────────────────────────────────────────────────────────

async function initGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { showGPSError(); resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        state.locationName = `${state.lat.toFixed(2)}° ${state.lat >= 0 ? 'N' : 'S'}, `
                           + `${state.lon.toFixed(2)}° ${state.lon >= 0 ? 'E' : 'O'}`;
        document.getElementById('location-text').textContent = state.locationName;
        document.getElementById('location-icon').style.color = '#c0392b';
        document.getElementById('gps-error').classList.add('hidden');
        state.lastFrameTime = 0;
        resolve();
      },
      () => { showGPSError(); resolve(); },
      { timeout: 8000, enableHighAccuracy: false }
    );
  });
}

function showGPSError() {
  document.getElementById('gps-error').classList.remove('hidden');
  document.getElementById('location-text').textContent = 'Position par défaut (Paris)';
}

document.getElementById('gps-retry').addEventListener('click', async () => {
  document.getElementById('gps-error').classList.add('hidden');
  await initGPS();
});

// ─── Calculs astronomiques ────────────────────────────────────────────────────

function computeFrame() {
  const jd     = julianDate(new Date());
  const lstDeg = lst(jd, state.lon);

  const starsFiltered = filterStarsByMag(state.allStars, state.magLimit);

  state.visibleStars = starsFiltered.map(star => {
    const { azimuth, altitude } = equatorialToHorizontal(raToDeg(star.ra), star.dec, lstDeg, state.lat);
    return { ...star, azimuth, altitude };
  });

  state.visibleMessier = state.messierObjects.map(obj => {
    const { azimuth, altitude } = equatorialToHorizontal(raToDeg(obj.ra), obj.dec, lstDeg, state.lat);
    return { ...obj, azimuth, altitude };
  });

  state.constellSegments = state.constellLines.map(line => {
    const e1 = equatorialToHorizontal(raToDeg(line.ra1), line.dec1, lstDeg, state.lat);
    const e2 = equatorialToHorizontal(raToDeg(line.ra2), line.dec2, lstDeg, state.lat);
    return { az1: e1.azimuth, alt1: e1.altitude, az2: e2.azimuth, alt2: e2.altitude };
  });

  state.computedLabels = state.constellLabels.map(lbl => {
    const { azimuth, altitude } = equatorialToHorizontal(raToDeg(lbl.ra), lbl.dec, lstDeg, state.lat);
    return { name: lbl.name, az: azimuth, alt: altitude };
  });
}

// ─── Boucle de rendu ─────────────────────────────────────────────────────────

function startRenderLoop() {
  function frame(ts) {
    if (ts - state.lastFrameTime > 5000 || state.lastFrameTime === 0) {
      if (state.catalogReady) computeFrame();
      state.lastFrameTime = ts;
    }
    draw();
    state.animFrameId = requestAnimationFrame(frame);
  }
  state.animFrameId = requestAnimationFrame(frame);
}

function draw() {
  const { viewAz, viewAlt, fovDeg, filters, magLimit } = state;

  renderer.clear();
  renderer.drawSkyBackground();

  if (filters.grid) renderer.drawGrid(viewAz, viewAlt, fovDeg);

  if (filters.constellations && state.constellSegments.length) {
    renderer.drawConstellations(state.constellSegments, viewAz, viewAlt, fovDeg);
  }

  if (filters.stars) {
    renderer.drawStars(state.visibleStars, viewAz, viewAlt, fovDeg, magLimit);
  }

  if (filters.messier) {
    renderer.drawMessier(state.visibleMessier, viewAz, viewAlt, fovDeg);
  }

  if (filters.constellations && filters.labels && state.computedLabels.length) {
    renderer.drawConstellationLabels(state.computedLabels, viewAz, viewAlt, fovDeg);
  }

  renderer.drawLandscape(viewAz, viewAlt, fovDeg);
  renderer.drawCardinalPoints(viewAz, viewAlt, fovDeg);
  renderer.drawViewIndicator(viewAz, viewAlt, fovDeg);

  if (state.selected) {
    renderer.drawSelection(state.selected.azimuth, state.selected.altitude, viewAz, viewAlt, fovDeg);
  }
}

// ─── Horloge ─────────────────────────────────────────────────────────────────

function startTimeClock() {
  const tick = () => {
    document.getElementById('time-display').textContent =
      new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' TL';
  };
  tick();
  setInterval(tick, 1000);
}

// ─── Interactions ─────────────────────────────────────────────────────────────

function setupEventListeners() {
  // Zoom
  document.getElementById('btn-zoom-in').addEventListener('click',  () => adjustFov(0.7));
  document.getElementById('btn-zoom-out').addEventListener('click', () => adjustFov(1 / 0.7));
  document.getElementById('btn-reset-view').addEventListener('click', resetView);

  // Filtres
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      state.filters[f] = !state.filters[f];
      btn.classList.toggle('active', state.filters[f]);
    });
  });

  // Paramètres
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('overlay').addEventListener('click', closeSettings);
  document.getElementById('info-close').addEventListener('click', () => {
    state.selected = null;
    document.getElementById('info-panel').classList.add('hidden');
  });

  document.getElementById('mag-limit').addEventListener('input', (e) => {
    state.magLimit = parseFloat(e.target.value);
    document.getElementById('mag-value').textContent = state.magLimit.toFixed(1);
    state.lastFrameTime = 0;
  });
  document.getElementById('show-milkyway').addEventListener('change', (e) => {
    state.showMilkyWay = e.target.checked;
  });
  document.getElementById('red-mode').addEventListener('change', (e) => {
    document.body.classList.toggle('white-mode', !e.target.checked);
  });

  // ── Souris ───────────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    state.drag = { active: true, startX: e.clientX, startY: e.clientY,
                   startAz: state.viewAz, startAlt: state.viewAlt };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!state.drag.active) return;
    applyDrag(e.clientX - state.drag.startX, e.clientY - state.drag.startY);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!state.drag.active) return;
    const dx = e.clientX - state.drag.startX;
    const dy = e.clientY - state.drag.startY;
    state.drag.active = false;
    canvas.style.cursor = 'crosshair';
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) handleClick(e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseleave', () => { state.drag.active = false; canvas.style.cursor = 'crosshair'; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    adjustFov(e.deltaY > 0 ? 1.1 : 0.9);
  }, { passive: false });

  // ── Tactile ──────────────────────────────────────────────────────────────────
  canvas.addEventListener('touchstart',  onTouchStart, { passive: false });
  canvas.addEventListener('touchmove',   onTouchMove,  { passive: false });
  canvas.addEventListener('touchend',    onTouchEnd,   { passive: false });

  window.addEventListener('resize', () => { renderer.resize(); });
}

// ─── Drag ─────────────────────────────────────────────────────────────────────

function applyDrag(dx, dy) {
  const sens = state.fovDeg / renderer.width; // degrés par pixel
  state.viewAz  = ((state.drag.startAz  - dx * sens) % 360 + 360) % 360;
  state.viewAlt = clamp(state.drag.startAlt + dy * sens, 2, 88);
}

// ─── Zoom ─────────────────────────────────────────────────────────────────────

function adjustFov(factor) {
  state.fovDeg = clamp(state.fovDeg * factor, state.fovMin, state.fovMax);
}

function resetView() {
  state.viewAz  = 180;
  state.fovDeg  = 90;
  state.viewAlt = renderer.defaultViewAlt(state.fovDeg);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ─── Tactile ─────────────────────────────────────────────────────────────────

let touchStartTime;

function onTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    state.drag  = { active: true, startX: t.clientX, startY: t.clientY,
                    startAz: state.viewAz, startAlt: state.viewAlt };
    state.pinch = { active: false };
    touchStartTime = Date.now();
  } else if (e.touches.length === 2) {
    state.drag  = { active: false };
    state.pinch = { active: true, dist: pinchDist(e.touches), startFov: state.fovDeg };
  }
}

function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && state.drag.active && !state.pinch.active) {
    const t = e.touches[0];
    applyDrag(t.clientX - state.drag.startX, t.clientY - state.drag.startY);
  } else if (e.touches.length === 2 && state.pinch.active) {
    const d = pinchDist(e.touches);
    state.fovDeg = clamp(state.pinch.startFov * (state.pinch.dist / d), state.fovMin, state.fovMax);
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0) {
    const wasDragging = state.drag.active;
    const t = e.changedTouches[0];
    const dx = t.clientX - state.drag.startX;
    const dy = t.clientY - state.drag.startY;
    state.drag.active = false;
    state.pinch.active = false;
    if (wasDragging && Date.now() - touchStartTime < 300 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      handleClick(t.clientX, t.clientY);
    }
  }
  if (e.touches.length < 2) state.pinch.active = false;
}

function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Clic → sélection d'objet ─────────────────────────────────────────────────

function handleClick(screenX, screenY) {
  const { az, alt } = unproject(screenX, screenY, renderer.cx, renderer.cy,
                                renderer.width, state.viewAz, state.viewAlt, state.fovDeg);
  if (alt < -5) {
    state.selected = null;
    document.getElementById('info-panel').classList.add('hidden');
    return;
  }

  const threshold = state.fovDeg / 15;
  const obj = findNearestObject(az, alt, state.visibleStars, state.visibleMessier, threshold);

  if (obj) { state.selected = obj; showInfoPanel(obj); }
  else      { state.selected = null; document.getElementById('info-panel').classList.add('hidden'); }
}

function showInfoPanel(obj) {
  const panel  = document.getElementById('info-panel');
  const icon   = document.getElementById('info-icon');
  const name   = document.getElementById('info-name');
  const type   = document.getElementById('info-type');
  const dets   = document.getElementById('info-details');
  const coords = document.getElementById('info-coords');

  if (obj.objectType === 'star') {
    icon.textContent = '★';
    name.textContent = obj.name || `Étoile`;
    type.textContent = 'Étoile · ' + (obj.spect || '?');
    dets.innerHTML   = `<b>Magnitude :</b> <span>${obj.mag?.toFixed(2) ?? '—'}</span><br>
                        <b>Indice B-V :</b> <span>${obj.bv?.toFixed(2) ?? '—'}</span><br>
                        <b>Distance :</b> <span>${obj.dist ? Math.round(obj.dist) + ' al' : '—'}</span>`;
  } else {
    const style      = messierTypeStyle(obj.type);
    icon.textContent = style.icon;
    name.textContent = obj.id + (obj.name ? ' — ' + obj.name : '');
    type.textContent = obj.type || 'Objet du ciel profond';
    dets.innerHTML   = `<b>Magnitude :</b> <span>${obj.mag?.toFixed(1) ?? '—'}</span><br>
                        <b>Taille angulaire :</b> <span>${obj.size ? obj.size + "'" : '—'}</span><br>
                        <b>Constellation :</b> <span>${obj.constellation || '—'}</span>
                        ${obj.desc ? `<br><br>${obj.desc}` : ''}`;
  }

  coords.textContent = `Az ${obj.azimuth?.toFixed(1)}°  ·  Alt ${obj.altitude?.toFixed(1)}°  ·  `
                     + `AR ${obj.ra?.toFixed(3)}h  ·  Déc ${obj.dec?.toFixed(2)}°`;
  panel.classList.remove('hidden');
}

// ─── Paramètres ──────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById('settings-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}

// ─── Service Worker ──────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(e => console.warn('[AstroMate] SW:', e));
  });
}

// ─── Démarrage ───────────────────────────────────────────────────────────────

init();
