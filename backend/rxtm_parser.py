import struct
import json
from typing import List, Dict, Any, Tuple, Optional

RXTM_MAGIC = 0x4D545852  # 'RXTM' in little-endian

class RXTMParser:
    """Parser and processor for SimTelemetry binary files (format RXTM)."""

    @staticmethod
    def parse_binary(data: bytes) -> Dict[str, Any]:
        """Parses raw bytes of an RXTM file and returns header metadata and sample points."""
        if len(data) < 16:
            raise ValueError("Data too short to contain RXTM header")

        magic, version, flags, sample_rate, sample_count = struct.unpack_from("<IHHI I", data, 0)
        if magic != RXTM_MAGIC:
            raise ValueError(f"Invalid magic: expected {hex(RXTM_MAGIC)} ('RXTM'), got {hex(magic)}")

        samples: List[Dict[str, Any]] = []
        max_speed = 0
        max_rpm = 0
        max_lat_g = 0.0
        max_lon_g = 0.0

        for i in range(sample_count):
            offset = 16 + (i * 50)
            if offset + 50 > len(data):
                break

            (
                s_time, trk_pct, lap, replay_frame,
                thr_raw, brk_raw, clu_raw, steer_raw, gear,
                spd_kmh, rpm, fuel_dl,
                world_x, world_y,
                lat_g_raw, lon_g_raw,
                tire_temp_avg, flags_raw
            ) = struct.unpack_from("<ffHI BBB b b HH H ff b b B B", data, offset)

            thr_pct = round((thr_raw / 255.0) * 100.0, 1)
            brk_pct = round((brk_raw / 255.0) * 100.0, 1)
            lat_g = round(lat_g_raw / 10.0, 2)
            lon_g = round(lon_g_raw / 10.0, 2)

            if spd_kmh > max_speed:
                max_speed = spd_kmh
            if rpm > max_rpm:
                max_rpm = rpm
            if abs(lat_g) > max_lat_g:
                max_lat_g = abs(lat_g)
            if abs(lon_g) > max_lon_g:
                max_lon_g = abs(lon_g)

            samples.append({
                "time": round(s_time, 3),
                "dist_pct": round(trk_pct, 5),
                "lap": lap,
                "speed": spd_kmh,
                "gear": gear,
                "rpm": rpm,
                "throttle": thr_pct,
                "brake": brk_pct,
                "steering": steer_raw,
                "world_x": round(world_x, 2),
                "world_y": round(world_y, 2),
                "lat_g": lat_g,
                "lon_g": lon_g,
                "tire_temp": tire_temp_avg
            })

        return {
            "version": version,
            "flags": flags,
            "sample_rate_hz": sample_rate,
            "sample_count": len(samples),
            "max_speed_kmh": max_speed,
            "max_rpm": max_rpm,
            "max_lat_g": max_lat_g,
            "max_lon_g": max_lon_g,
            "samples": samples
        }

    @staticmethod
    def calculate_delta(
        ref_samples: List[Dict[str, Any]], 
        comp_samples: List[Dict[str, Any]],
        num_points: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Synchronizes two laps over normalized distance (dist_pct 0.0 to 1.0)
        and computes delta time (comp_time - ref_time) in seconds.
        Negative delta = comp is faster; Positive delta = comp is slower.
        """
        if not ref_samples or not comp_samples:
            return []

        # Sort samples by dist_pct
        ref_sorted = sorted([s for s in ref_samples if 0.0 <= s.get("dist_pct", 0) <= 1.05], key=lambda x: x["dist_pct"])
        comp_sorted = sorted([s for s in comp_samples if 0.0 <= s.get("dist_pct", 0) <= 1.05], key=lambda x: x["dist_pct"])

        if not ref_sorted or not comp_sorted:
            return []

        ref_start_time = ref_sorted[0]["time"]
        comp_start_time = comp_sorted[0]["time"]

        # Helper to interpolate a sample at target dist_pct
        def interpolate_at_pct(samples: List[Dict[str, Any]], target_pct: float, start_time: float) -> Tuple[float, Dict[str, Any]]:
            # Binary search or linear scan
            idx = 0
            while idx < len(samples) - 1 and samples[idx + 1]["dist_pct"] < target_pct:
                idx += 1

            if idx >= len(samples) - 1:
                s = samples[-1]
                return s["time"] - start_time, s

            s0 = samples[idx]
            s1 = samples[idx + 1]
            p0 = s0["dist_pct"]
            p1 = s1["dist_pct"]

            if p1 == p0:
                t = 0.0
            else:
                t = (target_pct - p0) / (p1 - p0)

            interp_time = (s0["time"] + t * (s1["time"] - s0["time"])) - start_time
            interp_sample = {
                "dist_pct": round(target_pct, 4),
                "speed": round(s0["speed"] + t * (s1["speed"] - s0["speed"]), 1),
                "gear": s1["gear"] if t > 0.5 else s0["gear"],
                "rpm": int(s0["rpm"] + t * (s1["rpm"] - s0["rpm"])),
                "throttle": round(s0["throttle"] + t * (s1["throttle"] - s0["throttle"]), 1),
                "brake": round(s0["brake"] + t * (s1["brake"] - s0["brake"]), 1),
                "steering": int(s0["steering"] + t * (s1["steering"] - s0["steering"])),
                "world_x": round(s0["world_x"] + t * (s1["world_x"] - s0["world_x"]), 2),
                "world_y": round(s0["world_y"] + t * (s1["world_y"] - s0["world_y"]), 2),
                "lat_g": round(s0["lat_g"] + t * (s1["lat_g"] - s0["lat_g"]), 2),
                "lon_g": round(s0["lon_g"] + t * (s1["lon_g"] - s0["lon_g"]), 2),
            }
            return interp_time, interp_sample

        result = []
        prev_delta = 0.0
        for i in range(num_points + 1):
            pct = i / float(num_points)
            t_ref, s_ref = interpolate_at_pct(ref_sorted, pct, ref_start_time)
            t_comp, s_comp = interpolate_at_pct(comp_sorted, pct, comp_start_time)

            # delta_s = t_ref - t_comp: negative means ref/active lap is faster than comparison lap
            delta_s = round(t_ref - t_comp, 3)
            diff = round(delta_s - prev_delta, 3) if i > 0 else 0.0
            prev_delta = delta_s

            if diff < -0.015:
                status = "gain"
            elif diff > 0.015:
                status = "loss"
            else:
                status = "neutral"

            result.append({
                "dist_pct": round(pct, 4),
                "delta": delta_s,
                "diff": diff,
                "status": status,
                "ref": s_ref,
                "comp": s_comp
            })

        return result


