from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import io
import csv
import os
import logging
from typing import Optional, List, Dict, Any

from database import (
    init_db, get_all_sessions, get_session_by_id, 
    get_telemetry_cache, save_telemetry_cache, save_session, save_lap
)
from rxtm_parser import RXTMParser
from corner_detector import detect_corners
from simtelemetry_client import import_full_session, extract_session_id

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("telemetry_hub")

app = FastAPI(title="TelemetryHub Pro", description="Sim Racing Telemetry & Analysis System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()
    sessions = get_all_sessions()
    if not sessions:
        logger.info("Initializing database with default session 2BaXHUMzT9lHtox0...")
        try:
            import_full_session("2BaXHUMzT9lHtox0")
            logger.info("Default session successfully seeded.")
        except Exception as e:
            logger.error(f"Failed to seed default session: {e}")

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "TelemetryHub Pro API"}

@app.get("/api/sessions")
def list_sessions():
    return {"sessions": get_all_sessions()}

@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    sess = get_session_by_id(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess

@app.get("/api/sessions/{session_id}/laps/{lap_num}/telemetry")
def get_lap_telemetry(session_id: str, lap_num: int, lod: Optional[int] = Query(None, description="Level of detail / downsampling target points")):
    samples = get_telemetry_cache(session_id, lap_num)
    if not samples:
        # Check if lap exists in database and if local blob is available
        sess = get_session_by_id(session_id)
        if not sess:
            raise HTTPException(status_code=404, detail="Session not found")
        target_lap = next((l for l in sess.get("laps", []) if l["lap_number"] == lap_num), None)
        if not target_lap:
            raise HTTPException(status_code=404, detail="Lap not found")

        local_path = target_lap.get("local_blob_path")
        if local_path and os.path.exists(local_path):
            with open(local_path, "rb") as f:
                parsed = RXTMParser.parse_binary(f.read())
                samples = parsed["samples"]
                save_telemetry_cache(session_id, lap_num, samples)
        else:
            raise HTTPException(status_code=404, detail="Telemetry data not available for this lap")

    total_samples = len(samples)
    if lod and lod > 0 and total_samples > lod:
        step = max(1, total_samples // lod)
        downsampled = samples[::step]
        # Always ensure last point is included
        if downsampled[-1] != samples[-1]:
            downsampled.append(samples[-1])
        return {
            "session_id": session_id,
            "lap_number": lap_num,
            "total_samples": total_samples,
            "returned_samples": len(downsampled),
            "samples": downsampled
        }

    return {
        "session_id": session_id,
        "lap_number": lap_num,
        "total_samples": total_samples,
        "returned_samples": total_samples,
        "samples": samples
    }

@app.get("/api/sessions/{session_id}/telemetry")
def get_session_telemetry(
    session_id: str,
    lod: Optional[int] = Query(None, description="Target points per lap"),
    from_lap: Optional[int] = Query(None, description="First lap number (inclusive)"),
    to_lap: Optional[int] = Query(None, description="Last lap number (inclusive)")
):
    """All laps of a session concatenated in lap order on one continuous timeline.

    Each sample keeps the lap metadata the replay needs to switch laps without
    rebuilding the track. Only completed, non-pit laps are included so the
    timeline does not contain the partial out lap.
    """
    sess = get_session_by_id(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    laps = sess.get("laps", [])
    if from_lap is not None:
        laps = [l for l in laps if l["lap_number"] >= from_lap]
    if to_lap is not None:
        laps = [l for l in laps if l["lap_number"] <= to_lap]
    laps = sorted([l for l in laps if l.get("is_valid") and not l.get("is_pit_lap")], key=lambda l: l["lap_number"])

    if not laps:
        raise HTTPException(status_code=404, detail="No valid flying laps in this session")

    merged = []
    lap_marks = []
    offset = 0.0
    for lap in laps:
        samples = get_telemetry_cache(session_id, lap["lap_number"])
        if not samples:
            local_path = lap.get("local_blob_path")
            if local_path and os.path.exists(local_path):
                with open(local_path, "rb") as f:
                    samples = RXTMParser.parse_binary(f.read())["samples"]
                    save_telemetry_cache(session_id, lap["lap_number"], samples)
        if not samples:
            continue

        if lod and lod > 0 and len(samples) > lod:
            step = max(1, len(samples) // lod)
            samples = samples[::step]

        t0 = samples[0]["time"]
        for s in samples:
            point = dict(s)
            point["lap_number"] = lap["lap_number"]
            point["lap_time"] = lap.get("lap_time")
            point["session_time"] = s["time"] + offset - t0
            merged.append(point)

        lap_dur = (samples[-1]["time"] - t0) if len(samples) > 1 else 0.0
        lap_marks.append({
            "lap_number": lap["lap_number"],
            "start_time": offset,
            "end_time": offset + lap_dur,
            "lap_time": lap.get("lap_time")
        })
        offset += lap_dur

    return {
        "session_id": session_id,
        "lap_count": len(lap_marks),
        "total_samples": len(merged),
        "total_duration": offset,
        "laps": lap_marks,
        "samples": merged
    }


@app.get("/api/sessions/{session_id}/laps/{lap_num}/corners")
def get_lap_corners(
    session_id: str,
    lap_num: int,
    lap_comp: Optional[int] = Query(None, description="Comparison lap number for per-corner delta"),
    track_name: Optional[str] = Query(None, description="Circuit name override for official corner mapping"),
):
    sess = get_session_by_id(session_id)
    circuit_name = track_name or (sess.get("track_name") if sess else "")

    samples = get_telemetry_cache(session_id, lap_num)
    if not samples:
        if not sess:
            raise HTTPException(status_code=404, detail="Session not found")
        target_lap = next((l for l in sess.get("laps", []) if l["lap_number"] == lap_num), None)
        if not target_lap:
            raise HTTPException(status_code=404, detail="Lap not found")
        local_path = target_lap.get("local_blob_path")
        if local_path and os.path.exists(local_path):
            with open(local_path, "rb") as f:
                parsed = RXTMParser.parse_binary(f.read())
                samples = parsed["samples"]
                save_telemetry_cache(session_id, lap_num, samples)
        else:
            raise HTTPException(status_code=404, detail="Telemetry data not available for this lap")

    comp_samples = get_telemetry_cache(session_id, lap_comp) if lap_comp else None
    corners = detect_corners(samples, compare_samples=comp_samples, track_name=circuit_name)

    return {
        "session_id": session_id,
        "lap_number": lap_num,
        "lap_comp": lap_comp,
        "track_name": circuit_name,
        "corner_count": len(corners),
        "corners": corners,
    }


@app.get("/api/sessions/{session_id}/compare")
def compare_laps(
    session_id: str, 
    lap_ref: int = Query(2, description="Reference lap number (typically best lap)"), 
    lap_comp: int = Query(1, description="Comparison lap number"),
    points: int = Query(1000, description="Interpolated points count")
):
    ref_samples = get_telemetry_cache(session_id, lap_ref)
    comp_samples = get_telemetry_cache(session_id, lap_comp)

    if not ref_samples or not comp_samples:
        raise HTTPException(status_code=400, detail="Telemetry data missing for one or both laps")

    comparison = RXTMParser.calculate_delta(ref_samples, comp_samples, num_points=points)
    
    max_gain_pt = None
    max_loss_pt = None
    if comparison:
        # Most negative diff is biggest single gain
        sorted_by_gain = sorted(comparison, key=lambda x: x.get("diff", 0))
        if sorted_by_gain and sorted_by_gain[0].get("diff", 0) < -0.01:
            max_gain_pt = {
                "dist_pct": sorted_by_gain[0]["dist_pct"],
                "diff": sorted_by_gain[0]["diff"],
                "delta": sorted_by_gain[0]["delta"],
                "world_x": sorted_by_gain[0]["ref"]["world_x"],
                "world_y": sorted_by_gain[0]["ref"]["world_y"],
                "speed": sorted_by_gain[0]["ref"]["speed"]
            }
        # Most positive diff is biggest single loss
        if sorted_by_gain and sorted_by_gain[-1].get("diff", 0) > 0.01:
            max_loss_pt = {
                "dist_pct": sorted_by_gain[-1]["dist_pct"],
                "diff": sorted_by_gain[-1]["diff"],
                "delta": sorted_by_gain[-1]["delta"],
                "world_x": sorted_by_gain[-1]["ref"]["world_x"],
                "world_y": sorted_by_gain[-1]["ref"]["world_y"],
                "speed": sorted_by_gain[-1]["ref"]["speed"]
            }

    return {
        "session_id": session_id,
        "lap_ref": lap_ref,
        "lap_comp": lap_comp,
        "points_count": len(comparison),
        "total_delta": comparison[-1]["delta"] if comparison else 0.0,
        "max_gain": max_gain_pt,
        "max_loss": max_loss_pt,
        "comparison": comparison
    }


@app.post("/api/sessions/import")
def import_session(payload: Dict[str, Any]):
    url_or_id = payload.get("url_or_id")
    session_token = payload.get("session_token")
    if not url_or_id:
        raise HTTPException(status_code=400, detail="url_or_id is required")

    try:
        session_id = extract_session_id(url_or_id)
        imported = import_full_session(session_id, session_token)
        return {
            "success": True, 
            "message": f"Session {session_id} successfully imported",
            "session_id": session_id,
            "car_name": imported.get("carName"),
            "track_name": imported.get("trackName")
        }
    except Exception as e:
        logger.error(f"Import failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to import session: {str(e)}")

@app.post("/api/sessions/import-duckdb")
def import_duckdb_session(payload: Dict[str, Any]):
    file_path = payload.get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is required")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        from lmu_duckdb_parser import LMUDuckDBParser
        res = LMUDuckDBParser.parse_and_import(file_path)
        return res
    except Exception as e:
        logger.error(f"Failed to parse duckdb file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/upload-duckdb")
async def upload_duckdb_session(file: UploadFile = File(...)):
    if not file.filename.endswith(".duckdb"):
        raise HTTPException(status_code=400, detail="Only .duckdb files are supported")

    import shutil
    storage_dir = os.environ.get("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "storage"))
    upload_dir = os.path.join(storage_dir, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    temp_path = os.path.join(upload_dir, file.filename)

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        from lmu_duckdb_parser import LMUDuckDBParser
        res = LMUDuckDBParser.parse_and_import(temp_path)
        return res
    except Exception as e:
        logger.error(f"Failed to parse uploaded duckdb file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sessions/{session_id}/laps/{lap_num}/export/csv")
def export_lap_csv(session_id: str, lap_num: int):
    samples = get_telemetry_cache(session_id, lap_num)
    if not samples:
        raise HTTPException(status_code=404, detail="Telemetry not found")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "time", "dist_pct", "speed", "gear", "rpm", "throttle", 
        "brake", "steering", "world_x", "world_y", "lat_g", "lon_g"
    ])
    writer.writeheader()
    for s in samples:
        writer.writerow({
            "time": s.get("time"),
            "dist_pct": s.get("dist_pct"),
            "speed": s.get("speed"),
            "gear": s.get("gear"),
            "rpm": s.get("rpm"),
            "throttle": s.get("throttle"),
            "brake": s.get("brake"),
            "steering": s.get("steering"),
            "world_x": s.get("world_x"),
            "world_y": s.get("world_y"),
            "lat_g": s.get("lat_g"),
            "lon_g": s.get("lon_g")
        })

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={session_id}_lap_{lap_num}.csv"}
    )

# Static file serving for Frontend SPA when built
FRONTEND_DIST = os.environ.get(
    "FRONTEND_DIST",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
)

if os.path.isdir(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path in ("api", "docs", "redoc", "openapi.json"):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_html = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_html):
            return FileResponse(index_html)
        raise HTTPException(status_code=404, detail="Frontend index.html not found")

if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    reload = os.environ.get("RELOAD", "false").lower() in ("true", "1")
    uvicorn.run("main:app", host=host, port=port, reload=reload)
