import sqlite3
import json
import math

conn = sqlite3.connect('telemetry.db')
c = conn.cursor()
row = c.execute(
    "SELECT samples_json FROM telemetry_cache WHERE session_id LIKE 'lmu%' AND lap_number=3"
).fetchone()

if not row:
    raise SystemExit("No cached LMU lap 3. Import the session first.")

samples = json.loads(row[0])
print("Sample 300:", samples[300])

plats = [x['path_lateral'] for x in samples]
print(f"Lap 3 path_lateral min: {min(plats)}m, max: {max(plats)}m")

# The centreline is car position walked back along its right vector by
# path_lateral, so the car-to-centre offset must equal |path_lateral|.
offsets = []
for x in samples:
    h = x['heading'] if 'heading' in x else None
    offsets.append(abs(x['path_lateral']))

print(f"Lap 3 car-to-center offset min: {min(offsets):.2f}m, max: {max(offsets):.2f}m")

edges = [abs(x.get('track_edge') or 6.0) for x in samples]
print(f"Lap 3 track edge min: {min(edges):.2f}m, max: {max(edges):.2f}m")

off_track = sum(1 for p, e in zip(plats, edges) if abs(p) > e)
print(f"Samples beyond the track edge: {off_track} ({off_track / len(samples) * 100:.1f}%)")
