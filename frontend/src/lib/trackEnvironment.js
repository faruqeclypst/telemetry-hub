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

export function buildTrackGrassRibbons(spline, minTrackY = 0) {
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

  // Under-Roadbed Embankment Skirt (Seals elevated track to the ground floor)
  // Extends from outer edge of grass ribbon down to minTrackY
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

      const topY = py - 2.4;
      const botY = minTrackY - 1.2;

      verts.push(px + nx * outerDist, topY, pz + nz * outerDist);
      verts.push(px + nx * outerDist, botY, pz + nz * outerDist);
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
// the forest placement and the grass skirt, so every object sits on the exact
// same surface and nothing floats or sinks.
let terrainContext = null;

export function setTerrainContext(spline, minTrackY) {
  let cx = 0, cz = 0;
  if (spline && spline.positions && spline.sampleCount > 0) {
    for (let s = 0; s < spline.sampleCount; s++) {
      cx += spline.positions[s * 3];
      cz += spline.positions[s * 3 + 2];
    }
    cx /= spline.sampleCount;
    cz /= spline.sampleCount;
  }
  terrainContext = { cx, cz, minTrackY };
}

export function terrainHeightAt(x, z) {
  const ctx = terrainContext || { cx: 0, cz: 0, minTrackY: 0 };
  const distToCenter = Math.hypot(x - ctx.cx, z - ctx.cz);
  const hillWave1 = Math.sin(x * 0.0028) * Math.cos(z * 0.0028) * 16.0;
  const hillWave2 = Math.sin((x + z) * 0.0055) * 8.0;
  const hillElevation = hillWave1 + hillWave2;
  const hillFactor = Math.min(1.0, Math.max(0.0, (distToCenter - 450) / 750));
  return ctx.minTrackY - 1.2 + hillElevation * hillFactor;
}

export function buildRollingTerrain(spline, minTrackY = 0) {
  const size = 5200;
  const segments = 84;
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
// 8. Master Environment Controller
// ============================================================================

export function createTrackEnvironment(scene, spline, options = {}) {
  const { initialLightingMode = 'night', minTrackY = 0, cameraStands = [] } = options;

  // 1. Atmospheric Sky Dome
  const skyDome = createSkyDome(scene, initialLightingMode);

  // 2. Grass Verges & Under-Road Skirt
  const grassGroup = buildTrackGrassRibbons(spline, minTrackY);
  if (grassGroup) scene.add(grassGroup);

  // 3. Rolling Countryside Terrain. This also seeds the shared terrain height
  //    function used by the forest, so trees always sit on the ground.
  setTerrainContext(spline, minTrackY);
  const terrainMesh = buildRollingTerrain(spline, minTrackY);
  if (terrainMesh) scene.add(terrainMesh);

  // 4. Instanced 3D Forests (Pines & Oaks with TV Camera Sightline Clearances)
  const forestGroup = createTracksideForest(spline, minTrackY, cameraStands);
  if (forestGroup) scene.add(forestGroup);

  // 5. Trackside Floodlight Masts (night visibility landmarks)
  const floodlights = createTracksideFloodlights(scene, spline);
  if (floodlights) floodlights.setMode(initialLightingMode);

  return {
    skyDome,
    grassGroup,
    terrainMesh,
    forestGroup,
    floodlights,
    setLightingMode: (mode) => {
      skyDome.setMode(mode);
      if (floodlights) floodlights.setMode(mode);
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
    }
  };
}
