import sqlite3
import json
import math

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute("SELECT samples_json FROM telemetry_cache WHERE session_id LIKE '%Ferrari%' AND lap_number = 3").fetchone()
samples = json.loads(row[0])

unique_pts = [samples[0]]
for s in samples[1:]:
    d = math.hypot(s['world_x'] - unique_pts[-1]['world_x'], s['world_y'] - unique_pts[-1]['world_y'])
    if d > 0.05:
        unique_pts.append(s)

cum_d = [0.0] * len(unique_pts)
for i in range(1, len(unique_pts)):
    d = math.hypot(unique_pts[i]['world_x'] - unique_pts[i-1]['world_x'], unique_pts[i]['world_y'] - unique_pts[i-1]['world_y'])
    cum_d[i] = cum_d[i-1] + d

tot_len = cum_d[-1]
step_m = 2.0
num_slices = int(tot_len // step_m)
resampled_x = []
resampled_z = []

curr_idx = 0
for step in range(num_slices):
    target_d = step * step_m
    while curr_idx < len(cum_d) - 1 and cum_d[curr_idx + 1] < target_d:
        curr_idx += 1
    i0 = curr_idx
    i1 = min(len(cum_d) - 1, i0 + 1)
    seg_len = cum_d[i1] - cum_d[i0]
    alpha = (target_d - cum_d[i0]) / seg_len if seg_len > 0.001 else 0.0
    rx = unique_pts[i0]['world_x'] + alpha * (unique_pts[i1]['world_x'] - unique_pts[i0]['world_x'])
    ry = unique_pts[i0]['world_y'] + alpha * (unique_pts[i1]['world_y'] - unique_pts[i0]['world_y'])
    resampled_x.append(rx)
    resampled_z.append(-ry)

smooth_x = [0.0]*len(resampled_x)
smooth_z = [0.0]*len(resampled_z)
w = 3
for i in range(len(resampled_x)):
    sx, sz, cnt = 0.0, 0.0, 0
    for k in range(-w, w + 1):
        idx = max(0, min(len(resampled_x) - 1, i + k))
        sx += resampled_x[idx]
        sz += resampled_z[idx]
        cnt += 1
    smooth_x[i] = sx / cnt
    smooth_z[i] = sz / cnt

# Curvature calculation with 16m lookahead/lookbehind (8 slices)
N = len(smooth_x)
curv = [0.0]*N
for i in range(N):
    ip = max(0, i - 8)
    inx = min(N - 1, i + 8)
    ds = (inx - ip) * step_m
    if ds > 1.0:
        dx1 = smooth_x[i] - smooth_x[ip]
        dz1 = smooth_z[i] - smooth_z[ip]
        dx2 = smooth_x[inx] - smooth_x[i]
        dz2 = smooth_z[inx] - smooth_z[i]
        a1 = math.atan2(dx1, dz1)
        a2 = math.atan2(dx2, dz2)
        diff = (a2 - a1) % (math.pi * 2)
        if diff > math.pi: diff -= math.pi * 2
        if diff < -math.pi: diff += math.pi * 2
        curv[i] = diff / ds

# Test Kerb placement
turnK = 0.004
left_kerb = [1 if c < -turnK else 0 for c in curv]
right_kerb = [1 if c > turnK else 0 for c in curv]
both = sum(1 for i in range(N) if left_kerb[i] and right_kerb[i])
print(f"Total slices: {N}")
print(f"Left kerb slices: {sum(left_kerb)} ({sum(left_kerb)*100/N:.1f}%)")
print(f"Right kerb slices: {sum(right_kerb)} ({sum(right_kerb)*100/N:.1f}%)")
print(f"Both simultaneously: {both} (Should be 0!)")
print(f"Straight (no kerb): {sum(1 for i in range(N) if not left_kerb[i] and not right_kerb[i])} slices ({sum(1 for i in range(N) if not left_kerb[i] and not right_kerb[i])*100/N:.1f}%)")
