export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const MM_PER_PT = MM_PER_INCH / PT_PER_INCH;

export const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;
export const ptToMm = (pt: number) => pt * MM_PER_PT;
export const mmToInch = (mm: number) => mm / MM_PER_INCH;
export const inchToMm = (inch: number) => inch * MM_PER_INCH;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
