// Draws the launcher icon (1024 px PNG) — a warm tile with a photo-book glyph.
import sharp from 'sharp';
const out = process.argv[2];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2b871"/><stop offset="1" stop-color="#c8693a"/></linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe3b8"/><stop offset="1" stop-color="#ffd08c"/></linearGradient>
  </defs>
  <rect x="80" y="80" width="864" height="864" rx="196" fill="url(#bg)"/>
  <g transform="translate(512 540)">
    <path d="M-330 -210 Q-170 -250 -12 -200 L-12 250 Q-170 200 -330 240 Z" fill="#fffaf2"/>
    <path d="M330 -210 Q170 -250 12 -200 L12 250 Q170 200 330 240 Z" fill="#fffaf2"/>
    <rect x="-290" y="-160" width="240" height="260" rx="10" fill="url(#sky)"/>
    <circle cx="-120" cy="-90" r="34" fill="#f07a47"/>
    <path d="M-290 100 L-220 10 L-170 60 L-120 -10 L-50 100 Z" fill="#3d5568"/>
    <rect x="50" y="-160" width="240" height="120" rx="10" fill="url(#sky)"/>
    <path d="M50 -40 L120 -110 L170 -70 L215 -120 L290 -40 Z" fill="#3d5568"/>
    <rect x="50" y="-15" width="240" height="18" rx="9" fill="#d9c7ae"/>
    <rect x="50" y="25" width="180" height="18" rx="9" fill="#d9c7ae"/>
    <rect x="50" y="65" width="210" height="18" rx="9" fill="#d9c7ae"/>
  </g>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(out);
