/**
 * astro.js — Calculs astronomiques
 * Transformations de coordonnées célestes → coordonnées horizontales (Az/Alt)
 * Précision : ~0.1° (suffisant pour une carte du ciel visuelle)
 * Source des formules : Jean Meeus "Astronomical Algorithms" 2nd ed.
 */

// ─── Utilitaires trigonométriques ─────────────────────────────────────────────

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function sin(deg) { return Math.sin(deg * DEG); }
export function cos(deg) { return Math.cos(deg * DEG); }
export function tan(deg) { return Math.tan(deg * DEG); }
export function asin(x)  { return Math.asin(x) * RAD; }
export function acos(x)  { return Math.acos(Math.max(-1, Math.min(1, x))) * RAD; }
export function atan2(y, x) { return Math.atan2(y, x) * RAD; }

/** Réduit un angle en [0, 360) */
export function normalise360(deg) { return ((deg % 360) + 360) % 360; }

// ─── Temps ────────────────────────────────────────────────────────────────────

/**
 * Date julienne depuis un objet Date JS
 * Précise à la milliseconde, sans correction de réfraction atmosphérique
 */
export function julianDate(date = new Date()) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Temps Sidéral Moyen de Greenwich (GMST) en degrés
 * Formule Meeus chap. 12 — précision < 0.1"
 */
export function gmst(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  const gmst = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000.0;
  return normalise360(gmst);
}

/**
 * Temps Sidéral Local (LST) en degrés
 * @param {number} jd         — Date julienne
 * @param {number} longitude  — Longitude de l'observateur (°, Est positif)
 */
export function lst(jd, longitude) {
  return normalise360(gmst(jd) + longitude);
}

// ─── Conversion de coordonnées ─────────────────────────────────────────────────

/**
 * Coordonnées équatoriales → horizontales (Az/Alt)
 *
 * @param {number} ra        — Ascension droite (degrés, 0-360)
 * @param {number} dec       — Déclinaison (degrés)
 * @param {number} lstDeg    — Temps sidéral local (degrés)
 * @param {number} latitude  — Latitude de l'observateur (degrés)
 * @returns {{ azimuth: number, altitude: number }}
 */
export function equatorialToHorizontal(ra, dec, lstDeg, latitude) {
  // Angle horaire (0-360°)
  const H = normalise360(lstDeg - ra);

  const sinAlt = sin(dec) * sin(latitude) + cos(dec) * cos(latitude) * cos(H);
  const altitude = asin(sinAlt);

  const cosAz = (sin(dec) - sin(latitude) * sinAlt) / (cos(latitude) * Math.cos(altitude * DEG));
  let azimuth = acos(cosAz);

  // Convention : azimut depuis le Nord, sens horaire
  if (sin(H) > 0) azimuth = 360 - azimuth;

  return { azimuth, altitude };
}

/**
 * Ascension droite en heures → degrés
 * @param {number} hours — RA en heures décimales
 */
export function raToDeg(hours) { return hours * 15; }

/**
 * Magnitude → rayon du point en pixels (rendu canvas)
 * Magnitude visuelle : plus petit = plus lumineux
 * @param {number} mag        — Magnitude apparente
 * @param {number} zoomFactor — Facteur de zoom actuel
 */
export function magToRadius(mag, zoomFactor = 1) {
  const base = Math.max(0.4, 5.5 - mag * 0.8);
  return base * Math.sqrt(zoomFactor);
}

/**
 * Magnitude → opacité du point (0.15 - 1.0)
 */
export function magToOpacity(mag) {
  return Math.max(0.15, Math.min(1.0, 1.2 - mag * 0.12));
}

/**
 * Indice de couleur B-V → couleur CSS approximative
 * Spectre stellaire : bleu-blanc (O,B) → jaune (G) → orange-rouge (K,M)
 */
export function bvToColor(bv) {
  if (bv === undefined || bv === null || isNaN(bv)) return '#ffe8d0';
  // Gradient simplifié
  if (bv < -0.3) return '#b0c4ff'; // O — bleu-violet
  if (bv <  0.0) return '#c8d8ff'; // B — bleu-blanc
  if (bv <  0.3) return '#e8eeff'; // A — blanc
  if (bv <  0.6) return '#fff5e0'; // F — blanc-jaune
  if (bv <  0.8) return '#ffedd0'; // G — jaune (type solaire)
  if (bv <  1.2) return '#ffd0a0'; // K — orange
  return '#ff9060';                 // M — rouge-orange
}

/**
 * Type d'objet Messier → icône Unicode + couleur
 */
export function messierTypeStyle(type) {
  const map = {
    'galaxy':           { icon: '⬟', color: '#ffaa44' },
    'globular cluster': { icon: '◎', color: '#ffcc88' },
    'open cluster':     { icon: '✦', color: '#88ddff' },
    'nebula':           { icon: '◌', color: '#88ffcc' },
    'planetary nebula': { icon: '⊕', color: '#aaffee' },
    'supernova remnant':{ icon: '✸', color: '#ff8888' },
    'star cluster and nebula': { icon: '✦', color: '#aaccff' },
  };
  const key = (type || '').toLowerCase();
  return map[key] || { icon: '◎', color: '#cccccc' };
}

/**
 * Convertit la taille angulaire (arcmin) en rayon canvas
 * à une projection et un zoom donnés
 * @param {number} arcmin      — Taille en arcminutes
 * @param {number} scale       — Pixels par degré à l'écran
 */
export function arcminToPixels(arcmin, scale) {
  return (arcmin / 60) * scale;
}

/**
 * Vérifie si un objet est au-dessus de l'horizon
 */
export function isAboveHorizon(altitude) {
  return altitude > 0;
}

/**
 * Calcule la réfraction atmosphérique (correction en degrés)
 * Formule de Saemundsson — utile pour les objets près de l'horizon
 * @param {number} altitude — Altitude apparente (degrés)
 */
export function atmosphericRefraction(altitude) {
  if (altitude < -1) return 0;
  return (1.02 / tan(altitude + 10.3 / (altitude + 5.11))) / 60;
}
