/**
 * Visual theme: neon colour palettes that cross-fade as the run travels from one
 * "district" to the next. Pure data + colour maths, no canvas dependency.
 */
import { BIOME } from '../config.js';
import { clamp01, smoothstep } from '../core/math.js';

export const BIOMES = [
  {
    name: 'MIDNIGHT SPRAWL',
    sky: ['#05070f', '#101a3a', '#25214d'],
    sun: '#9fe4ff',
    sunGlow: '#2f6bff',
    far: '#0d1330',
    mid: '#141d47',
    near: '#080c22',
    accent: '#4de2ff',
    accent2: '#a86bff',
    floor: '#070a19',
    edge: '#4de2ff',
    fog: '#1b2a63',
    star: '#cfe8ff',
  },
  {
    name: 'MAGENTA DISTRICT',
    sky: ['#0b0413', '#2a0a3a', '#4a1050'],
    sun: '#ff9ad5',
    sunGlow: '#ff2d95',
    far: '#220a34',
    mid: '#330f45',
    near: '#12051d',
    accent: '#ff5ea8',
    accent2: '#ffb457',
    floor: '#12041a',
    edge: '#ff5ea8',
    fog: '#4a1350',
    star: '#ffd9f2',
  },
  {
    name: 'TOXIC FOUNDRY',
    sky: ['#02100c', '#052b23', '#0b3a2c'],
    sun: '#b9ff9e',
    sunGlow: '#2bff9e',
    far: '#04201a',
    mid: '#072b22',
    near: '#021009',
    accent: '#5dffb2',
    accent2: '#d6ff4d',
    floor: '#02100b',
    edge: '#5dffb2',
    fog: '#0b4030',
    star: '#d8ffe8',
  },
  {
    name: 'SOLAR SLUMS',
    sky: ['#150602', '#3a1204', '#5c2206'],
    sun: '#ffd08a',
    sunGlow: '#ff7a18',
    far: '#2a0e05',
    mid: '#3d1606',
    near: '#160604',
    accent: '#ffa53d',
    accent2: '#ff4d4d',
    floor: '#140603',
    edge: '#ffa53d',
    fog: '#5a2408',
    star: '#ffe6c2',
  },
  {
    name: 'VOID SECTOR',
    sky: ['#05040a', '#120f24', '#1d1838'],
    sun: '#e8e6ff',
    sunGlow: '#7a5cff',
    far: '#0e0b1d',
    mid: '#171233',
    near: '#05040d',
    accent: '#c9b6ff',
    accent2: '#6cf2ff',
    floor: '#05040d',
    edge: '#c9b6ff',
    fog: '#241c46',
    star: '#ffffff',
  },
];

/* --------------------------------------------------------------- colours */

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** Blend two hex colours, returning a hex colour string. */
export function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp01(t);
  return `#${toHex(ca[0] + (cb[0] - ca[0]) * k)}${toHex(ca[1] + (cb[1] - ca[1]) * k)}${toHex(
    ca[2] + (cb[2] - ca[2]) * k,
  )}`;
}

/** `rgba()` from a hex colour + alpha. */
export function alpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(a)})`;
}

/* ---------------------------------------------------------------- biome */

export const biomeIndexAt = (metres) =>
  Math.floor(metres / BIOME.length) % BIOMES.length;

/** Which district we are in and how far the blend towards the next one is. */
export function biomeBlend(metres) {
  const segment = metres / BIOME.length;
  const index = Math.floor(segment);
  const frac = segment - index;
  const blendStart = 1 - BIOME.blend / BIOME.length;
  const t = frac <= blendStart ? 0 : (frac - blendStart) / (1 - blendStart);
  const from = ((index % BIOMES.length) + BIOMES.length) % BIOMES.length;
  const to = (from + 1) % BIOMES.length;
  return { from, to, t: smoothstep(t) };
}

const COLOR_KEYS = [
  'sun',
  'sunGlow',
  'far',
  'mid',
  'near',
  'accent',
  'accent2',
  'floor',
  'edge',
  'fog',
  'star',
];

/**
 * Interpolated palette for a distance. Returns css strings plus the district
 * name that should be on-screen (the one we are blending *into* once past 60%).
 */
export function paletteAt(metres) {
  const { from, to, t } = biomeBlend(metres);
  const a = BIOMES[from];
  const b = BIOMES[to];
  const out = { name: t > 0.6 ? b.name : a.name, biomeFrom: from, biomeTo: to, t };
  for (const key of COLOR_KEYS) out[key] = mix(a[key], b[key], t);
  out.sky = a.sky.map((color, i) => mix(color, b.sky[i], t));
  out.raw = { a, b, t };
  return out;
}
