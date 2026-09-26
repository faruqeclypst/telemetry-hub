import sqlite3
import json
import math

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute("SELECT samples_json FROM telemetry_cache WHERE session_id LIKE '%Ferrari%' AND lap_number = 3").fetchone()
samples = json.loads(row[0])
n = len(samples)

wx = [s['world_x'] for s in samples]
wy = [s['world_y'] for s in samples]
plat = [s.get('path_lateral', 0.0) or 0.0 for s in samples]

cum_d = [0.0]*n
for i in range(1, n):
    cum_d[i] = cum_d[i-1] + math.hypot(wx[i] - wx[i-1], wy[i] - wy[i-1])

cx = [0.0]*n
cy = [0.0]*n
for i in range(n):
    d_cur = cum_d[i]
    ip = i
    while ip > 0 and (d_cur - cum_d[ip]) < 10.0:
        ip -= 1
    inx = i
    while inx < n - 1 and (cum_d[inx] - d_cur) < 10.0:
        inx += 1
    dx = wx[inx] - wx[ip]
    dy = wy[inx] - wy[ip]
    dist = math.hypot(dx, dy)
    if dist > 0.1:
        tx = dx / dist
        ty = dy / dist
        nx = ty
        ny = -tx
        p = plat[i]
        cx[i] = wx[i] - p * nx
        cy[i] = wy[i] - p * ny
    else:
        cx[i] = wx[i]
        cy[i] = wy[i]

scx = [0.0]*n
scy = [0.0]*n
for i in range(n):
    d_cur = cum_d[i]
    sum_x, sum_y, cnt = 0.0, 0.0, 0
    k = i
    while k >= 0 and (d_cur - cum_d[k]) < 12.0:
        sum_x += cx[k]
        sum_y += cy[k]
        cnt += 1
        k -= 1
    k = i + 1
    while k < n and (cum_d[k] - d_cur) < 12.0:
        sum_x += cx[k]
        sum_y += cy[k]
        cnt += 1
        k += 1
    scx[i] = sum_x / cnt
    scy[i] = sum_y / cnt

for i in range(2, n):
    a1 = math.atan2(scy[i-1] - scy[i-2], scx[i-1] - scx[i-2])
    a2 = math.atan2(scy[i] - scy[i-1], scx[i] - scx[i-1])
    diff = abs((a2 - a1 + math.pi) % (2*math.pi) - math.pi)
    if diff > 0.3:
        step_len = math.hypot(scx[i] - scx[i-1], scy[i] - scy[i-1])
        raw_step = math.hypot(wx[i] - wx[i-1], wy[i] - wy[i-1])
        print(f"Angle jump at i={i}: diff={math.degrees(diff):.1f} deg, step_len={step_len:.4f}m, raw_step={raw_step:.4f}m, spd={samples[i]['speed']}, plat={plat[i]}")
