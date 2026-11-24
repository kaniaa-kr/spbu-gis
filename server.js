const express = require("express");
const crypto = require("crypto"); // bawaan Node: untuk id unik zona
const fs = require("fs");
const os = require("os");
const path = require("path");

// Satu sumber kebenaran route. Dipakai lokal (node server.js)
// dan oleh Vercel melalui api/index.js (module.exports = app).
const app = express();
const PORT = process.env.PORT || 3000;

// Path data memakai process.cwd() supaya konsisten di lokal maupun Vercel.
const SPBU_FILE = path.join(process.cwd(), "data", "spbu.geojson");
const KEC_FILE = path.join(process.cwd(), "data", "batas_kecamatan.geojson");
const ZONA_BAWAAN = path.join(process.cwd(), "data", "zona_spbu.geojson");
// Filesystem Vercel read-only: zona baru ditulis ke /tmp (sementara)
const ZONA_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), "zona_spbu.geojson")
  : ZONA_BAWAAN;

// Middleware
app.use(express.json()); // parse body JSON (untuk POST zona)
app.use(express.static(path.join(process.cwd(), "public"))); // frontend + public/lib
app.use("/data", express.static(path.join(process.cwd(), "data")));

// ===== FUNGSI BANTU =====
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Buang duplikat berdasarkan "kode" (ambil kemunculan TERAKHIR)
function unik(fc) {
  const peta = new Map();
  fc.features.forEach((f) => peta.set(f.properties.kode, f));
  return { ...fc, features: [...peta.values()] };
}
const bacaSPBU = () => unik(readJSON(SPBU_FILE));

// Kunci jenis BBM -> teks token di kolom jenis_bbm (huruf kecil).
// Dicocokkan PERSIS per token, bukan substring, jadi "pertamax turbo"
// tidak ikut terhitung "pertamax" dan "dexlite" tidak ikut terhitung "dex".
const TOKEN_BBM = {
  pertalite: "pertalite",
  pertamax: "pertamax",
  pertamax_turbo: "pertamax turbo",
  dexlite: "dexlite",
  dex: "pertamina dex",
  solar: "solar subsidi",
};

// "Pertalite, Pertamax" -> ["pertalite", "pertamax"] (pecah koma, trim, lowercase)
const daftarToken = (raw) =>
  String(raw || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

const NAMA_MAKS = 40; // batas panjang nama zona

// Pastikan setiap zona punya properties.id. Zona lama (tanpa id) diberi id
// otomatis lalu disimpan, supaya daftar & penghapusan konsisten.
function beriIdZona(zona) {
  let berubah = false;
  zona.features.forEach((f) => {
    f.properties = f.properties || {};
    if (!f.properties.id) {
      f.properties.id = crypto.randomUUID();
      berubah = true;
    }
  });
  return berubah;
}

// Baca zona: file tulisan dulu, lalu file bawaan, kalau tidak ada = kosong.
// Zona yang belum punya id diberi id dan langsung disimpan.
function bacaZona() {
  let zona = { type: "FeatureCollection", features: [] };
  for (const f of [ZONA_FILE, ZONA_BAWAAN]) {
    if (fs.existsSync(f)) {
      zona = readJSON(f);
      break;
    }
  }
  if (beriIdZona(zona)) {
    try {
      fs.writeFileSync(ZONA_FILE, JSON.stringify(zona, null, 2));
    } catch (err) {
      console.warn("Gagal menyimpan id zona:", err.message);
    }
  }
  return zona;
}

// 1) GET /api/data/spbu -> GeoJSON SPBU (tanpa duplikat)
app.get("/api/data/spbu", (req, res) => {
  try {
    res.json(bacaSPBU());
  } catch (err) {
    res
      .status(500)
      .json({ error: "Gagal membaca spbu.geojson", detail: err.message });
  }
});

// 2) GET /api/stats/bbm -> jumlah SPBU yang MENJUAL tiap jenis + total 24 jam
//    (satu SPBU bisa dihitung di banyak jenis)
app.get("/api/stats/bbm", (req, res) => {
  try {
    const { features } = bacaSPBU();
    const perJenis = {};
    Object.keys(TOKEN_BBM).forEach((k) => (perJenis[k] = 0));
    let total24 = 0;

    features.forEach((f) => {
      const token = daftarToken(f.properties.jenis_bbm);
      Object.keys(TOKEN_BBM).forEach((k) => {
        if (token.includes(TOKEN_BBM[k])) perJenis[k]++;
      });
      if (f.properties.operasional_24jam === "Ya") total24++;
    });

    res.json({
      total: features.length,
      operasional_24jam: total24,
      per_jenis_bbm: perJenis,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) POST /api/feature/zona -> tambah poligon zona
app.post("/api/feature/zona", (req, res) => {
  const body = req.body;

  // Terima Feature tunggal ATAU FeatureCollection
  let incoming = [];
  if (body && body.type === "Feature") incoming = [body];
  else if (body && body.type === "FeatureCollection") incoming = body.features;
  else
    return res
      .status(400)
      .json({ error: "Body harus GeoJSON Feature atau FeatureCollection" });

  // Validasi: hanya Polygon / MultiPolygon (Point ditolak -> 400)
  const valid = incoming.every(
    (f) => f.geometry && ["Polygon", "MultiPolygon"].includes(f.geometry.type),
  );
  if (!incoming.length || !valid)
    return res
      .status(400)
      .json({ error: "Geometri harus Polygon/MultiPolygon" });

  // Validasi nama: wajib ada, dipangkas spasinya, maksimal 40 karakter
  for (const f of incoming) {
    const nama = String((f.properties && f.properties.nama) || "").trim();
    if (!nama)
      return res.status(400).json({ error: "properties.nama wajib diisi" });
    if (nama.length > NAMA_MAKS)
      return res
        .status(400)
        .json({ error: `properties.nama maksimal ${NAMA_MAKS} karakter` });
    // Nama sudah rapi + id unik dibuat server (id dari klien diabaikan)
    f.properties = { ...f.properties, nama, id: crypto.randomUUID() };
  }

  try {
    const zona = bacaZona();
    zona.features.push(...incoming);
    fs.writeFileSync(ZONA_FILE, JSON.stringify(zona, null, 2));

    const hasil = {
      message: "Zona tersimpan",
      ditambahkan: incoming.length,
      total_zona: zona.features.length,
    };
    if (process.env.VERCEL)
      hasil.catatan =
        "Zona disimpan sementara di /tmp (filesystem Vercel read-only), hilang saat instance restart.";
    res.status(201).json(hasil);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4) GET /api/data/zona -> semua zona tersimpan
app.get("/api/data/zona", (req, res) => {
  try {
    res.json(bacaZona());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5) DELETE /api/feature/zona/:id -> hapus zona berdasarkan properties.id
app.delete("/api/feature/zona/:id", (req, res) => {
  try {
    const zona = bacaZona();
    const i = zona.features.findIndex((f) => f.properties.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: "Zona tidak ditemukan" });

    zona.features.splice(i, 1);
    fs.writeFileSync(ZONA_FILE, JSON.stringify(zona, null, 2));
    res.json({ message: "Zona dihapus", total_zona: zona.features.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) GET /api/data/kecamatan -> batas kecamatan (data SK-1)
app.get("/api/data/kecamatan", (req, res) => {
  try {
    res.json(readJSON(KEC_FILE));
  } catch (err) {
    res
      .status(500)
      .json({
        error: "Gagal membaca batas_kecamatan.geojson",
        detail: err.message,
      });
  }
});

// Ekspor app untuk Vercel (api/index.js)
module.exports = app;

// Jalankan server hanya saat file ini dieksekusi langsung (node server.js)
if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`Server jalan di http://localhost:${PORT}`),
  );
}
