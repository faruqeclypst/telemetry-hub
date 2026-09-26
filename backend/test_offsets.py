import sqlite3
import json
import math

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute("SELECT samples_json FROM telemetry_cache WHERE session_id LIKE '%Ferrari%' AND lap_number = 3").fetchone()
samples = json.loads(row[0])

# Smooth track from raw samples
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

# Smooth with 20m window (10 slices)
smooth_x = [0.0]*len(resampled_x)
smooth_z = [0.0]*len(resampled_z)
w = 8
for i in range(len(resampled_x)):
    sx, sz, cnt = 0.0, 0.0, 0
    for k in range(-w, w + 1):
        idx = max(0, min(len(resampled_x) - 1, i + k))
        sx += resampled_x[idx]
        sz += resampled_z[idx]
        cnt += 1
    smooth_x[i] = sx / cnt
    smooth_z[i] = sz / cnt

# Measure distance of car from smoothed road centerline
offsets = []
for s in samples:
    wx = s['world_x']
    wz = -s['world_y']
    # find closest slice
    min_d = float('inf')
    for i in range(0, len(smooth_x), 5):
        d = math.hypot(wx - smooth_x[i], wz - smooth_z[i])
        if d < min_d: min_d = d
    offsets.append(min_d)

print(f"Car deviation from smoothed track centerline: min={min(offsets):.2f}m, max={max(offsets):.2f}m, avg={sum(offsets)/len(offsets):.2f}m")
