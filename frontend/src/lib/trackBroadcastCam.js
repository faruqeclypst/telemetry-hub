/**
 * TelemetryHub Pro - Intelligent TV Broadcast Camera Director
 *
 * Implements realistic motorsport TV broadcasting:
 * 1. Professional Trackside Scaffold Towers (10.5m - 13.0m elevated vantage points)
 * 2. Dynamic Optical Zoom (Telephoto 9.5° FOV when car is far away, smoothly zooming out
 *    to 48° FOV as the car attacks the apex, and smoothly zooming back in as it pulls away)
 * 3. Human Cameraman Fluid-Head Tripod Panning (lead-framing, smooth tracking damping)
 * 4. Tree Clearance Target Points (for automated foliage exclusion)
 */

import * as THREE from 'three';

export function createBroadcastCamDirector(spline, corners = []) {
  const cameraStands = [];

  if (spline && spline.sampleCount > 10) {
    const totalLen = spline.totalLength || 4000;      // 1. Pit Straight & Start/Finish Tower
    const sfPose = spline.poseAtPct(0.005);
    cameraStands.push({
      id: 'sf-tower',
      pct: 0.005,
      name: 'Main Straight / Pit Tower',
      x: sfPose.x + sfPose.normalX * 28.0,
      y: (sfPose.y || 0) + 14.0,
      z: sfPose.z + sfPose.normalZ * 28.0,
      targetX: sfPose.x,
      targetY: sfPose.y || 0,
      targetZ: sfPose.z,
      minPct: 0.94,
      maxPct: 0.06
    });

    // 2. Corner Apex Camera Stands (Elevated outside turns for dramatic telephoto compression)
    if (corners && corners.length > 0) {
      corners.forEach((corner, idx) => {
        const apexPct = corner.apex_pct != null ? corner.apex_pct : (idx / corners.length);
        const pose = spline.poseAtPct(apexPct);

        // Place camera outside the turn on an elevated scaffold tower
        const sideSign = (corner.direction === 'left') ? -1 : 1;
        const distOffset = 34.0;
        const heightOffset = 13.5;

        // Position slightly before or at apex to capture oncoming braking and turn-in
        const standX = pose.x + pose.normalX * (distOffset * sideSign);
        const standY = (pose.y || 0) + heightOffset;
        const standZ = pose.z + pose.normalZ * (distOffset * sideSign);

        cameraStands.push({
          id: `corner-${corner.number || idx + 1}`,
          pct: apexPct,
          name: corner.name ? `${corner.name} Camera` : `Turn ${corner.number || idx + 1} Tower`,
          x: standX,
          y: standY,
          z: standZ,
          targetX: pose.x,
          targetY: pose.y || 0,
          targetZ: pose.z,
          minPct: ((apexPct - 0.045) + 1.0) % 1.0,
          maxPct: (apexPct + 0.035) % 1.0
        });
      });
    }

    // 3. Intermediate Straightaway Gantries & Berm Towers
    const stepCount = Math.max(8, Math.round(totalLen / 380));
    for (let i = 0; i < stepCount; i++) {
      const u = i / stepCount;
      const pose = spline.poseAtPct(u);
      const isNearCorner = cameraStands.some(cs => Math.abs(cs.pct - u) < 0.032);

      if (!isNearCorner) {
        // Alternate left/right side for visual variety
        const sideSign = (i % 2 === 0) ? 1 : -1;
        const standX = pose.x + pose.normalX * (30.0 * sideSign);
        const standY = (pose.y || 0) + 14.0;
        const standZ = pose.z + pose.normalZ * (30.0 * sideSign);

        cameraStands.push({
          id: `straight-${i}`,
          pct: u,
          name: `Sector ${Math.floor((u * 3) + 1)} High Gantry`,
          x: standX,
          y: standY,
          z: standZ,
          targetX: pose.x,
          targetY: pose.y || 0,
          targetZ: pose.z,
          minPct: ((u - 0.04) + 1.0) % 1.0,
          maxPct: (u + 0.04) % 1.0
        });
      }
    }
  }

  let activeStand = cameraStands[0] || null;
  let lastSwitchTime = -999;
  const smoothLookTarget = new THREE.Vector3();
  let isTargetInit = false;
  let currentFov = 38.0;

  // Calculates dynamic optical zoom FOV based on physical distance to car:
  // Tight optical telephoto (~8.5° FOV) when far away (>220m),
  // smoothly widening to 48.0° FOV as the car attacks the apex (15m - 40m).
  function calculateBroadcastFov(dist) {
    const d = Math.max(12.0, Math.min(280.0, dist));
    const t = Math.max(0.0, Math.min(1.0, (d - 15.0) / 225.0));
    const curve = Math.pow(t, 0.75); // Natural optical zoom servo response curve
    return 48.0 - curve * (48.0 - 8.5);
  }

  return {
    cameraStands,
    update(camera, targetX, targetY, targetZ, distPct, curTime, dt, zoomMultiplier = 1.0) {
      if (cameraStands.length === 0) return;

      const normPct = ((distPct % 1.0) + 1.0) % 1.0;

      // Broadcast TV Director switching logic
      const dwellTime = curTime - lastSwitchTime;
      const canSwitch = dwellTime > 2.8 || dwellTime < 0;

      // Find the camera stand that best frames the car
      let bestStand = activeStand;
      let highestScore = -Infinity;

      for (const stand of cameraStands) {
        const dx = stand.x - targetX;
        const dz = stand.z - targetZ;
        const dist = Math.hypot(dx, dz);

        // Good broadcast coverage range: 14m to 280m
        if (dist >= 14.0 && dist <= 280.0) {
          // Preference for stands where car is approaching (ahead of the car)
          let pctDiff = stand.pct - normPct;
          if (pctDiff < -0.5) pctDiff += 1.0;
          if (pctDiff > 0.5) pctDiff -= 1.0;

          // Score: high for approaching cars, moderate for receding cars
          let score = 300.0 - dist;
          if (pctDiff > 0 && pctDiff < 0.08) {
            score += 150.0; // Car is approaching this camera!
          } else if (pctDiff < 0 && pctDiff > -0.04) {
            score += 40.0; // Car recently passed camera
          }

          if (score > highestScore) {
            highestScore = score;
            bestStand = stand;
          }
        }
      }

      if (canSwitch && bestStand && bestStand !== activeStand) {
        activeStand = bestStand;
        lastSwitchTime = curTime;
        // On camera cut, snap target immediately to prevent jarring camera swings
        smoothLookTarget.set(targetX, targetY + 0.8, targetZ);
        // Snap FOV immediately for the new stand's initial distance
        const newCarDist = Math.hypot(bestStand.x - targetX, bestStand.z - targetZ);
        currentFov = calculateBroadcastFov(newCarDist) / Math.max(0.4, Math.min(2.5, zoomMultiplier));
      }

      const stand = activeStand || cameraStands[0];
      if (!stand) return;

      // 1. Position camera rigidly on the elevated trackside scaffold tower
      camera.position.set(stand.x, stand.y, stand.z);

      // 2. Human cameraman fluid-head tracking (slight inertia damping)
      const idealAim = new THREE.Vector3(targetX, targetY + 0.75, targetZ);
      if (!isTargetInit) {
        smoothLookTarget.copy(idealAim);
        isTargetInit = true;
      } else {
        const panAlpha = 1.0 - Math.exp(-14.0 * dt);
        smoothLookTarget.lerp(idealAim, panAlpha);
      }
      camera.lookAt(smoothLookTarget);

      // 3. Dynamic Optical Zoom: Telephoto when far away, wide when close
      const carDist = Math.hypot(stand.x - targetX, stand.z - targetZ);
      const idealFov = calculateBroadcastFov(carDist) / Math.max(0.4, Math.min(2.5, zoomMultiplier));

      const zoomAlpha = 1.0 - Math.exp(-9.0 * dt);
      currentFov += (idealFov - currentFov) * zoomAlpha;
      camera.fov = Math.max(5.5, Math.min(65.0, currentFov));
      camera.updateProjectionMatrix();

      return {
        standName: stand.name,
        distance: carDist
      };
    },
    reset() {
      lastSwitchTime = -999;
      isTargetInit = false;
      currentFov = 38.0;
    }
  };
}
