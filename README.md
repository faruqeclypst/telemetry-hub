# TelemetryHub Pro

Platform analisis telemetri sim racing full-stack mandiri (alternatif modern SimTelemetry) untuk **Le Mans Ultimate (LMU)**, iRacing, Assetto Corsa, dan simulator balap lainnya.

---

## Fitur Utama

- **Multi-Channel Synchronized Canvas Telemetry**:
  - Grafik kecepatan (*Speed*), pedal (*Throttle* & *Brake*), *Gear & RPM*, serta *Steering & G-Force* yang tersinkronisasi 60 FPS.
  - *Dedicated Left Gutter*: Sumbu Y terpisah rapi tanpa teks yang bertumpuk.
  - *Precision HUD*: Nilai instan yang tidak goyang dengan font tabular mono (`JetBrains Mono`).
  - *Corner band*: tikungan aktif ditandai langsung di atas trace, tikungan lain jadi tick tipis.
- **Corner Analysis**:
  - Deteksi tikungan otomatis dari steering, curvature, dan lateral G, dengan hysteresis agar tidak pecah oleh noise.
  - Per tikungan: entry (titik rem pertama), turn-in, apex (kecepatan minimum + gear), exit (throttle 100%), durasi, panjang, dan max lateral G.
  - Gear apex dihitung dari rasio rpm/kecepatan, jadi nilai stale dari channel `Gear` LMU tidak ikut terpakai.
  - Mode compare menambahkan delta per tikungan, plus ringkasan *slowest apex* dan *biggest gain*.
  - Klik satu tikungan menyinkronkan chart, peta 2D, dan 3D ke titik apex-nya.
- **2D Track Map Interaktif**:
  - Lintasan sirkuit di-render langsung dari koordinat telemetri (`world_x`, `world_y`).
  - *Speed Heatmap*: Menyoroti zona pengereman (*braking zones*) berwarna merah dan zona kecepatan tinggi berwarna hijau.
  - *Gain/Loss mode* saat membandingkan lap, plus badge *MAX GAIN* dan *MAX LOSS*.
  - Tab nomor tikungan yang bisa diklik, sejajar dengan rail *Corners*.
- **3D Track Replay Interaktif (Three.js)**:
  - Klik pada peta atau tombol **"3D replay"** untuk membuka visualisasi sirkuit 3D, langsung fokus ke tikungan yang sedang dipilih.
  - Geometri jalan dibangun dari *centripetal Catmull-Rom spline*: tangent dan normal analitik, tepi aspal ber-bevel, UV dari panjang busur, jadi tidak ada sudut patah di tikungan.
  - Kerb 3D dengan profil tinggi, rib melintang, dan taper masuk/keluar. Kerb apex di sisi dalam tikungan, kerb exit di sisi luar setelah apex.
  - Model mobil balap 3D dengan *steering wheel pivot*, lampu rem dari channel brake, dan body roll dari lateral G. Yaw dibatasi dan di-damping, jadi mobil tidak menyentak di tikungan lambat.
  - Mode *dual-car ghost* saat membandingkan dua lap.
  - Pilihan kamera: *Chase Cam*, *Hood Cam*, *Top-Down*, dan *Free 360° Orbit*.
  - Kontrol pemutaran (*Play / Pause*, kecepatan 0.25x–4x, serta slider *timeline scrub* yang sinkron dengan telemetri).
- **Delta Comparison Mode**:
  - Komparasi dua lap berbeda secara real-time dengan kalkulasi selisih waktu terhadap persentase jarak sirkuit.
- **RXTM Binary Engine**:
  - Parser internal untuk format file biner `.bin` SimTelemetry (magic `0x4D545852` / `RXTM`).
  - Unduh dan impor otomatis dari URL atau ID sesi SimTelemetry.
  - Ekspor telemetri ke format CSV.

---

## Arah Desain

Arah visual dan aturan UI ada di [`DESIGN.md`](DESIGN.md): mood *engineering pit wall*, dark theme, tipografi Saira + JetBrains Mono, dan dial ENERGY 3 / RHYTHM 3 / MOTION 3.

---

## Alur Kerja Harian & Deploy VPS

Setup produksi saat ini berjalan di VPS `43.134.175.87` memakai **systemd** (bukan Docker),
folder aplikasi `/home/ubuntu/telemetry-hub`, dan backend uvicorn di port **8099**.
Frontend di-serve sebagai SPA dari `frontend/dist` (lihat `FRONTEND_DIST` di unit service).

### Ringkasan alur

```
1. Ngoding          (edit file di folder project ini)
2. git add -A
3. git commit -m "pesan perubahan"
4. git push
5. Deploy ke VPS    (lihat di bawah)
6. Buka http://43.134.175.87:8099/ lalu hard refresh (Ctrl+F5)
```

### Langkah 5: Deploy ke VPS

Cara termudah, cukup jalankan satu perintah dari komputer lokal:

```bash
ssh ubuntu@43.134.175.87 "bash ~/vps-build.sh"
```

Script `~/vps-build.sh` di VPS melakukan semuanya secara otomatis:

1. `git fetch origin main` + `git reset --hard origin/main` di `/home/ubuntu/telemetry-hub`.
   File yang tidak terlacak seperti `backend/storage/`, `backend/telemetry.db`, `.env`, dan
   `backend/venv/` **tidak tersentuh** karena ada di `.gitignore`.
2. Build frontend dengan Node 20 (via nvm): `rm -rf node_modules dist && npm install && npm run build`.
3. Update dependency backend: `./venv/bin/pip install -r requirements.txt`.
4. `sudo systemctl restart telemetry-hub`, lalu verifikasi port `8099` mendengarkan.

Jika script belum ada di VPS, isinya seperti ini:

```bash
#!/usr/bin/env bash
set -e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null
APP=/home/ubuntu/telemetry-hub
cd "$APP" && git fetch origin main && git reset --hard origin/main
cd "$APP/frontend" && rm -rf node_modules dist && npm install && npm run build
cd "$APP/backend" && ./venv/bin/pip install -q -r requirements.txt
sudo systemctl restart telemetry-hub
sleep 2 && systemctl is-active telemetry-hub && sudo ss -ltnp | grep 8099
```

### Catatan penting

- **Node wajib v20+ di VPS.** Vite 8 tidak jalan di Node v12. Node 20 sudah tersedia lewat
  nvm (`. "$NVM_DIR/nvm.sh"; nvm use 20`), jadi script harus memuat nvm dulu.
- **Bukan Docker.** Container Docker yang ada di VPS itu project lain (prefix `simak_`).
  Jangan menyentuhnya.
- **Cek cepat setelah deploy:** `curl -s http://43.134.175.87:8099/ | grep -o 'assets/index-[^"]*\.js'`
  harus menampilkan nama bundle baru (hash berubah setiap build).
- **Rollback:** `cd /home/ubuntu/telemetry-hub && git reset --hard <commit-lama>` lalu ulangi
  langkah build + restart.

---

## Struktur Direktori

```
telemetry-hub/
├── start.bat                     # Launcher sekali klik untuk Windows
├── README.md                     # Dokumentasi sistem
├── backend/                      # Service FastAPI & SQLite
│   ├── main.py                   # REST API server & router
│   ├── database.py               # SQLite schema & query layer
│   ├── corner_detector.py        # Deteksi tikungan & delta per tikungan
│   ├── rxtm_parser.py            # Parser biner RXTM & kalkulator delta
│   ├── lmu_duckdb_parser.py      # Parser rekaman DuckDB Le Mans Ultimate
│   ├── simtelemetry_client.py    # Klien tRPC SimTelemetry & pengunduh blob
│   └── telemetry.db              # Database lokal (auto-created)
└── frontend/                     # Web App Vite + React
    ├── src/
    │   ├── components/
    │   │   ├── TelemetryChart.jsx  # Multi-channel canvas graphs
    │   │   ├── TrackMap.jsx        # 2D Canvas circuit map
    │   │   ├── Track3DModal.jsx    # 3D replay (Three.js)
    │   │   ├── CornerPanel.jsx     # Pit board daftar tikungan
    │   │   ├── LapTable.jsx        # Tabel waktu lap & komparasi
    │   │   ├── SessionHeader.jsx   # Timing strip sesi
    │   │   ├── ImportModal.jsx     # Dialog impor sesi
    │   │   ├── PanelState.jsx      # State loading / empty / error
    │   │   └── ErrorBoundary.jsx   # Isolasi kegagalan per panel
    │   ├── lib/
    │   │   └── trackGeometry.js    # Spline, road, kerb, verge, pose tracker
    │   ├── App.jsx               # Komponen utama
    │   └── index.css             # Design token & komponen
    └── package.json
```

---

## API

Endpoint yang dipakai frontend:

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/sessions` | Daftar sesi |
| GET | `/api/sessions/{id}` | Detail sesi + daftar lap |
| GET | `/api/sessions/{id}/laps/{lap}/telemetry` | Sample telemetri, parameter `lod` untuk downsampling |
| GET | `/api/sessions/{id}/laps/{lap}/corners` | Deteksi tikungan, parameter `lap_comp` untuk delta |
| GET | `/api/sessions/{id}/compare` | Delta time terhadap persentase jarak |
| GET | `/api/sessions/{id}/laps/{lap}/export/csv` | Ekspor CSV |
| POST | `/api/sessions/import` | Impor dari URL atau ID SimTelemetry |
| POST | `/api/sessions/import-duckdb` | Impor dari path DuckDB lokal |
| POST | `/api/sessions/upload-duckdb` | Unggah file DuckDB |

---

## Cara Menjalankan

### Cara 1: Sekali Klik (Windows)
Cukup jalankan file [`start.bat`](file:///d:/PROJECT/github/vps/telemetry-hub/start.bat) dengan double-click. Script akan otomatis menyalakan backend dan frontend serta membuka browser.

### Cara 2: Menjalankan Manual di Terminal

1. **Jalankan Backend**:
   ```bash
   cd d:/PROJECT/github/vps/telemetry-hub/backend
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
2. **Jalankan Frontend**:
   ```bash
   cd d:/PROJECT/github/vps/telemetry-hub/frontend
   npx vite --host 127.0.0.1 --port 5173
   ```
3. Buka browser di **`http://127.0.0.1:5173`**.

---

## Menjalankan Online (Production & Remote)

TelemetryHub Pro sudah mendukung **Unified Full-Stack Mode**: backend FastAPI dapat menyajikan (*serve*) frontend SPA (React) langsung dari satu port yang sama tanpa CORS issue.

### Opsi 1: Jalankan di VPS dengan Docker (Paling Praktis)
Jalankan satu perintah di folder `telemetry-hub`:
```bash
docker compose up -d --build
```
Aplikasi akan langsung online di port `8000` dengan database tersimpan di Docker Volume.

### Opsi 2: Deploy Otomatis di Linux VPS (Systemd + Nginx)
1. Salin folder `telemetry-hub` ke VPS Ubuntu.
2. Jalankan script deployment otomatis:
   ```bash
   chmod +x deploy_vps.sh
   ./deploy_vps.sh
   ```
   Service `telemetry-hub` akan otomatis berjalan di background melalui systemd dan restart otomatis jika server reboot.

### Opsi 3: Akses Online Langsung dari PC Lokal (Tunnel Gratis)
Jika TelemetryHub berjalan di PC lokal (misal PC tempat simulator terinstall):
1. Pastikan frontend sudah di-build: `cd frontend && npm run build`
2. Jalankan backend: `cd backend && python main.py`
3. Klik dua kali [`online_tunnel.bat`](online_tunnel.bat) untuk mendapatkan link publik HTTPS gratis tanpa sewa VPS.

### Opsi 4: Cloud Hosting Terpisah (Frontend Vercel + Backend Cloud)
- **Frontend**: Deploy folder `frontend/` ke Vercel / Netlify / Cloudflare Pages. Atur environment variable `VITE_API_URL=https://api-backend-anda.com`.
- **Backend**: Deploy folder `backend/` ke Railway / Render / Fly.io dengan `requirements.txt`.
