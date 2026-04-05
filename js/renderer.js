/**
 * renderer.js — Rendu Canvas 2D de la carte du ciel
 * Toutes les couleurs respectent le mode nuit (rouge/noir)
 */

import { magToRadius, magToOpacity, bvToColor, messierTypeStyle, arcminToPixels } from './astro.js';
import { project, computeSkyRadius } from './projection.js';

// ─── Couleurs nuit ─────────────────────────────────────────────────────────────
const COLORS = {
  skyBg:           '#000000',
  skyDisk:         '#020004',
  horizon:         'rgba(192, 57, 43, 0.25)',
  horizonLine:     'rgba(192, 57, 43, 0.5)',
  constellLine:    'rgba(180, 50, 30, 0.35)',
  constellLabel:   'rgba(180, 60, 40, 0.7)',
  starGlow:        'rgba(255, 220, 180, 0.08)',
  cardinalLabel:   'rgba(192, 57, 43, 0.8)',
  gridLine:        'rgba(120, 30, 20, 0.2)',
  milkyWay:        'rgba(60, 20, 10, 0.18)',
  objectOutline:   'rgba(100, 200, 150, 0.6)',
  objectFill:      'rgba(60, 120, 90, 0.12)',
};

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.cx = 0;
    this.cy = 0;
    this.skyRadius = 0;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(dpr, dpr);
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.skyRadius = computeSkyRadius(this.width, this.height);
  }

  /** Efface et redessine le fond du ciel */
  clear() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Fond total noir
    ctx.fillStyle = COLORS.skyBg;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Dessine le disque du ciel (hémisphère) */
  drawSkyDisk(zoomFactor, panX, panY) {
    const ctx = this.ctx;
    const r = this.skyRadius * zoomFactor;

    // Fond du disque céleste
    const grad = ctx.createRadialGradient(
      this.cx + panX, this.cy + panY, 0,
      this.cx + panX, this.cy + panY, r
    );
    grad.addColorStop(0, '#050008');
    grad.addColorStop(0.7, '#020004');
    grad.addColorStop(1, '#000000');

    ctx.beginPath();
    ctx.arc(this.cx + panX, this.cy + panY, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Cercle de l'horizon
    ctx.beginPath();
    ctx.arc(this.cx + panX, this.cy + panY, r, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.horizonLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Lueur de l'horizon
    const horizonGlow = ctx.createRadialGradient(
      this.cx + panX, this.cy + panY, r * 0.85,
      this.cx + panX, this.cy + panY, r
    );
    horizonGlow.addColorStop(0, 'transparent');
    horizonGlow.addColorStop(1, COLORS.horizon);
    ctx.beginPath();
    ctx.arc(this.cx + panX, this.cy + panY, r, 0, Math.PI * 2);
    ctx.fillStyle = horizonGlow;
    ctx.fill();
  }

  /** Dessine la Voie Lactée (approximation elliptique) */
  drawMilkyWay(zoomFactor, panX, panY, lstDeg, latitude) {
    const ctx = this.ctx;

    // La Voie Lactée suit approximativement le plan galactique
    // Centre galactique : RA 17h45m, Dec -29°
    // On dessine une bande elliptique approximative
    ctx.save();
    ctx.globalAlpha = 0.4;

    const positions = [];
    for (let i = 0; i <= 36; i++) {
      const galLon = i * 10; // longitude galactique 0-360
      // Conversion galactique → équatorial (approximation)
      const ra  = (galLon + 282.25) % 360;
      const dec = 62.6 * Math.sin((galLon - 33) * Math.PI / 180) - 30;

      const H = ((lstDeg - ra) % 360 + 360) % 360;
      const sinAlt = Math.sin(dec * Math.PI/180) * Math.sin(latitude * Math.PI/180)
                   + Math.cos(dec * Math.PI/180) * Math.cos(latitude * Math.PI/180) * Math.cos(H * Math.PI/180);
      const alt = Math.asin(sinAlt) * 180 / Math.PI;
      if (alt < -10) continue;

      const cosAz = (Math.sin(dec * Math.PI/180) - Math.sin(latitude * Math.PI/180) * sinAlt)
                  / (Math.cos(latitude * Math.PI/180) * Math.cos(alt * Math.PI/180));
      let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
      if (Math.sin(H * Math.PI/180) > 0) az = 360 - az;

      const p = project(az, alt, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      positions.push(p);
    }

    if (positions.length > 2) {
      ctx.beginPath();
      ctx.moveTo(positions[0].x, positions[0].y);
      for (let i = 1; i < positions.length; i++) {
        ctx.lineTo(positions[i].x, positions[i].y);
      }
      ctx.strokeStyle = COLORS.milkyWay;
      ctx.lineWidth = 28 * zoomFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    ctx.restore();
  }

  /** Grille de coordonnées horizontales (azimut / altitude) */
  drawGrid(zoomFactor, panX, panY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);

    // Cercles d'altitude : 15°, 30°, 45°, 60°, 75°
    for (const alt of [15, 30, 45, 60, 75]) {
      const r = ((90 - alt) / 90) * this.skyRadius * zoomFactor;
      ctx.beginPath();
      ctx.arc(this.cx + panX, this.cy + panY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Label d'altitude
      ctx.fillStyle = COLORS.gridLine;
      ctx.font = '9px Courier New';
      ctx.fillText(alt + '°', this.cx + panX + r + 4, this.cy + panY);
    }

    // Lignes d'azimut : tous les 30°
    for (let az = 0; az < 360; az += 30) {
      const p1 = project(az, 0,  this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      const p2 = project(az, 88, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Points cardinaux sur le bord de l'horizon */
  drawCardinalPoints(zoomFactor, panX, panY) {
    const ctx = this.ctx;
    const cardinals = [
      { az: 0,   label: 'N' },
      { az: 45,  label: 'NE' },
      { az: 90,  label: 'E' },
      { az: 135, label: 'SE' },
      { az: 180, label: 'S' },
      { az: 225, label: 'SO' },
      { az: 270, label: 'O' },
      { az: 315, label: 'NO' },
    ];

    ctx.save();
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { az, label } of cardinals) {
      const p = project(az, -2, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      ctx.fillStyle = label.length === 1 ? COLORS.cardinalLabel : COLORS.gridLine;
      ctx.fillText(label, p.x, p.y);
    }

    ctx.restore();
  }

  /** Lignes de constellations */
  drawConstellations(lines, zoomFactor, panX, panY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLORS.constellLine;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 5]);
    ctx.globalAlpha = 0.8;

    for (const segment of lines) {
      // segment = { az1, alt1, az2, alt2 } — déjà transformé en horizontal
      if (segment.alt1 < -5 && segment.alt2 < -5) continue; // sous l'horizon

      const p1 = project(segment.az1, segment.alt1, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      const p2 = project(segment.az2, segment.alt2, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Labels des constellations */
  drawConstellationLabels(labels, zoomFactor, panX, panY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = COLORS.constellLabel;
    ctx.font = `${Math.max(8, 9 * zoomFactor)}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { name, az, alt } of labels) {
      if (alt < 2) continue;
      const p = project(az, alt, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      ctx.fillText(name.toUpperCase(), p.x, p.y);
    }

    ctx.restore();
  }

  /** Étoiles */
  drawStars(stars, zoomFactor, panX, panY, magLimit) {
    const ctx = this.ctx;

    for (const star of stars) {
      if (star.altitude < -1) continue;
      if (star.mag > magLimit) continue;

      const p = project(star.azimuth, star.altitude, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      const r = magToRadius(star.mag, Math.max(1, zoomFactor));
      const opacity = magToOpacity(star.mag);
      const color = bvToColor(star.bv);

      ctx.save();
      ctx.globalAlpha = opacity;

      // Halo pour les étoiles brillantes (mag < 2)
      if (star.mag < 2 && r > 2) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        glow.addColorStop(0, color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
        glow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Point de l'étoile
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.restore();

      // Nom des étoiles brillantes (mag < 2.5)
      if (star.name && star.mag < 2.5 && zoomFactor >= 0.8) {
        ctx.save();
        ctx.fillStyle = 'rgba(200, 80, 60, 0.75)';
        ctx.font = `${Math.max(8, 9 * zoomFactor)}px Courier New`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(star.name, p.x + r + 3, p.y - 2);
        ctx.restore();
      }
    }
  }

  /** Objets Messier — cercle/ellipse représentant la taille angulaire */
  drawMessier(objects, zoomFactor, panX, panY, pixelsPerDegree) {
    const ctx = this.ctx;

    for (const obj of objects) {
      if (obj.altitude < -1) continue;

      const p = project(obj.azimuth, obj.altitude, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);
      const style = messierTypeStyle(obj.type);

      // Taille angulaire → pixels (min 4px pour être visible)
      const sizeR = Math.max(4, arcminToPixels(obj.size || 5, pixelsPerDegree * zoomFactor));

      ctx.save();

      // Halo de luminosité selon magnitude
      const glowSize = sizeR * 1.5;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
      glow.addColorStop(0, style.color.replace(')', ', 0.15)').replace('#', 'rgba(').replace(/([0-9a-f]{2})/gi, (_,h) => parseInt(h,16)+',').replace(/,$/, ')'));

      // Cercle de taille représentant l'objet
      ctx.beginPath();
      if (obj.type && obj.type.toLowerCase().includes('galaxy')) {
        // Galaxies : ellipse inclinée
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 6);
        ctx.scale(1, 0.45);
        ctx.arc(0, 0, sizeR, 0, Math.PI * 2);
        ctx.restore();
      } else {
        ctx.arc(p.x, p.y, sizeR, 0, Math.PI * 2);
      }

      ctx.strokeStyle = style.color + 'aa';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = style.color + '18';
      ctx.fill();

      // Icône centrale
      ctx.font = `${Math.min(14, Math.max(8, sizeR * 0.8))}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.color + 'cc';
      ctx.fillText(style.icon, p.x, p.y);

      // Label "Mxx"
      if (zoomFactor >= 0.7) {
        ctx.font = `8px Courier New`;
        ctx.fillStyle = style.color + 'aa';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(obj.id, p.x + sizeR + 3, p.y - 2);
      }

      ctx.restore();
    }
  }

  /** Zénith — point central */
  drawZenith(panX, panY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(192, 57, 43, 0.5)';
    ctx.lineWidth = 1;
    const x = this.cx + panX;
    const y = this.cy + panY;
    const s = 8;
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.restore();
  }

  /** Highlight d'un objet sélectionné */
  drawSelection(az, alt, zoomFactor, panX, panY) {
    const ctx = this.ctx;
    const p = project(az, alt, this.cx, this.cy, this.skyRadius, zoomFactor, panX, panY);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 100, 80, 0.9)';
    ctx.lineWidth = 1.5;
    const r = 16;
    // Réticule
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const gap = 5;
    ctx.beginPath();
    ctx.moveTo(p.x - r - gap, p.y); ctx.lineTo(p.x - r + gap, p.y);
    ctx.moveTo(p.x + r - gap, p.y); ctx.lineTo(p.x + r + gap, p.y);
    ctx.moveTo(p.x, p.y - r - gap); ctx.lineTo(p.x, p.y - r + gap);
    ctx.moveTo(p.x, p.y + r - gap); ctx.lineTo(p.x, p.y + r + gap);
    ctx.stroke();
    ctx.restore();
  }
}
