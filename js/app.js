/**
 * app.js — Point d'entrée principal d'AstroMate
 * Orchestre : GPS, calculs, rendu, interactions
 */

import { julianDate, lst, raToDeg, equatorialToHorizontal, isAboveHorizon, messierTypeStyle } from './astro.js';
import { SkyRenderer } from './renderer.js';
import { project, unproject, computeSkyRadius } from './projection.js';
import { loadCatalog, filterStarsByMag, findNearestObject } from './catalog.js';

// ─── État global ───────────────────────────────────────────────────────────────

const state = {
  // Position de l'observateur
  lat: 48.8566,     // Paris par défaut
  lon: 2.3522,
  locationName: 'Paris, France (défaut)',

  // Vue
  zoomFactor: 1.0,
  panX: 0,
  panY: 0,
  zoomMin: 0.5,
  zoomMax: 8,

  // Données du catalogue
  allStars:       [],
  constellLines:  [],
  constellLabels: [],
  messierObjects: [],

  // Objets calculés (avec az/alt courants)
  visibleStars:   [],
  visibleMessier: [],
  constellSegments: [],

  // Filtres
  filters: {
    stars: true,
    constellations: true,
    messier: true,
    labels: true,
    grid: false,
  },
  magLimit: 6.5,
  showMilkyWay: true,

  // Sélection
  selected: null,

  // Animation
  animFrameId: null,
  lastFrameTime: 0,

  // Interaction tactile
  touch: {
    active: false,
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    isPinching: false,
  },

  // Catalogue chargé ?
  catalogReady: false,
};

// ─── Constantes ────────────────────────────────────────────────────────────────

const PIXELS_PER_DEGREE_BASE = 6; // à zoom=1

// ─── Initialisations ───────────────────────────────────────────────────────────

const canvas   = document.getElementById('sky-canvas');
const renderer = new SkyRenderer(canvas);

async function init() {
  renderer.resize();
  updateProgress('Catalogue stellaire…', 20);

  // Chargement du catalogue
  const catalog = await loadCatalog((label, pct) => updateProgress(label, pct));
  state.allStars       = catalog.stars.stars || [];
  state.constellLines  = catalog.constellations.lines  || [];
  state.constellLabels = catalog.constellations.labels || [];
  state.messierObjects = catalog.messier.objects || [];
  state.catalogReady   = true;

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

// ─── GPS ───────────────────────────────────────────────────────────────────────

async function initGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      showGPSError();
      resolve();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        state.locationName = `${state.lat.toFixed(2)}° ${state.lat >= 0 ? 'N' : 'S'}, `
                           + `${state.lon.toFixed(2)}° ${state.lon >= 0 ? 'E' : 'O'}`;
        document.getElementById('location-text').textContent = state.locationName;
        document.getElementById('location-icon').style.color = '#c0392b';
        // Cacher le message d'erreur si GPS a finalement répondu
        document.getElementById('gps-error').classList.add('hidden');
        state.lastFrameTime = 0; // force recalcul avec la vraie position
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

// ─── Calculs astronomiques (frame) ─────────────────────────────────────────────

function computeFrame() {
  const now = new Date();
  const jd  = julianDate(now);
  const lstDeg = lst(jd, state.lon);

  // Filtrage par magnitude
  const starsFiltered = filterStarsByMag(state.allStars, state.magLimit);

  // Calcul des coordonnées horizontales pour chaque étoile
  state.visibleStars = starsFiltered.map(star => {
    const { azimuth, altitude } = equatorialToHorizontal(
      raToDeg(star.ra), star.dec, lstDeg, state.lat
    );
    return { ...star, azimuth, altitude };
  });

  // Objets Messier
  state.visibleMessier = state.messierObjects.map(obj => {
    const { azimuth, altitude } = equatorialToHorizontal(
      raToDeg(obj.ra), obj.dec, lstDeg, state.lat
    );
    return { ...obj, azimuth, altitude };
  });

  // Segments de constellations — cherche les coordonnées des étoiles d'extrémité
  state.constellSegments = [];
  for (const line of state.constellLines) {
    // Chaque ligne = { ra1, dec1, ra2, dec2 }
    const e1 = equatorialToHorizontal(raToDeg(line.ra1), line.dec1, lstDeg, state.lat);
    const e2 = equatorialToHorizontal(raToDeg(line.ra2), line.dec2, lstDeg, state.lat);
    state.constellSegments.push({
      az1: e1.azimuth, alt1: e1.altitude,
      az2: e2.azimuth, alt2: e2.altitude,
    });
  }

  // Labels de constellations
  state.computedLabels = state.constellLabels.map(lbl => {
    const { azimuth, altitude } = equatorialToHorizontal(
      raToDeg(lbl.ra), lbl.dec, lstDeg, state.lat
    );
    return { name: lbl.name, az: azimuth, alt: altitude };
  });

  return { lstDeg };
}

// ─── Boucle de rendu ──────────────────────────────────────────────────────────

function startRenderLoop() {
  function frame(timestamp) {
    // Throttle : recalcul toutes les 5 secondes max (le ciel ne bouge pas vite)
    if (timestamp - state.lastFrameTime > 5000 || state.lastFrameTime === 0) {
      if (state.catalogReady) computeFrame();
      state.lastFrameTime = timestamp;
    }

    draw();
    state.animFrameId = requestAnimationFrame(frame);
  }
  state.animFrameId = requestAnimationFrame(frame);
}

function draw() {
  const { zoomFactor, panX, panY, filters, magLimit } = state;
  const pixelsPerDeg = PIXELS_PER_DEGREE_BASE * (renderer.skyRadius / 90);

  renderer.clear();
  renderer.drawSkyDisk(zoomFactor, panX, panY);

  if (filters.grid) {
    renderer.drawGrid(zoomFactor, panX, panY);
  }

  if (state.showMilkyWay && state.catalogReady) {
    const jd = julianDate(new Date());
    const lstDeg = lst(jd, state.lon);
    renderer.drawMilkyWay(zoomFactor, panX, panY, lstDeg, state.lat);
  }

  if (filters.constellations && state.constellSegments.length) {
    renderer.drawConstellations(state.constellSegments, zoomFactor, panX, panY);
  }

  if (filters.stars) {
    renderer.drawStars(state.visibleStars, zoomFactor, panX, panY, magLimit);
  }

  if (filters.messier) {
    renderer.drawMessier(state.visibleMessier, zoomFactor, panX, panY, pixelsPerDeg);
  }

  if (filters.constellations && filters.labels && state.computedLabels) {
    renderer.drawConstellationLabels(state.computedLabels, zoomFactor, panX, panY);
  }

  renderer.drawCardinalPoints(zoomFactor, panX, panY);
  renderer.drawZenith(panX, panY);

  if (state.selected) {
    renderer.drawSelection(state.selected.azimuth, state.selected.altitude, zoomFactor, panX, panY);
  }
}

// ─── Horloge ──────────────────────────────────────────────────────────────────

function startTimeClock() {
  function tick() {
    const now = new Date();
    document.getElementById('time-display').textContent =
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + ' TL';
  }
  tick();
  setInterval(tick, 1000);
}

// ─── Interactions ─────────────────────────────────────────────────────────────

function setupEventListeners() {
  // Zoom boutons
  document.getElementById('btn-zoom-in').addEventListener('click', () => zoom(1.3));
  document.getElementById('btn-zoom-out').addEventListener('click', () => zoom(1 / 1.3));
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

  // Info panel
  document.getElementById('info-close').addEventListener('click', () => {
    state.selected = null;
    document.getElementById('info-panel').classList.add('hidden');
  });

  // Sliders
  document.getElementById('mag-limit').addEventListener('input', (e) => {
    state.magLimit = parseFloat(e.target.value);
    document.getElementById('mag-value').textContent = state.magLimit.toFixed(1);
    state.lastFrameTime = 0; // force recalcul
  });

  document.getElementById('show-milkyway').addEventListener('change', (e) => {
    state.showMilkyWay = e.target.checked;
  });

  document.getElementById('red-mode').addEventListener('change', (e) => {
    document.body.classList.toggle('white-mode', !e.target.checked);
  });

  // ── Souris ──────────────────────────────────────────────────────────────────
  let isDragging = false;
  let dragStartX, dragStartY, dragStartPanX, dragStartPanY;

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = state.panX;
    dragStartPanY = state.panY;
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    state.panX = dragStartPanX + (e.clientX - dragStartX);
    state.panY = dragStartPanY + (e.clientY - dragStartY);
    clampPan();
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    canvas.style.cursor = 'crosshair';
    // Clic sans drag → cherche un objet
    if (Math.abs(e.clientX - dragStartX) < 5 && Math.abs(e.clientY - dragStartY) < 5) {
      handleClick(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  // ── Tactile ─────────────────────────────────────────────────────────────────
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });

  // Resize
  window.addEventListener('resize', () => {
    renderer.resize();
    state.lastFrameTime = 0;
  });
}

// ─── Gestion tactile ──────────────────────────────────────────────────────────

let touchStartX, touchStartY, touchStartPanX, touchStartPanY;
let touchStartTime;

function onTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartX    = t.clientX;
    touchStartY    = t.clientY;
    touchStartPanX = state.panX;
    touchStartPanY = state.panY;
    touchStartTime = Date.now();
    state.touch.isPinching = false;
  } else if (e.touches.length === 2) {
    state.touch.isPinching = true;
    state.touch.pinchDist = getPinchDist(e.touches);
  }
}

function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && !state.touch.isPinching) {
    const t = e.touches[0];
    state.panX = touchStartPanX + (t.clientX - touchStartX);
    state.panY = touchStartPanY + (t.clientY - touchStartY);
    clampPan();
  } else if (e.touches.length === 2) {
    const dist = getPinchDist(e.touches);
    const ratio = dist / state.touch.pinchDist;
    zoom(ratio, false);
    state.touch.pinchDist = dist;
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0 && !state.touch.isPinching) {
    const elapsed = Date.now() - touchStartTime;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (elapsed < 300 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      handleClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }
  }
  if (e.touches.length < 2) state.touch.isPinching = false;
}

function getPinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Zoom & Pan ───────────────────────────────────────────────────────────────

function zoom(factor, clampIt = true) {
  state.zoomFactor = Math.max(state.zoomMin, Math.min(state.zoomMax, state.zoomFactor * factor));
  if (clampIt) clampPan();
}

function clampPan() {
  const maxPan = renderer.skyRadius * (state.zoomFactor - 0.5);
  state.panX = Math.max(-maxPan, Math.min(maxPan, state.panX));
  state.panY = Math.max(-maxPan, Math.min(maxPan, state.panY));
}

function resetView() {
  state.zoomFactor = 1;
  state.panX = 0;
  state.panY = 0;
}

// ─── Clic / tap sur un objet ──────────────────────────────────────────────────

function handleClick(screenX, screenY) {
  const { azimuth, altitude } = unproject(
    screenX, screenY,
    renderer.cx, renderer.cy,
    renderer.skyRadius,
    state.zoomFactor,
    state.panX, state.panY
  );

  if (altitude < -5 || altitude > 90) {
    state.selected = null;
    document.getElementById('info-panel').classList.add('hidden');
    return;
  }

  const threshold = 5 / state.zoomFactor;
  const obj = findNearestObject(azimuth, altitude, state.visibleStars, state.visibleMessier, threshold);

  if (obj) {
    state.selected = obj;
    showInfoPanel(obj);
  } else {
    state.selected = null;
    document.getElementById('info-panel').classList.add('hidden');
  }
}

function showInfoPanel(obj) {
  const panel = document.getElementById('info-panel');
  const icon  = document.getElementById('info-icon');
  const name  = document.getElementById('info-name');
  const type  = document.getElementById('info-type');
  const dets  = document.getElementById('info-details');
  const coords = document.getElementById('info-coords');

  if (obj.objectType === 'star') {
    icon.textContent = '★';
    name.textContent = obj.name || `HIP ${obj.hip || '—'}`;
    type.textContent = 'Étoile · ' + (obj.spect || '?');
    dets.innerHTML = `
      <b>Magnitude :</b> <span>${obj.mag?.toFixed(2) ?? '—'}</span><br>
      <b>Indice B-V :</b> <span>${obj.bv?.toFixed(2) ?? '—'}</span><br>
      <b>Distance :</b> <span>${obj.dist ? Math.round(obj.dist) + ' al' : '—'}</span>
    `;
  } else {
    const style = messierTypeStyle(obj.type);
    icon.textContent = style.icon;
    name.textContent = obj.id + (obj.name ? ' — ' + obj.name : '');
    type.textContent = obj.type || 'Objet du ciel profond';
    dets.innerHTML = `
      <b>Magnitude :</b> <span>${obj.mag?.toFixed(1) ?? '—'}</span><br>
      <b>Taille angulaire :</b> <span>${obj.size ? obj.size + "'" : '—'}</span><br>
      <b>Constellation :</b> <span>${obj.constellation || '—'}</span>
      ${obj.desc ? `<br><br>${obj.desc}` : ''}
    `;
  }

  coords.textContent =
    `Az ${obj.azimuth?.toFixed(1)}°  ·  Alt ${obj.altitude?.toFixed(1)}°  ·  ` +
    `AR ${obj.ra?.toFixed(3)}h  ·  Déc ${obj.dec?.toFixed(2)}°`;

  panel.classList.remove('hidden');
}

// ─── Paramètres ───────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById('settings-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}

// ─── Service Worker ────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('[AstroMate] Service Worker enregistré'))
      .catch(e => console.warn('[AstroMate] SW erreur :', e));
  });
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

init();
