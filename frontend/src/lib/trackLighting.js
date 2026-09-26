/**
 * TelemetryHub Pro - Dynamic 3D Environment Lighting & Vehicle Headlight Rig
 *
 * Supports Day, Sunset, and WEC Le Mans Night with forward projector headlights,
 * volumetric beams, and brake light ground illumination.
 */

import * as THREE from 'three';

export function createLightingRig(scene) {
  // Ambient fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  // Directional Sun / Moon
  const sun = new THREE.DirectionalLight(0xfffaed, 1.4);
  sun.position.set(250, 400, 180);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2500;
  const d = 500;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Hemisphere Sky / Ground bounce
  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x1a2230, 0.35);
  scene.add(hemi);

  let currentMode = 'night';

  // Sky colour and fog are owned by the sky dome (trackEnvironment). This rig
  // only carries the lights, so there is a single source of truth for the
  // background and no flicker between the two controllers.
  function setMode(mode) {
    currentMode = mode;
    if (mode === 'day') {
      ambient.color.setHex(0xffffff);
      ambient.intensity = 0.72;
      sun.color.setHex(0xfffcf2);
      sun.intensity = 1.7;
      sun.position.set(280, 450, 180);
      hemi.color.setHex(0xa8d5ff);
      hemi.groundColor.setHex(0x2d3a4b);
      hemi.intensity = 0.55;
    } else if (mode === 'sunset') {
      ambient.color.setHex(0xff9466);
      ambient.intensity = 0.55;
      sun.color.setHex(0xff6e2a);
      sun.intensity = 1.55;
      sun.position.set(450, 110, 280);
      hemi.color.setHex(0xff7744);
      hemi.groundColor.setHex(0x1a1222);
      hemi.intensity = 0.45;
    } else {
      // Night WEC: bright enough to read the road and liveries. The floodlights
      // and car headlights add the local pools on top of this base exposure.
      ambient.color.setHex(0x2b3b55);
      ambient.intensity = 0.62;
      sun.color.setHex(0x8fa8cc);
      sun.intensity = 0.72;
      sun.position.set(160, 320, 140);
      hemi.color.setHex(0x2a3d5c);
      hemi.groundColor.setHex(0x0d1420);
      hemi.intensity = 0.5;
    }
  }

  // Initialize in default mode
  setMode('night');

  return {
    ambient,
    sun,
    hemi,
    setMode,
    getMode: () => currentMode
  };
}

export function attachCarLights(carMesh) {
  // Left and Right forward SpotLights (Headlights)
  const leftSpot = new THREE.SpotLight(0xfff6dd, 0, 120, Math.PI / 7, 0.45, 1.2);
  const rightSpot = new THREE.SpotLight(0xfff6dd, 0, 120, Math.PI / 7, 0.45, 1.2);

  leftSpot.position.set(0.65, 0.55, 2.2);
  rightSpot.position.set(-0.65, 0.55, 2.2);

  const leftTarget = new THREE.Object3D();
  leftTarget.position.set(0.65, 0.1, 45);
  const rightTarget = new THREE.Object3D();
  rightTarget.position.set(-0.65, 0.1, 45);

  carMesh.add(leftSpot);
  carMesh.add(rightSpot);
  carMesh.add(leftTarget);
  carMesh.add(rightTarget);

  leftSpot.target = leftTarget;
  rightSpot.target = rightTarget;

  // Front bumper ground spill
  const frontSpill = new THREE.PointLight(0xfffae0, 0, 14, 1.8);
  frontSpill.position.set(0, 0.45, 3.2);
  carMesh.add(frontSpill);

  // Rear tail & brake ground light
  const rearSpill = new THREE.PointLight(0xff2222, 0, 8, 2.0);
  rearSpill.position.set(0, 0.45, -2.4);
  carMesh.add(rearSpill);

  return {
    update(lightingMode, isBraking) {
      const isNight = lightingMode === 'night';
      const isSunset = lightingMode === 'sunset';

      const headIntensity = isNight ? 8.5 : isSunset ? 4.0 : 0;
      const spillIntensity = isNight ? 3.0 : isSunset ? 1.2 : 0;

      leftSpot.intensity = headIntensity;
      rightSpot.intensity = headIntensity;
      frontSpill.intensity = spillIntensity;

      // Rear red light: glow red at night, bright glow when braking
      if (isNight || isSunset) {
        rearSpill.intensity = isBraking ? 4.5 : 1.2;
      } else {
        rearSpill.intensity = isBraking ? 1.8 : 0;
      }
    }
  };
}
