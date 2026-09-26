import sqlite3
import json
import math

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute("SELECT samples_json FROM telemetry_cache WHERE session_id LIKE '%Ferrari%' AND lap_number = 0").fetchone()
if row:
    samples = json.loads(row[0])
    print("Lap 3 count:", len(samples))
    # check differences between consecutive track_center_x and world_x
    max_d_raw = 0
    max_d_center = 0
    jitter_center = 0
    jitter_raw = 0
    for i in range(1, len(samples)):
        s0 = samples[i-1]
        s1 = samples[i]
        d_raw = math.hypot(s1['world_x'] - s0['world_x'], s1['world_y'] - s0['world_y'])
        max_d_raw = max(max_d_raw, d_raw)
        if 'track_center_x' in s1 and 'track_center_x' in s0:
            d_center = math.hypot(s1['track_center_x'] - s0['track_center_x'], s1['track_center_y'] - s0['track_center_y'])
            max_d_center = max(max_d_center, d_center)
            # Check angle change between segments
            if i > 1:
                s_prev = samples[i-2]
                a_raw1 = math.atan2(s0['world_y'] - s_prev['world_y'], s0['world_x'] - s_prev['world_x'])
                a_raw2 = math.atan2(s1['world_y'] - s0['world_y'], s1['world_x'] - s0['world_x'])
                diff_raw = abs((a_raw2 - a_raw1 + math.pi) % (2*math.pi) - math.pi)
                jitter_raw = max(jitter_raw, diff_raw)

                a_c1 = math.atan2(s0['track_center_y'] - s_prev['track_center_y'], s0['track_center_x'] - s_prev['track_center_x'])
                a_c2 = math.atan2(s1['track_center_y'] - s0['track_center_y'], s1['track_center_x'] - s0['track_center_x'])
                diff_c = abs((a_c2 - a_c1 + math.pi) % (2*math.pi) - math.pi)
                if diff_c > 0.8: # large sudden angle change!
                    print(f"JITTER at sample {i}: diff_c={math.degrees(diff_c):.1f} deg, diff_raw={math.degrees(diff_raw):.1f} deg, plat={s1.get('path_lateral')}")
                jitter_center = max(jitter_center, diff_c)

    print(f"Max raw step: {max_d_raw:.2f}m, Max center step: {max_d_center:.2f}m")
    print(f"Max raw angular change: {math.degrees(jitter_raw):.1f} deg")
    print(f"Max center angular change: {math.degrees(jitter_center):.1f} deg")
