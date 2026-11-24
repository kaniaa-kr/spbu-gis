// Jalankan dari root proyek:  node terapkan-update.js
// Menimpa public/app.js (cadangan: public/app.js.bak) dengan fitur baru:
// layer kecamatan, zona tersimpan + hapus, zoom otomatis ke SPBU.
const fs = require("fs");
const { execFileSync } = require("child_process");

const FILE = "public/app.js";
const asli = fs.readFileSync(FILE, "utf8");
let src = asli.replace(/\r\n/g, "\n");

if (src.includes("muatZona")) {
  console.log("app.js sudah diperbarui sebelumnya. Tidak ada yang diubah.");
  process.exit(0);
}

// Ganti satu potongan teks; kalau tidak ditemukan, berhenti tanpa mengubah file
function ganti(dari, ke, nama) {
  if (!src.includes(dari)) {
    console.error(`GAGAL: bagian "${nama}" tidak ditemukan. File tidak diubah.`);
    process.exit(1);
  }
  src = src.replace(dari, () => ke);
}

// ---------------------------------------------------------------------
// Blok kode yang disisipkan ke dalam IIFE app.js (sebelum bagian BOOT).
// Ditulis sebagai fungsi biasa agar mudah dibaca; hanya isinya yang disalin.
// ---------------------------------------------------------------------
function blok() {
    /* ---------------------------------------------------------------------
       LAYER TAMBAHAN: kecamatan (highlight wilayah), zona tersimpan (+ hapus),
       dan zoom otomatis ke sebaran SPBU
       --------------------------------------------------------------------- */

    // Gaya tambahan, memakai font yang sama dengan halaman
    const gayaTambahan = document.createElement("style");
    gayaTambahan.textContent = `
        .kec-label { background: transparent; border: 0; box-shadow: none; color: #7df9ee;
            font-family: ${getComputedStyle(document.body).fontFamily}; font-size: 9px;
            text-shadow: 0 0 3px #000, 0 0 3px #000; }
        .kec-label::before { display: none; }
        .zoom-jauh .kec-label { display: none; }
        .btn-hapus-zona { margin-top: 8px; cursor: pointer; background: #ef4444; color: #fff;
            border: 2px solid #061326; padding: 4px 8px; font-family: inherit; font-size: 10px; }
        .leaflet-control-layers { background: #061326; color: #cfeeff; border: 3px solid #2ee6d6;
            border-radius: 0; font-family: inherit; font-size: 10px; }
    `;
    document.head.appendChild(gayaTambahan);

    // Pane khusus mengatur urutan tumpukan: kecamatan (bawah) < zona < marker SPBU (atas)
    map.createPane("kecPane").style.zIndex = 350;
    map.createPane("zonaPane").style.zIndex = 380;

    // Cari nama kecamatan dari properti yang namanya mengandung "kec"/"kc"/"nam"
    function namaKecamatan(p) {
        const keys = Object.keys(p || {});
        const k = keys.find((x) => /kec|kc/i.test(x)) || keys.find((x) => /nam/i.test(x));
        return k ? String(p[k]) : "KECAMATAN";
    }

    // Layer kecamatan: isi transparan + garis teal, disorot saat kursor di atasnya
    const gayaKec = { color: "#2ee6d6", weight: 2, fillColor: "#2ee6d6", fillOpacity: 0.1 };
    const kecLayer = L.geoJSON(null, {
        pane: "kecPane",
        style: gayaKec,
        onEachFeature: (f, layer) => {
            layer.bindTooltip(namaKecamatan(f.properties).toUpperCase(), {
                permanent: true, direction: "center", className: "kec-label",
            });
            layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.3, weight: 3 }));
            layer.on("mouseout", () => kecLayer.resetStyle(layer));
        },
    }).addTo(map);

    fetch("/api/data/kecamatan")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("data kecamatan tidak ada"))))
        .then((d) => kecLayer.addData(d))
        .catch((e) => console.warn("Layer kecamatan dilewati:", e.message));

    // Label kecamatan disembunyikan saat zoom jauh agar tidak menumpuk
    function aturLabelKecamatan() {
        map.getContainer().classList.toggle("zoom-jauh", map.getZoom() < 11);
    }
    map.on("zoomend", aturLabelKecamatan);
    aturLabelKecamatan();

    // Layer zona tersimpan (data dari GET /api/data/zona)
    const zonaLayer = L.layerGroup().addTo(map);

    // Isi popup zona: nama + tombol hapus (DELETE /api/feature/zona/:index)
    function popupZona(f, i) {
        const box = document.createElement("div");
        const judul = document.createElement("b");
        judul.textContent = (f.properties && (f.properties.nama || f.properties.name)) || "Zona #" + (i + 1);
        const tombol = document.createElement("button");
        tombol.className = "btn-hapus-zona";
        tombol.textContent = "HAPUS ZONA";
        tombol.addEventListener("click", async () => {
            if (!confirm("Hapus zona ini secara permanen?")) return;
            const res = await fetch("/api/feature/zona/" + i, { method: "DELETE" });
            if (res.ok) {
                map.closePopup();
                muatZona();
                dom.logStatus.textContent = "ZONE DELETED.";
            }
        });
        box.append(judul, document.createElement("br"), tombol);
        return box;
    }

    // Ambil semua zona dari server lalu gambar ulang
    async function muatZona() {
        try {
            const res = await fetch("/api/data/zona", { cache: "no-store" });
            const fc = await res.json();
            zonaLayer.clearLayers();
            fc.features.forEach((f, i) => {
                L.geoJSON(f, {
                    pane: "zonaPane",
                    style: { color: "#ffd23f", weight: 3, dashArray: "8 4", fillColor: "#ffd23f", fillOpacity: 0.18 },
                })
                    .on("click", (e) => {
                        if (state.zoneMode) return; // saat menggambar zona, klik hanya menambah titik
                        L.popup().setLatLng(e.latlng).setContent(popupZona(f, i)).openOn(map);
                    })
                    .addTo(zonaLayer);
            });
        } catch (err) {
            console.warn("Gagal memuat zona:", err.message);
        }
    }

    // Saklar tampil/sembunyi layer
    L.control
        .layers(null, { KECAMATAN: kecLayer, ZONA: zonaLayer }, { position: "bottomright", collapsed: false })
        .addTo(map);

    // Zoom otomatis ke sebaran SPBU (ruang untuk panel HUD kiri, header, dan bar bawah)
    function fokusKeSPBU() {
        if (!state.data || !state.data.features.length) return;
        const titik = state.data.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
        map.fitBounds(L.latLngBounds(titik), {
            paddingTopLeft: [230, 90], paddingBottomRight: [30, 80], maxZoom: 14,
        });
    }

    muatZona();

}

const teksBlok = blok.toString();
const isiBlok = teksBlok.slice(teksBlok.indexOf("{") + 1, teksBlok.lastIndexOf("}")).replace(/^\n/, "");

// 1) Sisipkan blok sebelum bagian BOOT
ganti(
  "    /* ---------------------------------------------------------------------\n       BOOT",
  isiBlok + "\n    /* ---------------------------------------------------------------------\n       BOOT",
  "BOOT",
);

// 2) Setelah data SPBU dimuat, zoom ke sebaran titik
ganti(
  'renderSPBU();\n            setUplink("ONLINE", "ok");',
  'renderSPBU();\n            fokusKeSPBU(); // zoom otomatis ke sebaran SPBU\n            setUplink("ONLINE", "ok");',
  "loadData",
);

// 3) Setelah zona disimpan, gambar ulang dari server (agar bisa dihapus)
ganti(
  '            L.polygon(state.zonePoints, {\n                color: "#2ee6d6", weight: 3, dashArray: "8 4",\n                fillColor: "#2ee6d6", fillOpacity: 0.08, interactive: false,\n            }).addTo(map);\n',
  "            muatZona(); // gambar ulang dari data server (sudah termasuk zona baru)\n",
  "saveZone",
);

// Tulis hasil, cek sintaks; kalau error, kembalikan file asli
fs.writeFileSync(FILE + ".bak", asli);
fs.writeFileSync(FILE, src);
try {
  execFileSync(process.execPath, ["--check", FILE], { stdio: "pipe" });
  console.log("Selesai. public/app.js diperbarui (cadangan: public/app.js.bak).");
} catch (e) {
  fs.writeFileSync(FILE, asli);
  console.error("Sintaks hasil patch error, file dikembalikan:\n" + e.stderr);
  process.exit(1);
}
