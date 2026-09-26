/**
 * TelemetryHub Pro - 3D Visual FX Engine
 *
 * Includes:
 * 1. 3D Floating Delta Tag (F1 Broadcast style time & distance badge between cars)
 * 2. 3D Corner Overhead Signs & Apex Gantries
 * 3. Dynamic Skidmarks & Braking Point Indicators
 */

import * as THREE from 'three';

// ----------------------------------------------------------------------------
// 1. Floating 3D Delta Tag between Driver and Ghost
// ----------------------------------------------------------------------------
export function createDeltaTagSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // The tag floats above the cars and is depth tested, so hills, trees and the
  // car itself occlude it correctly. depthWrite stays off so it never punches a
  // hole in the scene it overlaps.
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(4.2, 1.3, 1.0);
  sprite.renderOrder = 5;
  sprite.visible = false;

  let lastText = '';

  return {
    sprite,
    update(driverPose, ghostPose, deltaSec, deltaMeters) {
      if (!driverPose || !ghostPose || deltaSec == null) {
        sprite.visible = false;
        return;
      }

      sprite.visible = true;

      // Position floating above the ghost car
      sprite.position.set(ghostPose.x, (ghostPose.y || 0) + 2.2, ghostPose.z);

      const sign = deltaSec <= 0 ? '−' : '+';
      const absDelta = Math.abs(deltaSec).toFixed(2);
      const absDist = Math.abs(deltaMeters || 0).toFixed(1);
      const textKey = `${sign}${absDelta}_${absDist}`;

      if (textKey === lastText) return;
      lastText = textKey;

      const isAhead = deltaSec <= 0;
      const primaryColor = isAhead ? '#3fd68c' : '#ff5c5c';
      const labelText = isAhead ? `GHOST AHEAD ${sign}${absDelta}s` : `GHOST BEHIND ${sign}${absDelta}s`;

      ctx.clearRect(0, 0, 512, 160);

      // Pill container
      ctx.fillStyle = 'rgba(7, 11, 16, 0.92)';
      ctx.beginPath();
      ctx.roundRect(16, 16, 480, 128, 24);
      ctx.fill();

      // Border glow
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Left status bar
      ctx.fillStyle = primaryColor;
      ctx.beginPath();
      ctx.roundRect(16, 16, 16, 128, [24, 0, 0, 24]);
      ctx.fill();

      // Top label
      ctx.font = 'bold 24px "Saira", system-ui, sans-serif';
      ctx.fillStyle = '#9aa6b2';
      ctx.textAlign = 'left';
      ctx.fillText(labelText, 52, 54);

      // Delta time value
      ctx.font = '800 52px "JetBrains Mono", monospace';
      ctx.fillStyle = primaryColor;
      ctx.fillText(`${sign}${absDelta}s`, 52, 114);

      // Distance tag
      ctx.font = 'bold 26px "JetBrains Mono", monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'right';
      ctx.fillText(`${absDist}m`, 468, 112);

      texture.needsUpdate = true;
    }
  };
}

// ----------------------------------------------------------------------------
// 2. 3D Corner Overhead Signs (Holographic Apex Gantries)
// ----------------------------------------------------------------------------
export function createCornerGantry(corner, spline) {
  const group = new THREE.Group();
  const apexPct = corner.apex_pct != null ? corner.apex_pct : 0;
  const pose = spline.poseAtPct(apexPct);
  const halfW = spline.halfWidth || 6.0;

  // Sign dimensions
  const postDist = halfW + 3.2;
  const signHeight = 5.2;

  // Post left and right
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1e2634,
    metalness: 0.8,
    roughness: 0.4
  });
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, signHeight, 8);

  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(pose.normalX * postDist, signHeight / 2, pose.normalZ * postDist);
  group.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(-pose.normalX * postDist, signHeight / 2, -pose.normalZ * postDist);
  group.add(rightPost);

  // Cross beam
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x111622, metalness: 0.9, roughness: 0.3 });
  const beamGeo = new THREE.BoxGeometry(postDist * 2, 0.14, 0.14);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, signHeight, 0);
  beam.rotation.y = pose.heading;
  group.add(beam);

  // Overhead Banner Canvas (High-Definition 1024x256)
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Background pill
  ctx.fillStyle = 'rgba(8, 12, 18, 0.96)';
  ctx.beginPath();
  ctx.roundRect(16, 16, 992, 224, 32);
  ctx.fill();

  // Vibrant accent border
  ctx.strokeStyle = '#35c7f0';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Corner Number Box
  ctx.fillStyle = '#ff8a3d';
  ctx.beginPath();
  ctx.roundRect(36, 36, 180, 184, 24);
  ctx.fill();

  ctx.font = '900 96px "Saira", system-ui, sans-serif';
  ctx.fillStyle = '#070b10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`T${corner.number || 1}`, 126, 128);

  // Corner Name
  const cornerName = (corner.name || `TURN ${corner.number || 1}`).toUpperCase();
  ctx.font = '800 58px "Saira", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(cornerName, 246, 114);

  // Subtitle: Apex Speed, Turn Degree & Direction
  ctx.font = 'bold 36px "JetBrains Mono", monospace';
  ctx.fillStyle = '#35c7f0';
  const vmin = corner.min_speed || corner.min_speed_kmh || corner.apex?.speed;
  const dir = (corner.direction || '').toUpperCase();
  const deg = corner.turn_deg ? `${Math.round(corner.turn_deg)}° ` : '';
  const speedText = vmin ? `APEX: ${Math.round(vmin)} KM/H  •  ${deg}${dir}` : `${deg}${dir} APEX ZONE`;
  ctx.fillText(speedText, 246, 184);

  const bannerTex = new THREE.CanvasTexture(canvas);
  bannerTex.anisotropy = 8;

  const signW = postDist * 1.5;
  const signH = 1.25;
  const halfSW = signW / 2;
  const halfSH = signH / 2;

  // Front Banner: Normal faces upstream towards oncoming traffic, U=0 on driver's left, U=1 on driver's right
  const frontGeo = new THREE.BufferGeometry();
  frontGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
     halfSW,  halfSH, 0,  // 0: Top-Left of text (screen left)
    -halfSW,  halfSH, 0,  // 1: Top-Right of text (screen right)
     halfSW, -halfSH, 0,  // 2: Bottom-Left of text
    -halfSW, -halfSH, 0   // 3: Bottom-Right of text
  ]), 3));
  frontGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 1,
    1, 1,
    0, 0,
    1, 0
  ]), 2));
  frontGeo.setIndex([0, 2, 1, 1, 2, 3]);
  frontGeo.computeVertexNormals();

  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    roughness: 0.35,
    metalness: 0.15
  });
  const banner = new THREE.Mesh(frontGeo, bannerMat);
  banner.position.set(0, signHeight - 0.65, 0);
  banner.rotation.y = pose.heading;
  group.add(banner);

  // Sleek Dark Backplate: Normal faces downstream
  const backGeo = new THREE.BufferGeometry();
  backGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -halfSW,  halfSH, 0.02,
     halfSW,  halfSH, 0.02,
    -halfSW, -halfSH, 0.02,
     halfSW, -halfSH, 0.02
  ]), 3));
  backGeo.setIndex([0, 2, 1, 1, 2, 3]);
  backGeo.computeVertexNormals();

  const backMat = new THREE.MeshStandardMaterial({
    color: 0x090d14,
    roughness: 0.6,
    metalness: 0.8
  });
  const backPlate = new THREE.Mesh(backGeo, backMat);
  backPlate.position.set(0, signHeight - 0.65, 0);
  backPlate.rotation.y = pose.heading;
  group.add(backPlate);

  group.position.set(pose.x, (pose.y || 0), pose.z);
  return group;
}

// ----------------------------------------------------------------------------
// 3. Dynamic Skidmarks & Braking Zone System
// ----------------------------------------------------------------------------
export function createSkidmarkSystem(scene) {
  // Each mark is a quad strip. Two wheels per car, so a braking event writes a
  // pair of strips that follow the wheels' actual ground contact line.
  const maxQuads = 900;
  const positions = new Float32Array(maxQuads * 6 * 3);
  const colors = new Float32Array(maxQuads * 6 * 3);

  let quadCursor = 0;
  let prevLeft = null;
  let prevRight = null;
  let fade = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  const WHEEL_HALF_SPAN = 0.9;
  const HALF_WIDTH = 0.16;

  // Contact point of one wheel in world space, on the road surface.
  function wheelPoint(carPose, side, out) {
    const cos = Math.cos(carPose.heading);
    const sin = Math.sin(carPose.heading);
    const offset = WHEEL_HALF_SPAN * side;
    // Right vector across the car plus a small rearward bias (rear wheels lock).
    out.set(
      carPose.x + cos * offset,
      (carPose.elevation != null ? carPose.elevation : carPose.y || 0) + 0.03,
      carPose.z - sin * offset
    );
    return out;
  }

  // Emit one ribbon segment from a previous contact pair to the current pair.
  // left/right are the outer edges of the wheel's contact patch.
  function pushQuad(prevA, prevB, curA, curB, shade) {
    const base = (quadCursor % maxQuads) * 6 * 3;
    const v = [prevA, prevB, curA, curB];
    // Triangle order: (prevA, prevB, curA) and (curA, prevB, curB).
    const tri = [0, 1, 2, 2, 1, 3];
    for (let i = 0; i < 6; i++) {
      const p = v[tri[i]];
      positions[base + i * 3] = p.x;
      positions[base + i * 3 + 1] = p.y;
      positions[base + i * 3 + 2] = p.z;
      colors[base + i * 3] = shade;
      colors[base + i * 3 + 1] = shade;
      colors[base + i * 3 + 2] = shade;
    }
    quadCursor++;
    geo.setDrawRange(0, Math.min(quadCursor, maxQuads) * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  const leftA = new THREE.Vector3();
  const leftEdgeL = new THREE.Vector3();
  const leftEdgeR = new THREE.Vector3();
  const rightA = new THREE.Vector3();
  const rightEdgeL = new THREE.Vector3();
  const rightEdgeR = new THREE.Vector3();

  return {
    addPoint(carPose, brakeVal, speedKmh) {
      const isLocking = brakeVal >= 55 && speedKmh >= 30;

      if (!carPose || !isLocking) {
        prevLeft = null;
        prevRight = null;
        return;
      }

      wheelPoint(carPose, 1, leftA);
      wheelPoint(carPose, -1, rightA);

      // Contact patch width across the car's heading.
      const cos = Math.cos(carPose.heading);
      const sin = Math.sin(carPose.heading);
      leftEdgeL.set(leftA.x - cos * HALF_WIDTH, leftA.y, leftA.z + sin * HALF_WIDTH);
      leftEdgeR.set(leftA.x + cos * HALF_WIDTH, leftA.y, leftA.z - sin * HALF_WIDTH);
      rightEdgeL.set(rightA.x - cos * HALF_WIDTH, rightA.y, rightA.z + sin * HALF_WIDTH);
      rightEdgeR.set(rightA.x + cos * HALF_WIDTH, rightA.y, rightA.z - sin * HALF_WIDTH);

      if (!prevLeft || !prevRight) {
        prevLeft = [leftEdgeL.clone(), leftEdgeR.clone()];
        prevRight = [rightEdgeL.clone(), rightEdgeR.clone()];
        fade = Math.min(1, (brakeVal - 55) / 45);
        return;
      }

      // Only emit a new quad once the car has moved far enough, so the strip
      // follows the road instead of clumping.
      if (leftA.distanceTo(prevLeft[0]) < 0.35) return;

      const shade = 0.02 + 0.06 * fade;
      pushQuad(prevLeft[0], prevLeft[1], leftEdgeL, leftEdgeR, shade);
      pushQuad(prevRight[0], prevRight[1], rightEdgeL, rightEdgeR, shade);

      prevLeft = [leftEdgeL.clone(), leftEdgeR.clone()];
      prevRight = [rightEdgeL.clone(), rightEdgeR.clone()];
    },
    reset() {
      prevLeft = null;
      prevRight = null;
    }
  };
}
