/**
 * projection.js — Projection azimutale équidistante
 *
 * Le zénith (altitude 90°) est au centre du canvas.
 * L'horizon (altitude 0°) est sur le bord du disque céleste.
 * Le plan de projection est : Nord en haut, Est à droite.
 *
 * Cette projection est la plus naturelle pour une carte "vue du dessus"
 * car elle conserve les distances angulaires depuis le zénith.
 */

/**
 * Convertit (azimuth, altitude) → (x, y) sur le canvas
 *
 * @param {number} azimuth   — Azimut (°, Nord=0, Est=90, Sud=180, Ouest=270)
 * @param {number} altitude  — Altitude (°, 0 = horizon, 90 = zénith)
 * @param {number} cx        — Centre X du canvas (pixels)
 * @param {number} cy        — Centre Y du canvas (pixels)
 * @param {number} radius    — Rayon du disque céleste (pixels)
 * @param {number} zoomFactor — Facteur de zoom (>1 = zoom in)
 * @param {number} panX      — Décalage horizontal de vue (pixels)
 * @param {number} panY      — Décalage vertical de vue (pixels)
 * @returns {{ x: number, y: number, r: number }} — position + rayon depuis centre
 */
export function project(azimuth, altitude, cx, cy, radius, zoomFactor = 1, panX = 0, panY = 0) {
  // Distance angulaire depuis le zénith (0° au centre, 90° au bord)
  const zenithDist = 90 - altitude;

  // Rayon dans la projection (linéaire avec la distance zénithale)
  const r = (zenithDist / 90) * radius * zoomFactor;

  // Convention : Nord en haut → azimut 0° pointe vers le haut (-Y)
  //               azimut 90° (Est) pointe vers la droite (+X)
  const azRad = (azimuth - 180) * Math.PI / 180;

  const x = cx + r * Math.sin(azimuth * Math.PI / 180) + panX;
  const y = cy - r * Math.cos(azimuth * Math.PI / 180) + panY;

  return { x, y, r };
}

/**
 * Inverse : (x, y) canvas → (azimuth, altitude)
 * Utile pour détecter un clic sur un objet
 */
export function unproject(x, y, cx, cy, radius, zoomFactor = 1, panX = 0, panY = 0) {
  const dx = x - cx - panX;
  const dy = y - cy - panY;
  const r = Math.sqrt(dx * dx + dy * dy);

  const zenithDist = (r / (radius * zoomFactor)) * 90;
  const altitude = 90 - zenithDist;

  let azimuth = Math.atan2(dx, -dy) * 180 / Math.PI;
  if (azimuth < 0) azimuth += 360;

  return { azimuth, altitude };
}

/**
 * Vérifie si un point (x,y) est dans le disque céleste affiché
 */
export function isInsideSkyDisk(x, y, cx, cy, radius, zoomFactor = 1, panX = 0, panY = 0) {
  const dx = x - cx - panX;
  const dy = y - cy - panY;
  return Math.sqrt(dx * dx + dy * dy) <= radius * zoomFactor;
}

/**
 * Calcule le rayon du disque céleste selon la taille du canvas
 * Utilise 90% du plus petit demi-côté pour laisser une marge
 */
export function computeSkyRadius(canvasW, canvasH) {
  return Math.min(canvasW, canvasH) * 0.46;
}
