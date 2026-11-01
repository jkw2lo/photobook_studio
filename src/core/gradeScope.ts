import type { ColorGrade, Element, Gradient, Spread } from './model';
import { gradeColor, isNeutralGrade } from './grade';

// Where a grade applies. A grade for "photos only" changes the photos and nothing else; a grade for
// the whole page also recolours the background (colour and photo), text, shapes and calendars. Those
// are vector colours, so they're passed through the same colour maths as the photos — the editor
// and the PDF both draw the recoloured page, and print matches the screen.

/** The grades in a chain (page's, then document's) that colour the whole page. */
export function pageGrades(grades: (ColorGrade | undefined)[]): ColorGrade[] {
  return grades.filter((g): g is ColorGrade => !!g && g.scope === 'page' && !isNeutralGrade(g));
}

/** A colour (#rgb or #rrggbb) through a chain of grades; anything else ('none') is left alone. */
export function gradeHex(hex: string, grades: ColorGrade[]): string {
  if (!grades.length || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return hex;
  const x = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  let rgb = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
  for (const g of grades) rgb = gradeColor(g, rgb);
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function gradeElement(el: Element, grades: ColorGrade[]): Element {
  const c = (hex: string) => gradeHex(hex, grades);
  const grad = (g: Gradient | undefined) => g && { ...g, from: c(g.from), to: c(g.to) };
  switch (el.type) {
    case 'text':
      return {
        ...el, color: c(el.color), strokeColor: el.strokeColor && c(el.strokeColor), backgroundColor: el.backgroundColor && c(el.backgroundColor), gradient: grad(el.gradient),
        shadow: el.shadow && { ...el.shadow, color: c(el.shadow.color) }, extrude: el.extrude && { ...el.extrude, color: c(el.extrude.color) },
        glow: el.glow && { ...el.glow, color: c(el.glow.color) }, outline2: el.outline2 && { ...el.outline2, color: c(el.outline2.color) },
      };
    case 'shape':
      return { ...el, fill: c(el.fill), strokeColor: el.strokeColor && c(el.strokeColor), gradient: grad(el.gradient) };
    case 'calendar':
      return { ...el, color: c(el.color), accent: c(el.accent) };
    default:
      return { ...el, borderColor: c(el.borderColor) };
  }
}

/** A surface as drawn under whole-page grades: its background and every element's colours recoloured.
 * Photos aren't touched here — they're graded as images. */
export function gradeSurfaceColours(surface: Spread, styleBackground: string, grades: ColorGrade[]): Spread {
  if (!grades.length) return surface;
  return { ...surface, background: gradeHex(surface.background ?? styleBackground, grades), elements: surface.elements.map((e) => gradeElement(e, grades)) };
}
