// Makes the web version's demo photos: an illustrated, made-up trip along the Amalfi Coast, 22
// pictures over three days. Flat illustrations, not photographs of anyone or anywhere real.
//
//   npm run demo-photos   → src/web/public/demo/*.jpg + manifest.json
//
// Each JPEG carries EXIF with a placeholder date (2000:01:0D HH:MM:SS, D = trip day). The demo
// rewrites those bytes relative to today when it loads (src/web/demo/sample.ts), so the trip is
// always a few weeks old, and the photos still go through the real import (EXIF, analysis).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { mulberry32 } from '../src/core/random';

const OUT = 'src/web/public/demo';

type Shape = 'land' | 'portrait' | 'pano';
const SIZE: Record<Shape, [number, number]> = { land: [2400, 1800], portrait: [1800, 2400], pano: [4800, 1600] };

interface Photo {
  file: string;
  day: 1 | 2 | 3;
  time: string;
  shape: Shape;
  draw: (w: number, h: number, r: () => number) => string;
  /** Marked ★ in the demo library. */
  favorite?: boolean;
}

const PASTELS = ['#f2c6a0', '#f6e3b4', '#e9a68b', '#f4d7d0', '#c9dcc0', '#fbeedd', '#e7b98f', '#d9c7e6', '#f7d488', '#bcd7e0'];

// ---- building blocks ------------------------------------------------------------------------

const sky = (w: number, h: number, top: string, bottom: string, id = 'sky') =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>`;

const sun = (x: number, y: number, r: number, color = '#ffe2a0') => `<circle cx="${x}" cy="${y}" r="${r * 1.6}" fill="${color}" opacity="0.25"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;

function sea(w: number, y: number, h: number, r: () => number, deep = '#2f7fa3', light = '#5fb2c9') {
  let s = `<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs><rect x="0" y="${y}" width="${w}" height="${h - y}" fill="url(#sea)"/>`;
  for (let i = 0; i < 26; i++) {
    const yy = y + 20 + r() * (h - y - 30);
    const x = r() * w;
    const len = 40 + r() * 140;
    s += `<path d="M${x} ${yy} q${len / 4} -8 ${len / 2} 0 t${len / 2} 0" stroke="#e8f6f8" stroke-width="5" fill="none" opacity="${0.35 + r() * 0.4}" stroke-linecap="round"/>`;
  }
  return s;
}

function cliff(w: number, h: number, base: number, peak: number, side: 'left' | 'right', color: string, r: () => number) {
  const pts: string[] = [];
  const x0 = side === 'left' ? 0 : w;
  const reach = w * (0.45 + r() * 0.2);
  pts.push(`${x0},${h}`, `${x0},${peak}`);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const x = side === 'left' ? reach * t : w - reach * t;
    pts.push(`${x},${peak + (base - peak) * t * t + (r() - 0.5) * 60}`);
  }
  pts.push(`${side === 'left' ? reach : w - reach},${h}`);
  return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
}

/** Pastel houses stacked up a slope from (x0, yBase) towards (x1, yTop). */
function village(x0: number, x1: number, yBase: number, yTop: number, size: number, r: () => number) {
  let s = '';
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    const t = row / rows;
    const y = yBase - (yBase - yTop) * t;
    const span = (x1 - x0) * (1 - t * 0.55);
    const start = x0 + (x1 - x0 - span) * (x1 > x0 ? 0.5 : 0.5);
    const n = Math.max(2, Math.round(span / (size * 1.25)));
    for (let i = 0; i < n; i++) {
      const hw = size * (0.7 + r() * 0.6);
      const hh = size * (0.6 + r() * 0.7);
      const x = start + (i / n) * span + r() * size * 0.3;
      const c = PASTELS[Math.floor(r() * PASTELS.length)];
      s += `<rect x="${x}" y="${y - hh}" width="${hw}" height="${hh}" fill="${c}" stroke="#00000014" stroke-width="3"/>`;
      s += `<rect x="${x + hw * 0.22}" y="${y - hh * 0.72}" width="${hw * 0.18}" height="${hh * 0.24}" fill="#3d5a73" opacity="0.75"/>`;
      s += `<rect x="${x + hw * 0.6}" y="${y - hh * 0.72}" width="${hw * 0.18}" height="${hh * 0.24}" fill="#3d5a73" opacity="0.75"/>`;
      if (r() > 0.6) s += `<path d="M${x - 6} ${y - hh} L${x + hw / 2} ${y - hh - hh * 0.35} L${x + hw + 6} ${y - hh} Z" fill="#c4674a"/>`;
    }
  }
  return s;
}

function boat(x: number, y: number, s: number, hull = '#f4efe6', stripe = '#2e6f95') {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-120 0 L120 0 L90 40 L-95 40 Z" fill="${hull}"/><rect x="-118" y="6" width="236" height="9" fill="${stripe}"/><rect x="-30" y="-46" width="70" height="46" fill="#fbfaf6"/><rect x="-18" y="-36" width="18" height="16" fill="#7aa9c4"/><rect x="10" y="-36" width="18" height="16" fill="#7aa9c4"/></g>`;
}

function lemonTree(x: number, y: number, s: number, r: () => number) {
  let g = `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-14" y="-40" width="28" height="160" fill="#7b5a3c"/>`;
  for (let i = 0; i < 7; i++) g += `<ellipse cx="${(r() - 0.5) * 220}" cy="${-90 - r() * 120}" rx="${90 + r() * 50}" ry="${70 + r() * 40}" fill="${['#4f8a4a', '#5c9a50', '#447c41'][i % 3]}"/>`;
  for (let i = 0; i < 16; i++) g += `<ellipse cx="${(r() - 0.5) * 260}" cy="${-60 - r() * 200}" rx="17" ry="13" fill="#f5d33f" stroke="#d9b21f" stroke-width="3"/>`;
  return g + '</g>';
}

const umbrella = (x: number, y: number, s: number, c1: string, c2: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="0" width="8" height="150" fill="#6d5a48"/><path d="M-120 10 Q0 -90 120 10 Z" fill="${c1}"/><path d="M-40 10 Q0 -90 40 10 Z" fill="${c2}"/></g>`;

const label = (x: number, y: number, size: number, text: string, color = '#3b3026') => `<text x="${x}" y="${y}" font-family="Georgia, serif" font-size="${size}" fill="${color}" text-anchor="middle">${text}</text>`;

// ---- scenes ------------------------------------------------------------------------------------

function coast(w: number, h: number, r: () => number, o: { skyTop: string; skyBottom: string; sunAt?: [number, number]; horizon?: number; side?: 'left' | 'right'; houses?: boolean; boats?: number; cliffColor?: string }) {
  const horizon = h * (o.horizon ?? 0.52);
  let s = sky(w, h, o.skyTop, o.skyBottom);
  if (o.sunAt) s += sun(w * o.sunAt[0], h * o.sunAt[1], Math.min(w, h) * 0.07);
  s += sea(w, horizon, h, r);
  const side = o.side ?? 'left';
  s += cliff(w, h, h * 0.95, horizon - h * 0.22, side, o.cliffColor ?? '#8d7a5f', r);
  if (o.houses) s += side === 'left' ? village(w * 0.02, w * 0.34, h * 0.86, horizon - h * 0.08, Math.min(w, h) * 0.07, r) : village(w * 0.64, w * 0.98, h * 0.86, horizon - h * 0.08, Math.min(w, h) * 0.07, r);
  for (let i = 0; i < (o.boats ?? 0); i++) s += boat(w * (side === 'left' ? 0.55 + i * 0.2 : 0.18 + i * 0.2), horizon + (h - horizon) * (0.3 + r() * 0.4), 0.9 + r() * 0.8);
  return s;
}

function plate(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#e9dcc7"/>`;
  for (let i = 0; i < 9; i++) s += `<rect x="0" y="${(i * h) / 9}" width="${w}" height="${h / 18}" fill="#d97a5d" opacity="0.18"/>`;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.34;
  s += `<circle cx="${cx + 18}" cy="${cy + 22}" r="${R}" fill="#00000022"/><circle cx="${cx}" cy="${cy}" r="${R}" fill="#fbfaf6"/><circle cx="${cx}" cy="${cy}" r="${R * 0.72}" fill="#f3efe6"/>`;
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * R * 0.55;
    s += `<path d="M${cx + Math.cos(a) * d} ${cy + Math.sin(a) * d} q${(r() - 0.5) * 160} ${(r() - 0.5) * 160} ${(r() - 0.5) * 220} ${(r() - 0.5) * 220}" stroke="#f0cf7a" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < 9; i++) s += `<circle cx="${cx + (r() - 0.5) * R}" cy="${cy + (r() - 0.5) * R}" r="${R * 0.06}" fill="#d64b32"/>`;
  for (let i = 0; i < 5; i++) s += `<ellipse cx="${cx + (r() - 0.5) * R}" cy="${cy + (r() - 0.5) * R}" rx="${R * 0.06}" ry="${R * 0.03}" fill="#4f8a4a"/>`;
  s += `<rect x="${w * 0.1}" y="${h * 0.12}" width="${w * 0.05}" height="${h * 0.76}" rx="20" fill="#c9c2b4"/>`;
  return s;
}

function cafe(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#4c7d93"/>`;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 9; j++) if ((i + j) % 2 === 0) s += `<rect x="${(i * w) / 12}" y="${(j * h) / 9}" width="${w / 12}" height="${h / 9}" fill="#f2efe6" opacity="0.9"/>`;
  const cx = w * 0.5;
  const cy = h * 0.52;
  s += `<ellipse cx="${cx + 20}" cy="${cy + 30}" rx="${w * 0.2}" ry="${w * 0.2}" fill="#00000026"/><circle cx="${cx}" cy="${cy}" r="${w * 0.2}" fill="#fbfaf6"/><circle cx="${cx}" cy="${cy}" r="${w * 0.11}" fill="#fbfaf6" stroke="#e4ddd0" stroke-width="10"/><circle cx="${cx}" cy="${cy}" r="${w * 0.085}" fill="#6b3f24"/><circle cx="${cx - 20}" cy="${cy - 14}" r="${w * 0.03}" fill="#c99a6b" opacity="0.8"/>`;
  s += `<rect x="${cx + w * 0.1}" y="${cy - 14}" width="${w * 0.09}" height="28" rx="14" fill="#fbfaf6"/>`;
  s += `<rect x="${w * 0.12}" y="${h * 0.7}" width="${w * 0.16}" height="${h * 0.12}" rx="10" fill="#f5d33f"/>`;
  void r;
  return s;
}

function door(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#f3d9b8"/>`;
  s += `<path d="M${w * 0.28} ${h * 0.92} L${w * 0.28} ${h * 0.36} Q${w * 0.5} ${h * 0.18} ${w * 0.72} ${h * 0.36} L${w * 0.72} ${h * 0.92} Z" fill="#2d6f8f"/>`;
  s += `<rect x="${w * 0.495}" y="${h * 0.36}" width="${w * 0.01}" height="${h * 0.56}" fill="#1f5068"/>`;
  s += `<rect x="0" y="${h * 0.92}" width="${w}" height="${h * 0.08}" fill="#cdb79a"/>`;
  for (let i = 0; i < 70; i++) {
    const x = r() < 0.5 ? r() * w * 0.32 : w - r() * w * 0.32;
    const y = r() * h * 0.55;
    s += `<circle cx="${x}" cy="${y}" r="${18 + r() * 26}" fill="${['#d5307e', '#e2559a', '#b8236a'][i % 3]}" opacity="0.92"/>`;
  }
  for (let i = 0; i < 30; i++) s += `<ellipse cx="${r() * w}" cy="${r() * h * 0.5}" rx="22" ry="12" fill="#4f8a4a" opacity="0.8"/>`;
  s += `<rect x="${w * 0.08}" y="${h * 0.8}" width="${w * 0.12}" height="${h * 0.12}" fill="#c4674a"/><ellipse cx="${w * 0.14}" cy="${h * 0.78}" rx="${w * 0.1}" ry="${h * 0.06}" fill="#5c9a50"/>`;
  return s;
}

function stairs(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#f6e3c4"/>`;
  s += `<rect x="0" y="0" width="${w * 0.22}" height="${h}" fill="#e9a68b"/><rect x="${w * 0.78}" y="0" width="${w * 0.22}" height="${h}" fill="#f2c6a0"/>`;
  for (let i = 0; i < 14; i++) {
    const y = h - (i + 1) * (h / 15);
    const inset = i * w * 0.012;
    s += `<rect x="${w * 0.22 + inset}" y="${y}" width="${w * 0.56 - 2 * inset}" height="${h / 15}" fill="${i % 2 ? '#e3d3b8' : '#d8c6a8'}"/>`;
  }
  s += `<rect x="${w * 0.4}" y="${h * 0.04}" width="${w * 0.2}" height="${h * 0.1}" fill="#9fd0e3"/>`;
  for (let i = 0; i < 6; i++) s += `<rect x="${w * 0.03}" y="${h * (0.15 + i * 0.12)}" width="${w * 0.12}" height="${h * 0.06}" fill="#3d5a73" opacity="0.6"/>`;
  s += `<ellipse cx="${w * 0.86}" cy="${h * 0.3}" rx="${w * 0.1}" ry="${h * 0.04}" fill="#5c9a50"/><rect x="${w * 0.8}" y="${h * 0.3}" width="${w * 0.12}" height="${h * 0.05}" fill="#c4674a"/>`;
  void r;
  return s;
}

function tiles(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#fbf7ee"/>`;
  const n = 6;
  const t = w / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < Math.ceil(h / t); j++) {
      const x = i * t;
      const y = j * t;
      const c = (i + j) % 2 ? '#2e6f95' : '#e3a92f';
      s += `<rect x="${x + 6}" y="${y + 6}" width="${t - 12}" height="${t - 12}" fill="#fbf7ee" stroke="#d8cfbf" stroke-width="4"/>`;
      s += `<circle cx="${x + t / 2}" cy="${y + t / 2}" r="${t * 0.28}" fill="${c}"/><circle cx="${x + t / 2}" cy="${y + t / 2}" r="${t * 0.12}" fill="#fbf7ee"/>`;
      for (let k = 0; k < 4; k++) s += `<circle cx="${x + (k % 2 ? t * 0.14 : t * 0.86)}" cy="${y + (k < 2 ? t * 0.14 : t * 0.86)}" r="${t * 0.07}" fill="#4f8a4a"/>`;
    }
  }
  void r;
  return s;
}

function dome(w: number, h: number, r: () => number) {
  let s = sky(w, h, '#7fc3e3', '#d8eef5');
  s += `<rect x="${w * 0.25}" y="${h * 0.55}" width="${w * 0.5}" height="${h * 0.45}" fill="#f6eedf"/>`;
  s += `<path d="M${w * 0.3} ${h * 0.56} Q${w * 0.5} ${h * 0.18} ${w * 0.7} ${h * 0.56} Z" fill="#e3a92f"/>`;
  for (let i = 0; i < 6; i++) s += `<path d="M${w * (0.33 + i * 0.068)} ${h * 0.56} Q${w * 0.5} ${h * 0.2} ${w * 0.5} ${h * 0.22}" stroke="#2e6f95" stroke-width="12" fill="none"/>`;
  s += `<rect x="${w * 0.485}" y="${h * 0.13}" width="${w * 0.03}" height="${h * 0.1}" fill="#6d5a48"/><rect x="${w * 0.47}" y="${h * 0.16}" width="${w * 0.06}" height="${h * 0.015}" fill="#6d5a48"/>`;
  s += `<path d="M${w * 0.42} ${h} L${w * 0.42} ${h * 0.75} Q${w * 0.5} ${h * 0.66} ${w * 0.58} ${h * 0.75} L${w * 0.58} ${h} Z" fill="#8b5a3c"/>`;
  s += `<rect x="0" y="${h * 0.8}" width="${w * 0.25}" height="${h * 0.2}" fill="#f2c6a0"/><rect x="${w * 0.75}" y="${h * 0.76}" width="${w * 0.25}" height="${h * 0.24}" fill="#f4d7d0"/>`;
  void r;
  return s;
}

function beach(w: number, h: number, r: () => number) {
  let s = sky(w, h, '#8cc9e8', '#e6f4f8');
  s += sea(w, h * 0.42, h * 0.7, r);
  s += `<path d="M0 ${h * 0.66} Q${w * 0.5} ${h * 0.6} ${w} ${h * 0.68} L${w} ${h} L0 ${h} Z" fill="#c9b9a6"/>`;
  for (let i = 0; i < 160; i++) s += `<circle cx="${r() * w}" cy="${h * 0.7 + r() * h * 0.3}" r="${4 + r() * 6}" fill="#b2a08c" opacity="0.6"/>`;
  const colours: [string, string][] = [['#f28c28', '#fbeedd'], ['#2e6f95', '#fbeedd'], ['#f28c28', '#fbeedd'], ['#2e6f95', '#fbeedd'], ['#f28c28', '#fbeedd']];
  colours.forEach(([a, b], i) => (s += umbrella(w * (0.12 + i * 0.19), h * (0.66 + (i % 2) * 0.06), 1.4 + (i % 2) * 0.3, a, b)));
  return s;
}

function grove(w: number, h: number, r: () => number) {
  let s = sky(w, h, '#a9d8ef', '#eef7f2');
  s += `<rect x="0" y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="#9cba7c"/>`;
  for (let i = 0; i < 5; i++) s += `<rect x="0" y="${h * (0.6 + i * 0.08)}" width="${w}" height="10" fill="#7e9c62" opacity="0.6"/>`;
  for (let i = 0; i < 5; i++) s += lemonTree(w * (0.1 + i * 0.2), h * (0.62 + (i % 2) * 0.08), 1.6 + r() * 0.5, r);
  s += `<rect x="0" y="${h * 0.86}" width="${w}" height="${h * 0.04}" fill="#6d5a48" opacity="0.6"/>`;
  return s;
}

function trail(w: number, h: number, r: () => number) {
  let s = sky(w, h, '#9fd0ea', '#f5ecd8');
  s += sea(w, h * 0.62, h, r);
  s += `<path d="M0 ${h * 0.5} L${w * 0.2} ${h * 0.28} L${w * 0.38} ${h * 0.42} L${w * 0.6} ${h * 0.22} L${w * 0.85} ${h * 0.45} L${w} ${h * 0.38} L${w} ${h * 0.7} L0 ${h * 0.7} Z" fill="#7b8f6a"/>`;
  s += `<path d="M0 ${h} L0 ${h * 0.62} Q${w * 0.3} ${h * 0.55} ${w * 0.5} ${h * 0.7} T${w} ${h * 0.75} L${w} ${h} Z" fill="#a8935f"/>`;
  s += `<path d="M${w * 0.1} ${h} Q${w * 0.3} ${h * 0.8} ${w * 0.55} ${h * 0.77} T${w * 0.95} ${h * 0.7}" stroke="#e8d9b5" stroke-width="40" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 20; i++) s += `<circle cx="${r() * w}" cy="${h * (0.8 + r() * 0.2)}" r="${20 + r() * 30}" fill="#5c7a48"/>`;
  return s;
}

function arrival(w: number, h: number, r: () => number) {
  let s = sky(w, h, '#bfe2f2', '#fdf2df');
  s += sun(w * 0.8, h * 0.18, Math.min(w, h) * 0.06);
  s += sea(w, h * 0.45, h, r);
  s += `<path d="M0 ${h * 0.45} L${w * 0.15} ${h * 0.3} L${w * 0.3} ${h * 0.38} L${w * 0.45} ${h * 0.26} L${w * 0.6} ${h * 0.45} Z" fill="#9aa596" opacity="0.8"/>`;
  s += boat(w * 0.5, h * 0.75, 3.2);
  s += `<path d="M${w * 0.2} ${h * 0.82} q${w * 0.15} 30 ${w * 0.6} 0" stroke="#fbfaf6" stroke-width="16" fill="none" opacity="0.6"/>`;
  return s;
}

function dusk(w: number, h: number, r: () => number, tint = 0) {
  const top = ['#3c4f7c', '#4a4e7e', '#3a5078'][tint % 3];
  let s = sky(w, h, top, '#f2a46a');
  s += sun(w * (0.5 + tint * 0.02), h * 0.5, Math.min(w, h) * 0.08, '#ffd27a');
  s += sea(w, h * 0.55, h, r, '#3a4f6e', '#c98a63');
  s += cliff(w, h, h * 0.95, h * 0.35, 'right', '#3e3a40', r);
  s += `<rect x="0" y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="#2c2b30"/>`;
  for (let i = 0; i < 9; i++) s += `<rect x="${(i * w) / 9 + 10}" y="${h * 0.8}" width="14" height="${h * 0.06}" fill="#2c2b30"/>`;
  s += `<rect x="0" y="${h * 0.8}" width="${w}" height="12" fill="#2c2b30"/>`;
  s += `<circle cx="${w * 0.2}" cy="${h * 0.78}" r="${h * 0.025}" fill="#ffd27a" opacity="0.9"/>`;
  return s;
}

function lemons(w: number, h: number, r: () => number) {
  let s = `<rect width="${w}" height="${h}" fill="#7a5a3f"/>`;
  s += `<rect x="${w * 0.08}" y="${h * 0.3}" width="${w * 0.84}" height="${h * 0.6}" fill="#c9a77c"/>`;
  for (let i = 0; i < 8; i++) s += `<rect x="${w * 0.08}" y="${h * (0.3 + i * 0.075)}" width="${w * 0.84}" height="6" fill="#a88560"/>`;
  for (let i = 0; i < 45; i++) s += `<ellipse cx="${w * (0.14 + r() * 0.72)}" cy="${h * (0.32 + r() * 0.5)}" rx="${w * 0.045}" ry="${w * 0.034}" fill="#f5d33f" stroke="#d9b21f" stroke-width="5"/>`;
  for (let i = 0; i < 18; i++) s += `<ellipse cx="${w * (0.14 + r() * 0.72)}" cy="${h * (0.3 + r() * 0.5)}" rx="${w * 0.03}" ry="${w * 0.012}" fill="#4f8a4a"/>`;
  s += `<path d="M${w * 0.02} ${h * 0.3} L${w * 0.5} ${h * 0.05} L${w * 0.98} ${h * 0.3} Z" fill="#e9dcc7"/>`;
  for (let i = 0; i < 8; i++) s += `<path d="M${w * (0.02 + i * 0.12)} ${h * 0.3} L${w * 0.5} ${h * 0.05}" stroke="#d64b32" stroke-width="22" opacity="0.7"/>`;
  s += `<rect x="${w * 0.36}" y="${h * 0.84}" width="${w * 0.28}" height="${h * 0.1}" fill="#fbfaf6"/>`;
  s += label(w * 0.5, h * 0.905, h * 0.045, 'limoni €2');
  return s;
}

// ---- the trip ------------------------------------------------------------------------------------

const harbourPano = (w: number, h: number, r: () => number) => {
  let s = sky(w, h, '#a7d6ee', '#fbefd9');
  s += sun(w * 0.86, h * 0.2, h * 0.08);
  s += sea(w, h * 0.55, h, r);
  s += cliff(w * 0.5, h, h * 0.95, h * 0.18, 'left', '#8d7a5f', r);
  s += village(w * 0.01, w * 0.28, h * 0.86, h * 0.36, h * 0.075, r);
  s += `<polygon points="${w * 0.55},${h} ${w * 0.62},${h * 0.32} ${w * 0.75},${h * 0.4} ${w * 0.82},${h * 0.55} ${w * 0.9},${h} " fill="#9a8668"/>`;
  s += village(w * 0.6, w * 0.84, h * 0.88, h * 0.42, h * 0.07, r);
  for (let i = 0; i < 4; i++) s += boat(w * (0.33 + i * 0.06), h * (0.72 + (i % 2) * 0.1), 0.9 + r() * 0.5);
  return s;
};

const burst = (dx: number) => (w: number, h: number, r: () => number) => {
  let s = sky(w, h, '#86c5e6', '#e7f4f8');
  s += sea(w, h * 0.38, h, r);
  s += boat(w * (0.45 + dx), h * 0.62, 4.2, '#fbfaf6', '#c4674a');
  s += `<path d="M${w * (0.2 + dx)} ${h * 0.72} q${w * 0.1} 30 ${w * 0.3} 6" stroke="#fbfaf6" stroke-width="18" fill="none" opacity="0.7"/>`;
  return s;
};

const PHOTOS: Photo[] = [
  { file: 'day1-01-ferry.jpg', day: 1, time: '09:40:00', shape: 'land', draw: arrival },
  { file: 'day1-02-harbour-pano.jpg', day: 1, time: '10:25:00', shape: 'pano', draw: harbourPano, favorite: true },
  { file: 'day1-03-positano.jpg', day: 1, time: '11:10:00', shape: 'land', draw: (w, h, r) => coast(w, h, r, { skyTop: '#9fd3ee', skyBottom: '#fdf3e2', side: 'left', houses: true, boats: 2 }) },
  { file: 'day1-04-lemon-stall.jpg', day: 1, time: '12:30:00', shape: 'portrait', draw: lemons },
  { file: 'day1-05-stairs.jpg', day: 1, time: '15:05:00', shape: 'portrait', draw: stairs },
  { file: 'day1-06-dusk-terrace.jpg', day: 1, time: '19:45:00', shape: 'land', draw: (w, h, r) => dusk(w, h, r, 0), favorite: true },
  { file: 'day1-07-dinner.jpg', day: 1, time: '20:50:00', shape: 'land', draw: plate },
  { file: 'day2-01-path-of-the-gods.jpg', day: 2, time: '08:55:00', shape: 'land', draw: trail },
  { file: 'day2-02-trail-view.jpg', day: 2, time: '10:20:00', shape: 'portrait', draw: (w, h, r) => coast(w, h, r, { skyTop: '#a3d4ee', skyBottom: '#f6efe0', side: 'right', houses: true, horizon: 0.45 }) },
  { file: 'day2-03-boat-a.jpg', day: 2, time: '12:01:10', shape: 'land', draw: burst(-0.04) },
  { file: 'day2-03-boat-b.jpg', day: 2, time: '12:01:11', shape: 'land', draw: burst(0) },
  { file: 'day2-03-boat-c.jpg', day: 2, time: '12:01:12', shape: 'land', draw: burst(0.04) },
  { file: 'day2-04-lemon-grove.jpg', day: 2, time: '14:30:00', shape: 'land', draw: grove, favorite: true },
  { file: 'day2-05-beach.jpg', day: 2, time: '16:15:00', shape: 'land', draw: beach },
  { file: 'day2-06-sunset.jpg', day: 2, time: '19:52:00', shape: 'land', draw: (w, h, r) => dusk(w, h, r, 1) },
  { file: 'day2-06-sunset-copy.jpg', day: 2, time: '19:52:00', shape: 'land', draw: (w, h, r) => dusk(w, h, r, 1) },
  { file: 'day3-01-cafe.jpg', day: 3, time: '08:30:00', shape: 'land', draw: cafe },
  { file: 'day3-02-tiles.jpg', day: 3, time: '10:05:00', shape: 'portrait', draw: tiles },
  { file: 'day3-03-door.jpg', day: 3, time: '11:20:00', shape: 'portrait', draw: door },
  { file: 'day3-04-dome.jpg', day: 3, time: '12:45:00', shape: 'portrait', draw: dome },
  { file: 'day3-05-ravello.jpg', day: 3, time: '15:30:00', shape: 'land', draw: (w, h, r) => coast(w, h, r, { skyTop: '#8fc6e6', skyBottom: '#f9ecd6', sunAt: [0.75, 0.2], side: 'right', houses: true, boats: 1, horizon: 0.5 }) },
  { file: 'day3-06-last-view.jpg', day: 3, time: '18:40:00', shape: 'land', draw: (w, h, r) => dusk(w, h, r, 2) },
];

// Roughly along the coast (made-up points, in the sea off each town), for map stickers.
const GPS: Record<number, [number, number]> = { 1: [40.627, 14.484], 2: [40.62, 14.53], 3: [40.646, 14.61] };

function dms(v: number): string {
  const d = Math.floor(v);
  const m = Math.floor((v - d) * 60);
  const s = Math.round(((v - d) * 60 - m) * 60 * 100);
  return `${d}/1 ${m}/1 ${s}/100`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [i, p] of PHOTOS.entries()) {
  const [w, h] = SIZE[p.shape];
  // The copy is the same picture: the same seed gives the same drawing (an exact duplicate).
  const seed = p.file.endsWith('-copy.jpg') ? PHOTOS.findIndex((q) => q.file === p.file.replace('-copy', '')) + 1 : i + 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${p.draw(w, h, mulberry32(seed * 7919))}</svg>`;
  const date = `2000:01:0${p.day} ${p.time}`;
  const [lat, lon] = GPS[p.day];
  const buf = await sharp(Buffer.from(svg))
    .jpeg({ quality: 84, chromaSubsampling: '4:4:4' })
    .withExif({
      IFD0: { Make: 'Sample', Model: 'Illustrated', DateTime: date },
      IFD2: { DateTimeOriginal: date },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: dms(lat), GPSLongitudeRef: 'E', GPSLongitude: dms(lon) },
    })
    .toBuffer();
  writeFileSync(join(OUT, p.file), buf);
  bytes += buf.length;
}
writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify({ trip: 'Amalfi Coast', photos: PHOTOS.map((p) => ({ file: p.file, ...(p.favorite ? { favorite: true } : {}) })) }, null, 2)}\n`,
);
console.log(`Wrote ${PHOTOS.length} demo photos (${(bytes / 1e6).toFixed(1)} MB) to ${OUT}`);
