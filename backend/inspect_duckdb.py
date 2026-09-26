import duckdb
import math

db_path = r"C:\Users\Admin\Downloads\Autodromo Enzo e Dino Ferrari_P_2026-09-25T09_01_47Z.duckdb"
con = duckdb.connect(db_path, read_only=True)

laps = con.execute("SELECT ts, value FROM Lap").fetchall()
t0 = 80.74
t2_start = laps[2][0] # 374.62
t2_end = laps[3][0]   # 491.24

i_start = int((t2_start - t0) * 10)
i_end = int((t2_end - t0) * 10)

gps_lats = [r[0] for r in con.execute('SELECT value FROM "GPS Latitude"').fetchall()]
gps_lons = [r[0] for r in con.execute('SELECT value FROM "GPS Longitude"').fetchall()]
path_lats = [r[0] for r in con.execute('SELECT value FROM "Path Lateral"').fetchall()]
track_edges = [r[0] for r in con.execute('SELECT value FROM "Track Edge"').fetchall()]

lat_center = sum(gps_lats) / len(gps_lats)
lon_center = sum(gps_lons) / len(gps_lons)
m_per_lat = 111320.0
m_per_lon = 111320.0 * math.cos(math.radians(60.0))

sub_lats = gps_lats[i_start:i_end]
sub_lons = gps_lons[i_start:i_end]
sub_plats = path_lats[i_start:i_end]
sub_tedges = track_edges[i_start:i_end]
n = len(sub_lats)

car_xs = [(sub_lons[i] - lon_center) * m_per_lon for i in range(n)]
car_zs = [-(sub_lats[i] - lat_center) * m_per_lat for i in range(n)]

headings = []
for i in range(n):
    ip = (i - 1 + n) % n
    inx = (i + 1) % n
    dx = car_xs[inx] - car_xs[ip]
    dz = car_zs[inx] - car_zs[ip]
    headings.append(math.atan2(dx, dz))

center_xs = []
center_zs = []
for i in range(n):
    h = headings[i]
    plat = sub_plats[i]
    # Right normal in (X, Z) is (cos(h), -sin(h))
    nr_x = math.cos(h)
    nr_z = -math.sin(h)
    cx = car_xs[i] - nr_x * plat
    cz = car_zs[i] - nr_z * plat
    center_xs.append(cx)
    center_zs.append(cz)

# Now check car distance from track center at peak kerb points:
for i in range(0, n, 100):
    car_dist_from_center = math.hypot(car_xs[i] - center_xs[i], car_zs[i] - center_zs[i])
    print(f"i={i}: plat={sub_plats[i]:.2f}m, dist={car_dist_from_center:.2f}m, edge={abs(sub_tedges[i]):.2f}m")
