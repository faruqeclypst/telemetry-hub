import os
import re
import urllib.request
import urllib.parse
import json
import logging
from typing import Dict, Any, Optional
from rxtm_parser import RXTMParser
from database import save_session, save_lap, save_telemetry_cache

logger = logging.getLogger("simtelemetry_client")

DATA_DIR = os.environ.get("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "storage"))
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_SESSION_TOKEN = "SZ55tfIEtXPmUgJ0kZpnEk4kfoRFPZsP.CdKFklmVBYh%2FtrHs0saQCnooXtbvsz83yvrlTmL37N4%3D"

def extract_session_id(input_str: str) -> str:
    """Extracts session ID from URL or bare ID string."""
    clean = input_str.strip()
    match = re.search(r"\/app\/([a-zA-Z0-9_-]+)", clean)
    if match:
        return match.group(1)
    return clean

def fetch_simtelemetry_session(session_id: str, session_token: Optional[str] = None) -> Dict[str, Any]:
    """Fetches session metadata from SimTelemetry tRPC API."""
    token = session_token or DEFAULT_SESSION_TOKEN
    cookie = f"__Secure-simtelemetry.session_token={token}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": cookie
    }
    encoded_input = urllib.parse.quote(json.dumps({"json": {"sessionId": session_id}}))
    url = f"https://simtelemetry.site/api/trpc/telemetry.getSession?input={encoded_input}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        session_data = res["result"]["data"]["json"]
        return session_data

def download_and_process_blob(blob_url: str, session_id: str, lap_number: int) -> Dict[str, Any]:
    """Downloads a raw .bin RXTM file from Vercel blob and parses it."""
    local_path = os.path.join(DATA_DIR, f"{session_id}_lap_{lap_number}.bin")
    
    # Download if not exists locally
    if not os.path.exists(local_path):
        req = urllib.request.Request(blob_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp:
            content = resp.read()
            with open(local_path, "wb") as f:
                f.write(content)
    else:
        with open(local_path, "rb") as f:
            content = f.read()

    parsed = RXTMParser.parse_binary(content)
    parsed["local_path"] = local_path
    return parsed

def import_full_session(session_input: str, session_token: Optional[str] = None) -> Dict[str, Any]:
    """Imports an entire session from SimTelemetry and saves it to local DB."""
    session_id = extract_session_id(session_input)
    session_data = fetch_simtelemetry_session(session_id, session_token)
    save_session(session_data)

    laps = session_data.get("laps", [])
    for lap in laps:
        blob_url = lap.get("blobUrl")
        lap_num = lap.get("lapNumber")
        max_speed = 0
        max_rpm = 0

        if blob_url:
            try:
                parsed = download_and_process_blob(blob_url, session_id, lap_num)
                max_speed = parsed.get("max_speed_kmh", 0)
                max_rpm = parsed.get("max_rpm", 0)
                lap["local_blob_path"] = parsed["local_path"]
                # Cache parsed telemetry samples
                save_telemetry_cache(session_id, lap_num, parsed["samples"])
            except Exception as e:
                logger.error(f"Error downloading blob for lap {lap_num}: {e}")

        save_lap(lap, max_speed=max_speed, max_rpm=max_rpm)

    return session_data
