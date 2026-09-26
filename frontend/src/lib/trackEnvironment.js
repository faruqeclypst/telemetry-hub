/**
 * TelemetryHub Pro - Track Environment System
 *
 * Implements:
 * 1. Procedural Atmospheric Sky Dome (Day, Sunset, WEC Night with dynamic stars & horizon mist)
 * 2. Continuous Trackside Grass & Run-off Embankments (seals roadbed, prevents floating track)
 * 3. Rolling Countryside Terrain & Earth Bed
 * 4. High-Performance Instanced 3D Forests (2,400+ Ardennes Pines & Broadleaf Oaks in 4 draw calls)
 */

import * as THREE from 'three';

// ============================================================================
// 1. Procedural Texture Generators
// ============================================================================

let cachedGrassTex = null;
let cachedGrassBump = null;

export function createGrassTextures() {
  if (cachedGrassTex && cachedGrassBump) {
    return { texture: cachedGrassTex, bumpTexture: cachedGrassBump };
  }

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base grass tone (deep Ardennes/Le Mans racing green)
  ctx.fillStyle = '#223d1b';
  ctx.fillRect(0, 0, size, size);

  // Noise layers for grass blades and organic earth mottling
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  // Bump canvas
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d');
  const bumpImg = bumpCtx.createImageData(size, size);
  const bData = bumpImg.data;

  // Pseudo-random deterministic noise
  for (let i = 0; i < size * size; i++) {
    const px = i % size;
    const py = Math.floor(i / size);

    // Multi-frequency Perlin-style hash
    const n1 = Math.sin(px * 0.15) * Math.cos(py * 0.15);
    const n2 = Math.sin(px * 0.04 + py * 0.03);
    const n3 = (Math.random() - 0.5) * 0.28;
    const combined = (n1 * 0.35 + n2 * 0.45 + n3 + 1.0) * 0.5;

    // Grass color variation
    const r = Math.min(255, Math.max(20, Math.floor(30 + combined * 26)));
    const g = Math.min(255, Math.max(35, Math.floor(58 + combined * 42)));
    const b = Math.min(255, Math.max(15, Math.floor(24 + combined * 22)));

    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;

    // Bump
    const bumpVal = Math.floor(combined * 255);
    bData[idx] = bumpVal;
    bData[idx + 1] = bumpVal;
    bData[idx + 2] = bumpVal;
    bData[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);

  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = THREE.RepeatWrapping;
  bumpTexture.wrapT = THREE.RepeatWrapping;
  bumpTexture.repeat.set(12, 12);

  cachedGrassTex = texture;
  cachedGrassBump = bumpTexture;

  return { texture, bumpTexture };
}

// ============================================================================
// 2. BufferGeometry Merger Helper (Zero External Dependencies)
// ============================================================================

function mergeBufferGeometries(geometries) {
  let totalPos = 0;
  let totalNorm = 0;
  let totalUv = 0;
  let totalIndices = 0;

  for (const geo of geometries) {
    totalPos += geo.attributes.position.array.length;
    if (geo.attributes.normal) totalNorm += geo.attributes.normal.array.length;
    if (geo.attributes.uv) totalUv += geo.attributes.uv.array.length;
    if (geo.index) totalIndices += geo.index.array.length;
  }

  const mergedPos = new Float32Array(totalPos);
  const mergedNorm = new Float32Array(totalNorm);
  const mergedUv = new Float32Array(totalUv);
  const mergedIndices = totalIndices > 0 ? new Uint32Array(totalIndices) : null;

  let posOffset = 0;
  let normOffset = 0;
  let uvOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.attributes.position.array;
    mergedPos.set(pos, posOffset);
    posOffset += pos.length;

    if (geo.attributes.normal) {
      const norm = geo.attributes.normal.array;
      mergedNorm.set(norm, normOffset);
      normOffset += norm.length;
    }

    if (geo.attributes.uv) {
      const uv = geo.attributes.uv.array;
      mergedUv.set(uv, uvOffset);
      uvOffset += uv.length;
    }

    if (geo.index && mergedIndices) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i++) {
        mergedIndices[indexOffset + i] = idx[i] + vertexOffset;
      }
      indexOffset += idx.length;
    }

    vertexOffset += pos.length / 3;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  if (totalNorm > 0) merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
  if (totalUv > 0) merged.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
  if (mergedIndices) merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  merged.computeVertexNormals();

  return merged;
}

// ============================================================================
// 3. Atmospheric Sky Dome (Dynamic Day, Sunset, Night WEC)
// ============================================================================

const SKY_MODES = {
  day: {
    topColor: new THREE.Color(0x1e66b0),
    horizonColor: new THREE.Color(0x9fc8eb),
    groundColor: new THREE.Color(0x273f22),
    sunColor: new THREE.Color(0xfff6dc),
    sunDir: new THREE.Vector3(0.5, 0.7, 0.3).normalize(),
    sunGlow: 1.0,
    nightFactor: 0.0,
    fogColor: 0x9fc8eb,
    fogDensity: 0.0003
  },
  sunset: {
    topColor: new THREE.Color(0x1c173b),
    horizonColor: new THREE.Color(0xe65c27),
    groundColor: new THREE.Color(0x191021),
    sunColor: new THREE.Color(0xffaa54),
    sunDir: new THREE.Vector3(0.85, 0.18, 0.5).normalize(),
    sunGlow: 1.6,
    nightFactor: 0.0,
    fogColor: 0x241428,
    fogDensity: 0.0005
  },
  night: {
    topColor: new THREE.Color(0x050b1c),
    horizonColor: new THREE.Color(0x0e2138),
    groundColor: new THREE.Color(0x050a14),
    sunColor: new THREE.Color(0x9fb6d8),
    sunDir: new THREE.Vector3(0.3, 0.62, 0.3).normalize(),
    sunGlow: 0.55,
    nightFactor: 1.0,
    fogColor: 0x0a1524,
    fogDensity: 0.0004
  }
};

export function createSkyDome(scene, initialMode = 'night') {
  const skyGeo = new THREE.SphereGeometry(4500, 32, 24);

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: new THREE.Color(0x02050e) },
      uHorizonColor: { value: new THREE.Color(0x081324) },
      uGroundColor: { value: new THREE.Color(0x020408) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0x1c2b42) },
      uSunGlow: { value: 0.2 },
      uNightFactor: { value: 1.0 },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunGlow;
      uniform float uNightFactor;
      uniform float uTime;
      varying vec3 vWorldPosition;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      // One layer of stars: a jittered grid where a few cells hold a star.
      float starLayer(vec3 nPos, float scale, float threshold, float size) {
        vec2 coord = vec2(atan(nPos.z, nPos.x) * scale, nPos.y * scale * 1.85);
        vec2 grid = floor(coord);
        float rnd = hash21(grid);
        if (rnd < threshold) return 0.0;
        vec2 jitter = vec2(hash21(grid + 11.3), hash21(grid + 27.7)) - 0.5;
        float d = length(fract(coord) - 0.5 - jitter * 0.55);
        float brightness = 0.35 + 0.65 * hash21(grid + 5.1);
        return smoothstep(size, 0.0, d) * brightness;
      }

      void main() {
        vec3 nPos = normalize(vWorldPosition);
        float h = nPos.y;
        vec3 sky;

        if (h >= -0.05) {
          float t = pow(clamp(h + 0.05, 0.0, 1.0), 0.44);
          sky = mix(uHorizonColor, uTopColor, t);

          // Atmospheric Sun / Moon glow
          float sunDot = max(0.0, dot(nPos, uSunDir));
          sky += uSunColor * (pow(sunDot, 64.0) * 0.8 + pow(sunDot, 6.0) * 0.3 * uSunGlow);

          // Star field in the night sky: three densities plus a soft galactic band
          if (uNightFactor > 0.05 && h > 0.02) {
            float twinkle = 0.72 + 0.28 * sin(uTime * 2.4 + nPos.x * 60.0 + nPos.z * 40.0);
            float stars = 0.0;
            stars += starLayer(nPos, 90.0, 0.976, 0.42);
            stars += starLayer(nPos, 170.0, 0.988, 0.30) * 0.7;
            stars += starLayer(nPos, 320.0, 0.994, 0.22) * 0.45;
            stars *= twinkle * uNightFactor;

            // Faint Milky Way band, tilted across the dome
            float band = exp(-pow((nPos.y + nPos.x * 0.45 + 0.12) * 2.6, 2.0));
            sky += vec3(0.28, 0.31, 0.42) * band * 0.5 * uNightFactor;

            sky += mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.95, 0.86), hash21(floor(nPos.xz * 300.0))) * stars * 1.6;
          }
        } else {
          float t = clamp(-h * 5.0, 0.0, 1.0);
          sky = mix(uHorizonColor, uGroundColor, t);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  function setMode(mode) {
    const config = SKY_MODES[mode] || SKY_MODES.night;
    skyMat.uniforms.uTopColor.value.copy(config.topColor);
    skyMat.uniforms.uHorizonColor.value.copy(config.horizonColor);
    skyMat.uniforms.uGroundColor.value.copy(config.groundColor);
    skyMat.uniforms.uSunColor.value.copy(config.sunColor);
    skyMat.uniforms.uSunDir.value.copy(config.sunDir);
    skyMat.uniforms.uSunGlow.value = config.sunGlow;
    skyMat.uniforms.uNightFactor.value = config.nightFactor;

    scene.background = config.horizonColor;
    if (scene.fog) {
      scene.fog.color.set(config.fogColor);
      scene.fog.density = config.fogDensity;
    }
  }

  setMode(initialMode);

  return {
    mesh: skyMesh,
    setMode,
    update: (dt) => {
      skyMat.uniforms.uTime.value += dt;
    },
    dispose: () => {
      scene.remove(skyMesh);
      skyGeo.dispose();
      skyMat.dispose();
    }
  };
}

// ============================================================================
// 4. Continuous Trackside Grass Verges & Embankment Skirt (Seals Road Underneath)
// ============================================================================

export function buildTrackGrassRibbons(spline, _minTrackY = 0) {
  if (!spline || spline.sampleCount < 8) return null;

  const { sampleCount, closed, positions, normals, arcLength } = spline;
  const halfWidth = spline.halfWidth || 6.0;
  const kerbWidth = 1.35;
  const vergeWidth = 4.0;
  const vergeStart = halfWidth + kerbWidth + vergeWidth - 0.4;

  const group = new THREE.Group();
  group.name = 'track-environment-grass';

  const { texture: grassTex, bumpTexture: grassBump } = createGrassTextures();
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    bumpMap: grassBump,
    bumpScale: 0.05,
    roughness: 0.94,
    metalness: 0.03,
    color: 0x325227,
    side: THREE.DoubleSide
  });

  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x1b2819,
    roughness: 0.98,
    metalness: 0.02,
    side: THREE.DoubleSide
  });

  // Grass Runoff Ribbon Profiles (Extends 32m outward from road on each side)
  // [distance offset from verge, relative Y drop, U coordinate]
  const profile = [
    { off: 0.0, yDrop: -0.05, u: 0.0 },
    { off: 4.5, yDrop: -0.18, u: 0.15 },
    { off: 12.0, yDrop: -0.55, u: 0.42 },
    { off: 24.0, yDrop: -1.35, u: 0.78 },
    { off: 36.0, yDrop: -2.40, u: 1.0 }
  ];

  for (const side of ['left', 'right']) {
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
      const v = arcLength[s] / 8.0;

      for (let p = 0; p < profile.length; p++) {
        const totalOffset = (vergeStart + profile[p].off) * sign;
        const vx = px + nx * totalOffset;
        const vy = py + profile[p].yDrop;
        const vz = pz + nz * totalOffset;

        verts.push(vx, vy, vz);
        uvs.push(profile[p].u, v);
      }
    }

    const last = closed ? sampleCount : sampleCount - 1;
    const pLen = profile.length;
    for (let s = 0; s < last; s++) {
      const s0 = s;
      const s1 = (s + 1) % sampleCount;

      for (let p = 0; p < pLen - 1; p++) {
        const a = s0 * pLen + p;
        const b = s0 * pLen + p + 1;
        const c = s1 * pLen + p;
        const d = s1 * pLen + p + 1;

        if (side === 'left') {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, grassMat);
    mesh.receiveShadow = true;
    mesh.name = `grass-verge-${side}`;
    group.add(mesh);
  }

  // Verge-to-terrain sealing skirt. The rolling terrain follows the circuit
  // elevation, so the skirt only needs to bridge the short step from the grass
  // ribbon edge down to the local ground, not plunge to the lap minimum.
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? 1 : -1;
    const outerDist = (vergeStart + 36.0) * sign;
    const verts = [];
    const indices = [];

    for (let s = 0; s < sampleCount; s++) {
      const px = positions[s * 3];
      const py = positions[s * 3 + 1];
      const pz = positions[s * 3 + 2];
      const nx = normals[s * 3];
      const nz = normals[s * 3 + 2];

      const edgeX = px + nx * outerDist;
      const edgeZ = pz + nz * outerDist;
      const topY = py - 2.40;
      const groundY = terrainHeightAt(edgeX, edgeZ);
      const botY = Math.min(topY, groundY) - 0.35;

      verts.push(edgeX, topY, edgeZ);
      verts.push(edgeX, botY, edgeZ);
    }

    const last = closed ? sampleCount : sampleCount - 1;
    for (let s = 0; s < last; s++) {
      const a = s * 2;
      const b = s * 2 + 1;
      const c = ((s + 1) % sampleCount) * 2;
      const d = ((s + 1) % sampleCount) * 2 + 1;

      if (side === 'left') {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, soilMat);
    mesh.receiveShadow = true;
    mesh.name = `soil-skirt-${side}`;
    group.add(mesh);
  }

  return group;
}

// ============================================================================
// 5. Rolling Countryside Ground Terrain (Tanah & Perbukitan Luar)
// ============================================================================

// Terrain elevation is a single analytic function shared by the ground mesh,
// the forest placement, the floodlights, the trackside props and the grass
// skirt, so every object sits on the exact same surface and nothing floats or
// sinks.
//
// The circuit is not flat (Spa spans roughly 100m of altitude), so the ground
// cannot be a single flat sheet at the global minimum: doing that buries the
// terrain ~30m under the high half of the lap and leaves the road on a cliff.
// Instead the ground samples the nearest point on the track and follows its
// elevation nearby, then blends outward into rolling hills. That keeps the
// trackside level with the shoulder and lets the landscape rise and fall with
// the circuit.
let terrainContext = null;

export function setTerrainContext(spline, minTrackY) {
  let cx = 0, cz = 0;
  const trackPoints = [];
  if (spline && spline.positions && spline.sampleCount > 0) {
    for (let s = 0; s < spline.sampleCount; s++) {
      const px = spline.positions[s * 3];
      const pz = spline.positions[s * 3 + 2];
      cx += px;
      cz += pz;
    }
    cx /= spline.sampleCount;
    cz /= spline.sampleCount;

    // Keep one point every ~64m for nearest-track queries. The full 1.5m
    // sample set is far too dense to scan per terrain vertex.
    const stride = Math.max(1, Math.round(64 / (spline.sampleSpacing || 1.5)));
    for (let s = 0; s < spline.sampleCount; s += stride) {
      trackPoints.push({
        x: spline.positions[s * 3],
        y: spline.positions[s * 3 + 1],
        z: spline.positions[s * 3 + 2]
      });
    }
  }
  terrainContext = { cx, cz, minTrackY, trackPoints };
}

// Nearest track sample for a world position, squared distance returned via out.
const _nearest = { y: 0, distSq: Infinity };

function nearestTrackAt(x, z) {
  const ctx = terrainContext;
  _nearest.y = ctx ? ctx.minTrackY : 0;
  _nearest.distSq = Infinity;
  if (!ctx || ctx.trackPoints.length === 0) return _nearest;

  let bestSq = Infinity;
  let bestY = _nearest.y;
  const pts = ctx.trackPoints;
  for (let i = 0; i < pts.length; i++) {
    const dx = x - pts[i].x;
    const dz = z - pts[i].z;
    const sq = dx * dx + dz * dz;
    if (sq < bestSq) {
      bestSq = sq;
      bestY = pts[i].y;
    }
  }
  _nearest.y = bestY;
  _nearest.distSq = bestSq;
  return _nearest;
}

// Ground sits this far below the nearest road surface, matching how the grass
// verge steps down from the asphalt edge.
const SHOULDER_DROP = 1.6;
// Fully track-following inside this radius, fully hill-driven past HILL_FAR.
const TRACK_BLEND_NEAR = 55.0;
const TRACK_BLEND_FAR = 620.0;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function terrainHeightAt(x, z) {
  const ctx = terrainContext || { cx: 0, cz: 0, minTrackY: 0, trackPoints: [] };
  const nearest = nearestTrackAt(x, z);
  const dist = Math.sqrt(nearest.distSq);

  // Ground that hugs the circuit: always level with the local road shoulder,
  // never a cliff down to the lap minimum.
  const shoulderY = nearest.y - SHOULDER_DROP;

  // Rolling hills, anchored to the local shoulder so they stay continuous with
  // the trackside ground instead of dropping to a global floor.
  const hillWave1 = Math.sin(x * 0.0028) * Math.cos(z * 0.0028) * 16.0;
  const hillWave2 = Math.sin((x + z) * 0.0055) * 8.0;
  const hillElevation = hillWave1 + hillWave2;
  const hillsY = shoulderY + Math.abs(hillElevation) * 0.85;

  // Blend from hugging the track to open countryside with distance.
  const t = smoothstep(TRACK_BLEND_NEAR, TRACK_BLEND_FAR, dist);
  const blended = shoulderY + (hillsY - shoulderY) * t;

  // The lap minimum is a hard floor: the ground may never fall below the
  // lowest point of the circuit, which is what created the sunken basin.
  const floorY = ctx.minTrackY - SHOULDER_DROP;
  return Math.max(blended, floorY);
}

export function buildRollingTerrain(spline, minTrackY = 0) {
  const size = 5200;
  // 220 segments puts vertices roughly every 24m, dense enough for the ground
  // to actually follow the circuit elevation near the track instead of
  // stair-stepping across it.
  const segments = 220;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  setTerrainContext(spline, minTrackY);

  const posAttr = geo.attributes.position;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, terrainHeightAt(x, z));
  }

  geo.computeVertexNormals();

  const { texture: grassTex } = createGrassTextures();
  const terrainMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    color: 0x223a1c,
    roughness: 0.95,
    metalness: 0.02,
    side: THREE.DoubleSide
  });

  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  terrain.name = 'rolling-countryside-terrain';

  return terrain;
}

// ============================================================================
// 6. Realistic 3D Trees (InstancedMesh: Ardennes Pines & Broadleaf Oaks)
// ============================================================================

function createPineTreeGeometry() {
  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.48, 4.4, 6);
  trunkGeo.translate(0, 2.2, 0);

  // 3-tiered conical foliage
  const cone1 = new THREE.ConeGeometry(2.8, 4.2, 7);
  cone1.translate(0, 4.2, 0);

  const cone2 = new THREE.ConeGeometry(2.1, 3.6, 7);
  cone2.translate(0, 6.4, 0);

  const cone3 = new THREE.ConeGeometry(1.4, 2.8, 7);
  cone3.translate(0, 8.4, 0);

  const foliageGeo = mergeBufferGeometries([cone1, cone2, cone3]);

  cone1.dispose();
  cone2.dispose();
  cone3.dispose();

  return { trunkGeo, foliageGeo };
}

function createOakTreeGeometry() {
  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.58, 3.8, 6);
  trunkGeo.translate(0, 1.9, 0);

  // 4 overlapping low-poly faceted crowns
  const crown1 = new THREE.IcosahedronGeometry(2.4, 1);
  crown1.translate(0, 5.0, 0);

  const crown2 = new THREE.IcosahedronGeometry(1.9, 1);
  crown2.translate(1.2, 4.5, 0.4);

  const crown3 = new THREE.IcosahedronGeometry(1.8, 1);
  crown3.translate(-1.1, 4.7, -0.5);

  const crown4 = new THREE.IcosahedronGeometry(1.7, 1);
  crown4.translate(0.1, 6.5, 0.1);

  const foliageGeo = mergeBufferGeometries([crown1, crown2, crown3, crown4]);

  crown1.dispose();
  crown2.dispose();
  crown3.dispose();
  crown4.dispose();

  return { trunkGeo, foliageGeo };
}

export function createTracksideForest(spline, minTrackY = 0, cameraStands = []) {
  if (!spline || spline.sampleCount < 8) return null;

  const group = new THREE.Group();
  group.name = 'track-environment-forest';

  const { trunkGeo: pineTrunkGeo, foliageGeo: pineFoliageGeo } = createPineTreeGeometry();
  const { trunkGeo: oakTrunkGeo, foliageGeo: oakFoliageGeo } = createOakTreeGeometry();

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x3d2716,
    roughness: 0.96,
    metalness: 0.02
  });

  const pineFoliageMat = new THREE.MeshStandardMaterial({
    color: 0x1d3e20,
    roughness: 0.88,
    metalness: 0.02
  });

  const oakFoliageMat = new THREE.MeshStandardMaterial({
    color: 0x2e5624,
    roughness: 0.88,
    metalness: 0.02
  });

  // Pre-calculate TV broadcast camera sightline corridors to guarantee zero tree obstruction
  const cameraCorridors = [];
  if (cameraStands && cameraStands.length > 0) {
    const offsets = [-0.045, -0.03, -0.015, 0.0, 0.015, 0.03, 0.045];
    for (const stand of cameraStands) {
      const standCorridor = {
        sx: stand.x,
        sz: stand.z,
        rays: []
      };
      for (const off of offsets) {
        const p = spline.poseAtPct(stand.pct + off);
        const dx = p.x - stand.x;
        const dz = p.z - stand.z;
        standCorridor.rays.push({
          dx,
          dz,
          lenSq: Math.max(1.0, dx * dx + dz * dz)
        });
      }
      cameraCorridors.push(standCorridor);
    }
  }

  // Reject any candidate whose distance to the nearest point on the racing
  // surface is below the safe buffer. This is what keeps trees out of the
  // middle of the circuit: band offsets are measured from the local tangent,
  // but on tight loops the opposite side of the track can be metres away.
  function isTooCloseToTrack(treeX, treeZ, safeDist) {
    const safeSq = safeDist * safeDist;
    for (let s = 0; s < sampleCount; s += 2) {
      const dx = treeX - positions[s * 3];
      const dz = treeZ - positions[s * 3 + 2];
      if (dx * dx + dz * dz < safeSq) return true;
    }
    return false;
  }

  function isTreeBlockingCamera(treeX, treeZ) {
    if (cameraCorridors.length === 0) return false;
    for (let c = 0; c < cameraCorridors.length; c++) {
      const corr = cameraCorridors[c];
      const dxStand = treeX - corr.sx;
      const dzStand = treeZ - corr.sz;
      // 1. Clear 34m circular buffer around the TV camera scaffold tower
      if (dxStand * dxStand + dzStand * dzStand < 1156.0) return true;

      // 2. Clear 18m corridor around all sightline rays from tower to the track
      for (let r = 0; r < corr.rays.length; r++) {
        const ray = corr.rays[r];
        const t = Math.max(0.0, Math.min(1.0, (dxStand * ray.dx + dzStand * ray.dz) / ray.lenSq));
        const px = corr.sx + t * ray.dx;
        const pz = corr.sz + t * ray.dz;
        const dRaySq = (treeX - px) * (treeX - px) + (treeZ - pz) * (treeZ - pz);
        if (dRaySq < 324.0) return true;
      }
    }
    return false;
  }

  // Tree Candidate Placement Collection
  const pineInstances = [];
  const oakInstances = [];

  const { sampleCount, positions, normals } = spline;
  const halfWidth = spline.halfWidth || 6.0;
  const safeBuffer = halfWidth + 14.0; // Strictly outside racing line, kerbs, and verges

  // Keep roots on the shared terrain surface, minus a small embed so no gap
  // shows at the trunk base on slopes.
  const groundY = (tx, tz) => terrainHeightAt(tx, tz) - 0.25;

  // Step along spline (every ~9 meters)
  const step = Math.max(3, Math.round(sampleCount / 220));

  for (let s = 0; s < sampleCount; s += step) {
    const px = positions[s * 3];
    const pz = positions[s * 3 + 2];
    const nx = normals[s * 3];
    const nz = normals[s * 3 + 2];

    for (const sideSign of [1, -1]) {
      // Band 1: Trackside Verge Tree Line (offset 22m - 38m)
      if (Math.random() < 0.45) {
        const offset = safeBuffer + 4.0 + Math.random() * 16.0;
        const tx = px + nx * offset * sideSign + (Math.random() - 0.5) * 8.0;
        const tz = pz + nz * offset * sideSign + (Math.random() - 0.5) * 8.0;

        // Skip any tree that obstructs TV cameras, sightlines, or the track itself
        if (isTreeBlockingCamera(tx, tz)) continue;
        if (isTooCloseToTrack(tx, tz, safeBuffer)) continue;

        const ty = groundY(tx, tz);
        const scale = 0.8 + Math.random() * 0.45;
        const rotY = Math.random() * Math.PI * 2;

        if (Math.random() < 0.6) {
          pineInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.85 + Math.random() * 0.3 });
        } else {
          oakInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.85 + Math.random() * 0.3 });
        }
      }

      // Band 2: Mid-ground Forest Belt (offset 45m - 90m)
      if (Math.random() < 0.75) {
        const clusterSize = 2 + Math.floor(Math.random() * 3);
        const baseOffset = safeBuffer + 25.0 + Math.random() * 45.0;

        for (let c = 0; c < clusterSize; c++) {
          const jitterX = (Math.random() - 0.5) * 22.0;
          const jitterZ = (Math.random() - 0.5) * 22.0;
          const tx = px + nx * baseOffset * sideSign + jitterX;
          const tz = pz + nz * baseOffset * sideSign + jitterZ;

          // Skip any tree that obstructs TV cameras, sightlines, or the track itself
          if (isTreeBlockingCamera(tx, tz)) continue;
          if (isTooCloseToTrack(tx, tz, safeBuffer)) continue;

          const ty = groundY(tx, tz);
          const scale = 0.75 + Math.random() * 0.55;
          const rotY = Math.random() * Math.PI * 2;

          if (Math.random() < 0.65) {
            pineInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.8 + Math.random() * 0.4 });
          } else {
            oakInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.8 + Math.random() * 0.4 });
          }
        }
      }

      // Band 3: Distant Hillside Woods (offset 95m - 210m)
      if (Math.random() < 0.55) {
        const clusterSize = 2 + Math.floor(Math.random() * 4);
        const baseOffset = safeBuffer + 75.0 + Math.random() * 110.0;

        for (let c = 0; c < clusterSize; c++) {
          const jitterX = (Math.random() - 0.5) * 35.0;
          const jitterZ = (Math.random() - 0.5) * 35.0;
          const tx = px + nx * baseOffset * sideSign + jitterX;
          const tz = pz + nz * baseOffset * sideSign + jitterZ;

          // Skip any tree that obstructs TV cameras, sightlines, or the track itself
          if (isTreeBlockingCamera(tx, tz)) continue;
          if (isTooCloseToTrack(tx, tz, halfWidth + 6.0)) continue;

          const ty = groundY(tx, tz);
          const scale = 0.85 + Math.random() * 0.6;
          const rotY = Math.random() * Math.PI * 2;

          if (Math.random() < 0.6) {
            pineInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.75 + Math.random() * 0.45 });
          } else {
            oakInstances.push({ x: tx, y: ty, z: tz, scale, rotY, tone: 0.75 + Math.random() * 0.45 });
          }
        }
      }
    }
  }

  // Populate Instanced Meshes
  const dummy = new THREE.Object3D();
  const dummyColor = new THREE.Color();

  // 1. Pines
  const pineCount = pineInstances.length;
  if (pineCount > 0) {
    const pineTrunkMesh = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, pineCount);
    const pineFoliageMesh = new THREE.InstancedMesh(pineFoliageGeo, pineFoliageMat, pineCount);
    pineTrunkMesh.castShadow = true;
    pineTrunkMesh.receiveShadow = true;
    pineFoliageMesh.castShadow = true;
    pineFoliageMesh.receiveShadow = true;

    for (let i = 0; i < pineCount; i++) {
      const inst = pineInstances[i];
      dummy.position.set(inst.x, inst.y, inst.z);
      dummy.rotation.set(0, inst.rotY, 0);
      dummy.scale.set(inst.scale, inst.scale, inst.scale);
      dummy.updateMatrix();

      pineTrunkMesh.setMatrixAt(i, dummy.matrix);
      pineFoliageMesh.setMatrixAt(i, dummy.matrix);

      // Organic foliage color variation (rich Ardennes pine tones)
      dummyColor.setRGB(0.11 * inst.tone, 0.24 * inst.tone, 0.12 * inst.tone);
      pineFoliageMesh.setColorAt(i, dummyColor);
    }

    pineTrunkMesh.instanceMatrix.needsUpdate = true;
    pineFoliageMesh.instanceMatrix.needsUpdate = true;
    if (pineFoliageMesh.instanceColor) pineFoliageMesh.instanceColor.needsUpdate = true;

    group.add(pineTrunkMesh);
    group.add(pineFoliageMesh);
  }

  // 2. Oaks
  const oakCount = oakInstances.length;
  if (oakCount > 0) {
    const oakTrunkMesh = new THREE.InstancedMesh(oakTrunkGeo, trunkMat, oakCount);
    const oakFoliageMesh = new THREE.InstancedMesh(oakFoliageGeo, oakFoliageMat, oakCount);
    oakTrunkMesh.castShadow = true;
    oakTrunkMesh.receiveShadow = true;
    oakFoliageMesh.castShadow = true;
    oakFoliageMesh.receiveShadow = true;

    for (let i = 0; i < oakCount; i++) {
      const inst = oakInstances[i];
      dummy.position.set(inst.x, inst.y, inst.z);
      dummy.rotation.set(0, inst.rotY, 0);
      dummy.scale.set(inst.scale, inst.scale, inst.scale);
      dummy.updateMatrix();

      oakTrunkMesh.setMatrixAt(i, dummy.matrix);
      oakFoliageMesh.setMatrixAt(i, dummy.matrix);

      // Organic foliage color variation (European broadleaf oak tones)
      dummyColor.setRGB(0.18 * inst.tone, 0.34 * inst.tone, 0.14 * inst.tone);
      oakFoliageMesh.setColorAt(i, dummyColor);
    }

    oakTrunkMesh.instanceMatrix.needsUpdate = true;
    oakFoliageMesh.instanceMatrix.needsUpdate = true;
    if (oakFoliageMesh.instanceColor) oakFoliageMesh.instanceColor.needsUpdate = true;

    group.add(oakTrunkMesh);
    group.add(oakFoliageMesh);
  }

  return group;
}

// ============================================================================
// 7. Trackside Floodlight Masts (WEC night visibility)
// ============================================================================

// A sparse ring of tall lamp masts with a soft light pool. Only a handful of
// real lights are used (kept off the shadow pass) because the ambient rig
// already carries the exposure; these exist to give the night circuit
// readable landmarks instead of a black void.
export function createTracksideFloodlights(scene, spline) {
  if (!spline || spline.sampleCount < 8) return null;

  const group = new THREE.Group();
  group.name = 'track-environment-floodlights';

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a3444, metalness: 0.7, roughness: 0.45 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xe8f1ff,
    emissive: 0xdce9ff,
    emissiveIntensity: 2.4
  });
  const mastGeo = new THREE.CylinderGeometry(0.18, 0.26, 18.0, 8);
  const lampGeo = new THREE.BoxGeometry(2.4, 0.35, 0.7);
  const halfWidth = spline.halfWidth || 6.0;

  const mastCount = 10;
  const lights = [];
  for (let i = 0; i < mastCount; i++) {
    const pct = (i + 0.5) / mastCount;
    const pose = spline.poseAtPct(pct);
    const sideSign = i % 2 === 0 ? 1 : -1;
    const offset = (halfWidth + 26.0) * sideSign;
    const mx = pose.x + pose.normalX * offset;
    const mz = pose.z + pose.normalZ * offset;
    const baseY = terrainHeightAt(mx, mz);

    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(mx, baseY + 9.0, mz);
    group.add(mast);

    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(pose.x + pose.normalX * offset * 0.72, baseY + 18.0, pose.z + pose.normalZ * offset * 0.72);
    lamp.lookAt(pose.x, pose.y || 0, pose.z);
    group.add(lamp);

    const light = new THREE.PointLight(0xcfe0ff, 0, 150, 1.6);
    light.position.set(lamp.position.x, baseY + 17.6, lamp.position.z);
    group.add(light);
    lights.push(light);
  }

  scene.add(group);

  return {
    group,
    setMode(mode) {
      const intensity = mode === 'night' ? 950 : mode === 'sunset' ? 220 : 0;
      for (const light of lights) light.intensity = intensity;
      lampMat.emissiveIntensity = mode === 'night' ? 2.4 : mode === 'sunset' ? 1.2 : 0.3;
    },
    dispose: () => {
      scene.remove(group);
      mastGeo.dispose();
      lampGeo.dispose();
      mastMat.dispose();
      lampMat.dispose();
    }
  };
}

// ============================================================================
// 8. Trackside Furniture (Marshals, Barriers, Grandstands, Gantry, Boards)
// ============================================================================

// WEC marshals wear hi-vis so they are the first thing the eye finds at night.
const MARSHAL_COLORS = [
  [0.94, 0.55, 0.13],
  [0.95, 0.82, 0.15],
  [0.85, 0.22, 0.18]
];

function createFlagTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const cell = 16;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f4f6f8' : '#15181d';
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function createBillboardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0c1016';
  ctx.fillRect(0, 0, 384, 128);
  ctx.fillStyle = '#ff6b00';
  ctx.fillRect(0, 110, 384, 18);

  ctx.fillStyle = '#eef3f8';
  ctx.font = '900 46px "Saira", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TELEMETRY', 192, 54);
  ctx.fillStyle = '#35c7f0';
  ctx.font = '900 30px "Saira", system-ui, sans-serif';
  ctx.fillText('HUB • ENDURANCE', 192, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function createStartLightsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080a0e';
  ctx.fillRect(0, 0, 256, 128);

  const lights = [
    [0x10, 0x10, 0x10, 0x10, 0x10],
    [0x10, 0x18, 0x18, 0x18, 0x10],
    [0x12, 0x1a, 0x2a, 0x1a, 0x12]
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = '#1a1e24';
      ctx.beginPath();
      ctx.roundRect(14 + c * 48, 12 + r * 36, 34, 28, 6);
      ctx.fill();
      ctx.fillStyle = `rgb(120,${110 - r * 30},40)`;
      ctx.beginPath();
      ctx.roundRect(16 + c * 48, 14 + r * 36, 30, 24, 5);
      ctx.fill();
      void lights;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// The whole furniture set is static geometry in front of the barriers, placed
// from the same spline and terrain function as the track and forest, so nothing
// floats and the racing corridor stays completely clear.
export function createTracksideProps(scene, spline, options = {}) {
  const { cameraStands = [] } = options;
  if (!spline || spline.sampleCount < 8) return null;

  const group = new THREE.Group();
  group.name = 'track-environment-props';

  const halfWidth = spline.halfWidth || 6.0;
  const kerbWidth = 1.35;
  const vergeWidth = 4.0;
  const barrierOffset = halfWidth + kerbWidth + vergeWidth + 0.9;
  const groundY = (x, z) => terrainHeightAt(x, z);

  // Keep every camera tower sightline clear, same guarantee the forests get.
  function blocksCamera(x, z) {
    for (const stand of cameraStands) {
      const dx = x - stand.x;
      const dz = z - stand.z;
      if (dx * dx + dz * dz < 400.0) return true;
      const p = spline.poseAtPct(stand.pct);
      const rx = p.x - stand.x;
      const rz = p.z - stand.z;
      const lenSq = Math.max(1.0, rx * rx + rz * rz);
      const t = Math.max(0.0, Math.min(1.0, (dx * rx + dz * rz) / lenSq));
      const px = stand.x + t * rx;
      const pz = stand.z + t * rz;
      const ddx = x - px;
      const ddz = z - pz;
      if (ddx * ddx + ddz * ddz < 144.0) return true;
    }
    return false;
  }

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b3542, roughness: 0.5, metalness: 0.65 });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.42, metalness: 0.78 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.9, metalness: 0.05 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.95, metalness: 0.02 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.7, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc98d63, roughness: 0.8, metalness: 0.02 });
  const flagTex = createFlagTexture();
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide });
  const lightBarMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f25,
    emissive: 0x9fb4cc,
    emissiveIntensity: 0.5,
    roughness: 0.5,
    metalness: 0.4
  });
  const boardTex = createBillboardTexture();
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
  const boardFrameMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.6, metalness: 0.5 });
  const startLightMat = new THREE.MeshStandardMaterial({
    map: createStartLightsTexture(),
    roughness: 0.5,
    metalness: 0.3,
    side: THREE.DoubleSide
  });

  // ---- 8a. Continuous concrete wall + guardrail on the outside of bends -----
  const wallStep = Math.max(2, Math.round(spline.sampleCount / 260));
  const wallInner = [];
  const wallOuter = [];
  const railLow = [];
  const railHigh = [];
  for (let s = 0; s < spline.sampleCount; s += wallStep) {
    const pose = spline.poseAtPct(spline.pctAt(s));
    for (const side of [1, -1]) {
      const x = pose.x + pose.normalX * barrierOffset * side;
      const z = pose.z + pose.normalZ * barrierOffset * side;
      const terrain = groundY(x, z);
      // Barrier top follows the road-verge line so it never dips below the
      // racing surface. The base sinks to the terrain so no gap opens on hills.
      const top = pose.y + 0.55;
      const base = Math.min(terrain, top - 0.6);
      const push = side > 0 ? wallInner : wallOuter;
      push.push({ x, z, base, top });
      const rail = side > 0 ? railLow : railHigh;
      rail.push({ x, z, y: top + 0.55 });
    }
  }

  const buildWall = (samples, name) => {
    if (samples.length < 2) return;
    const verts = [];
    const indices = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      verts.push(s.x, s.base, s.z, s.x, s.top, s.z);
    }
    const last = spline.closed ? samples.length : samples.length - 1;
    for (let i = 0; i < last; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % samples.length) * 2;
      const d = ((i + 1) % samples.length) * 2 + 1;
      indices.push(a, b, c, b, d, c);
      indices.push(c, b, a, c, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, concreteMat);
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  };
  buildWall(wallInner, 'barrier-left');
  buildWall(wallOuter, 'barrier-right');

  const buildRail = (samples, name) => {
    if (samples.length < 2) return;
    const pts = samples.map((s) => new THREE.Vector3(s.x, s.y, s.z));
    const curve = new THREE.CatmullRomCurve3(pts, spline.closed, 'catmullrom', 0.4);
    const railGeo = new THREE.TubeGeometry(curve, pts.length * 2, 0.07, 6, spline.closed);
    const rail = new THREE.Mesh(railGeo, guardMat);
    rail.castShadow = true;
    rail.name = name;
    group.add(rail);
  };
  buildRail(railLow, 'guardrail-left');
  buildRail(railHigh, 'guardrail-right');

  // ---- 8b. Marshal posts, flags and distance marker poles -------------------
  const marshalCount = 14;
  const flagCount = 6;
  for (let i = 0; i < marshalCount; i++) {
    const pct = (i + 0.5) / marshalCount;
    const pose = spline.poseAtPct(pct);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = (barrierOffset + 4.5) * side;
    const mx = pose.x + pose.normalX * offset;
    const mz = pose.z + pose.normalZ * offset;
    if (blocksCamera(mx, mz)) continue;
    const base = groundY(mx, mz);

    // Post structure
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.8), metalMat);
    deck.position.set(mx, base + 1.5, mz);
    deck.rotation.y = pose.heading;
    deck.castShadow = true;
    group.add(deck);
    for (const [px, pz] of [[-1.0, -0.7], [1.0, -0.7], [-1.0, 0.7], [1.0, 0.7]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), metalMat);
      leg.position.set(mx + px * Math.cos(pose.heading) - pz * Math.sin(pose.heading),
        base + 0.75,
        mz + px * Math.sin(pose.heading) + pz * Math.cos(pose.heading));
      group.add(leg);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), guardMat);
    rail.position.set(mx, base + 2.1, mz);
    rail.rotation.y = pose.heading;
    group.add(rail);

    // Floodlight bar on top of the rail, bright at night.
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 0.3), lightBarMat);
    lamp.position.set(mx, base + 2.42, mz);
    lamp.rotation.y = pose.heading;
    group.add(lamp);

    // Marshal figure in hi-vis
    const tone = MARSHAL_COLORS[i % MARSHAL_COLORS.length];
    const vestMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tone[0], tone[1], tone[2]),
      roughness: 0.7,
      metalness: 0.02
    });
    const fwd = pose.heading;
    const figureX = mx - pose.normalX * 0.6 * side;
    const figureZ = mz - pose.normalZ * 0.6 * side;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8), vestMat);
    torso.position.set(figureX, base + 1.85, figureZ);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
    head.position.set(figureX, base + 2.28, figureZ);
    group.add(head);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10), vestMat);
    lid.position.set(figureX, base + 2.38, figureZ);
    group.add(lid);

    // A couple of marshals wave a flag
    if (i % 3 === 0 && i < flagCount * 3) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6), postMat);
      pole.position.set(figureX, base + 2.5, figureZ);
      pole.rotation.z = 0.4;
      group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.48), flagMat);
      flag.position.set(figureX + 0.42, base + 3.0, figureZ);
      flag.rotation.y = fwd + 0.5;
      group.add(flag);
    }

    // Marshal post number plate facing the track
    if (i % 2 === 0) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), postMat);
      const towardTrack = -side;
      sign.position.set(
        mx + pose.normalX * 1.35 * towardTrack,
        base + 1.9,
        mz + pose.normalZ * 1.35 * towardTrack
      );
      sign.rotation.y = fwd + Math.PI / 2;
      group.add(sign);
    }
  }

  // Marker / braking boards on the approach to corners, plus light poles.
  for (let i = 0; i < 22; i++) {
    const pct = (i + 0.5) / 22;
    const pose = spline.poseAtPct(pct);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = (barrierOffset + 1.6) * side;
    const x = pose.x + pose.normalX * offset;
    const z = pose.z + pose.normalZ * offset;
    const base = groundY(x, z);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), postMat);
    pole.position.set(x, base + 1.3, z);
    group.add(pole);

    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), postMat);
    board.position.set(x, base + 2.2, z);
    board.rotation.y = pose.heading + Math.PI / 2;
    group.add(board);
  }

  // ---- 8c. Tire stacks at corner entries ------------------------------------
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
  const { curvature, sampleCount } = spline;
  const tireDummy = new THREE.Object3D();
  const tireSpots = [];
  const tireMatrices = [];
  for (let s = 0; s < sampleCount; s += 4) {
    if (Math.abs(curvature[s]) < 0.006) continue;
    const pose = spline.poseAtPct(spline.pctAt(s));
    const side = curvature[s] >= 0 ? -1 : 1;
    const offset = (barrierOffset + 1.4) * side;
    const x = pose.x + pose.normalX * offset;
    const z = pose.z + pose.normalZ * offset;
    if (blocksCamera(x, z)) continue;
    if (tireSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 14)) continue;
    tireSpots.push({ x, z });

    const base = groundY(x, z);
    const stack = 3 + Math.floor(Math.random() * 2);
    for (let t = 0; t < stack; t++) {
      tireDummy.position.set(x, base + 0.11 + t * 0.22, z);
      tireDummy.rotation.set(0, Math.random() * Math.PI, 0);
      tireDummy.updateMatrix();
      tireMatrices.push(tireDummy.matrix.clone());
    }
  }
  if (tireMatrices.length > 0) {
    const tires = new THREE.InstancedMesh(tireGeo, tireMat, tireMatrices.length);
    tires.castShadow = true;
    tires.receiveShadow = true;
    tireMatrices.forEach((m, i) => tires.setMatrixAt(i, m));
    tires.instanceMatrix.needsUpdate = true;
    group.add(tires);
  }

  // ---- 8d. Grandstands facing the track -----------------------------------
  // Stands are placed outboard of the barrier and rotated so their open side
  // faces the circuit. In this local frame +Z is "toward the track", the rows
  // step back along -Z and rise, and the roof cantilevers over the front row.
  const standCount = 6;
  const standSections = [];
  for (let i = 0; i < standCount; i++) {
    const pct = (i + 0.5) / standCount;
    const pose = spline.poseAtPct(pct);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = (barrierOffset + 24.0) * side;
    const cx = pose.x + pose.normalX * offset;
    const cz = pose.z + pose.normalZ * offset;
    if (blocksCamera(cx, cz)) continue;
    const base = groundY(cx, cz);
    // Yaw that points local +Z from the stand back toward the track centre.
    const yaw = pose.heading - (Math.PI / 2) * side;
    standSections.push({ cx, cz, base, yaw, side });
  }

  if (standSections.length > 0) {
    const rows = 8;
    const width = 46;
    const rowDepth = 1.15;
    const rowRise = 0.42;
    const totalDepth = rows * rowDepth;

    for (const stand of standSections) {
      const standGroup = new THREE.Group();
      standGroup.position.set(stand.cx, stand.base, stand.cz);
      standGroup.rotation.y = stand.yaw;

      // Rows climb away from the track, so the lowest row is nearest the front
      // edge (+Z) and the highest is at the back (-Z).
      for (let r = 0; r < rows; r++) {
        const z = -r * rowDepth;
        const step = new THREE.Mesh(
          new THREE.BoxGeometry(width, rowRise * (r + 1), rowDepth * 0.9),
          concreteMat
        );
        step.position.set(0, (rowRise * (r + 1)) / 2, z);
        step.receiveShadow = true;
        standGroup.add(step);

        const seats = new THREE.Mesh(
          new THREE.BoxGeometry(width - 1.2, 0.16, rowDepth * 0.55),
          metalMat
        );
        seats.position.set(0, rowRise * (r + 1) + 0.08, z + rowDepth * 0.18);
        standGroup.add(seats);
      }

      const topY = rowRise * rows;

      // Front retaining wall along the lowest row, facing the track.
      const facade = new THREE.Mesh(new THREE.BoxGeometry(width, 1.6, 0.35), concreteMat);
      facade.position.set(0, 0.8, rowDepth * 0.45);
      facade.castShadow = true;
      standGroup.add(facade);

      // Roof: cantilevered forward over the front rows, sloping up to the back.
      const roofDepth = totalDepth + 5.0;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 3, 0.35, roofDepth), guardMat);
      roof.position.set(0, topY + 4.6, -totalDepth / 2 + 1.6);
      roof.rotation.x = 0.09;
      roof.castShadow = true;
      standGroup.add(roof);

      // Roof support columns at the two front corners.
      for (const sx of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, topY + 4.6, 0.4), metalMat);
        col.position.set(sx * (width / 2 + 0.8), (topY + 4.6) / 2, rowDepth * 0.45);
        col.castShadow = true;
        standGroup.add(col);
      }

      // Rear concourse / paddock building mass behind the seating.
      const back = new THREE.Mesh(new THREE.BoxGeometry(width + 6, 5.0, 8.0), concreteMat);
      back.position.set(0, 2.5, -totalDepth - 4.0);
      back.castShadow = true;
      back.receiveShadow = true;
      standGroup.add(back);

      const backRoof = new THREE.Mesh(new THREE.BoxGeometry(width + 6.6, 0.4, 8.6), boardFrameMat);
      backRoof.position.set(0, 5.2, -totalDepth - 4.0);
      standGroup.add(backRoof);

      // Crowd blocks: instanced, low-poly, muted palette, sitting on each row.
      const crowdGeo = new THREE.BoxGeometry(0.42, 0.72, 0.34);
      const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02 });
      const crowdBudget = rows * Math.floor(width) * 2;
      const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdBudget);
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const palette = [0x2c3e50, 0x7f8c8d, 0xc0392b, 0x2980b9, 0xd35400, 0x8e44ad, 0x27ae60, 0x95a5a6, 0xecf0f1, 0x34495e];
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        const z = -r * rowDepth;
        const seatY = rowRise * (r + 1) + 0.16;
        for (let c = 0; c < width - 1; c++) {
          if (idx >= crowdBudget) break;
          if (Math.random() > 0.62) continue;
          dummy.position.set(-width / 2 + 0.6 + c, seatY + 0.36, z + rowDepth * 0.18);
          dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
          dummy.scale.set(1, 0.9 + Math.random() * 0.25, 1);
          dummy.updateMatrix();
          crowd.setMatrixAt(idx, dummy.matrix);
          color.setHex(palette[(Math.random() * palette.length) | 0]);
          color.multiplyScalar(0.8 + Math.random() * 0.35);
          crowd.setColorAt(idx, color);
          idx++;
        }
      }
      crowd.count = idx;
      crowd.instanceMatrix.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
      standGroup.add(crowd);

      group.add(standGroup);
    }
  }

  // ---- 8e. Start/finish gantry with lights --------------------------------
  {
    const pose = spline.poseAtPct(0.0);
    const span = barrierOffset + 3.0;
    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(pose.x, 0, pose.z);
    gantryGroup.rotation.y = pose.heading;

    const towerH = 9.6;
    const beamY = 9.0;
    for (const sx of [-1, 1]) {
      const wx = pose.x + pose.normalX * span * sx;
      const wz = pose.z + pose.normalZ * span * sx;
      const base = groundY(wx, wz);
      // Tower is placed in the rotated group frame, so only its height varies.
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.7, towerH, 0.7), metalMat);
      tower.position.set(sx * span, base + towerH / 2, 0);
      tower.castShadow = true;
      gantryGroup.add(tower);
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.4, 1.1, 1.1), metalMat);
    beam.position.set(0, beamY, 0);
    beam.castShadow = true;
    gantryGroup.add(beam);

    const lightPanel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), startLightMat);
    lightPanel.position.set(0, beamY - 1.3, 0.58);
    gantryGroup.add(lightPanel);

    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.7, 1.0), boardMat);
    banner.position.set(0, beamY + 0.9, 0.0);
    banner.rotation.y = Math.PI;
    gantryGroup.add(banner);

    group.add(gantryGroup);
  }

  // ---- 8f. Advertising boards on the straights -----------------------------
  const boardCount = 10;
  for (let i = 0; i < boardCount; i++) {
    const pct = (i + 0.35) / boardCount;
    const pose = spline.poseAtPct(pct);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = (barrierOffset + 2.6) * side;
    const x = pose.x + pose.normalX * offset;
    const z = pose.z + pose.normalZ * offset;
    if (blocksCamera(x, z)) continue;
    const base = groundY(x, z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 2.4), boardMat);
    board.position.set(x, base + 1.6, z);
    board.rotation.y = pose.heading + Math.PI / 2 + (side > 0 ? 0 : Math.PI);
    group.add(board);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.6, 0.12), boardFrameMat);
    frame.position.set(x - pose.normalX * 0.12 * side, base + 1.6, z - pose.normalZ * 0.12 * side);
    frame.rotation.y = board.rotation.y;
    group.add(frame);
  }

  // ---- 8g. Overhead track bridge -------------------------------------------
  {
    const bridgePct = 0.82;
    const pose = spline.poseAtPct(bridgePct);
    const ahead = spline.poseAtPct(Math.min(1.0, bridgePct + 4.0 / spline.totalLength));
    const dx = ahead.x - pose.x;
    const dz = ahead.z - pose.z;
    const dlen = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx / dlen, dz / dlen);
    const span = halfWidth + 9.0;
    const bridge = new THREE.Group();
    const baseY = pose.y || 0;
    bridge.position.set(pose.x, baseY, pose.z);
    bridge.rotation.y = heading;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 1.2, 9.0), concreteMat);
    deck.position.set(0, 7.2, 0);
    deck.castShadow = true;
    bridge.add(deck);

    const parapetMat = new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.85, metalness: 0.05 });
    for (const sx of [-1, 1]) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.9, 0.3), parapetMat);
      parapet.position.set(0, 8.2, sx * 4.3);
      bridge.add(parapet);
    }

    for (const sx of [-1, 1]) {
      const px = sx * (halfWidth + 3.2);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.8, 7.4, 2.4), concreteMat);
      pier.position.set(px, 3.6, 0);
      pier.castShadow = true;
      bridge.add(pier);
    }

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.6, 1.4), boardMat);
    sign.position.set(0, 6.1, 4.1);
    bridge.add(sign);

    group.add(bridge);
  }

  scene.add(group);

  return {
    group,
    setMode(mode) {
      // Floodlight bars on the marshal posts read brightest at night.
      lightBarMat.emissiveIntensity = mode === 'night' ? 1.1 : mode === 'sunset' ? 0.7 : 0.25;
    },
    dispose: () => {
      scene.remove(group);
      group.traverse((obj) => {
        if (obj.isMesh || obj.isInstancedMesh) {
          if (obj.geometry) obj.geometry.dispose();
        }
      });
    }
  };
}

// ============================================================================
// 9. Master Environment Controller
// ============================================================================

export function createTrackEnvironment(scene, spline, options = {}) {
  const { initialLightingMode = 'night', minTrackY = 0, cameraStands = [] } = options;

  // 1. Atmospheric Sky Dome
  const skyDome = createSkyDome(scene, initialLightingMode);

  // 2. Seed the shared terrain height field first: the grass skirt, the ground
  //    mesh, the forest, the floodlights and the trackside props all sample the
  //    same function, so it must be ready before any of them are built.
  setTerrainContext(spline, minTrackY);

  // 3. Grass Verges & Under-Road Skirt (skirt seals to the local terrain)
  const grassGroup = buildTrackGrassRibbons(spline, minTrackY);
  if (grassGroup) scene.add(grassGroup);

  // 4. Rolling Countryside Terrain (follows the circuit elevation nearby)
  const terrainMesh = buildRollingTerrain(spline, minTrackY);
  if (terrainMesh) scene.add(terrainMesh);

  // 5. Instanced 3D Forests (Pines & Oaks with TV Camera Sightline Clearances)
  const forestGroup = createTracksideForest(spline, minTrackY, cameraStands);
  if (forestGroup) scene.add(forestGroup);

  // 6. Trackside Floodlight Masts (night visibility landmarks)
  const floodlights = createTracksideFloodlights(scene, spline);
  if (floodlights) floodlights.setMode(initialLightingMode);

  // 7. Trackside Furniture: barriers, marshal posts, grandstands, gantry, boards
  const props = createTracksideProps(scene, spline, { minTrackY, cameraStands });
  if (props) props.setMode(initialLightingMode);

  return {
    skyDome,
    grassGroup,
    terrainMesh,
    forestGroup,
    floodlights,
    props,
    setLightingMode: (mode) => {
      skyDome.setMode(mode);
      if (floodlights) floodlights.setMode(mode);
      if (props) props.setMode(mode);
    },
    update: (dt) => {
      skyDome.update(dt);
    },
    dispose: () => {
      skyDome.dispose();
      if (grassGroup) scene.remove(grassGroup);
      if (terrainMesh) scene.remove(terrainMesh);
      if (forestGroup) scene.remove(forestGroup);
      if (floodlights) floodlights.dispose();
      if (props) props.dispose();
    }
  };
}
