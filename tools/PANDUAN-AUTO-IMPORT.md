# Auto-Import Telemetry LMU ke TelemetryHub

Setelah disiapkan sekali, setiap sesi LMU yang selesai otomatis masuk ke
TelemetryHub tanpa import manual.

```
┌──────────────┐   ┌────────────────┐   ┌────────────────────┐
│  LMU (PC)    │──>│ lmu_watcher.py │──>│ TelemetryHub (VPS) │
│  rekam sesi  │   │ pantau folder  │   │ auto-import ke DB  │
└──────────────┘   └────────────────┘   └────────────────────┘
```

LMU menulis rekaman `.duckdb` ke `Documents\Le Mans Ultimate\UserData\Telemetry`.
Watcher memantau folder itu, menunggu berkas selesai ditulis, lalu mengunggahnya
ke endpoint `/api/sessions/ingest` di TelemetryHub.

---

## 1. Aktifkan perekaman native LMU

Di LMU: **Settings -> Gameplay/Advanced -> aktifkan Telemetry Recording**.
Setelah itu setiap sesi menghasilkan satu berkas `.duckdb` di folder Telemetry.

> Kalau kamu belum tahu lokasinya, buka File Explorer dan cari:
> `Le Mans Ultimate\UserData\Telemetry`

---

## 2. Jalankan watcher di PC

```bat
pip install requests
python tools\lmu_watcher.py
```

Watcher akan memantau folder default. Kalau library-mu di tempat lain:

```bat
python tools\lmu_watcher.py --folder "D:\SteamLibrary\steamapps\common\Le Mans Ultimate\UserData\Telemetry"
```

Biarkan jendela itu terbuka saat balapan. Setelah sesi selesai dan LMU menyimpan
berkas, telemetry otomatis muncul di http://43.134.175.87:8099/

Cek sekali tanpa menunggu:

```bat
python tools\lmu_watcher.py --sekali
```

---

## 3. Supaya jalan sendiri saat Windows menyala

Buat berkas `jalankan-watcher.bat`:

```bat
@echo off
cd /d D:\PROJECT\github\vps\telemetry-hub
python tools\lmu_watcher.py
pause
```

Tekan `Win+R`, ketik `shell:startup`, lalu letakkan **pintasan** berkas `.bat`
itu di folder yang terbuka. Selesai.

---

## 4. Mengamankan endpoint (opsional tapi disarankan)

Secara default endpoint terbuka. Untuk memakai kunci API:

1. Di VPS, tambahkan `INGEST_API_KEY` ke environment service
   (`sudo systemctl edit telemetry-hub`, lalu
   `Environment="INGEST_API_KEY=kunci-rahasiamu"`), kemudian
   `sudo systemctl restart telemetry-hub`.
2. Isi `CFG["api_key"]` di `lmu_watcher.py` dengan kunci yang sama.

---

## Cara kerjanya (ringkas)

1. Watcher memindai folder tiap 15 detik.
2. Berkas dianggap siap setelah ukurannya tidak berubah selama 12 detik.
3. Sidik jari berkas dicatat di `terkirim.json`, jadi berkas yang sama tidak
   dikirim dua kali meskipun watcher di-restart.
4. Berkas diunggah ke `/api/sessions/ingest`; server mem-parse dan menyimpan ke
   database, lalu menghapus salinan sementara di inbox.
5. Sesi langsung muncul di daftar session web.

---

## Kalau ada masalah

| Gejala | Sebab | Solusi |
|---|---|---|
| "Folder belum ada" | Path salah | Sesuaikan `--folder` |
| HTTP 415 | Bukan `.duckdb` | Aktifkan telemetry recording native LMU |
| HTTP 401 | Kunci beda | Samakan `api_key` dan `INGEST_API_KEY` |
| Berkas terkirim dua kali | `terkirim.json` terhapus | Jangan hapus berkas itu |
| Sesi tidak muncul | Upload gagal | Lihat pesan di jendela watcher |
