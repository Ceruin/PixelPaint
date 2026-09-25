import { DEFAULT_BRUSH } from './brush.js';

export const PRESETS = [
  { cat: 'Sketch', name: 'Pencil HB', tip: 'pencil', size: 6, minSize: 0.4, flow: 0.6, spacing: 0.08, hardness: 0.9, smoothing: 0.15, pressureOpacity: true },
  { cat: 'Sketch', name: 'Graphite 6B', tip: 'pencil', size: 18, minSize: 0.3, flow: 0.4, spacing: 0.06, hardness: 0.6, pressureOpacity: true },
  { cat: 'Sketch', name: 'Charcoal', tip: 'chalk', size: 30, flow: 0.5, spacing: 0.12, scatter: 0.08, angleJitter: 1, pressureOpacity: true },
  { cat: 'Ink', name: 'Ink Pen', size: 8, minSize: 0.1, hardness: 0.95, spacing: 0.04, smoothing: 0.45 },
  { cat: 'Ink', name: 'Technical Pen', size: 4, minSize: 1, hardness: 1, spacing: 0.04, pressureSize: false, smoothing: 0.3 },
  { cat: 'Ink', name: 'Brush Pen', size: 20, minSize: 0.05, hardness: 0.9, spacing: 0.03, roundness: 0.55, angle: 40, smoothing: 0.5 },
  { cat: 'Paint', name: 'Round', size: 24, hardness: 0.85 },
  { cat: 'Paint', name: 'Soft Round', size: 60, hardness: 0, flow: 0.25, minSize: 0.6, pressureOpacity: true },
  { cat: 'Paint', name: 'Airbrush', size: 120, hardness: 0, flow: 0.05, buildup: true, spacing: 0.05, pressureSize: false, pressureOpacity: true },
  { cat: 'Paint', name: 'Oil Flat', tip: 'bristle', size: 40, minSize: 0.5, flow: 0.8, spacing: 0.05, followDir: true, angle: 90 },
  { cat: 'Paint', name: 'Marker', size: 30, hardness: 0.7, flow: 0.4, opacity: 0.7, blend: 'multiply', pressureSize: false },
  { cat: 'Texture', name: 'Chalk', tip: 'chalk', size: 40, flow: 0.7, spacing: 0.15, angleJitter: 1 },
  { cat: 'Texture', name: 'Splatter', tip: 'splatter', size: 60, scatter: 0.8, sizeJitter: 0.6, angleJitter: 1, spacing: 0.6 },
  { cat: 'Texture', name: 'Stipple', size: 5, scatter: 3, spacing: 0.9, sizeJitter: 0.7, hardness: 0.9, pressureSize: false },
  { cat: 'Eraser', name: 'Hard Eraser', size: 30, hardness: 0.95, pressureSize: false, smoothing: 0.1 },
  { cat: 'Eraser', name: 'Soft Eraser', size: 80, hardness: 0, flow: 0.5, smoothing: 0.1 },
  { cat: 'Blend', name: 'Smudge', size: 40, hardness: 0.3, flow: 0.7, spacing: 0.06, smoothing: 0.1, pressureOpacity: true },
  { cat: 'Blend', name: 'Soft Blender', size: 80, hardness: 0, flow: 0.4, spacing: 0.05, smoothing: 0.1 },
].map(p => ({ ...DEFAULT_BRUSH, ...p }));

export const preset = name => structuredClone(PRESETS.find(p => p.name === name) ?? PRESETS[0]);
