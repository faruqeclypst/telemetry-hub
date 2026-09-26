import sqlite3
import json

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
import math

c.execute("SELECT samples_json FROM telemetry_cache WHERE session_id='2BaXHUMzT9lHtox0' AND lap_number=2")
row = c.fetchone()
if row:
    samples = json.loads(row[0])
    n = len(samples)
    curvatures = []
    for i in range(n):
        p0 = samples[(i - 6 + n) % n]
        p1 = samples[i]
        p2 = samples[(i + 6) % n]
        dx1, dy1 = p1['world_x'] - p0['world_x'], p1['world_y'] - p0['world_y']
        dx2, dy2 = p2['world_x'] - p1['world_x'], p2['world_y'] - p1['world_y']
        a1 = math.atan2(dx1, -dy1)
        a2 = math.atan2(dx2, -dy2)
        diff = (a2 - a1) % (math.pi * 2)
        if diff > math.pi: diff -= math.pi * 2
        curvatures.append(diff)

    left_turns = sum(1 for k in curvatures if k < -0.035)
    right_turns = sum(1 for k in curvatures if k > 0.035)
    straights = sum(1 for k in curvatures if abs(k) <= 0.035)
    print(f"Total: {n} | Left Turns (Apex Left): {left_turns} | Right Turns (Apex Right): {right_turns} | Straights/Banking: {straights}")


