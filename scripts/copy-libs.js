// Salin library dari node_modules ke public/lib supaya frontend berjalan
// offline (node server.js) dan di Vercel (public/ disajikan sebagai static).
// Jalankan: npm run copy-libs
const fs = require("fs");
const path = require("path");

const root = process.cwd();

// Salin folder secara rekursif
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// Leaflet -> public/lib/leaflet
copyDir(path.join(root, "node_modules/leaflet/dist"), path.join(root, "public/lib/leaflet"));

// Leaflet.markercluster -> public/lib/markercluster
copyDir(
  path.join(root, "node_modules/leaflet.markercluster/dist"),
  path.join(root, "public/lib/markercluster"),
);

// Font Press Start 2P (hanya file woff2 yang dipakai @font-face)
const fontSrc = path.join(root, "node_modules/@fontsource/press-start-2p/files");
const fontDest = path.join(root, "public/lib/fonts");
fs.mkdirSync(fontDest, { recursive: true });
for (const file of fs.readdirSync(fontSrc)) {
  if (file.endsWith(".woff2")) {
    fs.copyFileSync(path.join(fontSrc, file), path.join(fontDest, file));
  }
}

console.log("Library disalin ke public/lib/.");
