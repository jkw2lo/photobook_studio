// Combine rendered spread PNGs into one labelled contact sheet for quick visual review.
//   npx tsx scripts/contact-sheet.ts <render-dir> <out.png>
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [dir, out] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.startsWith('spread-')).sort();
const metas = await Promise.all(files.map((f) => sharp(join(dir, f)).metadata()));
const w = metas[0].width!;
const h = metas[0].height!;
const cols = 2;
const pad = 24;
const label = 22;
const rows = Math.ceil(files.length / cols);
const composites = files.flatMap((f, i) => {
  const x = pad + (i % cols) * (w + pad);
  const y = pad + Math.floor(i / cols) * (h + pad + label);
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${label}"><text x="0" y="16" font-family="Helvetica" font-size="15" fill="#ddd">${f.replace('.png', '')}</text></svg>`);
  return [{ input: text, left: x, top: y }, { input: join(dir, f), left: x, top: y + label }];
});
await sharp({ create: { width: pad + cols * (w + pad), height: pad + rows * (h + pad + label), channels: 3, background: '#2a2a2a' } })
  .composite(composites)
  .png()
  .toFile(out);
console.log(out);
