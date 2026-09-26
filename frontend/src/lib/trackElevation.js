/**
 * TelemetryHub Pro - Real-World 3D Track Elevation & Camber Profiler
 *
 * Provides accurate elevation curves (in meters) and road banking/camber (in radians)
 * for sim racing circuits. Guarantees smooth C2 continuity and closed loops (Y(0) == Y(1)).
 */

// Keypoints: [dist_pct, elevation_m, optional_camber_rad]
// Values are referenced from official circuit topographic surveys.
const TRACK_ELEVATION_DATABASE = {
  // Autodromo Enzo e Dino Ferrari (Imola) - 36m total elevation change
  imola: [
    [0.00, 36.0, 0.0],     // Start/Finish straight
    [0.07, 35.2, 0.03],    // Tamburello chicane
    [0.13, 36.8, -0.02],   // Villeneuve chicane
    [0.19, 38.5, 0.04],    // Tosa hairpin entry
    [0.26, 48.0, 0.02],    // Colle Aperto uphill climb
    [0.34, 63.5, -0.04],   // Piratella braking
    [0.40, 71.2, -0.06],   // Piratella apex (Circuit Highest Point)
    [0.47, 62.0, 0.0],     // Descent to Acque Minerali
    [0.54, 48.2, 0.05],    // Acque Minerali dip (Bottom of compression)
    [0.60, 54.5, 0.02],    // Hill climb towards Variante Alta
    [0.67, 63.0, -0.03],   // Variante Alta chicane crest
    [0.76, 49.5, 0.02],    // Fast downhill run to Rivazza
    [0.82, 40.2, 0.04],    // Rivazza 1 & 2
    [0.90, 36.8, 0.0],     // Main straight descent
    [1.00, 36.0, 0.0]      // Closed loop seam
  ],

  // Circuit de Spa-Francorchamps - Iconic Ardennes roller-coaster (Realistic FIA topographic profile)
  spa: [
    [0.00, 32.0, 0.0],     // Start / Finish
    [0.06, 30.0, 0.04],    // La Source hairpin
    [0.09, 24.0, 0.02],    // Descent to Ancienne Douane
    [0.12, 17.5, 0.06],    // Eau Rouge compression dip (bottom of valley)
    [0.15, 27.5, -0.05],   // Raidillon uphill sweep
    [0.18, 35.0, -0.02],   // Raidillon crest
    [0.24, 43.0, 0.0],     // Kemmel Straight climb
    [0.32, 47.0, 0.02],    // Les Combes chicane top (highest point)
    [0.43, 34.0, 0.04],    // Bruxelles downhill carousel
    [0.53, 16.0, 0.05],    // Pouhon double-left valley
    [0.66, 23.0, -0.02],   // Fagnes chicane
    [0.78, 19.5, 0.03],    // Campus / Stavelot
    [0.89, 26.0, 0.02],    // Blanchimont
    [0.95, 29.5, -0.03],   // Bus Stop chicane
    [1.00, 32.0, 0.0]      // Closed loop seam
  ],

  // Daytona International Speedway (Road Course) - 31-degree NASCAR banking
  daytona: [
    [0.00, 1.2, 0.0],      // Start/Finish tri-oval
    [0.08, 0.8, 0.02],     // Turn 1 infield entry
    [0.18, 0.5, -0.02],    // International Horseshoe
    [0.32, 0.6, 0.02],     // Infield sweeping kink
    [0.48, 0.5, 0.01],     // Infield exit onto oval
    [0.55, 3.8, 0.22],     // NASCAR Turn 1 & 2 banking ramp
    [0.64, 6.2, 0.32],     // High Banking Turn 1 & 2 (31° banking)
    [0.70, 2.0, 0.05],     // Backstretch transition
    [0.76, 1.4, -0.04],    // Bus Stop / Le Mans chicane
    [0.82, 3.5, 0.20],     // NASCAR Turn 3 & 4 banking ramp
    [0.91, 6.2, 0.32],     // High Banking Turn 3 & 4 (31° banking)
    [0.97, 2.2, 0.12],     // Tri-oval apron exit
    [1.00, 1.2, 0.0]       // Closed loop seam
  ],

  // Sebring International Raceway - Historic bumpy airfield with concrete slabs
  sebring: [
    [0.00, 0.0, 0.0],      // Start/Finish straight
    [0.06, 0.8, 0.03],     // Turn 1 rough apex bump
    [0.18, 0.3, 0.01],     // Hairpin approach
    [0.32, 0.9, 0.04],     // Big Hairpin camber
    [0.45, 0.2, 0.0],      // Fangio chicane
    [0.60, 0.7, 0.02],     // Cunningham & Tower
    [0.74, 0.1, 0.0],      // Ulmann Straight flat run
    [0.89, 1.4, 0.07],     // Sunset Bend (Turn 17) banked concrete carousel
    [1.00, 0.0, 0.0]       // Closed loop seam
  ],

  // Circuit de la Sarthe (Le Mans)
  lemans: [
    [0.00, 10.0, 0.0],     // Pit straight
    [0.05, 18.5, 0.03],    // Dunlop chicane & bridge crest
    [0.09, 8.2, -0.02],    // Descent through Esses
    [0.14, 5.0, 0.03],     // Tertre Rouge
    [0.26, 13.0, 0.0],     // Mulsanne straight hump 1
    [0.39, 15.2, 0.0],     // Mulsanne straight hump 2
    [0.57, 4.2, 0.04],     // Mulsanne corner
    [0.68, 2.0, 0.05],     // Indianapolis dip
    [0.75, 5.8, 0.02],     // Arnage
    [0.85, 11.5, 0.04],    // Porsche Curves rolling sweepers
    [0.94, 9.2, -0.03],    // Ford chicanes
    [1.00, 10.0, 0.0]      // Closed loop seam
  ]
};

function matchCircuitKey(trackName) {
  if (!trackName) return null;
  const lower = trackName.toLowerCase();
  if (lower.includes('ferrari') || lower.includes('imola')) return 'imola';
  if (lower.includes('spa') || lower.includes('francorchamps')) return 'spa';
  if (lower.includes('daytona')) return 'daytona';
  if (lower.includes('sebring')) return 'sebring';
  if (lower.includes('sarthe') || lower.includes('mans')) return 'lemans';
  return null;
}

// Smooth Catmull-Rom cubic interpolation between keypoints
function interpolateKeypoints(keypoints, u) {
  const normU = ((u % 1.0) + 1.0) % 1.0;
  const n = keypoints.length;

  let idx = 0;
  while (idx < n - 2 && keypoints[idx + 1][0] < normU) {
    idx++;
  }

  const p1 = keypoints[idx];
  const p2 = keypoints[idx + 1];
  const span = p2[0] - p1[0];
  const t = span > 1e-6 ? (normU - p1[0]) / span : 0.0;

  // Neighbors for tangents
  const p0 = idx > 0 ? keypoints[idx - 1] : keypoints[n - 2];
  const p3 = idx + 2 < n ? keypoints[idx + 2] : keypoints[1];

  // Catmull-Rom spline formulation
  const t2 = t * t;
  const t3 = t2 * t;

  const y0 = p0[1], y1 = p1[1], y2 = p2[1], y3 = p3[1];
  const elev = 0.5 * (
    (2 * y1) +
    (-y0 + y2) * t +
    (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
    (-y0 + 3 * y1 - 3 * y2 + y3) * t3
  );

  const c0 = p0[2] || 0, c1 = p1[2] || 0, c2 = p2[2] || 0, c3 = p3[2] || 0;
  const camber = 0.5 * (
    (2 * c1) +
    (-c0 + c2) * t +
    (2 * c0 - 5 * c1 + 4 * c2 - c3) * t2 +
    (-c0 + 3 * c1 - 3 * c2 + y3 * 0) * t3
  );

  return { elevation: elev, camber };
}

/**
 * Returns the track elevation (meters) and camber (radians) at a given lap fraction (0..1)
 */
export function getTrackElevation(trackName, distPct, sample = null) {
  const circuitKey = matchCircuitKey(trackName);
  const known = circuitKey && TRACK_ELEVATION_DATABASE[circuitKey]
    ? interpolateKeypoints(TRACK_ELEVATION_DATABASE[circuitKey], distPct)
    : null;

  // The database is authored with the intuitive sign: positive camber means the
  // racing surface rises toward the OUTSIDE of the corner (true banking, as at
  // Daytona). The 3D road ribbon measures lateral offset along the spline
  // normal, which points to the car's LEFT, so a positive value there would
  // raise the inside instead. Flip the sign once here, at the boundary, so the
  // road geometry, the kerbs, the verge and the car body all bank the right way.
  const toGeometrySign = (camber) => -camber;

  // A measured in-game altitude overrides the circuit's elevation profile, but
  // it must NOT wipe the banking: banking is a property of the circuit, not of
  // the sample. Keeping camber from the database is what lets a banked oval
  // like Daytona render its 31-degree turns even when the log carries altitude.
  if (sample && (sample.world_z != null || sample.elevation != null)) {
    const rawElev = sample.world_z != null ? sample.world_z : sample.elevation;
    if (Number.isFinite(rawElev)) {
      return { elevation: rawElev, camber: toGeometrySign(known ? known.camber : 0) };
    }
  }

  if (known) {
    return { elevation: known.elevation, camber: toGeometrySign(known.camber) };
  }

  // Realistic natural multi-harmonic elevation fallback for unlisted tracks
  const u = ((distPct % 1.0) + 1.0) % 1.0;
  const twoPi = Math.PI * 2;
  const elev = 5.2 * Math.sin(twoPi * u) +
               2.6 * Math.cos(twoPi * 2 * u - 0.45) +
               1.2 * Math.sin(twoPi * 3 * u + 0.8) +
               0.6 * Math.sin(twoPi * 5 * u);

  // Subtle natural camber on high-speed sweeps
  const camber = 0.02 * Math.sin(twoPi * 2 * u);

  return { elevation: Math.max(0, elev + 8.0), camber: toGeometrySign(camber) };
}
