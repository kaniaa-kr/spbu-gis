/* ==========================================================================
   Pontianak Paw Petrol // frontend (SK-4)
   WebGIS SPBU Kota Pontianak
   - Map Leaflet + tile OpenStreetMap
   - Titik SPBU dirender dengan L.circleMarker (bukan L.marker/L.icon)
   - Filter jenis BBM lewat state.filters + checkbox
   - Clustering dengan L.markerClusterGroup + L.divIcon
   - Sidebar "ACTIVITY LOG" menampilkan detail SPBU saat marker diklik
   ========================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
       STATE (dibaca oleh renderSPBU dan handler filter)
       - filters : jenis BBM yang tercentang (default semua true)
       - cluster : mode cluster aktif/tidak
       - dipilih : SPBU yang sedang terkunci di sidebar (untuk chip BBM)
       --------------------------------------------------------------------- */
  let state = {
    data: null, // hasil fetch GeoJSON, disimpan SEKALI (tidak di-fetch ulang)
    filters: {
      pertalite: true,
      pertamax: true,
      pertamax_turbo: true,
      dexlite: true,
      dex: true, // = Pertamina Dex
      solar: true, // = Solar Subsidi
    },
    cluster: false,
    layerGroup: null, // wadah layer aktif (L.layerGroup / L.markerClusterGroup)
    zoneMode: false, // mode menggambar zona aktif/tidak
    zonePoints: [], // titik-titik poligon zona yang sedang digambar
    zonePreview: null, // layer preview poligon/polyline zona
    dipilih: null, // fitur SPBU yang sedang dikunci di sidebar
    chipBox: null, // elemen pembungkus chip BBM di sidebar
  };

  /* ---------------------------------------------------------------------
       JENIS BBM: warna, nama tampilan, dan teks token di kolom jenis_bbm.
       Satu SPBU bisa menjual BANYAK jenis, jadi filter memakai model
       "SPBU menjual jenis X" (bukan satu kategori per SPBU).
       --------------------------------------------------------------------- */
  const WARNA_BBM = {
    pertalite: "#22c55e",
    pertamax: "#3b82f6",
    pertamax_turbo: "#a855f7",
    dexlite: "#f97316",
    dex: "#ef4444",
    solar: "#cbd5e1",
  };

  const NAMA_BBM = {
    pertalite: "PERTALITE",
    pertamax: "PERTAMAX",
    pertamax_turbo: "PERTAMAX TURBO",
    dexlite: "DEXLITE",
    dex: "PERTAMINA DEX",
    solar: "SOLAR SUBSIDI",
  };

  // Teks token (huruf kecil) yang dicocokkan PERSIS dengan hasil split(",")
  const TOKEN_BBM = {
    pertalite: "pertalite",
    pertamax: "pertamax",
    pertamax_turbo: "pertamax turbo",
    dexlite: "dexlite",
    dex: "pertamina dex",
    solar: "solar subsidi",
  };

  // Urutan prioritas warna marker (paling atas = paling diutamakan)
  const URUTAN_PRIORITAS = [
    "dex",
    "pertamax_turbo",
    "pertamax",
    "dexlite",
    "pertalite",
    "solar",
  ];

  /* Referensi elemen DOM yang dipakai berulang */
  const dom = {
    map: document.getElementById("map"),
    uplink: document.getElementById("uplink-status"),
    signalCount: document.getElementById("signal-count"),
    coordLat: document.getElementById("coord-lat"),
    coordLon: document.getElementById("coord-lon"),
    zoom: document.getElementById("zoom-level"),
    jumlah: document.getElementById("jumlah-spbu"),
    chkBBM: {}, // diisi di bawah: satu checkbox per jenis BBM
    chkCluster: document.getElementById("chk-cluster"),
    log: document.getElementById("activity-log"),
    logBtn: document.getElementById("btn-log"),
    closeLogBtn: document.getElementById("btn-close-log"),
    selected: document.getElementById("selected-panel"),
    retryBtn: document.getElementById("btn-retry"),
    logStatus: document.getElementById("log-status"),
    scanBtn: document.getElementById("btn-scan"),
    resetBtn: document.getElementById("btn-reset"),
    zoneBtn: document.getElementById("btn-zone"),
    zoneLabel: document.getElementById("zone-label"),
    zoneNameGroup: document.getElementById("zone-name-group"),
    zoneName: document.getElementById("zone-name"),
    zoneNote: document.getElementById("zone-note"),
    zonesBtn: document.getElementById("btn-zones"),
    zonePanel: document.getElementById("zone-panel"),
    closeZonesBtn: document.getElementById("btn-close-zones"),
    zoneList: document.getElementById("zone-list"),
    zoneStatus: document.getElementById("zone-status"),
    fxBtn: document.getElementById("btn-fx"),
    fxLabel: document.getElementById("fx-label"),
    trailerBtn: document.getElementById("btn-trailer"),
    dialog: document.getElementById("trailer-dialog"),
    closeTrailerBtn: document.getElementById("btn-close-trailer"),
    returnBtn: document.getElementById("btn-return"),
    timer: document.getElementById("timer-digits"),
    sweepFill: document.getElementById("sweep-fill"),
  };

  // id checkbox = "chk-" + kunci (garis bawah jadi strip): pertamax_turbo -> chk-pertamax-turbo
  Object.keys(WARNA_BBM).forEach((kunci) => {
    dom.chkBBM[kunci] = document.getElementById(
      "chk-" + kunci.replace("_", "-"),
    );
  });

  /* ---------------------------------------------------------------------
       HELPER
       --------------------------------------------------------------------- */

  // Tambah nol di depan agar angka selalu 2 digit (contoh: 2 -> "02")
  const pad2 = (value) => String(value).padStart(2, "0");

  // Daftar jenis BBM yang DIJUAL sebuah SPBU (kunci, urutan sama dengan WARNA_BBM).
  // jenis_bbm dipecah per koma lalu dicocokkan PERSIS per token, bukan substring,
  // jadi "Pertamax Turbo" tidak ikut "Pertamax" dan "Dexlite" tidak ikut "Dex".
  function jenisDijual(feature) {
    const token = String(feature.properties?.jenis_bbm || "")
      .split(",")
      .map((t) => t.trim().toLowerCase());
    return Object.keys(TOKEN_BBM).filter((kunci) =>
      token.includes(TOKEN_BBM[kunci]),
    );
  }

  // Jenis TERCENTANG berprioritas tertinggi yang dijual SPBU ini (dipakai untuk
  // filter DAN warna marker). null = SPBU tidak menjual jenis tercentang apa pun.
  function jenisTampil(feature) {
    const dijual = jenisDijual(feature);
    return (
      URUTAN_PRIORITAS.find((k) => dijual.includes(k) && state.filters[k]) ||
      null
    );
  }

  // Perbarui status uplink di top bar (ONLINE / SYNCING / LOST)
  function setUplink(text, mode) {
    dom.uplink.textContent = text;
    dom.uplink.classList.toggle("is-ok", mode === "ok");
    dom.uplink.classList.toggle("is-error", mode === "error");
  }

  // Perbarui teks "Menampilkan X dari N SPBU"
  function updateJumlah(terfilter) {
    const total = state.data ? state.data.features.length : 0;
    dom.jumlah.textContent = `MENAMPILKAN ${pad2(terfilter)} DARI ${pad2(total)} SPBU.`;
    dom.signalCount.textContent = pad2(terfilter);
  }

  // Update koordinat LAT/LON di top bar
  function updateCoords(lat, lng) {
    dom.coordLat.textContent = lat.toFixed(4);
    dom.coordLon.textContent = lng.toFixed(4);
  }

  // Update angka zoom di top bar
  function updateZoom() {
    dom.zoom.textContent = pad2(map.getZoom());
  }

  /* ---------------------------------------------------------------------
       MAP
       --------------------------------------------------------------------- */
  const map = L.map("map", {
    zoomControl: false,
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: true,
  }).setView([20, 0], 2);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Basemap OpenStreetMap (satu-satunya URL eksternal yang diizinkan)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    maxNativeZoom: 15,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    className: "pixel-tiles",
  }).addTo(map);

  updateCoords(20, 0);
  updateZoom();

  map.on("mousemove", (event) =>
    updateCoords(event.latlng.lat, event.latlng.lng),
  );
  map.on("zoomend", updateZoom);
  map.on("moveend", () => {
    const center = map.getCenter();
    updateCoords(center.lat, center.lng);
    updateZoom();
  });

  /* ---------------------------------------------------------------------
       ICON CLUSTER (L.divIcon)
       Menampilkan jumlah titik di dalam cluster sebagai lingkaran pixel.
       --------------------------------------------------------------------- */
  function buatIconCluster(cluster) {
    const jumlah = cluster.getChildCount();
    return L.divIcon({
      html: `<div class="cluster-icon">${jumlah}</div>`,
      className: "cluster-wrapper",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  /* ---------------------------------------------------------------------
       RENDER SPBU (dipanggil setiap kali filter/cluster berubah)
       1) hapus layer lama, 2) filter fitur, 3) pilih wadah layer,
       4) buat L.circleMarker per fitur, 5) tambahkan ke peta,
       6) perbarui jumlah.
       --------------------------------------------------------------------- */
  function renderSPBU() {
    if (!state.data) return;

    // 1. Hapus layer hasil render sebelumnya
    if (state.layerGroup) {
      map.removeLayer(state.layerGroup);
      state.layerGroup = null;
    }

    // 2. Filter: SPBU tampil jika menjual SETIDAKNYA SATU jenis yang tercentang
    const fitur = state.data.features.filter((f) => jenisTampil(f) !== null);

    // 3. Pilih wadah: markerClusterGroup jika cluster aktif, selain itu layerGroup
    if (state.cluster) {
      state.layerGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 46,
        iconCreateFunction: buatIconCluster,
      });
    } else {
      state.layerGroup = L.layerGroup();
    }

    // 4. Buat circleMarker untuk setiap fitur terfilter
    fitur.forEach((f) => {
      // GeoJSON [lng, lat] -> Leaflet butuh [lat, lng]
      const [lng, lat] = f.geometry.coordinates;
      const jenis = jenisTampil(f); // warna = jenis tercentang berprioritas tertinggi

      const marker = L.circleMarker([lat, lng], {
        radius: 9,
        color: "#061326", // outline hitam tebal
        weight: 3,
        fillColor: WARNA_BBM[jenis] || "#94a3b8",
        fillOpacity: 1,
      });

      // Klik marker -> buka sidebar detail (hentikan event agar tidak
      // memicu map.on('click') milik mode Gambar Zona)
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e.originalEvent);
        tampilkanDetail(f);
      });

      marker.addTo(state.layerGroup);
    });

    // 5. Tambahkan wadah ke peta
    state.layerGroup.addTo(map);

    // 6. Perbarui teks jumlah
    updateJumlah(fitur.length);

    // 7. Chip BBM di sidebar (jika ada SPBU terkunci) ikut terang/redup
    if (state.dipilih && state.chipBox)
      isiChipBBM(state.chipBox, state.dipilih);
  }

  /* ---------------------------------------------------------------------
       SIDEBAR DETAIL (Activity Log)
       --------------------------------------------------------------------- */
  function bukaSidebar() {
    tutupPanelZona(); // panel zona dan log berbagi slot kanan yang sama
    dom.log.classList.add("is-open");
    document.body.classList.add("log-open");
    dom.log.removeAttribute("inert");
    dom.log.setAttribute("aria-hidden", "false");
    dom.logBtn.setAttribute("aria-expanded", "true");
  }

  function tutupSidebar({ restoreFocus = false } = {}) {
    dom.log.classList.remove("is-open");
    document.body.classList.remove("log-open");
    dom.log.setAttribute("inert", "");
    dom.log.setAttribute("aria-hidden", "true");
    dom.logBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) dom.logBtn.focus();
  }

  // Isi chip jenis BBM yang dijual SPBU: terang = tercentang, redup = tidak
  function isiChipBBM(box, feature) {
    box.replaceChildren();
    jenisDijual(feature).forEach((kunci) => {
      const chip = document.createElement("span");
      chip.className =
        "bbm-chip chip-" + kunci + (state.filters[kunci] ? "" : " is-dim");
      chip.textContent = NAMA_BBM[kunci];
      box.append(chip);
    });
    if (!box.children.length) box.textContent = "-";
  }

  // Tampilkan detail SPBU (Kode, Alamat, Jenis BBM, Operasional 24 Jam) di sidebar
  function tampilkanDetail(feature) {
    const p = feature.properties || {};
    const judul = p.nama_spbu || "SPBU";

    dom.selected.className = "signal-file";
    dom.selected.replaceChildren();

    const nama = document.createElement("p");
    nama.className = "signal-name";
    nama.textContent = judul;

    const grid = document.createElement("dl");
    grid.className = "signal-grid";

    // Jenis BBM ditampilkan sebagai chip berwarna (bukan teks biasa)
    const chipBox = document.createElement("div");
    chipBox.className = "bbm-chips";
    state.dipilih = feature;
    state.chipBox = chipBox;
    isiChipBBM(chipBox, feature);

    const rows = [
      ["KODE", p.kode || "-"],
      ["ALAMAT", p.alamat || "-"],
      ["JENIS BBM", chipBox],
      ["OPERASIONAL 24 JAM", String(p.operasional_24jam || "-").toUpperCase()],
    ];

    rows.forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "signal-row";

      const dt = document.createElement("dt");
      dt.className = "signal-key";
      dt.textContent = key;

      const dd = document.createElement("dd");
      dd.className = "signal-val";
      if (value instanceof Node) dd.append(value);
      else dd.textContent = value;

      row.append(dt, dd);
      grid.append(row);
    });

    dom.selected.append(nama, grid);
    dom.logStatus.textContent = `LINK: LOCKED // ${p.kode || "SIGNAL"}`;
    bukaSidebar();
  }

  // Tampilkan pesan kosong saat sidebar dibuka tanpa sinyal
  function resetSidebar() {
    state.dipilih = null;
    state.chipBox = null;
    dom.selected.className = "selected-empty";
    dom.selected.replaceChildren();
    const empty = document.createElement("p");
    empty.textContent = "NO SIGNAL LOCKED.";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "TAP A SIGNAL ON THE GRID.";
    dom.selected.append(empty, hint);
    dom.logStatus.textContent = "LINK: STANDBY";
  }

  /* ---------------------------------------------------------------------
       FETCH DATA (sekali saja)
       --------------------------------------------------------------------- */
  async function loadData() {
    setUplink("SYNCING");
    dom.logStatus.textContent = "LINK: SYNCING";
    dom.jumlah.textContent = "SCANNING GRID...";
    dom.retryBtn.hidden = true;

    try {
      const response = await fetch("/api/data/spbu", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (
        !data ||
        data.type !== "FeatureCollection" ||
        !Array.isArray(data.features)
      ) {
        throw new Error("GeoJSON tidak valid");
      }

      state.data = data; // simpan sekali
      renderSPBU();
      fokusKeSPBU(); // zoom otomatis ke sebaran SPBU
      setUplink("ONLINE", "ok");
      dom.logStatus.textContent = "LINK: READY";
      dom.retryBtn.hidden = true;
    } catch (error) {
      state.data = null;
      state.dipilih = null;
      state.chipBox = null;
      if (state.layerGroup) {
        map.removeLayer(state.layerGroup);
        state.layerGroup = null;
      }
      updateJumlah(0);
      setUplink("LOST", "error");
      dom.logStatus.textContent = "LINK: LOST";
      dom.selected.className = "selected-empty";
      dom.selected.replaceChildren();
      const err = document.createElement("p");
      err.textContent = `SIGNAL LOST: ${error.message}`;
      dom.selected.append(err);
      dom.retryBtn.hidden = false;
      bukaSidebar();
    }
  }

  /* ---------------------------------------------------------------------
       MODE GAMBAR ZONA (POST /api/feature/zona)
       --------------------------------------------------------------------- */

  // Tampilkan pesan zona di tiga tempat: log status (sidebar), catatan di
  // bawah input nama (panel kiri), dan status panel KELOLA ZONA
  function pesanZona(teks) {
    dom.logStatus.textContent = teks;
    dom.zoneNote.textContent = teks;
    dom.zoneStatus.textContent = teks;
  }

  function setZoneMode(active, note) {
    state.zoneMode = active;
    dom.zoneBtn.classList.toggle("is-on", active);
    dom.zoneBtn.setAttribute("aria-pressed", String(active));
    dom.zoneLabel.textContent = active ? "SAVE ZONE" : "TRACE ZONE";
    dom.zoneNameGroup.hidden = !active; // input NAMA ZONA hanya tampil saat mode aktif
    // pastikan input terlihat di panel kiri yang bisa di-scroll
    if (active)
      dom.zoneNameGroup.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!active) {
      if (state.zonePreview) {
        map.removeLayer(state.zonePreview);
        state.zonePreview = null;
      }
      state.zonePoints = [];
      dom.zoneName.value = ""; // kosongkan input (setelah simpan / batal)
    }
    if (note) pesanZona(note);
  }

  // Dipanggil map.on('click'); hanya aktif saat mode zona
  function onMapClick(event) {
    if (!state.zoneMode) return;
    state.zonePoints.push([event.latlng.lat, event.latlng.lng]);
    drawZonePreview();
    pesanZona(`ZONE TRACE: ${state.zonePoints.length} POINT(S). MIN 3.`);
  }

  function drawZonePreview() {
    if (state.zonePreview) {
      map.removeLayer(state.zonePreview);
      state.zonePreview = null;
    }
    if (!state.zonePoints.length) return;
    const options = {
      color: "#ffd23f",
      weight: 3,
      dashArray: "6 4",
      interactive: false,
    };
    state.zonePreview =
      state.zonePoints.length >= 3
        ? L.polygon(state.zonePoints, {
            ...options,
            fillColor: "#2ee6d6",
            fillOpacity: 0.08,
          })
        : L.polyline(state.zonePoints, options);
    state.zonePreview.addTo(map);
  }

  async function saveZone() {
    if (dom.zoneBtn.disabled) return; // cegah kirim ganda (mis. Enter ditekan cepat)

    // Validasi 1: nama wajib diisi (spasi di awal/akhir dibuang)
    const nama = dom.zoneName.value.trim();
    if (!nama) {
      pesanZona("ZONE REJECTED: NAMA ZONA KOSONG.");
      dom.zoneName.focus();
      return;
    }
    // Validasi 2: poligon butuh minimal 3 titik
    if (state.zonePoints.length < 3) {
      pesanZona("ZONE REJECTED: NEED AT LEAST 3 POINTS.");
      return;
    }

    // GeoJSON [lng, lat]; ubah [lat, lng] -> [lng, lat] dan tutup ring
    const ring = state.zonePoints.map(([lat, lng]) => [lng, lat]);
    ring.push(ring[0]);

    const feature = {
      type: "Feature",
      properties: { nama }, // id dibuat oleh server
      geometry: { type: "Polygon", coordinates: [ring] },
    };

    dom.zoneBtn.disabled = true;
    try {
      const response = await fetch("/api/feature/zona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feature),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || `HTTP ${response.status}`);

      await muatZona(); // gambar ulang peta + daftar dari data server

      setZoneMode(
        false,
        `ZONE SAVED: ${nama}. TOTAL ${result.total_zona ?? "?"}.`,
      );
    } catch (error) {
      pesanZona(`ZONE SAVE FAILED: ${error.message}`);
    } finally {
      dom.zoneBtn.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------
       COUNTDOWN SWEEP (bottom bar)
       --------------------------------------------------------------------- */
  const SWEEP_TOTAL = 600;
  let sweepLeft = SWEEP_TOTAL;

  function renderSweep() {
    const minutes = Math.floor(sweepLeft / 60);
    const seconds = sweepLeft % 60;
    dom.timer.textContent = `${pad2(minutes)}:${pad2(seconds)}`;
    dom.sweepFill.style.width = `${(sweepLeft / SWEEP_TOTAL) * 100}%`;
  }

  setInterval(() => {
    sweepLeft -= 1;
    if (sweepLeft < 0) sweepLeft = SWEEP_TOTAL;
    renderSweep();
  }, 1000);
  renderSweep();

  /* ---------------------------------------------------------------------
       EVENT WIRING
       --------------------------------------------------------------------- */

  // Filter BBM (checkbox) -> update state.filters lalu render ulang
  Object.keys(dom.chkBBM).forEach((kunci) => {
    dom.chkBBM[kunci].addEventListener("change", () => {
      state.filters[kunci] = dom.chkBBM[kunci].checked;
      renderSPBU();
    });
  });

  // Checkbox cluster -> update state.cluster lalu render ulang
  dom.chkCluster.addEventListener("change", () => {
    state.cluster = dom.chkCluster.checked;
    renderSPBU();
  });

  // Tombol ACTIVITY LOG (toggle sidebar)
  dom.logBtn.addEventListener("click", () => {
    if (dom.log.classList.contains("is-open"))
      tutupSidebar({ restoreFocus: true });
    else bukaSidebar();
  });
  dom.closeLogBtn.addEventListener("click", () =>
    tutupSidebar({ restoreFocus: true }),
  );

  // Retry jika fetch gagal
  dom.retryBtn.addEventListener("click", loadData);

  // Scan area: zoom ke bounds semua fitur
  dom.scanBtn.addEventListener("click", () => {
    if (!state.data || !state.data.features.length) return;
    const bounds = L.latLngBounds(
      state.data.features.map((f) => [
        f.geometry.coordinates[1],
        f.geometry.coordinates[0],
      ]),
    );
    map.fitBounds(bounds, { maxZoom: 14, padding: [40, 40] });
  });

  // Reset ke tampilan global
  dom.resetBtn.addEventListener("click", () => {
    map.setView([20, 0], 2);
    updateCoords(20, 0);
    updateZoom();
  });

  // Mode zona: klik pertama mengaktifkan, klik kedua menyimpan
  dom.zoneBtn.addEventListener("click", () => {
    if (!state.zoneMode) {
      setZoneMode(true, "ZONE TRACE ARMED. CLICK THE GRID TO PLACE 3+ POINTS.");
    } else {
      saveZone();
    }
  });

  // Enter di kolom NAMA ZONA = SAVE ZONE
  dom.zoneName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveZone();
  });

  // Tombol KELOLA ZONA (toggle panel daftar zona) + tombol X
  dom.zonesBtn.addEventListener("click", () => {
    if (dom.zonePanel.classList.contains("is-open"))
      tutupPanelZona({ restoreFocus: true });
    else bukaPanelZona();
  });
  dom.closeZonesBtn.addEventListener("click", () =>
    tutupPanelZona({ restoreFocus: true }),
  );

  // CRT FX: matikan/hidupkan efek layar
  dom.fxBtn.addEventListener("click", () => {
    document.body.classList.toggle("fx-off");
    const on = !document.body.classList.contains("fx-off");
    dom.fxBtn.setAttribute("aria-pressed", String(on));
    dom.fxLabel.textContent = `CRT FX: ${on ? "ON" : "OFF"}`;
  });

  // Trailer dialog (native <dialog>)
  dom.trailerBtn.addEventListener("click", () => {
    if (typeof dom.dialog.showModal === "function") {
      if (!dom.dialog.open) dom.dialog.showModal();
    } else {
      dom.dialog.setAttribute("open", "");
    }
  });
  function closeTrailer() {
    if (dom.dialog.open) dom.dialog.close();
    else dom.dialog.removeAttribute("open");
  }
  dom.closeTrailerBtn.addEventListener("click", closeTrailer);
  dom.returnBtn.addEventListener("click", closeTrailer);
  dom.dialog.addEventListener("click", (event) => {
    if (event.target === dom.dialog) closeTrailer();
  });
  dom.dialog.addEventListener("close", () => dom.trailerBtn.focus());

  // Escape: tutup zona / sidebar
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (dom.dialog.open) return;
    if (state.zoneMode) {
      setZoneMode(false, "ZONE TRACE CANCELLED.");
    } else if (dom.zonePanel.classList.contains("is-open")) {
      tutupPanelZona({ restoreFocus: true });
    } else if (dom.log.classList.contains("is-open")) {
      tutupSidebar({ restoreFocus: true });
    }
  });

  // Klik peta untuk mode zona
  map.on("click", onMapClick);

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
    const k =
      keys.find((x) => /kec|kc/i.test(x)) || keys.find((x) => /nam/i.test(x));
    return k ? String(p[k]) : "KECAMATAN";
  }

  // Layer kecamatan: isi transparan + garis teal, disorot saat kursor di atasnya
  const gayaKec = {
    color: "#2ee6d6",
    weight: 2,
    fillColor: "#2ee6d6",
    fillOpacity: 0.1,
  };
  const kecLayer = L.geoJSON(null, {
    pane: "kecPane",
    style: gayaKec,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(namaKecamatan(f.properties).toUpperCase(), {
        permanent: true,
        direction: "center",
        className: "kec-label",
      });
      layer.on("mouseover", () =>
        layer.setStyle({ fillOpacity: 0.3, weight: 3 }),
      );
      layer.on("mouseout", () => kecLayer.resetStyle(layer));
    },
  }).addTo(map);

  fetch("/api/data/kecamatan")
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error("data kecamatan tidak ada")),
    )
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

  // Peta id zona -> layer-nya (dipakai tombol LIHAT untuk fitBounds)
  const layerPerZona = new Map();

  // Nama yang ditampilkan: properties.nama (zona baru), atau nama_zona / name (data lama)
  function namaZona(f, i) {
    const p = f.properties || {};
    return p.nama || p.nama_zona || p.name || "Zona #" + (i + 1);
  }

  // Buka/tutup panel KELOLA ZONA (berbagi slot kanan dengan Activity Log)
  function bukaPanelZona() {
    tutupSidebar(); // log ditutup dulu agar tidak menumpuk
    dom.zonePanel.classList.add("is-open");
    document.body.classList.add("log-open");
    dom.zonePanel.removeAttribute("inert");
    dom.zonePanel.setAttribute("aria-hidden", "false");
    dom.zonesBtn.setAttribute("aria-expanded", "true");
  }

  function tutupPanelZona({ restoreFocus = false } = {}) {
    dom.zonePanel.classList.remove("is-open");
    // kelas log-open dilepas hanya jika Activity Log juga tidak sedang terbuka
    if (!dom.log.classList.contains("is-open"))
      document.body.classList.remove("log-open");
    dom.zonePanel.setAttribute("inert", "");
    dom.zonePanel.setAttribute("aria-hidden", "true");
    dom.zonesBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) dom.zonesBtn.focus();
  }

  // Hapus zona berdasarkan properties.id (dipakai popup peta DAN daftar zona)
  async function hapusZona(id) {
    if (!confirm("Hapus zona ini secara permanen?")) return;
    try {
      const res = await fetch("/api/feature/zona/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const hasil = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(hasil.error || `HTTP ${res.status}`);
      map.closePopup();
      await muatZona(); // peta + daftar dimuat ulang
      pesanZona("ZONE DELETED.");
    } catch (error) {
      pesanZona(`ZONE DELETE FAILED: ${error.message}`);
    }
  }

  // Zoom peta ke satu zona (sisakan ruang untuk panel kiri dan panel kanan)
  function lihatZona(id) {
    const layer = layerPerZona.get(id);
    if (!layer) return;
    const kanan = window.innerWidth > 900 ? 390 : 30;
    map.fitBounds(layer.getBounds(), {
      paddingTopLeft: [230, 90],
      paddingBottomRight: [kanan, 80],
      maxZoom: 16,
    });
  }

  // Tombol bergaya HUD (hud-btn + btn-pip), sama seperti tombol di panel kiri
  function buatTombolHud(teks, kelasTambahan, aksi) {
    const tombol = document.createElement("button");
    tombol.type = "button";
    tombol.className = ("hud-btn " + kelasTambahan).trim();
    const pip = document.createElement("span");
    pip.className = "btn-pip";
    pip.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = teks;
    tombol.append(pip, label);
    tombol.addEventListener("click", aksi);
    return tombol;
  }

  // Isi daftar di panel KELOLA ZONA: satu baris per zona (nama + LIHAT + HAPUS)
  function isiDaftarZona(fitur) {
    dom.zoneList.replaceChildren();

    if (!fitur.length) {
      const kosong = document.createElement("div");
      kosong.className = "selected-empty";
      const teks = document.createElement("p");
      teks.textContent = "BELUM ADA ZONA.";
      kosong.append(teks);
      dom.zoneList.append(kosong);
    }

    fitur.forEach((f, i) => {
      const id = f.properties.id;
      const item = document.createElement("div");
      item.className = "signal-file";

      const nama = document.createElement("p");
      nama.className = "signal-name";
      nama.textContent = namaZona(f, i);

      const aksi = document.createElement("div");
      aksi.className = "zone-actions";
      aksi.append(
        buatTombolHud("LIHAT", "", () => lihatZona(id)),
        buatTombolHud("HAPUS", "hud-btn-bahaya", () => hapusZona(id)),
      );

      item.append(nama, aksi);
      dom.zoneList.append(item);
    });

    dom.zoneStatus.textContent = `ZONES: ${fitur.length} LOADED`;
  }

  // Isi popup zona di peta: nama + tombol hapus (memakai hapusZona yang sama)
  function popupZona(f, i) {
    const box = document.createElement("div");
    const judul = document.createElement("b");
    judul.textContent = namaZona(f, i);
    const tombol = document.createElement("button");
    tombol.className = "btn-hapus-zona";
    tombol.textContent = "HAPUS ZONA";
    tombol.addEventListener("click", () => hapusZona(f.properties.id));
    box.append(judul, document.createElement("br"), tombol);
    return box;
  }

  // Ambil semua zona dari server lalu gambar ulang peta + daftar
  async function muatZona() {
    try {
      const res = await fetch("/api/data/zona", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json();
      zonaLayer.clearLayers();
      layerPerZona.clear();
      fc.features.forEach((f, i) => {
        const layer = L.geoJSON(f, {
          pane: "zonaPane",
          style: {
            color: "#ffd23f",
            weight: 3,
            dashArray: "8 4",
            fillColor: "#ffd23f",
            fillOpacity: 0.18,
          },
          onEachFeature: (_fitur, anak) => {
            // Label nama di tengah zona. Pakai elemen DOM (bukan string)
            // supaya nama yang berisi karakter HTML tidak dieksekusi.
            const label = document.createElement("span");
            label.textContent = namaZona(f, i);
            anak.bindTooltip(label, {
              permanent: true,
              direction: "center",
              className: "zona-label",
            });
          },
        }).on("click", (e) => {
          if (state.zoneMode) return; // saat menggambar zona, klik hanya menambah titik
          L.popup().setLatLng(e.latlng).setContent(popupZona(f, i)).openOn(map);
        });
        layer.addTo(zonaLayer);
        layerPerZona.set(f.properties.id, layer);
      });
      isiDaftarZona(fc.features);
    } catch (err) {
      console.warn("Gagal memuat zona:", err.message);
    }
  }

  // Saklar tampil/sembunyi layer
  L.control
    .layers(
      null,
      { KECAMATAN: kecLayer, ZONA: zonaLayer },
      { position: "bottomright", collapsed: false },
    )
    .addTo(map);

  // Zoom otomatis ke sebaran SPBU (ruang untuk panel HUD kiri, header, dan bar bawah)
  function fokusKeSPBU() {
    if (!state.data || !state.data.features.length) return;
    const titik = state.data.features.map((f) => [
      f.geometry.coordinates[1],
      f.geometry.coordinates[0],
    ]);
    map.fitBounds(L.latLngBounds(titik), {
      paddingTopLeft: [230, 90],
      paddingBottomRight: [30, 80],
      maxZoom: 14,
    });
  }

  muatZona();

  /* ---------------------------------------------------------------------
       BOOT
       --------------------------------------------------------------------- */
  resetSidebar();
  updateJumlah(0);
  loadData();
})();
