/**
 * projection.js — Projection gnomonique (perspective)
 *
 * On simule une caméra posée sur l'observateur, pointant vers
 * (viewAz, viewAlt). La projection est identique à Stellarium :
 * — L'horizon est une ligne droite quand viewAlt ≈ 0°
 * — Le zénith est un point au-dessus du centre quand viewAlt < 90°
 * — Les grands cercles (constellations) restent des lignes droites
 *
 * Formule : projection gnomonique sur un plan tangent
 * à la sphère au point de visée.
 */

const DEG = Math.PI / 180;

/**
 * Projette (az, alt) → (x, y) écran
 *
 * @param {number} az       — Azimut de l'objet (°)
 * @param {number} alt      — Altitude de l'objet (°)
 * @param {number} cx       — Centre X canvas
 * @param {number} cy       — Centre Y canvas
 * @param {number} width    — Largeur canvas (pour calculer la focale)
 * @param {number} viewAz   — Azimut de la direction de visée (°)
 * @param {number} viewAlt  — Altitude de la direction de visée (°)
 * @param {number} fovDeg   — Champ de vision horizontal (°)
 * @returns {{ x, y, cosC } | null}  — null si derrière le spectateur
 */
export function project(az, alt, cx, cy, width, viewAz, viewAlt, fovDeg) {
  const φ  = alt    * DEG;
  const φ0 = viewAlt * DEG;

  // Différence d'azimut normalisée dans (-180°, 180°]
  let daz = az - viewAz;
  while (daz >  180) daz -= 360;
  while (daz < -180) daz += 360;
  const Δλ = daz * DEG;

  // cos de la distance angulaire depuis le centre de vue
  const cosC = Math.sin(φ0) * Math.sin(φ)
             + Math.cos(φ0) * Math.cos(φ) * Math.cos(Δλ);

  // Derrière le spectateur → ne pas afficher
  if (cosC < 0.001) return null;

  // Focale en pixels : f = (w/2) / tan(fov/2)
  const f = (width / 2) / Math.tan((fovDeg / 2) * DEG);

  const x = cx + f * (Math.cos(φ) * Math.sin(Δλ)) / cosC;
  const y = cy - f * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(Δλ)) / cosC;

  return { x, y, cosC };
}

/**
 * Inverse : (screenX, screenY) → (az, alt)
 * Utilisé pour détecter un clic
 */
export function unproject(screenX, screenY, cx, cy, width, viewAz, viewAlt, fovDeg) {
  const φ0 = viewAlt * DEG;
  const f  = (width / 2) / Math.tan((fovDeg / 2) * DEG);

  const xn =  (screenX - cx) / f;
  const yn = -(screenY - cy) / f;  // axe Y inversé

  const ρ = Math.sqrt(xn * xn + yn * yn);
  if (ρ < 1e-10) return { az: viewAz, alt: viewAlt };

  const c    = Math.atan(ρ);
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);

  const sinφ = cosC * Math.sin(φ0) + (yn * sinC * Math.cos(φ0)) / ρ;
  const alt  = Math.asin(Math.max(-1, Math.min(1, sinφ))) / DEG;

  const Δλ = Math.atan2(xn * sinC, ρ * Math.cos(φ0) * cosC - yn * Math.sin(φ0) * sinC);
  const az  = ((viewAz + Δλ / DEG) % 360 + 360) % 360;

  return { az, alt };
}

/**
 * Focale en pixels (utile pour convertir arcmin → pixels)
 */
export function focalLength(width, fovDeg) {
  return (width / 2) / Math.tan((fovDeg / 2) * DEG);
}
