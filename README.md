# AstroMate

**Version actuelle : v1.2.2**

Carte du ciel nocturne interactive — PWA mobile-first conçue pour l'observation astronomique en préservant la vision nocturne.

## Fonctionnalités

- Carte du ciel en temps réel basée sur la position GPS
- Projection stéréographique (horizon courbé, style Stellarium)
- Étoiles, constellations, objets Messier (catalogue HYG · IAU 2022)
- Thème rouge nuit pour préserver la vision
- Mode rouge nuit activable/désactivable
- Voie Lactée, grille céleste
- Fonctionne hors-ligne (PWA, cache-first)

## Technologies

- Canvas 2D — projection stéréographique
- Géolocalisation GPS
- Service Worker (PWA)
- Données : catalogue HYG, Messier, IAU 2022

## Historique des versions

| Version | Description |
|---------|-------------|
| v1.2.2  | Suppression ligne rouge droite · Dézoom jusqu'à 300° |
| v1.2.1  | Suppression ligne rouge bas d'écran · Dézoom étendu (fovMax 175°) |
| v1.2.0  | Projection stéréographique — horizon courbé style Stellarium |
| v1.1.3  | Horizon réellement calculé et visible à l'écran |
| v1.1.2  | Ligne d'horizon correcte en toute position/zoom |
| v1.1.1  | Projection gnomonique plein écran |
| v1.1.0  | Horizon perspective (gnomonique) |
| v1.0.x  | Version initiale — projection azimutale |
