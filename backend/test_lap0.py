import sqlite3
import json

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute("SELECT samples_json FROM telemetry_cache WHERE lap_number = 0").fetchone()
if row:
    samples = json.loads(row[0])
    print("Lap 0 samples count:", len(samples))
    for i in range(250, 300):
        s = samples[i]
        print(f"i={i}: spd={s['speed']} plat={s.get('path_lateral')} tedge={s.get('track_edge')} t_w={s.get('track_width')} wx={round(s['world_x'], 2)} cx={round(s.get('track_center_x', 0), 2)}")
