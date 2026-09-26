import * as THREE from 'three';
import { getTrackElevation } from './trackElevation';

const ALPHA = 0.5;

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = t0 + Math.pow(Math.max(1e-6, p1.distanceTo(p0)), ALPHA);
  const t2 = t1 + Math.pow(Math.max(1e-6, p2.distanceTo(p1)), ALPHA);
  const t3 = t2 + Math.pow(Math.max(1e-6, p3.distanceTo(p2)), ALPHA);

  const tt = t1 + (t2 - t1) * t;

  const a1 = p0.clone().lerp(p1, (tt - t0) / (t1 - t0));
  const a2 = p1.clone().lerp(p2, (tt - t1) / (t2 - t1));
  const a3 = p2.clone().lerp(p3, (tt - t2) / (t3 - t2));

  const b1 = a1.clone().lerp(a2, (tt - t0) / (t2 - t0));
  const b2 = a2.clone().lerp(a3, (tt - t1) / (t3 - t1));

  return b1.clone().lerp(b2, (tt - t1) / (t2 - t1));
}

// Same centripetal Catmull-Rom weights as catmullRomPoint, applied to a scalar
// (used for the camber field so banking curves with the centreline).
function catmullRomScalar(t, p0, p1, p2, p3) {
  const t0 = 0;
  const t1 = t0 + 1;
  const t2 = t1 + 1;
  const t3 = t2 + 1;
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, f) => a + (b - a) * f;
  const a1 = lerp(p0, p1, (tt - t0) / (t1 - t0));
  const a2 = lerp(p1, p2, (tt - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (tt - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, (tt - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (tt - t1) / (t3 - t1));
  return lerp(b1, b2, (tt - t1) / (t2 - t1));
}

// Vector3.clone()/lerp() drop custom properties, so camber would be lost the
// moment a point is cloned or interpolated. It is therefore carried explicitly
// through every step of the centreline pipeline (resample, smooth, eval).
function dedupe(points, minGap = 0.05) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceTo(out[out.length - 1]) >= minGap) out.push(points[i]);
  }
  return out;
}

function resampleUniform(points, spacing) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cum[cum.length - 1];
  const count = Math.max(4, Math.floor(total / spacing) + 1);
  const out = [];
  let cursor = 0;
  for (let s = 0; s < count; s++) {
    const target = s * spacing;
    while (cursor < points.length - 2 && cum[cursor + 1] < target) cursor++;
    const seg = cum[cursor + 1] - cum[cursor];
    const a = seg > 1e-6 ? (target - cum[cursor]) / seg : 0;
    const clampedA = Math.min(1, Math.max(0, a));
    const p = points[cursor].clone().lerp(points[cursor + 1], clampedA);
    // Camber is a scalar field, so interpolate it between the same neighbours.
    const c0 = points[cursor].camber || 0;
    const c1 = points[cursor + 1].camber || 0;
    p.camber = c0 + (c1 - c0) * clampedA;
    out.push(p);
  }
  return out;
}

export function buildTrackSpline(rawPoints, options = {}) {
  const {
    controlSpacing = 6.0,
    sampleSpacing = 1.5,
    closeGap = 35.0,
    smoothPasses = 2
  } = options;

  const valid = (rawPoints || []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z)
  );
  if (valid.length < 6) return null;

  const deduped = dedupe(valid, 0.05);
  if (deduped.length < 6) return null;

  let controls = resampleUniform(deduped, controlSpacing);

  const gap = controls[controls.length - 1].distanceTo(controls[0]);
  const closed = gap < closeGap;

  if (closed) {
    controls = controls.slice(0, -1);
  }

  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = controls.map((p, i) => {
      const prev = controls[i - 1] || (closed ? controls[controls.length - 1] : controls[i]);
      const nxt = controls[i + 1] || (closed ? controls[0] : controls[i]);
      const smoothed = p.clone().multiplyScalar(0.5).add(prev.clone().multiplyScalar(0.25)).add(nxt.clone().multiplyScalar(0.25));
      // Smooth camber with the same weights so banking curves stay continuous.
      smoothed.camber =
        (p.camber || 0) * 0.5 + (prev.camber || 0) * 0.25 + (nxt.camber || 0) * 0.25;
      return smoothed;
    });
    controls = next;
  }

  const n = controls.length;
  const segCount = closed ? n : n - 1;

  const controlCum = [0];
  for (let i = 1; i < n; i++) {
    controlCum.push(controlCum[i - 1] + controls[i].distanceTo(controls[i - 1]));
  }
  if (closed) controlCum.push(controlCum[n - 1] + controls[0].distanceTo(controls[n - 1]));
  const totalLength = controlCum[controlCum.length - 1];

  const sampleCount = Math.max(8, Math.round(totalLength / sampleSpacing));
  const positions = new Float32Array(sampleCount * 3);
  const tangents = new Float32Array(sampleCount * 3);
  const normals = new Float32Array(sampleCount * 3);
  const camber = new Float32Array(sampleCount);
  const curvature = new Float32Array(sampleCount);
  const arcLength = new Float32Array(sampleCount);
  const lateral = new Float32Array(sampleCount);

  const evalAt = (u) => {
    const clamped = closed ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u));
    const f = clamped * segCount;
    let i = Math.floor(f);
    if (i >= segCount) i = segCount - 1;
    const t = f - i;

    const i0 = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const i1 = closed ? i % n : i;
    const i2 = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const i3 = closed ? (i + 2) % n : Math.min(n - 1, i + 2);

    const point = catmullRomPoint(controls[i0], controls[i1], controls[i2], controls[i3], t);
    // Interpolate camber along the same Catmull-Rom segment so the banking
    // follows the curve rather than the coarse control spacing.
    point.camber = catmullRomScalar(
      t,
      controls[i0].camber || 0,
      controls[i1].camber || 0,
      controls[i2].camber || 0,
      controls[i3].camber || 0
    );
    return point;
  };

  const EPS = 1e-3;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  for (let s = 0; s < sampleCount; s++) {
    const u = s / (sampleCount - (closed ? 0 : 1));
    const p = evalAt(u);

    evalAt(u - EPS).subVectors(tmpA, evalAt(u));
    tmpA.negate();
    tmpB.copy(evalAt(u + EPS)).sub(p);
    const tan = tmpA.clone().add(tmpB).normalize();
    if (!Number.isFinite(tan.x) || tan.lengthSq() < 1e-9) tan.set(0, 0, 1);

    const nor = new THREE.Vector3(tan.z, 0, -tan.x).normalize();

    positions[s * 3] = p.x;
    positions[s * 3 + 1] = p.y;
    positions[s * 3 + 2] = p.z;
    tangents[s * 3] = tan.x;
    tangents[s * 3 + 1] = tan.y;
    tangents[s * 3 + 2] = tan.z;
    normals[s * 3] = nor.x;
    normals[s * 3 + 1] = nor.y;
    normals[s * 3 + 2] = nor.z;
    camber[s] = p.camber || 0;
    arcLength[s] = u * totalLength;
  }

  for (let s = 0; s < sampleCount; s++) {
    const sp = closed ? (s - 1 + sampleCount) % sampleCount : Math.max(0, s - 1);
    const sn = closed ? (s + 1) % sampleCount : Math.min(sampleCount - 1, s + 1);
    const dTheta = Math.atan2(
      normals[sn * 3] * normals[sp * 3 + 2] - normals[sn * 3 + 2] * normals[sp * 3],
      normals[sn * 3] * normals[sp * 3] + normals[sn * 3 + 2] * normals[sp * 3 + 2]
    );
    const ds = arcLength[sn] - arcLength[sp];
    curvature[s] = ds > 1e-3 ? dTheta / ds : 0;
  }

  const smoothK = new Float32Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) {
    let sum = 0;
    let cnt = 0;
    for (let k = -4; k <= 4; k++) {
      let idx = s + k;
      if (closed) idx = ((idx % sampleCount) + sampleCount) % sampleCount;
      else idx = Math.min(sampleCount - 1, Math.max(0, idx));
      sum += curvature[idx];
      cnt++;
    }
    smoothK[s] = sum / cnt;
  }

  const pctOf = (u) => (closed ? u : Math.min(1, Math.max(0, u)));

  return {
    closed,
    sampleCount,
    totalLength,
    sampleSpacing,
    positions,
    tangents,
    normals,
    camber,
    curvature: smoothK,
    arcLength,
    lateral,
    pctAt: (s) => pctOf(s / (sampleCount - (closed ? 0 : 1))),
    indexAtPct(pct) {
      const p = Math.min(1, Math.max(0, pct));
      const f = p * (sampleCount - (closed ? 0 : 1));
      const i = Math.floor(f);
      return Math.min(sampleCount - 1, Math.max(0, i));
    },
    poseAtPct(pct) {
      const p = Math.min(1, Math.max(0, pct));
      const f = p * (sampleCount - (closed ? 0 : 1));
      let i = Math.floor(f);
      if (i >= sampleCount - 1) i = sampleCount - 2;
      const a = f - i;
      const j = i + 1;

      const x = positions[i * 3] + a * (positions[j * 3] - positions[i * 3]);
      const y = positions[i * 3 + 1] + a * (positions[j * 3 + 1] - positions[i * 3 + 1]);
      const z = positions[i * 3 + 2] + a * (positions[j * 3 + 2] - positions[i * 3 + 2]);

      const tx = tangents[i * 3] + a * (tangents[j * 3] - tangents[i * 3]);
      const ty = tangents[i * 3 + 1] + a * (tangents[j * 3 + 1] - tangents[i * 3 + 1]);
      const tz = tangents[i * 3 + 2] + a * (tangents[j * 3 + 2] - tangents[i * 3 + 2]);
      const horizLen = Math.hypot(tx, tz) || 1;

      const nx = normals[i * 3] + a * (normals[j * 3] - normals[i * 3]);
      const nz = normals[i * 3 + 2] + a * (normals[j * 3 + 2] - normals[i * 3 + 2]);
      const nlen = Math.hypot(nx, nz) || 1;

      const roadPitch = -Math.atan2(ty, horizLen);
      const slopePct = (ty / horizLen) * 100;
      const bank = camber[i] + a * (camber[j] - camber[i]);

      return {
        x,
        y,
        z,
        heading: Math.atan2(tx / horizLen, tz / horizLen),
        pitch: roadPitch,
        slopePct,
        camber: bank,
        normalX: nx / nlen,
        normalZ: nz / nlen,
        curvature: smoothK[i] + a * (smoothK[j] - smoothK[i]),
        arcLength: arcLength[i] + a * (arcLength[j] - arcLength[i])
      };
    },
    pointAtPct(pct, offset = 0) {
      const pose = this.poseAtPct(pct);
      return {
        x: pose.x + pose.normalX * offset,
        y: pose.y,
        z: pose.z + pose.normalZ * offset,
        heading: pose.heading,
        pitch: pose.pitch,
        slopePct: pose.slopePct,
        curvature: pose.curvature
      };
    }
  };
}

export function buildSplineFromSamples(samples, options = {}) {
  if (!samples || samples.length < 6) return null;
  const valid = samples.filter((s) => Number.isFinite(s.world_x) && Number.isFinite(s.world_y));
  if (valid.length < 6) return null;

  const trackName = options.trackName || '';

  // Use true in-game track centerline if available, fallback to car line
  const pts = valid.map((s, idx) => {
    const x = s.track_center_x != null ? s.track_center_x : s.world_x;
    const y2d = s.track_center_y != null ? s.track_center_y : s.world_y;
    const distPct = s.dist_pct != null ? s.dist_pct : (idx / (valid.length - 1));
    const { elevation, camber } = getTrackElevation(trackName, distPct, s);
    const vec = new THREE.Vector3(x, elevation, -y2d);
    vec.camber = camber;
    return vec;
  });

  const spline = buildTrackSpline(pts, options);
  if (!spline) return null;

  // Compute physical track half-width from in-game data if available
  const widths = valid.filter((s) => s.track_width != null && s.track_width > 5).map((s) => s.track_width);
  if (widths.length > 10) {
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
    spline.trackWidth = avgW;
    spline.halfWidth = Math.max(5.0, Math.min(13.0, avgW / 2.0));
  } else {
    spline.trackWidth = 12.0;
    spline.halfWidth = 6.0;
  }

  return spline;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function buildRoadRibbon(spline, options = {}) {
  const {
    halfWidth = 6.0,
    bevelWidth = 0.35,
    bevelDrop = 0.055,
    surfaceY = 0.02,
    uScale = 14.0
  } = options;

  const { sampleCount, closed, positions, normals, arcLength } = spline;
  const laneCount = 4;
  const verts = [];
  const uvs = [];
  const indices = [];

  const lateralOffsets = [
    halfWidth + bevelWidth,
    halfWidth,
    -halfWidth,
    -(halfWidth + bevelWidth)
  ];
  const lateralY = [surfaceY - bevelDrop, surfaceY, surfaceY, surfaceY - bevelDrop];
  const lateralU = [1.0, 0.94, 0.06, 0.0];

  for (let s = 0; s < sampleCount; s++) {
    const px = positions[s * 3];
    const py = positions[s * 3 + 1];
    const pz = positions[s * 3 + 2];
    const nx = normals[s * 3];
    const nz = normals[s * 3 + 2];
    const v = arcLength[s] / uScale;
    const bank = (spline.camber && spline.camber[s]) || 0;

    for (let l = 0; l < laneCount; l++) {
      const off = lateralOffsets[l];
      const bankY = off * Math.sin(bank);
      verts.push(px + nx * off, py + lateralY[l] + bankY, pz + nz * off);
      uvs.push(lateralU[l], v);
    }
  }

  const last = closed ? sampleCount : sampleCount - 1;
  for (let s = 0; s < last; s++) {
    const s0 = s;
    const s1 = (s + 1) % sampleCount;
    for (let l = 0; l < laneCount - 1; l++) {
      const a = s0 * laneCount + l;
      const b = s0 * laneCount + l + 1;
      const c = s1 * laneCount + l;
      const d = s1 * laneCount + l + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function kerbMask(spline, threshold = 0.0035, minRunM = 22.0) {
  const { sampleCount, closed, curvature, arcLength } = spline;

  const smooth = (raw) => {
    const out = new Uint8Array(raw);
    for (let p = 0; p < 3; p++) {
      const copy = out.slice();
      for (let s = 0; s < sampleCount; s++) {
        const sp = closed ? (s - 1 + sampleCount) % sampleCount : Math.max(0, s - 1);
        const sn = closed ? (s + 1) % sampleCount : Math.min(sampleCount - 1, s + 1);
        out[s] = copy[sp] + copy[s] + copy[sn] >= 2 ? 1 : 0;
      }
    }
    return out;
  };

  // The apex kerb sits on the inside of the turn. Positive curvature is a left
  // hander, so it gets the left kerb, and the other way round.
  const leftRaw = new Uint8Array(sampleCount);
  const rightRaw = new Uint8Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) {
    if (curvature[s] >= threshold) leftRaw[s] = 1;
    else if (curvature[s] <= -threshold) rightRaw[s] = 1;
  }

  const collectRuns = (mask) => {
    const runs = [];
    let start = -1;
    for (let s = 0; s < sampleCount; s++) {
      if (mask[s] && start === -1) start = s;
      else if (!mask[s] && start !== -1) {
        runs.push([start, s - 1]);
        start = -1;
      }
    }
    if (start !== -1) runs.push([start, sampleCount - 1]);
    return runs.filter(([a, b]) => arcLength[b] - arcLength[a] >= minRunM);
  };

  const keep = (mask, runs) => {
    mask.fill(0);
    for (const [a, b] of runs) {
      for (let s = a; s <= b; s++) mask[s] = 1;
    }
  };

  const leftMask = smooth(leftRaw);
  const rightMask = smooth(rightRaw);
  const leftRuns = collectRuns(leftMask);
  const rightRuns = collectRuns(rightMask);
  keep(leftMask, leftRuns);
  keep(rightMask, rightRuns);

  // Exit kerb: the outside edge gets a short strip just after the apex of the
  // corner it belongs to.
  const addExit = (ownMask, apexRuns) => {
    const exit = new Uint8Array(sampleCount);
    for (const [a, b] of apexRuns) {
      const span = b - a;
      const exitStart = Math.min(b, a + Math.round(span * 0.55));
      const exitLen = Math.max(6, Math.round(span * 0.45));
      for (let s = exitStart; s <= Math.min(b, exitStart + exitLen); s++) exit[s] = 1;
    }
    for (let s = 0; s < sampleCount; s++) {
      if (exit[s] && !ownMask[s]) ownMask[s] = 1;
    }
  };

  addExit(rightMask, leftRuns);
  addExit(leftMask, rightRuns);

  const mask = new Uint8Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) {
    mask[s] = leftMask[s] || rightMask[s] ? 1 : 0;
  }

  const runs = [];
  let start = -1;
  for (let s = 0; s < sampleCount; s++) {
    if (mask[s] && start === -1) start = s;
    else if (!mask[s] && start !== -1) {
      runs.push([start, s - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, sampleCount - 1]);

  return { mask, leftMask, rightMask, runs };
}

export function buildKerbRibbon(spline, maskInfo, side, options = {}) {
  const {
    halfWidth = 6.0,
    kerbWidth = 1.35,
    crestHeight = 0.085,
    surfaceY = 0.02,
    taperM = 14.0,
    uScale = 1.6
  } = options;

  const { sampleCount, positions, normals, arcLength } = spline;
  const mask = side === 'left' ? maskInfo.leftMask : maskInfo.rightMask;
  const sign = side === 'left' ? 1 : -1;

  const verts = [];
  const uvs = [];
  const indices = [];

  const profile = [
    { off: 0.0, y: surfaceY + 0.004, u: 0.0 },
    { off: kerbWidth * 0.42, y: surfaceY + crestHeight, u: 0.42 },
    { off: kerbWidth * 0.78, y: surfaceY + crestHeight * 0.72, u: 0.78 },
    { off: kerbWidth, y: surfaceY + 0.012, u: 1.0 }
  ];

  let active = false;
  let vertBase = 0;

  for (let s = 0; s < sampleCount; s++) {
    if (!mask[s]) {
      active = false;
      continue;
    }

    let taper = 1.0;
    const inRun = s > 0 && mask[s - 1];
    const outRun = s < sampleCount - 1 && mask[s + 1];

    if (!inRun || !outRun) {
      let back = s;
      while (back > 0 && mask[back - 1]) back--;
      let fwd = s;
      while (fwd < sampleCount - 1 && mask[fwd + 1]) fwd++;
      const distFromStart = arcLength[s] - arcLength[back];
      const distFromEnd = arcLength[fwd] - arcLength[s];
      taper = Math.min(
        smoothstep(0, taperM, distFromStart),
        smoothstep(0, taperM, distFromEnd)
      );
    }

    if (taper <= 0.001) {
      active = false;
      continue;
    }

    const px = positions[s * 3];
    const py = positions[s * 3 + 1];
    const pz = positions[s * 3 + 2];
    const nx = normals[s * 3];
    const nz = normals[s * 3 + 2];
    const v = arcLength[s] / uScale;
    const bank = (spline.camber && spline.camber[s]) || 0;

    const width = kerbWidth * (0.35 + 0.65 * taper);

    for (let l = 0; l < profile.length; l++) {
      const off = (halfWidth + profile[l].off * (width / kerbWidth)) * sign;
      const bankY = off * Math.sin(bank);
      const y = l === 0 ? profile[l].y : surfaceY + (profile[l].y - surfaceY) * (0.4 + 0.6 * taper);
      verts.push(px + nx * off, py + y + bankY, pz + nz * off);
      uvs.push(profile[l].u, v);
    }

    if (active) {
      for (let l = 0; l < profile.length - 1; l++) {
        const a = vertBase - profile.length + l;
        const b = vertBase - profile.length + l + 1;
        const c = vertBase + l;
        const d = vertBase + l + 1;
        if (side === 'left') {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    active = true;
    vertBase += profile.length;
  }

  if (verts.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildVergeRibbon(spline, side, options = {}) {
  const {
    halfWidth = 6.0,
    kerbWidth = 1.35,
    vergeWidth = 4.0,
    surfaceY = 0.02,
    dropY = -0.05,
    uScale = 8.0
  } = options;

  const { sampleCount, closed, positions, normals, arcLength } = spline;
  const sign = side === 'left' ? 1 : -1;
  const verts = [];
  const uvs = [];
  const indices = [];

  for (let s = 0; s < sampleCount; s++) {
    const px = positions[s * 3];
    const py = positions[s * 3 + 1];
    const pz = positions[s * 3 + 2];
    const nx = normals[s * 3];
    const nz = normals[s * 3 + 2];
    const v = arcLength[s] / uScale;
    const bank = (spline.camber && spline.camber[s]) || 0;

    // Start under asphalt edge (halfWidth - 0.08m) so it is 100% seamlessly tucked under the road,
    // completely eliminating any gap between the road line and the verge/barrier.
    const inner = (halfWidth - 0.08) * sign;
    const outer = (halfWidth + kerbWidth + vergeWidth) * sign;

    verts.push(px + nx * inner, py + surfaceY - 0.005 + inner * Math.sin(bank), pz + nz * inner);
    verts.push(px + nx * outer, py + dropY + outer * Math.sin(bank), pz + nz * outer);
    uvs.push(0.0, v, 1.0, v);
  }

  const last = closed ? sampleCount : sampleCount - 1;
  for (let s = 0; s < last; s++) {
    const s0 = s;
    const s1 = (s + 1) % sampleCount;
    const a = s0 * 2;
    const b = s0 * 2 + 1;
    const c = s1 * 2;
    const d = s1 * 2 + 1;
    if (side === 'left') indices.push(a, b, c, b, d, c);
    else indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createPoseTracker() {
  let heading = null;
  let roll = 0;
  let pitch = 0;

  return {
    reset() {
      heading = null;
      roll = 0;
      pitch = 0;
    },
    update(targetHeading, latG, lonG, dt, options = {}) {
      const {
        yawRateLimit = 6.0,
        headingAlpha = 22.0,
        rollAlpha = 6.0,
        pitchAlpha = 5.0
      } = options;

      if (heading === null) {
        heading = targetHeading;
      } else {
        let diff = (targetHeading - heading) % (Math.PI * 2);
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;

        const maxStep = yawRateLimit * Math.max(dt, 1 / 240);
        if (diff > maxStep) diff = maxStep;
        else if (diff < -maxStep) diff = -maxStep;

        heading += diff * (1 - Math.exp(-headingAlpha * dt));
      }

      // Body roll and pitch come straight from the measured G channels.
      const targetRoll = Math.max(-0.13, Math.min(0.13, -(latG || 0) * 0.035));
      const targetPitch = Math.max(-0.05, Math.min(0.05, (lonG || 0) * 0.012));

      roll += (targetRoll - roll) * (1 - Math.exp(-rollAlpha * dt));
      pitch += (targetPitch - pitch) * (1 - Math.exp(-pitchAlpha * dt));

      return { heading, roll, pitch };
    }
  };
}
