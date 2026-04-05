/**
 * projection.js — Projection stéréographique
 *
 * Contrairement à la projection gnomonique (grands cercles = droites → horizon plat),
 * la stéréographique projette les grands cercles en CERCLES (ou arcs) sur l'écran.
 * L'horizon (grand cercle à alt=0) apparaît donc comme une courbe concave
 * s'abaissant vers les bords, exactement comme dans Stellarium.
 *
 * Formule : r = 2f · tan(c/2)
 * où c = distance angulaire depuis le centre de vue,
 *    f = paramètre d'échelle tel que le bord de l'écran = fovDeg/2
 */

const DEG = Math.PI / 180;

/**
 * Facteur d'échelle stéréographique.
 * On veut r_edge = width/2 pour c = fovDeg/2 :
 *   width/2 = 2f · tan(fovDeg/4)  →  f = (width/2) / (2·tan(fovDeg/4))
 */
function stereoF(width, fovDeg) {
  return (width / 2) / (2 * Math.tan((fovDeg / 4) * DEG));
}

/**
 * Projette (az, alt) → (x, y) écran en stéréographique
 *
 * @param {number} az       — Azimut objet (°)
 * @param {number} alt      — Altitude objet (°)
 * @param {number} cx/cy    — Centre canvas
 * @param {number} width    — Largeur canvas
 * @param {number} viewAz   — Azimut direction de vue (°)
 * @param {number} viewAlt  — Altitude direction de vue (°)
 * @param {number} fovDeg   — Champ de vision horizontal (°)
 * @returns {{ x, y, cosC } | null}
 */
export function project(az, alt, cx, cy, width, viewAz, viewAlt, fovDeg) {
  const φ  = alt    * DEG;
  const φ0 = viewAlt * DEG;

  let daz = az - viewAz;
  while (daz >  180) daz -= 360;
  while (daz < -180) daz += 360;
  const Δλ = daz * DEG;

  const cosC = Math.sin(φ0) * Math.sin(φ)
             + Math.cos(φ0) * Math.cos(φ) * Math.cos(Δλ);

  // Trop proche du point antipodal → projection à l'infini
  if (cosC < -0.95) return null;

  const f = stereoF(width, fovDeg);
  const k = 2 * f / (1 + cosC);   // facteur de grossissement stéréo

  const x = cx + k * Math.cos(φ) * Math.sin(Δλ);
  const y = cy - k * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(Δλ));

  return { x, y, cosC };
}

/**
 * Inverse : (screenX, screenY) → (az, alt)
 */
export function unproject(screenX, screenY, cx, cy, width, viewAz, viewAlt, fovDeg) {
  const φ0 = viewAlt * DEG;
  const f  = stereoF(width, fovDeg);

  const xn =  (screenX - cx);
  const yn = -(screenY - cy);
  const ρ  = Math.sqrt(xn * xn + yn * yn);

  if (ρ < 1e-10) return { az: viewAz, alt: viewAlt };

  // Inverse stéréographique : c = 2·arctan(ρ / 2f)
  const c    = 2 * Math.atan(ρ / (2 * f));
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);

  const sinφ = cosC * Math.sin(φ0) + (yn * sinC * Math.cos(φ0)) / ρ;
  const alt  = Math.asin(Math.max(-1, Math.min(1, sinφ))) / DEG;

  const Δλ = Math.atan2(xn * sinC, ρ * Math.cos(φ0) * cosC - yn * Math.sin(φ0) * sinC);
  const az  = ((viewAz + Δλ / DEG) % 360 + 360) % 360;

  return { az, alt };
}

/**
 * Échelle locale au centre de vue (pixels par radian) — pour sizing des objets Messier
 */
export function focalLength(width, fovDeg) {
  return stereoF(width, fovDeg);
}
