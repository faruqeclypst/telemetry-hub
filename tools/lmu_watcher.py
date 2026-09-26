#!/usr/bin/env python3
"""
TelemetryHub - LMU Auto-Upload Watcher (Windows)
================================================
Pantau folder rekaman telemetry LMU. Begitu sebuah sesi selesai dan LMU
menyimpan berkas .duckdb, skrip ini otomatis mengunggahnya ke TelemetryHub
di VPS, sehingga sesi langsung muncul di web tanpa import manual.

Pakai:
    python lmu_watcher.py                     # jalan terus, pantau folder
    python lmu_watcher.py --sekali            # cek folder sekali lalu keluar
    python lmu_watcher.py --folder "D:\\LMU\\Telemetry"

Butuh: pip install requests
"""

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    print("Modul 'requests' belum ada. Jalankan: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------- KONFIGURASI
CFG = {
    # Endpoint auto-ingest di TelemetryHub.
    "endpoint": "http://43.134.175.87:8099/api/sessions/ingest",
    # Samakan dengan INGEST_API_KEY di service VPS. Kosongkan bila tidak dipakai.
    "api_key": "",
    # Folder rekaman bawaan LMU. Sesuaikan bila library-mu di drive lain.
    "folder": os.path.join(
        os.path.expanduser("~"),
        "Documents",
        "Le Mans Ultimate",
        "UserData",
        "Telemetry",
    ),
    # Nama folder alternatif yang ikut dipantau (Steam library lain).
    "folder_extra": [],
    "ext": [".duckdb"],
    # Berkas harus diam selama ini (detik) sebelum dianggap selesai ditulis.
    "stabil_detik": 12,
    # Ukuran minimum (byte) agar berkas kosong/rusak diabaikan.
    "min_byte": 4096,
    # Catatan berkas yang sudah terkirim, supaya tidak dobel.
    "state": os.path.join(os.path.dirname(os.path.abspath(__file__)), "terkirim.json"),
    # Jeda antar pemindaian folder saat mode polling.
    "polling_detik": 15,
}
# ---------------------------------------------------------------------------

COLORS = {"info": "\033[96m", "ok": "\033[92m", "warn": "\033[93m", "err": "\033[91m", "dim": "\033[90m", "end": "\033[0m"}


def log(kind, msg):
    color = COLORS.get(kind, "")
    print("{0}[{1:%H:%M:%S}] {2}{3}".format(color, datetime.now(), msg, COLORS["end"]), flush=True)


def load_state(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}
    return {}


def save_state(path, state):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log("warn", "Gagal menyimpan state: {0}".format(e))


def fingerprint(path, size):
    """Cheap identity for a recording: name + size + mtime. Enough to avoid
    re-uploading the same finished file, without hashing a large blob."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = "{0}|{1}|{2}".format(os.path.basename(path), size, int(st.st_mtime))
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def is_stable(path, seconds):
    """True when the file size has stopped changing for `seconds`."""
    try:
        first = os.path.getsize(path)
    except OSError:
        return False
    time.sleep(seconds)
    try:
        second = os.path.getsize(path)
    except OSError:
        return False
    return first == second


def scan_folders(cfg):
    out = []
    for folder in [cfg["folder"]] + list(cfg.get("folder_extra") or []):
        if not folder or not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if os.path.splitext(name)[1].lower() in cfg["ext"]:
                full = os.path.join(folder, name)
                if os.path.isfile(full):
                    out.append(full)
    return out


def upload(cfg, path):
    size = os.path.getsize(path)
    try:
        with open(path, "rb") as fh:
            files = {"file": (os.path.basename(path), fh, "application/octet-stream")}
            data = {"api_key": cfg["api_key"]} if cfg["api_key"] else {}
            res = requests.post(cfg["endpoint"], files=files, data=data, timeout=300)
    except requests.RequestException as e:
        log("err", "Gagal mengunggah {0}: {1}".format(os.path.basename(path), e))
        return False

    if res.status_code == 200:
        try:
            payload = res.json()
            label = payload.get("track_name") or payload.get("session_id") or "sesi"
        except ValueError:
            label = "sesi"
        log("ok", "Terkirim: {0} ({1:.1f} MB) -> {2}".format(os.path.basename(path), size / 1e6, label))
        return True

    log("err", "Server menolak {0}: HTTP {1} {2}".format(os.path.basename(path), res.status_code, res.text[:200]))
    return False


def process_once(cfg, state):
    files = scan_folders(cfg)
    if not files:
        log("dim", "Tidak ada berkas di folder pantauan.")
        return 0

    sent = 0
    for path in files:
        size = os.path.getsize(path)
        if size < cfg["min_byte"]:
            continue
        fp = fingerprint(path, size)
        if fp is None or fp in state:
            continue
        if not is_stable(path, cfg["stabil_detik"]):
            log("dim", "Masih ditulis, dilewati: {0}".format(os.path.basename(path)))
            continue
        log("info", "Berkas baru terdeteksi: {0} ({1:.1f} MB)".format(os.path.basename(path), size / 1e6))
        if upload(cfg, path):
            state[fp] = {"file": os.path.basename(path), "at": datetime.now().isoformat(timespec="seconds")}
            save_state(cfg["state"], state)
            sent += 1
    return sent


def main():
    parser = argparse.ArgumentParser(description="TelemetryHub LMU auto-upload watcher")
    parser.add_argument("--folder", help="Timpa folder pantauan")
    parser.add_argument("--endpoint", help="Timpa endpoint ingest")
    parser.add_argument("--api-key", help="Timpa API key")
    parser.add_argument("--sekali", "--once", action="store_true", dest="once", help="Pindai sekali lalu keluar")
    parser.add_argument("--polling", action="store_true", help="Pakai pemindaian berkala (tanpa watchdog)")
    args = parser.parse_args()

    if args.folder:
        CFG["folder"] = args.folder
    if args.endpoint:
        CFG["endpoint"] = args.endpoint
    if args.api_key is not None:
        CFG["api_key"] = args.api_key

    log("info", "Endpoint : {0}".format(CFG["endpoint"]))
    log("info", "Folder   : {0}".format(CFG["folder"]))
    if not os.path.isdir(CFG["folder"]):
        log("warn", "Folder belum ada. Sesuaikan CFG['folder'] dengan lokasi rekaman LMU-mu.")

    state = load_state(CFG["state"])

    if args.once:
        total = process_once(CFG, state)
        log("info", "Selesai. {0} berkas terkirim.".format(total))
        return

    # Default loop: poll on an interval. This needs no extra dependency and is
    # robust on Windows, where a file-watch library adds install friction.
    log("ok", "Memantau... biarkan jendela ini terbuka saat balapan. Ctrl+C untuk berhenti.")
    try:
        while True:
            process_once(CFG, state)
            time.sleep(CFG["polling_detik"])
    except KeyboardInterrupt:
        log("info", "Dihentikan.")


if __name__ == "__main__":
    main()
