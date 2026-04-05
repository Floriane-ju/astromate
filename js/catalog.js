/**
 * catalog.js — Gestion du catalogue d'objets célestes
 * Charge les données depuis les fichiers JSON locaux (offline-first)
 * et met en cache dans IndexedDB pour les mises à jour futures
 */

const DB_NAME = 'astromate-db';
const DB_VERSION = 1;
const STORES = ['stars', 'meta'];

let db = null;

// ─── IndexedDB ────────────────────────────────────────────────────────────────

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('stars')) d.createObjectStore('stars', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta'))  d.createObjectStore('meta',  { keyPath: 'key' });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

// ─── Chargement des données ───────────────────────────────────────────────────

export async function loadCatalog(onProgress) {
  const steps = [
    { key: 'stars',         file: 'data/stars.json',         label: 'Étoiles' },
    { key: 'constellations',file: 'data/constellations.json',label: 'Constellations' },
    { key: 'messier',       file: 'data/messier.json',       label: 'Objets Messier' },
  ];

  const result = {};
  for (let i = 0; i < steps.length; i++) {
    const { key, file, label } = steps[i];
    onProgress && onProgress(label, Math.round((i / steps.length) * 90));
    try {
      const res  = await fetch(file);
      const data = await res.json();
      result[key] = data;
    } catch (e) {
      console.warn(`Impossible de charger ${file}:`, e);
      result[key] = key === 'stars' ? { stars: [] }
                  : key === 'constellations' ? { lines: [], labels: [] }
                  : { objects: [] };
    }
  }

  onProgress && onProgress('Prêt', 100);
  return result;
}

// ─── Filtrage par magnitude ───────────────────────────────────────────────────

export function filterStarsByMag(stars, magLimit) {
  return stars.filter(s => s.mag <= magLimit);
}

// ─── Recherche d'objet le plus proche d'un clic ──────────────────────────────

/**
 * Trouve l'objet (étoile ou Messier) le plus proche d'un point (az, alt)
 * @param {number} az           — Azimut cliqué
 * @param {number} alt          — Altitude cliquée
 * @param {Array}  visibleStars — Étoiles avec .azimuth, .altitude calculés
 * @param {Array}  visibleMess  — Objets Messier avec .azimuth, .altitude
 * @param {number} threshold    — Seuil de distance angulaire (degrés)
 */
export function findNearestObject(az, alt, visibleStars, visibleMess, threshold = 3) {
  let best = null;
  let bestDist = threshold;

  const angularDist = (a1, h1, a2, h2) => {
    const da = (a1 - a2) * Math.PI / 180;
    const dh = (h1 - h2) * Math.PI / 180;
    return Math.sqrt(da * da + dh * dh) * 180 / Math.PI;
  };

  for (const star of visibleStars) {
    const d = angularDist(az, alt, star.azimuth, star.altitude);
    if (d < bestDist) {
      bestDist = d;
      best = { ...star, objectType: 'star' };
    }
  }

  for (const obj of visibleMess) {
    const d = angularDist(az, alt, obj.azimuth, obj.altitude);
    if (d < bestDist) {
      bestDist = d;
      best = { ...obj, objectType: 'messier' };
    }
  }

  return best;
}
