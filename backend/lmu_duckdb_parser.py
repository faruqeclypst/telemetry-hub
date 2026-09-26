import duckdb
import math
import json
import bisect
import os
import re
from typing import Dict, Any, List, Optional, Tuple
import logging

from database import save_session, save_lap, save_telemetry_cache

logger = logging.getLogger("telemetry_hub.lmu_parser")

# Fallback sample rates used only when a recording has no channelsList table.
# Every channel name below is also declared inside a normal LMU recording, and
# the declared rate wins whenever it is present.
DEFAULT_RATES = {
    "Ground Speed": 100,
    "Engine RPM": 100,
    "Steering Pos": 100,
    "Throttle Pos": 50,
    "Brake Pos": 50,
    "GPS Latitude": 10,
    "GPS Longitude": 10,
    "GPS Time": 10,
    "G Force Lat": 10,
    "G Force Long": 10,
    "Lap Dist": 10,
    "Total Dist": 10,
    "Track Edge": 10,
    "Path Lateral": 10,
    "TyresTempCentre": 100,
    "TyresPressure": 10,
}

# Rough LMU compound index to label. The channel is 0 on every recording seen
# so far, in which case the label stays unknown instead of guessing.
COMPOUND_LABELS = {
    0: "Unknown",
    1: "Soft",
    2: "Medium",
    3: "Hard",
    4: "Wet",
    5: "Intermediate",
}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")


class LMUDuckDBParser:
    @staticmethod
    def _declared_rates(con) -> Dict[str, float]:
        try:
            rows = con.execute("SELECT * FROM channelsList").fetchall()
        except Exception:
            return {}
        rates: Dict[str, float] = {}
        for row in rows:
            if len(row) >= 2 and row[0] and row[1]:
                try:
                    rates[row[0]] = float(row[1])
                except (TypeError, ValueError):
                    continue
        return rates

    @staticmethod
    def _read_column(con, table: str, column: str = "value") -> List[float]:
        try:
            return [r[0] for r in con.execute(f'SELECT "{column}" FROM "{table}"').fetchall()]
        except Exception:
            return []

    @staticmethod
    def _first_value(con, table: str, column: str = "value"):
        try:
            row = con.execute(f'SELECT "{column}" FROM "{table}" LIMIT 1').fetchone()
            return row[0] if row else None
        except Exception:
            return None

    @staticmethod
    def parse_and_import(db_path: str, custom_session_id: Optional[str] = None) -> Dict[str, Any]:
        if not os.path.exists(db_path):
            raise FileNotFoundError(f"File not found: {db_path}")

        con = duckdb.connect(db_path, read_only=True)
        try:
            # 1. Read Metadata
            meta_rows = dict(con.execute("SELECT key, value FROM metadata").fetchall())
            driver_name = meta_rows.get("DriverName", "Unknown Driver")
            car_name = meta_rows.get("CarName", "Unknown Car")
            track_name = meta_rows.get("TrackName", "Unknown Track")
            track_layout = meta_rows.get("TrackLayout", "")
            car_class = meta_rows.get("CarClass", "GT3")
            session_type = meta_rows.get("SessionType", "Practice").lower()
            weather = meta_rows.get("WeatherConditions", "Clear")
            time_of_day = meta_rows.get("SessionTime", "12:00:00")
            recording_time = meta_rows.get("RecordingTime", "")

            # Unique Session ID
            if custom_session_id:
                session_id = custom_session_id
            else:
                base_name = os.path.splitext(os.path.basename(db_path))[0]
                clean_id = base_name.replace(" ", "_").replace("-", "_").replace(":", "_")
                session_id = f"lmu_{clean_id}"

            # Setup data (Brake bias)
            setup_raw = meta_rows.get("CarSetup")
            setup = json.loads(setup_raw) if setup_raw else {}
            brake_bias_str = setup.get("VM_BRAKE_BALANCE", {}).get("stringValue", "")
            try:
                brake_bias = float(str(brake_bias_str).split(":")[0])
            except (ValueError, IndexError):
                brake_bias = None

            # Atmospheric conditions
            air_temp = None
            track_temp = None
            try:
                air_temp = float(con.execute('SELECT avg(value) FROM "Ambient Temperature"').fetchone()[0])
            except Exception:
                pass
            try:
                track_temp = float(con.execute('SELECT avg(value) FROM "Track Temperature"').fetchone()[0])
            except Exception:
                pass

            # 2. Channel sample rates, declared by the recording when available
            rates = {**DEFAULT_RATES, **LMUDuckDBParser._declared_rates(con)}

            def rate_of(name: str) -> float:
                return float(rates.get(name) or 10.0)

            # 3. Continuous channels
            speeds = LMUDuckDBParser._read_column(con, "Ground Speed")
            rpms = LMUDuckDBParser._read_column(con, "Engine RPM")
            steers = LMUDuckDBParser._read_column(con, "Steering Pos")
            throttles = LMUDuckDBParser._read_column(con, "Throttle Pos")
            brakes = LMUDuckDBParser._read_column(con, "Brake Pos")
            gps_lats = LMUDuckDBParser._read_column(con, "GPS Latitude")
            gps_lons = LMUDuckDBParser._read_column(con, "GPS Longitude")
            lat_gs = LMUDuckDBParser._read_column(con, "G Force Lat")
            lon_gs = LMUDuckDBParser._read_column(con, "G Force Long")
            path_lats = LMUDuckDBParser._read_column(con, "Path Lateral")
            track_edges = LMUDuckDBParser._read_column(con, "Track Edge")
            # TyresTempCentre and friends store four wheels in value1..value4.
            # The front-left (value1) is used as the single reported temperature.
            tire_temps = LMUDuckDBParser._read_column(con, "TyresTempCentre", "value1")
            # Lap Dist wraps to zero at the start line. Unwrap it once into a
            # monotonic series, otherwise interpolating across the wrap returns
            # the midpoint between the two sides (4896 and -1.4 average to 2939).
            lap_dist_raw = LMUDuckDBParser._read_column(con, "Lap Dist")
            lap_dist_vals: List[float] = []
            if lap_dist_raw:
                wrap_span = max(lap_dist_raw) + 50.0
                offset = 0.0
                lap_dist_vals.append(float(lap_dist_raw[0]))
                for i in range(1, len(lap_dist_raw)):
                    if lap_dist_raw[i] - lap_dist_raw[i - 1] < -wrap_span * 0.5:
                        offset += wrap_span
                    lap_dist_vals.append(float(lap_dist_raw[i]) + offset)
            use_lap_dist = len(lap_dist_vals) > 10

            if not speeds:
                raise ValueError("No Ground Speed channel found in the recording")
            if not gps_lats or not gps_lons:
                raise ValueError("No GPS position channel found in the recording")

            def sample_index(channel_len: int, name: str, rel_t: float) -> Tuple[int, int, float]:
                """Fractional index into a channel at time rel_t seconds."""
                hz = rate_of(name)
                f = max(0.0, min(channel_len - 1.001, rel_t * hz))
                i0 = int(f)
                i1 = min(channel_len - 1, i0 + 1)
                return i0, i1, f - i0

            def interp(channel: List[float], name: str, rel_t: float, fallback: float = 0.0) -> float:
                if not channel:
                    return fallback
                i0, i1, a = sample_index(len(channel), name, rel_t)
                return channel[i0] + a * (channel[i1] - channel[i0])

            # Gear channel. LMU emits a 0 transient on every shift, so keep only
            # the last real value and ignore the zeros.
            gear_rows = con.execute('SELECT ts, value FROM Gear ORDER BY ts ASC').fetchall()
            gear_ts: List[float] = []
            gear_vals: List[int] = []
            last_gear = 1
            for ts, val in gear_rows:
                if val and val > 0:
                    last_gear = int(val)
                gear_ts.append(ts)
                gear_vals.append(last_gear)

            def get_gear(t: float) -> int:
                idx = bisect.bisect_right(gear_ts, t) - 1
                if idx < 0:
                    return 1
                return gear_vals[idx]

            # Laps and sector events
            lap_events = con.execute("SELECT ts, value FROM Lap ORDER BY ts ASC").fetchall()
            lap_time_events = dict(con.execute('SELECT ts, value FROM "Lap Time"').fetchall())
            s1_events = dict(con.execute('SELECT ts, value FROM "Last Sector1"').fetchall())
            s2_events = dict(con.execute('SELECT ts, value FROM "Last Sector2"').fetchall())

            if not lap_events:
                raise ValueError("No lap events found in DuckDB file")

            t0 = float(lap_events[0][0])
            total_duration = len(speeds) / rate_of("Ground Speed")
            session_end_t = t0 + total_duration

            # Planar GPS projection. The longitude scale depends on the latitude
            # of the circuit, so it is computed from the recording itself. The
            # previous version assumed 60 degrees, which happens to fit Imola but
            # is off by roughly 40 percent at Monza.
            lat_center = sum(gps_lats) / len(gps_lats)
            lon_center = sum(gps_lons) / len(gps_lons)
            m_per_lat = 111320.0
            m_per_lon = 111320.0 * math.cos(math.radians(lat_center))

            # Track length from the recording, not from a hardcoded value. The
            # max of Lap Dist is the measured lap length for this circuit.
            lap_dist_max = 0.0
            try:
                lap_dist_max = float(con.execute('SELECT max(value) FROM "Lap Dist"').fetchone()[0] or 0.0)
            except Exception:
                pass
            if lap_dist_max < 100.0:
                # Lap Dist is missing or unusable; fall back to the odometer.
                try:
                    total_vals = LMUDuckDBParser._read_column(con, "Total Dist")
                    if len(total_vals) > 10:
                        lap_dist_max = max(total_vals) - min(total_vals)
                except Exception:
                    lap_dist_max = 0.0

            # Setup channels, read instead of assumed
            abs_level = LMUDuckDBParser._first_value(con, "ABSLevel")
            tc_level = LMUDuckDBParser._first_value(con, "TCLevel")
            tire_pressure_row = con.execute('SELECT * FROM "TyresPressure" LIMIT 1').fetchone()
            tire_pressures = (
                [round(float(v), 1) for v in tire_pressure_row if v is not None]
                if tire_pressure_row
                else []
            )
            compound_raw = LMUDuckDBParser._first_value(con, "TyresCompound", "value1")
            try:
                tire_compound = COMPOUND_LABELS.get(int(compound_raw), "Unknown")
            except (TypeError, ValueError):
                tire_compound = "Unknown"

            # 4. Process each lap. The circuit length is the measured maximum of
            # Lap Dist when present, and is the same for every lap so a corner
            # always lands on the same dist_pct.
            laps_payload = []
            best_lap_time = float("inf")
            measured_track_length = lap_dist_max

            num_laps = len(lap_events)
            for l_idx in range(num_laps):
                ts_start, lap_num = lap_events[l_idx]
                ts_end = lap_events[l_idx + 1][0] if l_idx + 1 < num_laps else session_end_t
                duration = ts_end - ts_start

                if duration < 15.0:
                    continue

                is_pit_lap = 1 if (l_idx == 0 or l_idx == num_laps - 1) else 0
                is_valid = 0 if is_pit_lap else 1

                lap_time = lap_time_events.get(ts_end, duration)
                if lap_time <= 0:
                    lap_time = duration

                s1 = s1_events.get(ts_end)
                s2 = s2_events.get(ts_end)
                s3 = None
                if s1 and s2 and lap_time > (s1 + s2):
                    s3 = round(lap_time - s1 - s2, 3)

                if is_valid and lap_time < best_lap_time:
                    best_lap_time = lap_time

                # Extract synchronized telemetry samples at 50 Hz.
                target_hz = 50
                num_samples = max(20, int(round(duration * target_hz)))
                dt = duration / (num_samples - 1)

                rel_start = ts_start - t0

                # Distance is taken from the recorded Lap Dist channel when it is
                # available, so the percentage is exact. Speed integration is the
                # fallback for recordings without that channel. Lap Dist wraps to
                # zero at the start line, so it is re-based on this lap's own
                # start and unwrapped before use.
                cum_dist = [0.0] * num_samples
                if use_lap_dist:
                    base = interp(lap_dist_vals, "Lap Dist", rel_start, 0.0)
                    raw = [0.0] * num_samples
                    for step in range(num_samples):
                        rel_t = rel_start + step * dt
                        raw[step] = interp(lap_dist_vals, "Lap Dist", rel_t, base)
                    total_lap = lap_dist_max if lap_dist_max > 100.0 else max(raw)
                    cum_dist[0] = max(0.0, raw[0] - base)
                    for step in range(1, num_samples):
                        delta = raw[step] - raw[step - 1]
                        if delta < -total_lap * 0.5:
                            delta += total_lap
                        cum_dist[step] = max(0.0, cum_dist[step - 1] + delta)
                else:
                    for step in range(1, num_samples):
                        rel_t_cur = rel_start + step * dt
                        idx_spd = sample_index(len(speeds), "Ground Speed", rel_t_cur)[0]
                        cum_dist[step] = cum_dist[step - 1] + (speeds[idx_spd] / 3.6) * dt

                # dist_pct must use one circuit length for every lap, otherwise
                # the same physical corner lands on a different percentage and
                # the per-corner delta stops lining up. The recorded circuit
                # length is the shared denominator when Lap Dist is available.
                if use_lap_dist and lap_dist_max > 100.0:
                    tot_dist = lap_dist_max
                else:
                    tot_dist = cum_dist[-1] if cum_dist[-1] > 10.0 else (measured_track_length or 1.0)
                # A flying lap slightly overshoots the line, so the circuit
                # length is the maximum recorded Lap Dist, not the last sample.
                measured_track_length = max(measured_track_length, min(cum_dist[-1], tot_dist) if use_lap_dist else cum_dist[-1])

                raw_wx = []
                raw_wy = []
                raw_plat = []
                raw_tedge = []
                for step in range(num_samples):
                    rel_t = rel_start + step * dt

                    lat_interp = interp(gps_lats, "GPS Latitude", rel_t, lat_center)
                    lon_interp = interp(gps_lons, "GPS Longitude", rel_t, lon_center)
                    raw_wx.append((lon_interp - lon_center) * m_per_lon)
                    raw_wy.append((lat_interp - lat_center) * m_per_lat)
                    raw_plat.append(interp(path_lats, "Path Lateral", rel_t, 0.0) if path_lats else 0.0)
                    raw_tedge.append(
                        abs(interp(track_edges, "Track Edge", rel_t, 6.0)) if track_edges else 6.0
                    )

                # Smooth tangent headings for accurate lateral perpendiculars
                headings = []
                for step in range(num_samples):
                    ip = max(0, step - 8)
                    inx = min(num_samples - 1, step + 8)
                    dx = raw_wx[inx] - raw_wx[ip]
                    dy = raw_wy[inx] - raw_wy[ip]
                    mag = math.hypot(dx, dy)
                    headings.append(math.atan2(dy, dx) if mag > 1e-4 else (headings[-1] if headings else 0.0))

                # Smooth headings across a circular window to eliminate GPS discretization noise
                smooth_h = [0.0] * num_samples
                for step in range(num_samples):
                    sum_sin = 0.0
                    sum_cos = 0.0
                    cnt = 0
                    for k in range(-5, 6):
                        idx = (step + k) % num_samples
                        sum_sin += math.sin(headings[idx])
                        sum_cos += math.cos(headings[idx])
                        cnt += 1
                    smooth_h[step] = math.atan2(sum_sin / cnt, sum_cos / cnt)

                # Compute true in-game track centerline and physical track width
                track_cx = []
                track_cy = []
                track_w = []
                has_plat = any(abs(p) > 1e-3 for p in raw_plat) if raw_plat else False

                for step in range(num_samples):
                    if has_plat:
                        h = smooth_h[step]
                        # Right normal vector: tangent (cos h, sin h) turned 90 deg clockwise is (sin h, -cos h)
                        rx = math.sin(h)
                        ry = -math.cos(h)
                        plat = raw_plat[step]
                        cx = raw_wx[step] - rx * plat
                        cy = raw_wy[step] - ry * plat
                        tedge = abs(raw_tedge[step]) if raw_tedge else 6.0
                        half_w = max(5.0, min(14.0, abs(plat) + tedge))
                        track_cx.append(round(cx, 2))
                        track_cy.append(round(cy, 2))
                        track_w.append(round(half_w * 2.0, 2))
                    else:
                        track_cx.append(round(raw_wx[step], 2))
                        track_cy.append(round(raw_wy[step], 2))
                        track_w.append(12.0)

                samples = []
                max_spd = 0
                max_rpm_val = 0

                for step in range(num_samples):
                    t = ts_start + step * dt
                    rel_t = rel_start + step * dt

                    cur_spd = round(interp(speeds, "Ground Speed", rel_t), 1)
                    cur_rpm = int(round(interp(rpms, "Engine RPM", rel_t)))
                    if cur_spd > max_spd:
                        max_spd = cur_spd
                    if cur_rpm > max_rpm_val:
                        max_rpm_val = cur_rpm

                    lat_g_interp = interp(lat_gs, "G Force Lat", rel_t)
                    lon_g_interp = interp(lon_gs, "G Force Long", rel_t)
                    # TyresTempCentre is a 100 Hz channel. Indexing it with a 10 Hz
                    # index (the previous behaviour) read only the first tenth of
                    # the lap and froze the value after that.
                    ttemp_interp = interp(tire_temps, "TyresTempCentre", rel_t, 25.0)

                    dist_pct = min(1.0, max(0.0, cum_dist[step] / tot_dist))

                    samples.append({
                        "time": round(t, 3),
                        "dist_pct": round(dist_pct, 4),
                        "lap": lap_num,
                        "speed": cur_spd,
                        "gear": get_gear(t),
                        "rpm": cur_rpm,
                        "throttle": round(interp(throttles, "Throttle Pos", rel_t), 1),
                        "brake": round(interp(brakes, "Brake Pos", rel_t), 1),
                        "steering": round(interp(steers, "Steering Pos", rel_t), 1),
                        "world_x": round(raw_wx[step], 2),
                        "world_y": round(raw_wy[step], 2),
                        "track_center_x": track_cx[step],
                        "track_center_y": track_cy[step],
                        "track_width": track_w[step],
                        "track_heading": round(smooth_h[step], 4),
                        "path_lateral": round(raw_plat[step], 2),
                        "track_edge": round(raw_tedge[step], 2),
                        "lat_g": round(lat_g_interp, 2),
                        "lon_g": round(lon_g_interp, 2),
                        "tire_temp": round(ttemp_interp, 1)
                    })

                lap_id = f"{session_id}_lap_{lap_num}"
                lap_info = {
                    "id": lap_id,
                    "sessionId": session_id,
                    "lapNumber": lap_num,
                    "lapTime": round(lap_time, 3),
                    "sector1": round(s1, 3) if s1 else None,
                    "sector2": round(s2, 3) if s2 else None,
                    "sector3": round(s3, 3) if s3 else None,
                    "isValid": bool(is_valid),
                    "isPitLap": bool(is_pit_lap),
                    "fuelUsed": None,
                    "tireCompound": tire_compound,
                    "sampleCount": len(samples),
                    "local_blob_path": db_path,
                    "createdAt": recording_time
                }
                laps_payload.append(lap_info)

                save_lap(lap_info, max_speed=int(max_spd), max_rpm=int(max_rpm_val))
                save_telemetry_cache(session_id, lap_num, samples)
                logger.info(f"Saved Lap {lap_num} ({lap_time:.2f}s, {len(samples)} samples)")

            # Save full session
            session_payload = {
                "id": session_id,
                "userId": "lmu_user",
                "sim": "lmu",
                "sessionType": session_type,
                "trackName": track_name,
                "trackInternalId": _slug(track_layout or track_name),
                "trackLength": round(measured_track_length, 1) if measured_track_length > 0 else None,
                "carName": car_name,
                "carInternalId": _slug(car_name),
                "carClass": car_class,
                "driverName": driver_name,
                "bestLapTime": round(best_lap_time, 3) if best_lap_time < 999 else None,
                "totalLaps": len(laps_payload),
                "conditions": {
                    "airTemp": round(air_temp, 1) if air_temp is not None else None,
                    "trackTemp": round(track_temp, 1) if track_temp is not None else None,
                    "weather": weather,
                    "timeOfDay": time_of_day
                },
                "extendedSummary": {
                    "brakeBias": brake_bias,
                    "absLevel": int(abs_level) if abs_level is not None else None,
                    "tcLevel": int(tc_level) if tc_level is not None else None,
                    "tirePressuresKpa": tire_pressures
                },
                "metadata": {
                    "trackLayout": track_layout,
                    "recordingTime": recording_time,
                    "sourceFile": os.path.basename(db_path)
                },
                "createdAt": recording_time
            }

            save_session(session_payload)
            logger.info(f"Successfully imported LMU session: {session_id}")

            return {
                "success": True,
                "session_id": session_id,
                "track_name": track_name,
                "car_name": car_name,
                "driver_name": driver_name,
                "track_length": round(measured_track_length, 1) if measured_track_length > 0 else None,
                "total_laps": len(laps_payload),
                "best_lap_time": round(best_lap_time, 3) if best_lap_time < 999 else None
            }
        finally:
            con.close()
