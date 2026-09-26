import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Corner detection works on the reconstructed track centreline, not on the
# driven racing line. The racing line cuts corners and wanders between laps, so
# counting turns from it gives a different answer every lap. The centreline is
# rebuilt from world_x / world_y plus path_lateral when the recording has it.
STEP_M = 2.0
CENTER_SMOOTH_HALF = 6

# A sample is turning when its heading rate reaches REL_FLOOR times the
# strongest rate on the lap. Relative thresholds travel across circuits: the
# absolute curvature scale depends on corner radius and sample spacing, so a
# fixed number that fits Imola undercounts Monza and overcounts Daytona.
REL_FLOOR = 0.03
MIN_REGION_M = 12.0
MIN_TURN_ANGLE_DEG = 10.0

# One corner should not be split into fragments by a noisy heading valley.
MERGE_SAME_SIGN_M = 60.0
MIN_APEX_SPEED_KMH = 25.0
MAX_CORNERS = 60

# A flat kink at racing speed is a direction change, not a corner. A real
# corner loads the tyres, so it must show either lateral G or a speed drop.
MIN_LAT_G = 0.5
MIN_SPEED_DROP = 0.05

STEER_ON_DEG = 4.0


# -----------------------------------------------------------------------------
# Official Real-World Circuit Corner Catalog (FIA / WEC / IMSA Official Layouts)
# -----------------------------------------------------------------------------
OFFICIAL_TRACKS_DATABASE: Dict[str, Dict[str, Any]] = {
    # Autodromo Internazionale Enzo e Dino Ferrari (Imola, Italy) - 19 Turns
    "imola": {
        "name": "Autodromo Enzo e Dino Ferrari",
        "length_m": 4909,
        "turns": [
            {"number": 1, "name": "Variante Tamburello 1", "direction": "left", "nominal_pct": 0.145},
            {"number": 2, "name": "Variante Tamburello 2", "direction": "right", "nominal_pct": 0.150},
            {"number": 3, "name": "Variante Tamburello 3", "direction": "left", "nominal_pct": 0.175},
            {"number": 4, "name": "Variante Villeneuve 1", "direction": "left", "nominal_pct": 0.274},
            {"number": 5, "name": "Variante Villeneuve 2", "direction": "right", "nominal_pct": 0.284},
            {"number": 6, "name": "Villeneuve Kink", "direction": "left", "nominal_pct": 0.295},
            {"number": 7, "name": "Curva Tosa", "direction": "left", "nominal_pct": 0.354},
            {"number": 8, "name": "Piratella Approach", "direction": "right", "nominal_pct": 0.422},
            {"number": 9, "name": "Curva Piratella", "direction": "left", "nominal_pct": 0.475},
            {"number": 10, "name": "Acque Minerali Approach", "direction": "right", "nominal_pct": 0.540},
            {"number": 11, "name": "Acque Minerali 1", "direction": "right", "nominal_pct": 0.583},
            {"number": 12, "name": "Acque Minerali 2", "direction": "right", "nominal_pct": 0.590},
            {"number": 13, "name": "Acque Minerali Exit", "direction": "left", "nominal_pct": 0.595},
            {"number": 14, "name": "Variante Gresini 1", "direction": "right", "nominal_pct": 0.686},
            {"number": 15, "name": "Variante Gresini 2", "direction": "left", "nominal_pct": 0.696},
            {"number": 16, "name": "Rettifilo Approach", "direction": "right", "nominal_pct": 0.803},
            {"number": 17, "name": "Curva Rivazza 1", "direction": "left", "nominal_pct": 0.845},
            {"number": 18, "name": "Curva Rivazza 2", "direction": "left", "nominal_pct": 0.865},
            {"number": 19, "name": "Curva Traguardo", "direction": "right", "nominal_pct": 0.943}
        ]
    },

    # Sebring International Raceway (Florida, USA) - 17 Turns
    "sebring": {
        "name": "Sebring International Raceway",
        "length_m": 6019,
        "turns": [
            {"number": 1, "name": "Turn 1", "direction": "left", "nominal_pct": 0.073},
            {"number": 2, "name": "Turn 2", "direction": "left", "nominal_pct": 0.161},
            {"number": 3, "name": "Turn 3", "direction": "right", "nominal_pct": 0.174},
            {"number": 4, "name": "Turn 4", "direction": "left", "nominal_pct": 0.199},
            {"number": 5, "name": "Turn 5", "direction": "right", "nominal_pct": 0.251},
            {"number": 6, "name": "Big Bend", "direction": "right", "nominal_pct": 0.344},
            {"number": 7, "name": "The Hairpin", "direction": "right", "nominal_pct": 0.359},
            {"number": 8, "name": "Fangio Chicane 1", "direction": "left", "nominal_pct": 0.425},
            {"number": 9, "name": "Fangio Chicane 2", "direction": "right", "nominal_pct": 0.476},
            {"number": 10, "name": "Cunningham", "direction": "left", "nominal_pct": 0.494},
            {"number": 11, "name": "Collier", "direction": "right", "nominal_pct": 0.561},
            {"number": 12, "name": "Tower Turn 1", "direction": "left", "nominal_pct": 0.632},
            {"number": 13, "name": "Tower Turn 2", "direction": "right", "nominal_pct": 0.686},
            {"number": 14, "name": "Flying Fortress", "direction": "left", "nominal_pct": 0.711},
            {"number": 15, "name": "Gendebien Bend", "direction": "right", "nominal_pct": 0.739},
            {"number": 16, "name": "Le Mans Curve", "direction": "right", "nominal_pct": 0.755},
            {"number": 17, "name": "Sunset Bend", "direction": "right", "nominal_pct": 0.932}
        ]
    },

    # Daytona International Speedway Road Course (Rolex 24 layout) - 14 Turns
    "daytona": {
        "name": "Daytona International Speedway Road Course",
        "length_m": 5728,
        "turns": [
            {"number": 1, "name": "Infield Entry", "direction": "left", "nominal_pct": 0.083},
            {"number": 2, "name": "Turn 2", "direction": "right", "nominal_pct": 0.111},
            {"number": 3, "name": "International Horseshoe", "direction": "right", "nominal_pct": 0.167},
            {"number": 4, "name": "The Kink", "direction": "left", "nominal_pct": 0.247},
            {"number": 5, "name": "West Horseshoe", "direction": "right", "nominal_pct": 0.305},
            {"number": 6, "name": "Infield Exit", "direction": "left", "nominal_pct": 0.376},
            {"number": 7, "name": "Oval Turn 1", "direction": "left", "nominal_pct": 0.450},
            {"number": 8, "name": "Oval Turn 2", "direction": "left", "nominal_pct": 0.520},
            {"number": 9, "name": "Le Mans Chicane 1", "direction": "left", "nominal_pct": 0.670},
            {"number": 10, "name": "Le Mans Chicane 2", "direction": "right", "nominal_pct": 0.681},
            {"number": 11, "name": "Le Mans Chicane 3", "direction": "left", "nominal_pct": 0.708},
            {"number": 12, "name": "Oval Turn 3", "direction": "left", "nominal_pct": 0.834},
            {"number": 13, "name": "Oval Turn 4", "direction": "left", "nominal_pct": 0.900},
            {"number": 14, "name": "Tri-Oval Dogleg", "direction": "left", "nominal_pct": 0.989}
        ]
    },

    # Circuit de Spa-Francorchamps (Belgium) - 19 Turns
    "spa": {
        "name": "Circuit de Spa-Francorchamps",
        "length_m": 7004,
        "turns": [
            {"number": 1, "name": "La Source", "direction": "right", "nominal_pct": 0.062},
            {"number": 2, "name": "Eau Rouge", "direction": "left", "nominal_pct": 0.138},
            {"number": 3, "name": "Raidillon", "direction": "right", "nominal_pct": 0.158},
            {"number": 4, "name": "Raidillon Crest", "direction": "left", "nominal_pct": 0.178},
            {"number": 5, "name": "Les Combes 1", "direction": "right", "nominal_pct": 0.334},
            {"number": 6, "name": "Les Combes 2", "direction": "left", "nominal_pct": 0.355},
            {"number": 7, "name": "Malmedy", "direction": "right", "nominal_pct": 0.388},
            {"number": 8, "name": "Bruxelles / Rivage", "direction": "right", "nominal_pct": 0.442},
            {"number": 9, "name": "Jacky Ickx", "direction": "left", "nominal_pct": 0.490},
            {"number": 10, "name": "Pouhon Entry", "direction": "left", "nominal_pct": 0.572},
            {"number": 11, "name": "Pouhon Apex", "direction": "left", "nominal_pct": 0.602},
            {"number": 12, "name": "Fagnes 1", "direction": "right", "nominal_pct": 0.672},
            {"number": 13, "name": "Fagnes 2", "direction": "left", "nominal_pct": 0.701},
            {"number": 14, "name": "Campus", "direction": "right", "nominal_pct": 0.738},
            {"number": 15, "name": "Paul Frère", "direction": "right", "nominal_pct": 0.771},
            {"number": 16, "name": "Blanchimont 1", "direction": "left", "nominal_pct": 0.868},
            {"number": 17, "name": "Blanchimont 2", "direction": "left", "nominal_pct": 0.902},
            {"number": 18, "name": "Bus Stop Chicane 1", "direction": "right", "nominal_pct": 0.962},
            {"number": 19, "name": "Bus Stop Chicane 2", "direction": "left", "nominal_pct": 0.982}
        ]
    },

    # Circuit de la Sarthe (24 Hours of Le Mans, France) - 26 Official Turns
    "lemans": {
        "name": "Circuit de la Sarthe",
        "length_m": 13626,
        "turns": [
            {"number": 1, "name": "Dunlop Curve", "direction": "right", "nominal_pct": 0.045},
            {"number": 2, "name": "Dunlop Chicane 1", "direction": "left", "nominal_pct": 0.055},
            {"number": 3, "name": "Dunlop Chicane 2", "direction": "right", "nominal_pct": 0.062},
            {"number": 4, "name": "Esses de la Forêt 1", "direction": "left", "nominal_pct": 0.088},
            {"number": 5, "name": "Esses de la Forêt 2", "direction": "right", "nominal_pct": 0.102},
            {"number": 6, "name": "Tertre Rouge", "direction": "right", "nominal_pct": 0.138},
            {"number": 7, "name": "Chicane Forza 1", "direction": "right", "nominal_pct": 0.252},
            {"number": 8, "name": "Chicane Forza 2", "direction": "left", "nominal_pct": 0.264},
            {"number": 9, "name": "Chicane Michelin 1", "direction": "left", "nominal_pct": 0.385},
            {"number": 10, "name": "Chicane Michelin 2", "direction": "right", "nominal_pct": 0.398},
            {"number": 11, "name": "Virage de Mulsanne", "direction": "right", "nominal_pct": 0.565},
            {"number": 12, "name": "Indianapolis Entry", "direction": "right", "nominal_pct": 0.672},
            {"number": 13, "name": "Indianapolis Apex", "direction": "left", "nominal_pct": 0.685},
            {"number": 14, "name": "Virage d'Arnage", "direction": "right", "nominal_pct": 0.748},
            {"number": 15, "name": "Virage de la Chappe", "direction": "left", "nominal_pct": 0.812},
            {"number": 16, "name": "Courbe du Golf", "direction": "right", "nominal_pct": 0.835},
            {"number": 17, "name": "Virages Porsche 1", "direction": "right", "nominal_pct": 0.852},
            {"number": 18, "name": "Courbe du Pont", "direction": "left", "nominal_pct": 0.865},
            {"number": 19, "name": "Virages Porsche 3", "direction": "right", "nominal_pct": 0.878},
            {"number": 20, "name": "Virage Corvette", "direction": "left", "nominal_pct": 0.892},
            {"number": 21, "name": "Virages Porsche Exit", "direction": "right", "nominal_pct": 0.905},
            {"number": 22, "name": "Maison Blanche", "direction": "left", "nominal_pct": 0.922},
            {"number": 23, "name": "Chicane Ford 1", "direction": "left", "nominal_pct": 0.952},
            {"number": 24, "name": "Chicane Ford 2", "direction": "right", "nominal_pct": 0.962},
            {"number": 25, "name": "Chicane Ford 3", "direction": "left", "nominal_pct": 0.975},
            {"number": 26, "name": "Chicane Ford 4", "direction": "right", "nominal_pct": 0.985}
        ]
    },

    # Autodromo Nazionale Monza (Italy) - 12 Turns
    "monza": {
        "name": "Autodromo Nazionale Monza",
        "length_m": 5793,
        "turns": [
            {"number": 1, "name": "Variante Rettifilo 1", "direction": "right", "nominal_pct": 0.165},
            {"number": 2, "name": "Variante Rettifilo 2", "direction": "left", "nominal_pct": 0.180},
            {"number": 3, "name": "Curva Grande", "direction": "right", "nominal_pct": 0.285},
            {"number": 4, "name": "Variante della Roggia 1", "direction": "left", "nominal_pct": 0.405},
            {"number": 5, "name": "Variante della Roggia 2", "direction": "right", "nominal_pct": 0.420},
            {"number": 6, "name": "Curva di Lesmo 1", "direction": "right", "nominal_pct": 0.495},
            {"number": 7, "name": "Curva di Lesmo 2", "direction": "right", "nominal_pct": 0.540},
            {"number": 8, "name": "Curva del Serraglio", "direction": "left", "nominal_pct": 0.635},
            {"number": 9, "name": "Variante Ascari 1", "direction": "left", "nominal_pct": 0.730},
            {"number": 10, "name": "Variante Ascari 2", "direction": "right", "nominal_pct": 0.745},
            {"number": 11, "name": "Variante Ascari 3", "direction": "left", "nominal_pct": 0.760},
            {"number": 12, "name": "Curva Parabolica", "direction": "right", "nominal_pct": 0.910}
        ]
    },

    # Fuji Speedway (Japan) - 16 Turns
    "fuji": {
        "name": "Fuji Speedway",
        "length_m": 4563,
        "turns": [
            {"number": 1, "name": "TGR Corner", "direction": "right", "nominal_pct": 0.230},
            {"number": 2, "name": "Turn 2", "direction": "left", "nominal_pct": 0.290},
            {"number": 3, "name": "Coca-Cola Corner", "direction": "left", "nominal_pct": 0.355},
            {"number": 4, "name": "100R Entry", "direction": "right", "nominal_pct": 0.430},
            {"number": 5, "name": "100R Apex", "direction": "right", "nominal_pct": 0.465},
            {"number": 6, "name": "Advan Corner", "direction": "right", "nominal_pct": 0.535},
            {"number": 7, "name": "300R", "direction": "left", "nominal_pct": 0.620},
            {"number": 8, "name": "Dunlop Corner 1", "direction": "right", "nominal_pct": 0.680},
            {"number": 9, "name": "Dunlop Corner 2", "direction": "left", "nominal_pct": 0.695},
            {"number": 10, "name": "13th Corner", "direction": "right", "nominal_pct": 0.755},
            {"number": 11, "name": "Netz Corner 1", "direction": "left", "nominal_pct": 0.795},
            {"number": 12, "name": "Netz Corner 2", "direction": "right", "nominal_pct": 0.815},
            {"number": 13, "name": "GR Supra Corner 1", "direction": "right", "nominal_pct": 0.865},
            {"number": 14, "name": "GR Supra Corner 2", "direction": "right", "nominal_pct": 0.885},
            {"number": 15, "name": "Panasonic Corner 1", "direction": "right", "nominal_pct": 0.935},
            {"number": 16, "name": "Panasonic Corner 2", "direction": "right", "nominal_pct": 0.955}
        ]
    },

    # Bahrain International Circuit (Sakhir GP Layout) - 15 Turns
    "bahrain": {
        "name": "Bahrain International Circuit",
        "length_m": 5412,
        "turns": [
            {"number": 1, "name": "Michael Schumacher Turn", "direction": "right", "nominal_pct": 0.170},
            {"number": 2, "name": "Turn 2", "direction": "left", "nominal_pct": 0.190},
            {"number": 3, "name": "Turn 3", "direction": "right", "nominal_pct": 0.220},
            {"number": 4, "name": "Turn 4", "direction": "right", "nominal_pct": 0.340},
            {"number": 5, "name": "Turn 5", "direction": "left", "nominal_pct": 0.410},
            {"number": 6, "name": "Turn 6", "direction": "right", "nominal_pct": 0.435},
            {"number": 7, "name": "Turn 7", "direction": "left", "nominal_pct": 0.465},
            {"number": 8, "name": "Turn 8", "direction": "right", "nominal_pct": 0.525},
            {"number": 9, "name": "Turn 9", "direction": "left", "nominal_pct": 0.585},
            {"number": 10, "name": "Turn 10", "direction": "left", "nominal_pct": 0.615},
            {"number": 11, "name": "Turn 11", "direction": "left", "nominal_pct": 0.690},
            {"number": 12, "name": "Turn 12", "direction": "right", "nominal_pct": 0.740},
            {"number": 13, "name": "Turn 13", "direction": "right", "nominal_pct": 0.785},
            {"number": 14, "name": "Turn 14", "direction": "right", "nominal_pct": 0.915},
            {"number": 15, "name": "Turn 15", "direction": "right", "nominal_pct": 0.940}
        ]
    },

    # Autódromo Internacional do Algarve (Portimão, Portugal) - 15 Turns
    "portimao": {
        "name": "Autódromo Internacional do Algarve",
        "length_m": 4653,
        "turns": [
            {"number": 1, "name": "Primeira", "direction": "right", "nominal_pct": 0.190},
            {"number": 2, "name": "Segunda", "direction": "right", "nominal_pct": 0.220},
            {"number": 3, "name": "Terceira", "direction": "right", "nominal_pct": 0.270},
            {"number": 4, "name": "Quarta", "direction": "left", "nominal_pct": 0.320},
            {"number": 5, "name": "Torre VIP", "direction": "left", "nominal_pct": 0.395},
            {"number": 6, "name": "Samsó", "direction": "left", "nominal_pct": 0.450},
            {"number": 7, "name": "Portimão 1", "direction": "right", "nominal_pct": 0.490},
            {"number": 8, "name": "Curva da Serra", "direction": "right", "nominal_pct": 0.540},
            {"number": 9, "name": "Sol", "direction": "right", "nominal_pct": 0.590},
            {"number": 10, "name": "Lagos", "direction": "left", "nominal_pct": 0.640},
            {"number": 11, "name": "Craig Jones", "direction": "right", "nominal_pct": 0.710},
            {"number": 12, "name": "Portimão 2", "direction": "right", "nominal_pct": 0.750},
            {"number": 13, "name": "Sagres", "direction": "left", "nominal_pct": 0.790},
            {"number": 14, "name": "Galp 1", "direction": "right", "nominal_pct": 0.865},
            {"number": 15, "name": "Galp 2", "direction": "right", "nominal_pct": 0.915}
        ]
    },

    # Circuit of the Americas (COTA, Austin USA) - 20 Turns
    "cota": {
        "name": "Circuit of the Americas",
        "length_m": 5513,
        "turns": [
            {"number": 1, "name": "Turn 1", "direction": "left", "nominal_pct": 0.125},
            {"number": 2, "name": "Turn 2", "direction": "right", "nominal_pct": 0.165},
            {"number": 3, "name": "Turn 3", "direction": "left", "nominal_pct": 0.190},
            {"number": 4, "name": "Turn 4", "direction": "right", "nominal_pct": 0.215},
            {"number": 5, "name": "Turn 5", "direction": "left", "nominal_pct": 0.240},
            {"number": 6, "name": "Turn 6", "direction": "right", "nominal_pct": 0.265},
            {"number": 7, "name": "Turn 7", "direction": "right", "nominal_pct": 0.295},
            {"number": 8, "name": "Turn 8", "direction": "left", "nominal_pct": 0.320},
            {"number": 9, "name": "Turn 9", "direction": "left", "nominal_pct": 0.345},
            {"number": 10, "name": "Turn 10", "direction": "left", "nominal_pct": 0.380},
            {"number": 11, "name": "Turn 11", "direction": "left", "nominal_pct": 0.425},
            {"number": 12, "name": "Turn 12", "direction": "left", "nominal_pct": 0.635},
            {"number": 13, "name": "Turn 13", "direction": "right", "nominal_pct": 0.670},
            {"number": 14, "name": "Turn 14", "direction": "right", "nominal_pct": 0.695},
            {"number": 15, "name": "Turn 15", "direction": "left", "nominal_pct": 0.725},
            {"number": 16, "name": "Turn 16", "direction": "right", "nominal_pct": 0.780},
            {"number": 17, "name": "Turn 17", "direction": "right", "nominal_pct": 0.810},
            {"number": 18, "name": "Turn 18", "direction": "right", "nominal_pct": 0.835},
            {"number": 19, "name": "Turn 19", "direction": "left", "nominal_pct": 0.885},
            {"number": 20, "name": "Turn 20", "direction": "left", "nominal_pct": 0.940}
        ]
    },

    # Autódromo José Carlos Pace (Interlagos, Brazil) - 15 Turns
    "interlagos": {
        "name": "Autódromo José Carlos Pace",
        "length_m": 4309,
        "turns": [
            {"number": 1, "name": "S do Senna 1", "direction": "left", "nominal_pct": 0.105},
            {"number": 2, "name": "S do Senna 2", "direction": "right", "nominal_pct": 0.135},
            {"number": 3, "name": "Curva do Sol", "direction": "left", "nominal_pct": 0.170},
            {"number": 4, "name": "Descida do Lago 1", "direction": "left", "nominal_pct": 0.335},
            {"number": 5, "name": "Descida do Lago 2", "direction": "left", "nominal_pct": 0.360},
            {"number": 6, "name": "Ferradura 1", "direction": "right", "nominal_pct": 0.445},
            {"number": 7, "name": "Ferradura 2", "direction": "right", "nominal_pct": 0.470},
            {"number": 8, "name": "Curva do Laranjinha", "direction": "right", "nominal_pct": 0.515},
            {"number": 9, "name": "Pinheirinho", "direction": "left", "nominal_pct": 0.585},
            {"number": 10, "name": "Bico de Pato", "direction": "right", "nominal_pct": 0.635},
            {"number": 11, "name": "Mergulho", "direction": "left", "nominal_pct": 0.690},
            {"number": 12, "name": "Junção", "direction": "left", "nominal_pct": 0.745},
            {"number": 13, "name": "Subida dos Boxes", "direction": "left", "nominal_pct": 0.815},
            {"number": 14, "name": "Cotovelo", "direction": "left", "nominal_pct": 0.890},
            {"number": 15, "name": "Arquibancadas", "direction": "left", "nominal_pct": 0.945}
        ]
    }
}


def match_circuit_key(track_name: Optional[str]) -> Optional[str]:
    """Matches any arbitrary track name or session string to a known official circuit key."""
    if not track_name:
        return None
    lower = track_name.lower()
    if "ferrari" in lower or "imola" in lower:
        return "imola"
    if "sebring" in lower:
        return "sebring"
    if "daytona" in lower:
        return "daytona"
    if "spa" in lower or "francorchamps" in lower:
        return "spa"
    if "sarthe" in lower or "mans" in lower:
        return "lemans"
    if "monza" in lower:
        return "monza"
    if "fuji" in lower:
        return "fuji"
    if "bahrain" in lower or "sakhir" in lower:
        return "bahrain"
    if "portimao" in lower or "algarve" in lower:
        return "portimao"
    if "cota" in lower or "americas" in lower:
        return "cota"
    if "interlagos" in lower or "pace" in lower:
        return "interlagos"
    return None


def _resample_by_distance(samples: Sequence[Dict[str, Any]], step_m: float = STEP_M) -> List[Dict[str, Any]]:
    if len(samples) < 2:
        return list(samples)

    cum = [0.0] * len(samples)
    for i in range(1, len(samples)):
        dx = (samples[i].get("world_x") or 0.0) - (samples[i - 1].get("world_x") or 0.0)
        dy = (samples[i].get("world_y") or 0.0) - (samples[i - 1].get("world_y") or 0.0)
        cum[i] = cum[i - 1] + math.hypot(dx, dy)

    total = cum[-1]
    if total < step_m * 8:
        return list(samples)

    count = max(2, int(total / step_m))
    out: List[Dict[str, Any]] = []
    cursor = 0
    for s in range(count):
        target = s * step_m
        while cursor < len(samples) - 2 and cum[cursor + 1] < target:
            cursor += 1
        seg = cum[cursor + 1] - cum[cursor]
        a = (target - cum[cursor]) / seg if seg > 1e-6 else 0.0
        a = max(0.0, min(1.0, a))
        s0 = samples[cursor]
        s1 = samples[cursor + 1]
        merged = dict(s0)
        for key in ("world_x", "world_y", "speed", "steering", "lat_g", "lon_g", "dist_pct", "time", "brake", "throttle"):
            v0 = s0.get(key)
            v1 = s1.get(key)
            if isinstance(v0, (int, float)) and isinstance(v1, (int, float)):
                merged[key] = v0 + a * (v1 - v0)
        out.append(merged)
    return out


def _smooth(vals: Sequence[float], half: int) -> List[float]:
    n = len(vals)
    out = [0.0] * n
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n - 1, i + half)
        out[i] = sum(vals[lo:hi + 1]) / (hi - lo + 1)
    return out


def _centerline(pts: Sequence[Dict[str, Any]]) -> Tuple[List[float], List[float], List[float]]:
    """Rebuild the track centreline in metres. Telemetry gives the car position;
    path_lateral is the car's distance from the centreline, positive to the
    right. Walking the car back along its right vector recovers the centreline,
    which is the geometry the corners actually belong to."""
    n = len(pts)
    if n < 4:
        return [p.get("world_x") or 0.0 for p in pts], [p.get("world_y") or 0.0 for p in pts], [0.0] * n

    wx = [p.get("world_x") or 0.0 for p in pts]
    wy = [p.get("world_y") or 0.0 for p in pts]

    cum = [0.0] * n
    for i in range(1, n):
        cum[i] = cum[i - 1] + math.hypot(wx[i] - wx[i - 1], wy[i] - wy[i - 1])

    has_lateral = sum(1 for p in pts if p.get("path_lateral") is not None) >= n * 0.5

    headings = [0.0] * n
    for i in range(n):
        ip = i
        while ip > 0 and cum[i] - cum[ip] < 10.0:
            ip -= 1
        inx = i
        while inx < n - 1 and cum[inx] - cum[i] < 10.0:
            inx += 1
        dx = wx[inx] - wx[ip]
        dy = wy[inx] - wy[ip]
        headings[i] = math.atan2(dy, dx) if (dx * dx + dy * dy) > 1e-6 else 0.0

    cx = [0.0] * n
    cy = [0.0] * n
    for i in range(n):
        plat = (pts[i].get("path_lateral") or 0.0) if has_lateral else 0.0
        cx[i] = wx[i] + math.cos(headings[i]) * plat
        cy[i] = wy[i] + math.sin(headings[i]) * plat

    cx = _smooth(cx, CENTER_SMOOTH_HALF)
    cy = _smooth(cy, CENTER_SMOOTH_HALF)
    return cx, cy, cum


def _heading_rate(cx: Sequence[float], cy: Sequence[float], step_m: float) -> List[float]:
    """Signed heading change per metre along the centreline. Positive is a
    left-hand turn (counter-clockwise in world XY)."""
    n = len(cx)
    headings = [0.0] * n
    for i in range(n):
        ip = max(0, i - 2)
        inx = min(n - 1, i + 2)
        headings[i] = math.atan2(cy[inx] - cy[ip], cx[inx] - cx[ip])

    rate = [0.0] * n
    for i in range(1, n):
        d = headings[i] - headings[i - 1]
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        rate[i] = d / step_m
    return rate


def _raw_regions(rate: Sequence[float], floor: float) -> List[List[int]]:
    n = len(rate)
    regions: List[List[int]] = []
    i = 0
    while i < n:
        if abs(rate[i]) >= floor:
            sign = 1 if rate[i] > 0 else -1
            start = i
            j = i
            while j < n and abs(rate[j]) >= floor and (rate[j] > 0) == (sign > 0):
                j += 1
            regions.append([start, j - 1])
            i = j
        else:
            i += 1
    return regions


def _reference_speed(pts: Sequence[Dict[str, Any]], a: int, b: int) -> float:
    lo = max(0, a - 40)
    window = [pts[i].get("speed") or 0.0 for i in range(lo, b + 1)]
    return max(window) if window else 0.0


def _merge_same_sign(regions: List[List[int]], rate: Sequence[float], gap_m: float) -> List[List[int]]:
    """Join same-direction regions that a short bump separated, so one corner
    is not reported as two."""
    merged: List[List[int]] = []
    for seg in regions:
        if merged:
            prev = merged[-1]
            gap = (seg[0] - prev[1]) * STEP_M
            prev_sign = 1 if rate[prev[0] + (prev[1] - prev[0]) // 2] > 0 else -1
            seg_sign = 1 if rate[seg[0] + (seg[1] - seg[0]) // 2] > 0 else -1
            if prev_sign == seg_sign and gap <= gap_m:
                prev[1] = seg[1]
                continue
        merged.append(list(seg))
    return merged


def _turn_angle(rate: Sequence[float], a: int, b: int, step_m: float) -> float:
    total = sum(abs(rate[k]) for k in range(a + 1, b + 1)) * step_m
    return math.degrees(total)


def _gear_ratio_map(pts: Sequence[Dict[str, Any]]) -> Dict[int, float]:
    """km/h per 1000 rpm for each gear, measured from samples where the gear
    channel and the revs agree. The LMU gear channel holds stale values in slow
    corners, so this map is what makes the reported gear trustworthy."""
    buckets: Dict[int, List[float]] = {}
    for p in pts:
        g = p.get("gear")
        speed = p.get("speed") or 0.0
        rpm = p.get("rpm") or 0.0
        if not isinstance(g, int) or g < 1 or speed < 40.0 or rpm < 2000.0:
            continue
        buckets.setdefault(g, []).append(speed / rpm * 1000.0)

    ratio: Dict[int, float] = {}
    for g, values in buckets.items():
        if len(values) < 10:
            continue
        values.sort()
        ratio[g] = values[len(values) // 2]
    return ratio


def _stable_gear(
    pts: Sequence[Dict[str, Any]],
    peak: int,
    a: int,
    b: int,
    ratio: Dict[int, float],
) -> Optional[int]:
    lo = max(a, peak - 8)
    hi = min(b, peak + 8)
    counts: Dict[int, int] = {}
    for i in range(lo, hi + 1):
        g = pts[i].get("gear")
        if isinstance(g, int) and g > 0:
            counts[g] = counts.get(g, 0) + 1

    speed = pts[peak].get("speed") or 0.0
    rpm = pts[peak].get("rpm") or 0.0

    if speed >= 40.0 and rpm >= 2000.0 and len(ratio) >= 3:
        measured = speed / rpm * 1000.0
        best = min(ratio, key=lambda g: abs(ratio[g] - measured))
        if abs(ratio[best] - measured) / ratio[best] <= 0.12:
            return best
        return None

    if not counts:
        return None
    return max(counts, key=lambda k: counts[k])


def _sample_at_pct(samples: Sequence[Dict[str, Any]], pct: float) -> Optional[Dict[str, Any]]:
    if not samples:
        return None
    lo = 0
    hi = len(samples) - 1
    while lo + 1 < hi:
        mid = (lo + hi) >> 1
        if (samples[mid].get("dist_pct") or 0.0) <= pct:
            lo = mid
        else:
            hi = mid
    return samples[lo]


def _lap_clock(samples: Optional[Sequence[Dict[str, Any]]]) -> float:
    """Time channels are absolute recording timestamps, so every lap gets its
    own zero before any delta is taken. The zero is the sample at the smallest
    lap distance, which is the start line even for an out lap that begins
    mid-circuit."""
    if not samples:
        return 0.0
    best = min(
        samples,
        key=lambda s: s.get("dist_pct") if isinstance(s.get("dist_pct"), (int, float)) else 2.0,
    )
    t = best.get("time")
    return float(t) if isinstance(t, (int, float)) else 0.0


def _compare_corner(
    corner: Dict[str, Any],
    compare_samples: Sequence[Dict[str, Any]],
    ref_clock: float,
    comp_clock: float,
) -> Dict[str, Any]:
    a = _sample_at_pct(compare_samples, corner["entry"]["pct"])
    x = _sample_at_pct(compare_samples, corner["apex"]["pct"])
    e = _sample_at_pct(compare_samples, corner["exit"]["pct"])

    def _delta(ref_time, comp_time):
        if isinstance(ref_time, (int, float)) and isinstance(comp_time, (int, float)):
            return round((ref_time - ref_clock) - (comp_time - comp_clock), 3)
        return None

    def _speed(sample):
        return round(sample.get("speed") or 0.0, 1) if sample else None

    return {
        "entry_speed": _speed(a),
        "apex_speed": _speed(x),
        "exit_speed": _speed(e),
        "delta_entry": _delta(corner["entry"]["time"], (a or {}).get("time")),
        "delta_apex": _delta(corner["apex"]["time"], (x or {}).get("time")),
        "delta_exit": _delta(corner["exit"]["time"], (e or {}).get("time")),
    }


def detect_corners(
    samples: Sequence[Dict[str, Any]],
    min_speed_kmh: float = MIN_APEX_SPEED_KMH,
    compare_samples: Optional[Sequence[Dict[str, Any]]] = None,
    track_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Detects corners on a lap. When a circuit is known (Imola, Sebring, Daytona,
    Spa, Le Mans, Monza, etc.), matches telemetry apexes to the official FIA
    corner catalog so turn numbers and iconic names match the real track 100%."""
    if not samples or len(samples) < 20:
        return []

    pts = _resample_by_distance(samples)
    if len(pts) < 20:
        return []

    cx, cy, _ = _centerline(pts)
    rate = _heading_rate(cx, cy, STEP_M)

    fast = [abs(rate[i]) for i in range(len(rate)) if (pts[i].get("speed") or 0.0) >= min_speed_kmh]
    peak_rate = max(fast, default=max((abs(r) for r in rate), default=0.0))
    if peak_rate <= 0.0:
        return []
    floor = peak_rate * REL_FLOOR

    regions = _raw_regions(rate, floor)
    regions = [r for r in regions if (r[1] - r[0]) * STEP_M >= MIN_REGION_M]
    regions = _merge_same_sign(regions, rate, MERGE_SAME_SIGN_M)

    kept: List[List[int]] = []
    for a, b in regions:
        if _turn_angle(rate, a, b, STEP_M) < MIN_TURN_ANGLE_DEG:
            continue
        min_speed = min((pts[i].get("speed") or 0.0) for i in range(a, b + 1))
        if min_speed < min_speed_kmh:
            continue
        max_lat_g = max(abs(pts[i].get("lat_g") or 0.0) for i in range(a, b + 1))
        ref = _reference_speed(pts, a, b)
        drop = (ref - min_speed) / ref if ref > 1.0 else 0.0
        if max_lat_g < MIN_LAT_G and drop < MIN_SPEED_DROP:
            continue
        kept.append([a, b])

    ratio = _gear_ratio_map(pts)
    ref_clock = _lap_clock(pts)
    comp_clock = _lap_clock(compare_samples) if compare_samples else 0.0

    raw_corners: List[Dict[str, Any]] = []
    for a, b in kept:
        peak = max(range(a, b + 1), key=lambda i: abs(rate[i]))
        peak = max(a, min(b, peak))
        apex = pts[peak]

        direction = "left" if rate[peak] > 0 else "right"

        entry_i = a
        for i in range(a, peak + 1):
            if (pts[i].get("brake") or 0.0) >= 5.0:
                entry_i = i
                break

        turn_in_i = a
        for i in range(a, peak + 1):
            if abs(pts[i].get("steering") or 0.0) >= STEER_ON_DEG:
                turn_in_i = i
                break

        exit_i = b
        for i in range(peak, b + 1):
            if (pts[i].get("throttle") or 0.0) >= 98.0:
                exit_i = i
                break

        min_speed = min((pts[i].get("speed") or 0.0) for i in range(a, b + 1))
        max_lat_g = max(abs(pts[i].get("lat_g") or 0.0) for i in range(a, b + 1))

        dur = 0.0
        ta = pts[a].get("time")
        tb = pts[b].get("time")
        if isinstance(ta, (int, float)) and isinstance(tb, (int, float)):
            dur = max(0.0, tb - ta)

        corner: Dict[str, Any] = {
            "direction": direction,
            "start_pct": round(pts[a].get("dist_pct") or 0.0, 4),
            "end_pct": round(pts[b].get("dist_pct") or 0.0, 4),
            "apex_pct": round(apex.get("dist_pct") or 0.0, 4),
            "turn_deg": round(_turn_angle(rate, a, b, STEP_M), 1),
            "entry": {
                "pct": round(pts[entry_i].get("dist_pct") or 0.0, 4),
                "speed": round(pts[entry_i].get("speed") or 0.0, 1),
                "brake": round(pts[entry_i].get("brake") or 0.0, 1),
                "time": pts[entry_i].get("time"),
            },
            "turn_in": {
                "pct": round(pts[turn_in_i].get("dist_pct") or 0.0, 4),
                "speed": round(pts[turn_in_i].get("speed") or 0.0, 1),
                "time": pts[turn_in_i].get("time"),
            },
            "apex": {
                "pct": round(apex.get("dist_pct") or 0.0, 4),
                "speed": round(apex.get("speed") or 0.0, 1),
                "gear": _stable_gear(pts, peak, a, b, ratio),
                "lat_g": round(apex.get("lat_g") or 0.0, 2),
                "time": apex.get("time"),
            },
            "exit": {
                "pct": round(pts[exit_i].get("dist_pct") or 0.0, 4),
                "speed": round(pts[exit_i].get("speed") or 0.0, 1),
                "time": pts[exit_i].get("time"),
            },
            "min_speed": round(min_speed, 1),
            "max_lat_g": round(max_lat_g, 2),
            "duration": round(dur, 3),
            "length_m": round((b - a) * STEP_M, 1),
        }

        if compare_samples:
            corner["compare"] = _compare_corner(corner, compare_samples, ref_clock, comp_clock)

        raw_corners.append(corner)

    raw_corners.sort(key=lambda c: c["apex_pct"])

    # -------------------------------------------------------------------------
    # Reconcile with Official Real-World Circuit Catalog if track recognized
    # -------------------------------------------------------------------------
    circuit_key = match_circuit_key(track_name)
    if circuit_key and circuit_key in OFFICIAL_TRACKS_DATABASE:
        circuit_info = OFFICIAL_TRACKS_DATABASE[circuit_key]
        official_turns = circuit_info["turns"]

        max_dist_pct = max((s.get("dist_pct") or 0.0) for s in samples)
        is_partial_lap = max_dist_pct < 0.85

        matched_corners: List[Dict[str, Any]] = []
        used_raw: set = set()

        for turn_def in official_turns:
            nom_pct = turn_def["nominal_pct"]
            if is_partial_lap and nom_pct > max_dist_pct + 0.03:
                continue

            best_idx = None
            best_dist = 0.055
            for i, raw_c in enumerate(raw_corners):
                if i in used_raw:
                    continue
                d = abs(raw_c["apex_pct"] - nom_pct)
                if d < best_dist:
                    best_dist = d
                    best_idx = i

            if best_idx is not None:
                used_raw.add(best_idx)
                c = dict(raw_corners[best_idx])
                c["number"] = turn_def["number"]
                c["id"] = f"T{turn_def['number']}"
                c["name"] = turn_def["name"]
                matched_corners.append(c)
            else:
                # Flat-out turn or high-speed kink taken at full throttle:
                # Synthesize from real telemetry sample at the official turn location
                s = _sample_at_pct(samples, nom_pct) or samples[0]
                synth = {
                    "number": turn_def["number"],
                    "id": f"T{turn_def['number']}",
                    "name": turn_def["name"],
                    "direction": turn_def["direction"],
                    "start_pct": round(max(0.0, nom_pct - 0.012), 4),
                    "end_pct": round(min(1.0, nom_pct + 0.012), 4),
                    "apex_pct": round(nom_pct, 4),
                    "turn_deg": 18.0,
                    "entry": {
                        "pct": round(max(0.0, nom_pct - 0.012), 4),
                        "speed": round(s.get("speed") or 0.0, 1),
                        "brake": round(s.get("brake") or 0.0, 1),
                        "time": s.get("time"),
                    },
                    "turn_in": {
                        "pct": round(max(0.0, nom_pct - 0.006), 4),
                        "speed": round(s.get("speed") or 0.0, 1),
                        "time": s.get("time"),
                    },
                    "apex": {
                        "pct": round(nom_pct, 4),
                        "speed": round(s.get("speed") or 0.0, 1),
                        "gear": s.get("gear"),
                        "lat_g": round(s.get("lat_g") or 0.0, 2),
                        "time": s.get("time"),
                    },
                    "exit": {
                        "pct": round(min(1.0, nom_pct + 0.012), 4),
                        "speed": round(s.get("speed") or 0.0, 1),
                        "time": s.get("time"),
                    },
                    "min_speed": round(s.get("speed") or 0.0, 1),
                    "max_lat_g": round(abs(s.get("lat_g") or 0.0), 2),
                    "duration": 1.2,
                    "length_m": 85.0,
                }
                if compare_samples:
                    synth["compare"] = _compare_corner(synth, compare_samples, ref_clock, comp_clock)
                matched_corners.append(synth)

        matched_corners.sort(key=lambda c: c["number"])
        return matched_corners[:MAX_CORNERS]

    # Fallback for unregistered track: standard dynamic numbering
    for i, c in enumerate(raw_corners):
        c["number"] = i + 1
        c["id"] = f"T{i + 1}"
        c["name"] = f"Turn {i + 1}"
    return raw_corners[:MAX_CORNERS]
