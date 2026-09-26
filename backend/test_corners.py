import json
import sqlite3

from corner_detector import detect_corners

DB = "telemetry.db"
con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

for sid, lap in [
    ("2BaXHUMzT9lHtox0", 2),
    ("2BaXHUMzT9lHtox0", 1),
    ("lmu_Autodromo_Enzo_e_Dino_Ferrari_P_2026_09_25T09_01_47Z", 3),
    ("lmu_Autodromo_Enzo_e_Dino_Ferrari_P_2026_09_25T09_01_47Z", 4),
]:
    row = con.execute(
        "SELECT samples_json FROM telemetry_cache WHERE session_id = ? AND lap_number = ?",
        (sid, lap),
    ).fetchone()
    if not row:
        print(f"{sid} lap {lap}: no cache")
        continue
    samples = json.loads(row["samples_json"])
    corners = detect_corners(samples)
    print(f"\n{sid} lap {lap}: {len(corners)} corners")
    for c in corners:
        print(
            f"  C{c['number']:>2} {c['direction']:<5} apex@{c['apex_pct']*100:6.1f}% "
            f"vmin={c['min_speed']:6.1f} gear={c['apex']['gear']} "
            f"latG={c['max_lat_g']:4.2f} len={c['length_m']:6.1f}m dur={c['duration']:5.2f}s"
        )
