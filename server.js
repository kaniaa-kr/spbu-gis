const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const SPBU_FILE = path.join(__dirname, "data", "spbu.geojson");
const ZONA_FILE = path.join(__dirname, "data", "zona_spbu.geojson");

// Middleware
app.use(express.json()); // parse body JSON (untuk POST)
app.use(express.static(path.join(__dirname, "public"))); // sajikan frontend
// Library lokal (pengganti CDN, agar jalan tanpa internet)
app.use(
  "/lib/leaflet",
  express.static(path.join(__dirname, "node_modules/leaflet/dist")),
);
app.use(
  "/lib/markercluster",
  express.static(
    path.join(__dirname, "node_modules/leaflet.markercluster/dist"),
  ),
);

const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// 1) GET /api/data/spbu → seluruh GeoJSON SPBU
app.get("/api/data/spbu", (req, res) => {
  try {
    res.json(readJSON(SPBU_FILE));
  } catch (err) {
    res
      .status(500)
      .json({ error: "Gagal membaca spbu.geojson", detail: err.message });
  }
});

// 2) GET /api/stats/bbm → jumlah SPBU per jenis BBM
app.get("/api/stats/bbm", (req, res) => {
  try {
    const { features } = readJSON(SPBU_FILE);
    const perJenis = {};
    let total24 = 0;

    features.forEach((f) => {
      const jenis = f.properties.jenis_bbm || "Tidak diketahui";
      perJenis[jenis] = (perJenis[jenis] || 0) + 1;
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

// 3) POST /api/feature/zona → tambah poligon zona ke zona_spbu.geojson
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

  // Validasi: hanya Polygon / MultiPolygon
  const valid = incoming.every(
    (f) => f.geometry && ["Polygon", "MultiPolygon"].includes(f.geometry.type),
  );
  if (!incoming.length || !valid)
    return res
      .status(400)
      .json({ error: "Geometri harus Polygon/MultiPolygon" });

  try {
    const zona = fs.existsSync(ZONA_FILE)
      ? readJSON(ZONA_FILE)
      : { type: "FeatureCollection", features: [] };

    zona.features.push(...incoming);
    fs.writeFileSync(ZONA_FILE, JSON.stringify(zona, null, 2));

    res
      .status(201)
      .json({
        message: "Zona tersimpan",
        ditambahkan: incoming.length,
        total_zona: zona.features.length,
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
