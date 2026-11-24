// Buang baris/fitur duplikat berdasarkan kolom "kode" (yang dipertahankan: kemunculan TERAKHIR).
// Pemakaian:  node bersihkan-data.js data/spbu.geojson lokasi/spbu.csv
// Setiap file dicadangkan dulu sebagai <nama>.bak
const fs = require("fs");

// Pecah teks CSV menjadi baris berisi sel; mendukung sel bertanda kutip ("a, b")
function parseCSV(teks) {
  const baris = [];
  let row = [], sel = "", kutip = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (kutip) {
      if (c === '"' && teks[i + 1] === '"') { sel += '"'; i++; }
      else if (c === '"') kutip = false;
      else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === ",") { row.push(sel); sel = ""; }
    else if (c === "\n") { row.push(sel); baris.push(row); row = []; sel = ""; }
    else if (c !== "\r") sel += c;
  }
  if (sel !== "" || row.length) { row.push(sel); baris.push(row); }
  return baris.filter((r) => r.some((x) => x.trim() !== ""));
}
const kutipSel = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

// Pertahankan urutan kemunculan pertama, tetapi isi dari kemunculan terakhir
function dedupe(daftar, ambilKode) {
  const peta = new Map();
  daftar.forEach((x) => peta.set(ambilKode(x), x));
  return [...peta.values()];
}

function bersihkanGeoJSON(teks) {
  const { features, ...kepala } = JSON.parse(teks);
  const bersih = dedupe(features, (f) => f.properties.kode);
  const awal = JSON.stringify(kepala).slice(0, -1); // buang "}" penutup
  const hasil = awal + ',"features":[\n' + bersih.map((f) => JSON.stringify(f)).join(",\n") + "\n]}\n";
  return { hasil, sebelum: features.length, sesudah: bersih.length };
}

function bersihkanCSV(teks) {
  const [header, ...isi] = parseCSV(teks);
  const k = header.map((h) => h.trim().toLowerCase()).indexOf("kode");
  if (k < 0) throw new Error('Kolom "kode" tidak ditemukan di header CSV');
  const bersih = dedupe(isi, (r) => r[k].trim());
  const hasil = [header, ...bersih].map((r) => r.map(kutipSel).join(",")).join("\n") + "\n";
  return { hasil, sebelum: isi.length, sesudah: bersih.length };
}

const berkas = process.argv.slice(2);
if (!berkas.length) {
  console.log("Pemakaian: node bersihkan-data.js <spbu.geojson> [spbu.csv ...]");
  process.exit(1);
}

berkas.forEach((file) => {
  try {
    const teks = fs.readFileSync(file, "utf8");
    const r = file.toLowerCase().endsWith(".csv") ? bersihkanCSV(teks) : bersihkanGeoJSON(teks);
    fs.writeFileSync(file + ".bak", teks);
    fs.writeFileSync(file, r.hasil);
    console.log(`${file}: ${r.sebelum} -> ${r.sesudah} baris/fitur (cadangan: ${file}.bak)`);
  } catch (err) {
    console.error(`${file}: GAGAL (${err.message})`);
  }
});
