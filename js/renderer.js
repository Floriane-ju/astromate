/**
 * renderer.js — Rendu Canvas 2D mode perspective (Stellarium-like)
 * Projection gnomonique plein écran, horizon = ligne droite
 */

import { magToRadius, magToOpacity, bvToColor, messierTypeStyle, arcminToPixels } from './astro.js';
import { project, focalLength } from './projection.js';

const COLORS = {
  skyTop:          '#000003',
  skyHorizon:      '#060010',
  ground:          '#030001',
  groundGradTop:   'rgba(8, 2, 1, 0.95)',
  horizonLine:     'rgba(192, 57, 43, 0.3)',
  horizonGlow:     'rgba(80, 20, 10, 0.4)',
  constellLine:    'rgba(180, 50, 30, 0.35)',
  constellLabel:   'rgba(180, 60, 40, 0.7)',
  cardinalLabel:   'rgba(192, 57, 43, 0.9)',
  gridLine:        'rgba(120, 30, 20, 0.18)',
  starLabel:       'rgba(200, 80, 60, 0.75)',
};

export class SkyRenderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.width   = 0;
    this.height  = 0;
    this.cx      = 0;
    this.cy      = 0;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width  = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width  = this.width  * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width  = this.width  + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(dpr, dpr);
    this.cx = this.width  / 2;
    this.cy = this.height / 2;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  // ── Fond du ciel ─────────────────────────────────────────────────────────────

  drawSkyBackground() {
    const ctx  = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0,   COLORS.skyTop);
    grad.addColorStop(0.8, COLORS.skyHorizon);
    grad.addColorStop(1,   COLORS.skyHorizon);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // ── Horizon + sol ─────────────────────────────────────────────────────────────

  /**
   * L'horizon (alt=0) est un grand cercle → projection gnomonique = ligne droite.
   * On projette 2 points bien séparés en azimut pour déterminer la pente,
   * puis on extrapole jusqu'aux bords du canvas — même si l'horizon est hors-écran.
   */
  drawLandscape(viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;

    // 2 points sur l'horizon à 90° de part et d'autre de la direction de visée
    const pL = project((viewAz - 85 + 360) % 360, 0, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
    const pR = project((viewAz + 85)        % 360, 0, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);

    // Si les deux points sont derrière le spectateur, l'horizon n'est pas visible
    if (!pL && !pR) return;

    // Calcul de la droite y = a*x + b passant par les points disponibles
    let yLeft, yRight;

    if (pL && pR) {
      // Cas normal : 2 points → pente exacte
      const slope = (pR.y - pL.y) / (pR.x - pL.x || 1);
      yLeft  = pL.y - pL.x * slope;           // x=0
      yRight = pR.y + (this.width - pR.x) * slope; // x=width
    } else {
      // Un seul point visible (vue très rasante) → horizon horizontal au y connu
      const p = pL || pR;
      yLeft  = p.y;
      yRight = p.y;
    }

    // Si l'horizon est entièrement au-dessus de l'écran → tout est sol, ça ne devrait pas arriver
    // Si l'horizon est entièrement en-dessous → pas de sol à dessiner
    if (yLeft > this.height + 200 && yRight > this.height + 200) return;

    // Clamp pour ne pas dessiner des milliers de pixels hors-écran
    const clamp = (v) => Math.max(-50, Math.min(this.height + 50, v));
    yLeft  = clamp(yLeft);
    yRight = clamp(yRight);

    // ─ Sol (zone sous la ligne d'horizon)
    ctx.beginPath();
    ctx.moveTo(0,          this.height + 10);
    ctx.lineTo(0,          yLeft);
    ctx.lineTo(this.width, yRight);
    ctx.lineTo(this.width, this.height + 10);
    ctx.closePath();
    ctx.fillStyle = COLORS.ground;
    ctx.fill();

    // ─ Lueur atmosphérique au niveau de l'horizon
    const horizonMidY = (yLeft + yRight) / 2;
    const glowGrad = ctx.createLinearGradient(0, horizonMidY - 60, 0, horizonMidY + 20);
    glowGrad.addColorStop(0,   'transparent');
    glowGrad.addColorStop(0.6, COLORS.horizonGlow);
    glowGrad.addColorStop(1,   'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, horizonMidY - 60, this.width, 80);

    // ─ Ligne d'horizon
    ctx.beginPath();
    ctx.moveTo(0,          yLeft);
    ctx.lineTo(this.width, yRight);
    ctx.strokeStyle = COLORS.horizonLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Grille ────────────────────────────────────────────────────────────────────

  drawGrid(viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);
    ctx.fillStyle = COLORS.gridLine;
    ctx.font = '9px Courier New';

    // Parallèles d'altitude
    for (const alt of [10, 20, 30, 45, 60, 75]) {
      const pts = [];
      for (let az = 0; az < 360; az += 4) {
        const p = project(az, alt, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
        if (p) pts.push(p);
      }
      if (pts.length < 3) continue;
      pts.sort((a, b) => a.x - b.x);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (pts.length > 0) {
        const mid = pts[Math.floor(pts.length / 2)];
        ctx.fillText(alt + '°', mid.x + 3, mid.y - 3);
      }
    }

    // Méridiens d'azimut
    for (let az = 0; az < 360; az += 30) {
      const pts = [];
      for (let alt = 0; alt <= 90; alt += 5) {
        const p = project(az, alt, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
        if (p) pts.push(p);
      }
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Points cardinaux ──────────────────────────────────────────────────────────

  drawCardinalPoints(viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;
    const cardinals = [
      { az: 0,   label: 'N', big: true  },
      { az: 45,  label: 'NE' },
      { az: 90,  label: 'E', big: true  },
      { az: 135, label: 'SE' },
      { az: 180, label: 'S', big: true  },
      { az: 225, label: 'SO' },
      { az: 270, label: 'O', big: true  },
      { az: 315, label: 'NO' },
    ];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { az, label, big } of cardinals) {
      const p = project(az, -1.5, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      if (!p) continue;
      if (p.x < -20 || p.x > this.width + 20) continue;

      ctx.font = big ? 'bold 13px Courier New' : '10px Courier New';
      ctx.fillStyle = big ? COLORS.cardinalLabel : 'rgba(160, 40, 25, 0.7)';
      ctx.fillText(label, p.x, p.y);
    }

    ctx.restore();
  }

  // ── Constellations ────────────────────────────────────────────────────────────

  drawConstellations(lines, viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.constellLine;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 5]);

    for (const seg of lines) {
      if (seg.alt1 < -10 && seg.alt2 < -10) continue;
      const p1 = project(seg.az1, seg.alt1, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      const p2 = project(seg.az2, seg.alt2, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      if (!p1 || !p2) continue;

      // Évite les lignes qui traversent tout l'écran (points de part et d'autre du viewer)
      if (Math.abs(p1.x - p2.x) > this.width * 1.5) continue;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  drawConstellationLabels(labels, viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = COLORS.constellLabel;
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { name, az, alt } of labels) {
      if (alt < 2) continue;
      const p = project(az, alt, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      if (!p) continue;
      if (p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) continue;
      ctx.fillText(name.toUpperCase(), p.x, p.y);
    }

    ctx.restore();
  }

  // ── Étoiles ───────────────────────────────────────────────────────────────────

  drawStars(stars, viewAz, viewAlt, fovDeg, magLimit) {
    const ctx = this.ctx;

    // Facteur d'échelle de taille basé sur le FOV (plus on zoome, plus les étoiles sont grosses)
    const zoomScale = 90 / fovDeg;

    for (const star of stars) {
      if (star.altitude < -1)    continue;
      if (star.mag > magLimit)   continue;

      const p = project(star.azimuth, star.altitude, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      if (!p) continue;
      if (p.x < -20 || p.x > this.width + 20 || p.y < -20 || p.y > this.height + 20) continue;

      const r       = magToRadius(star.mag, Math.max(1, zoomScale));
      const opacity = magToOpacity(star.mag);
      const color   = bvToColor(star.bv);

      ctx.save();
      ctx.globalAlpha = opacity;

      // Halo pour les étoiles très brillantes
      if (star.mag < 1.5 && r > 2) {
        const haloR = r * 5;
        const glow  = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
        glow.addColorStop(0, color + '50');
        glow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // Nom des étoiles brillantes
      if (star.name && star.mag < 2.5 && zoomScale >= 0.8) {
        ctx.save();
        ctx.fillStyle = COLORS.starLabel;
        ctx.font = '9px Courier New';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(star.name, p.x + r + 3, p.y - 2);
        ctx.restore();
      }
    }
  }

  // ── Objets Messier ────────────────────────────────────────────────────────────

  drawMessier(objects, viewAz, viewAlt, fovDeg) {
    const ctx    = this.ctx;
    const f      = focalLength(this.width, fovDeg);
    // pixels par degré ≈ focale / 57.3
    const pixPerDeg = f / (180 / Math.PI);

    for (const obj of objects) {
      if (obj.altitude < -1) continue;

      const p = project(obj.azimuth, obj.altitude, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
      if (!p) continue;
      if (p.x < -50 || p.x > this.width + 50 || p.y < -50 || p.y > this.height + 50) continue;

      const style = messierTypeStyle(obj.type);
      const sizeR = Math.max(4, arcminToPixels(obj.size || 5, pixPerDeg));

      ctx.save();

      // Forme selon le type
      ctx.beginPath();
      if (obj.type?.toLowerCase().includes('galaxy')) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 5);
        ctx.scale(1, 0.42);
        ctx.arc(0, 0, sizeR, 0, Math.PI * 2);
        ctx.restore();
      } else {
        ctx.arc(p.x, p.y, sizeR, 0, Math.PI * 2);
      }

      ctx.strokeStyle = style.color + 'aa';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = style.color + '15';
      ctx.fill();

      // Icône centrale
      ctx.font = `${Math.min(13, Math.max(7, sizeR * 0.7))}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.color + 'cc';
      ctx.fillText(style.icon, p.x, p.y);

      // Label
      const zoomScale = 90 / fovDeg;
      if (zoomScale >= 0.6) {
        ctx.font = '8px Courier New';
        ctx.fillStyle = style.color + 'aa';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(obj.id, p.x + sizeR + 3, p.y - 2);
      }

      ctx.restore();
    }
  }

  // ── Sélection ─────────────────────────────────────────────────────────────────

  drawSelection(az, alt, viewAz, viewAlt, fovDeg) {
    const p = project(az, alt, this.cx, this.cy, this.width, viewAz, viewAlt, fovDeg);
    if (!p) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 100, 80, 0.9)';
    ctx.lineWidth = 1.5;
    const r = 16, gap = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - r - gap, p.y); ctx.lineTo(p.x - r + gap, p.y);
    ctx.moveTo(p.x + r - gap, p.y); ctx.lineTo(p.x + r + gap, p.y);
    ctx.moveTo(p.x, p.y - r - gap); ctx.lineTo(p.x, p.y - r + gap);
    ctx.moveTo(p.x, p.y + r - gap); ctx.lineTo(p.x, p.y + r + gap);
    ctx.stroke();
    ctx.restore();
  }

  // ── Indicateur de direction de vue ───────────────────────────────────────────

  drawViewIndicator(viewAz, viewAlt, fovDeg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '10px Courier New';
    ctx.fillStyle = 'rgba(140, 40, 25, 0.6)';
    ctx.textAlign = 'center';
    // Direction cardinale la plus proche
    const dirs = ['N','NE','E','SE','S','SO','O','NO'];
    const dir  = dirs[Math.round(viewAz / 45) % 8];
    ctx.fillText(`${dir} · ${Math.round(viewAlt)}° · FOV ${Math.round(fovDeg)}°`,
                 this.cx, this.height - 6);
    ctx.restore();
  }
}
