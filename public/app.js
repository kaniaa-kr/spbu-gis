// ===== STATE =====
const state = {
  filters: { pertalite: true, pertamax: true, dex: true },
  cluster: false,
};

const COLORS = { pertalite: "#2e9e4f", pertamax: "#d62828", dex: "#1d4ed8" };
const PRIORITAS = ["dex", "pertamax", "pertalite"]; // penentu warna jika SPBU punya >1 jenis

let spbuData = null; // data mentah (di-fetch sekali)
let layerSPBU = null; // layer yang sedang tampil

// ===== PETA =====
const map = L.map("map").setView([-0.0263, 109.3425], 12); // Pontianak
// Basemap online; saat offline area abu-abu, titik SPBU tetap muncul
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// ===== HELPER =====
// Ubah teks jenis_bbm menjadi daftar kategori baku
function kategori(raw) {
  const t = (raw || "").toLowerCase();
  const hasil = [];
  if (t.includes("pertalite")) hasil.push("pertalite");
  if (t.includes("pertamax")) hasil.push("pertamax");
  if (t.includes("dex")) hasil.push("dex");
  return hasil;
}

function warnaUtama(kats) {
  const k = PRIORITAS.find((p) => kats.includes(p));
  return COLORS[k] || "#777";
}

// ===== RENDER =====
function renderSPBU() {
  // 1. Hapus layer lama
  if (layerSPBU) map.removeLayer(layerSPBU);

  // 2. Filter berdasarkan state
  const tampil = spbuData.features.filter((f) =>
    kategori(f.properties.jenis_bbm).some((k) => state.filters[k]),
  );

  // 3. Pilih wadah: cluster atau layerGroup biasa
  layerSPBU = state.cluster
    ? L.markerClusterGroup({
        iconCreateFunction: (cluster) =>
          L.divIcon({
            html: `<div>${cluster.getChildCount()}</div>`,
            className: "cluster-icon",
            iconSize: [36, 36],
          }),
      })
    : L.layerGroup();

  // 4. Buat circleMarker per fitur
  tampil.forEach((f) => {
    const [lng, lat] = f.geometry.coordinates; // GeoJSON: [lng, lat]
    const p = f.properties;
    const warna = warnaUtama(kategori(p.jenis_bbm));

    L.circleMarker([lat, lng], {
      // Leaflet: [lat, lng]
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: warna,
      fillOpacity: 0.9,
    })
      .bindPopup(
        `<b>${p.nama_spbu || "SPBU " + p.kode}</b><br>${p.alamat}<br>` +
          `BBM: ${p.jenis_bbm}<br>24 Jam: ${p.operasional_24jam}`,
      )
      .addTo(layerSPBU);
  });

  layerSPBU.addTo(map);
  document.getElementById("info").textContent =
    `Menampilkan ${tampil.length} dari ${spbuData.features.length} SPBU`;
}

// ===== EVENT LISTENER =====
["pertalite", "pertamax", "dex"].forEach((k) => {
  document.getElementById("f-" + k).addEventListener("change", (e) => {
    state.filters[k] = e.target.checked;
    renderSPBU();
  });
});
document.getElementById("f-cluster").addEventListener("change", (e) => {
  state.cluster = e.target.checked;
  renderSPBU();
});

// ===== LOAD DATA DARI API (sekali saja) =====
fetch("/api/data/spbu")
  .then((r) => r.json())
  .then((data) => {
    spbuData = data;
    renderSPBU();
  })
  .catch((err) => {
    document.getElementById("info").textContent =
      "Gagal memuat data: " + err.message;
  });

// ===== GAMBAR ZONA (kirim ke POST /api/feature/zona) =====
let menggambar = false;
let titikZona = [];
let garisSementara = null;

const btnZona = document.getElementById("btn-zona");
const info = document.getElementById("info");

btnZona.addEventListener("click", async () => {
  if (!menggambar) {
    // mulai menggambar
    menggambar = true;
    titikZona = [];
    btnZona.textContent = "Simpan zona";
    info.textContent =
      'Klik peta untuk menambah titik (min. 3), lalu klik "Simpan zona".';
    return;
  }

  // selesai: validasi lalu kirim
  if (titikZona.length < 3) {
    info.textContent = "Minimal 3 titik untuk membentuk poligon.";
    return;
  }

  const ring = titikZona.map(([lat, lng]) => [lng, lat]); // balik ke [lng, lat]
  ring.push(ring[0]); // tutup cincin poligon

  const feature = {
    type: "Feature",
    properties: { nama: "Zona gambar " + new Date().toLocaleTimeString() },
    geometry: { type: "Polygon", coordinates: [ring] },
  };

  try {
    const res = await fetch("/api/feature/zona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feature),
    });
    const hasil = await res.json();
    info.textContent = res.ok
      ? `Tersimpan. Total zona: ${hasil.total_zona}`
      : `Gagal: ${hasil.error}`;
  } catch (err) {
    info.textContent = "Gagal mengirim: " + err.message;
  }

  // reset mode gambar (poligon tetap tampil di peta)
  menggambar = false;
  btnZona.textContent = "Gambar zona";
  if (garisSementara) {
    L.polygon(titikZona, { color: "#f59e0b" }).addTo(map);
    map.removeLayer(garisSementara);
    garisSementara = null;
  }
});

map.on("click", (e) => {
  if (!menggambar) return;
  titikZona.push([e.latlng.lat, e.latlng.lng]);
  if (garisSementara) map.removeLayer(garisSementara);
  garisSementara = L.polyline(titikZona, {
    color: "#f59e0b",
    dashArray: "4",
  }).addTo(map);
});
