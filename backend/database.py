import sqlite3
import json
import os
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "telemetry.db"))

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            sim TEXT,
            session_type TEXT,
            track_name TEXT,
            track_internal_id TEXT,
            track_length REAL,
            car_name TEXT,
            car_internal_id TEXT,
            car_class TEXT,
            driver_name TEXT,
            best_lap_time REAL,
            total_laps INTEGER,
            air_temp REAL,
            track_temp REAL,
            weather TEXT,
            time_of_day TEXT,
            brake_bias REAL,
            abs_level INTEGER,
            tc_level INTEGER,
            tire_pressures_json TEXT,
            metadata_json TEXT,
            created_at TEXT
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS laps (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            lap_number INTEGER,
            lap_time REAL,
            sector1 REAL,
            sector2 REAL,
            sector3 REAL,
            is_valid INTEGER,
            is_pit_lap INTEGER,
            fuel_used REAL,
            tire_compound TEXT,
            sample_count INTEGER,
            max_speed INTEGER,
            max_rpm INTEGER,
            blob_url TEXT,
            local_blob_path TEXT,
            created_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS telemetry_cache (
            session_id TEXT,
            lap_number INTEGER,
            sample_count INTEGER,
            samples_json TEXT,
            PRIMARY KEY (session_id, lap_number),
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        )
        """)
        conn.commit()

def save_session(session_data: Dict[str, Any]):
    with get_db() as conn:
        cursor = conn.cursor()
        ext = session_data.get("extendedSummary") or {}
        cond = session_data.get("conditions") or {}
        meta = session_data.get("metadata") or {}

        cursor.execute("""
        INSERT OR REPLACE INTO sessions (
            id, user_id, sim, session_type, track_name, track_internal_id,
            track_length, car_name, car_internal_id, car_class, driver_name,
            best_lap_time, total_laps, air_temp, track_temp, weather, time_of_day,
            brake_bias, abs_level, tc_level, tire_pressures_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_data["id"],
            session_data.get("userId"),
            session_data.get("sim", "lmu"),
            session_data.get("sessionType", "race"),
            session_data.get("trackName", "Unknown Track"),
            session_data.get("trackInternalId"),
            session_data.get("trackLength", 0.0),
            session_data.get("carName", "Unknown Car"),
            session_data.get("carInternalId"),
            session_data.get("carClass", "GT3"),
            session_data.get("driverName", "Driver"),
            session_data.get("bestLapTime"),
            session_data.get("totalLaps", 0),
            cond.get("airTemp"),
            cond.get("trackTemp"),
            cond.get("weather", "Clear"),
            cond.get("timeOfDay", "12:00"),
            ext.get("brakeBias"),
            ext.get("absLevel"),
            ext.get("tcLevel"),
            json.dumps(ext.get("tirePressuresKpa", [])),
            json.dumps(meta),
            session_data.get("createdAt")
        ))
        conn.commit()

def save_lap(lap_data: Dict[str, Any], max_speed: int = 0, max_rpm: int = 0):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO laps (
            id, session_id, lap_number, lap_time, sector1, sector2, sector3,
            is_valid, is_pit_lap, fuel_used, tire_compound, sample_count,
            max_speed, max_rpm, blob_url, local_blob_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            lap_data.get("id"),
            lap_data["sessionId"],
            lap_data["lapNumber"],
            lap_data["lapTime"],
            lap_data.get("sector1"),
            lap_data.get("sector2"),
            lap_data.get("sector3"),
            1 if lap_data.get("isValid", True) else 0,
            1 if lap_data.get("isPitLap", False) else 0,
            lap_data.get("fuelUsed"),
            lap_data.get("tireCompound", "Medium"),
            lap_data.get("sampleCount", 0),
            max_speed,
            max_rpm,
            lap_data.get("blobUrl"),
            lap_data.get("local_blob_path"),
            lap_data.get("createdAt")
        ))
        conn.commit()

def save_telemetry_cache(session_id: str, lap_number: int, samples: List[Dict[str, Any]]):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO telemetry_cache (
            session_id, lap_number, sample_count, samples_json
        ) VALUES (?, ?, ?, ?)
        """, (
            session_id,
            lap_number,
            len(samples),
            json.dumps(samples)
        ))
        conn.commit()

def get_telemetry_cache(session_id: str, lap_number: int) -> Optional[List[Dict[str, Any]]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT samples_json FROM telemetry_cache WHERE session_id = ? AND lap_number = ?", (session_id, lap_number))
        row = cursor.fetchone()
        if row:
            return json.loads(row["samples_json"])
    return None

def get_all_sessions() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sessions ORDER BY created_at DESC")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["tire_pressures"] = json.loads(d["tire_pressures_json"]) if d.get("tire_pressures_json") else []
            d["metadata"] = json.loads(d["metadata_json"]) if d.get("metadata_json") else {}
            # Count laps
            cursor.execute("SELECT COUNT(*) as cnt FROM laps WHERE session_id = ?", (d["id"],))
            d["laps_recorded"] = cursor.fetchone()["cnt"]
            result.append(d)
        return result

def get_session_by_id(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            return None
        session = dict(row)
        session["tire_pressures"] = json.loads(session["tire_pressures_json"]) if session.get("tire_pressures_json") else []
        session["metadata"] = json.loads(session["metadata_json"]) if session.get("metadata_json") else {}

        # Fetch laps
        cursor.execute("SELECT * FROM laps WHERE session_id = ? ORDER BY lap_number ASC", (session_id,))
        lap_rows = cursor.fetchall()
        session["laps"] = [dict(l) for l in lap_rows]
        return session
