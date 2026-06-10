// One-off PWA icon generator. Run from repo root after sips produces the
// resized transparent inputs (_lNNN.png). Paints the logo's alpha mask WHITE
// over a dark charcoal tile (#1a1917) so icons match the app's dark aesthetic.
//   npm i pngjs --no-save && node scripts/make-icons.js
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const APP = path.join(__dirname, "..", "app");
const BG = [26, 25, 23]; // #1a1917
const FG = [255, 255, 255];

const load = (p) => PNG.sync.read(fs.readFileSync(path.join(APP, p)));
const save = (png, p) => fs.writeFileSync(path.join(APP, p), PNG.sync.write(png));

// Full-bleed: white mark on dark tile, edge to edge.
function full(srcFile, size, outFile) {
  const src = load(srcFile);
  const o = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    const a = src.data[i * 4 + 3] / 255;
    o.data[i * 4] = Math.round(FG[0] * a + BG[0] * (1 - a));
    o.data[i * 4 + 1] = Math.round(FG[1] * a + BG[1] * (1 - a));
    o.data[i * 4 + 2] = Math.round(FG[2] * a + BG[2] * (1 - a));
    o.data[i * 4 + 3] = 255;
  }
  save(o, outFile);
}

// Maskable: smaller mark centered with safe-zone padding on a dark tile.
function maskable(srcFile, size, inner, outFile) {
  const src = load(srcFile); // already `inner`x`inner`
  const o = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    o.data[i * 4] = BG[0]; o.data[i * 4 + 1] = BG[1]; o.data[i * 4 + 2] = BG[2]; o.data[i * 4 + 3] = 255;
  }
  const off = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const a = src.data[(y * inner + x) * 4 + 3] / 255;
      const j = ((y + off) * size + (x + off)) * 4;
      o.data[j] = Math.round(FG[0] * a + BG[0] * (1 - a));
      o.data[j + 1] = Math.round(FG[1] * a + BG[1] * (1 - a));
      o.data[j + 2] = Math.round(FG[2] * a + BG[2] * (1 - a));
      o.data[j + 3] = 255;
    }
  }
  save(o, outFile);
}

full("_l512.png", 512, "icon-512.png");
full("_l192.png", 192, "icon-192.png");
full("_l180.png", 180, "apple-touch-icon.png");
maskable("_l368.png", 512, 368, "icon-maskable-512.png");
console.log("icons written");
