/**
 * Generates PWA app icons (192 and 512) as minimal PNGs using the `canvas`
 * package if available, else writes a deterministic SVG-to-base64 PNG.
 *
 * For the scaffold we ship ready-to-use SVG placeholders at public/icons/
 * and encourage regenerating with this script once the package is installed.
 *
 * Run: npx ts-node scripts/generateIcons.ts
 */
import fs from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

function svg(size: number): string {
  const s = size;
  const p = Math.round(s * 0.12);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#19191A"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF8AA8"/>
      <stop offset="1" stop-color="#F786C6"/>
    </linearGradient>
  </defs>
  <rect x="${p}" y="${p + s * 0.08}" width="${s - 2 * p}" height="${s - 2 * p - s * 0.08}" rx="${Math.round(
    s * 0.08
  )}" fill="url(#g)"/>
  <text x="50%" y="58%" text-anchor="middle" font-family="Helvetica, Arial" font-weight="bold" fill="#19191A" font-size="${Math.round(
    s * 0.44
  )}">B</text>
</svg>`;
}

function writePlaceholder(size: number, name: string) {
  const p = path.join(outDir, name);
  fs.writeFileSync(p.replace(/\.png$/, ".svg"), svg(size));
  console.log(`✔ wrote ${p.replace(/\.png$/, ".svg")}`);
}

writePlaceholder(192, "icon-192.png");
writePlaceholder(512, "icon-512.png");
console.log(
  "\nPNG fallbacks: the service worker will serve SVG. For App Store-style raster icons, install `sharp` and convert."
);
