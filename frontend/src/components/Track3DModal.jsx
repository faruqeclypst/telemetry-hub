import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, Play, Pause, RotateCcw, ZoomIn, ZoomOut, Zap, Sun, Moon, Sunset, Volume2, VolumeX, Video, Activity, Gauge, Diff, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import {
  buildSplineFromSamples,
  buildRoadRibbon,
  buildKerbRibbon,
  buildVergeRibbon,
  kerbMask,
  createPoseTracker
} from '../lib/trackGeometry';
import { getTrackElevation } from '../lib/trackElevation';
import { createEngineAudio } from '../lib/trackAudio';
import { createLightingRig, attachCarLights } from '../lib/trackLighting';
import { createBroadcastCamDirector } from '../lib/trackBroadcastCam';
import { createDeltaTagSprite, createCornerGantry, createSkidmarkSystem } from '../lib/trackFx';
import { createTrackEnvironment } from '../lib/trackEnvironment';

export default function Track3DModal({
  isOpen,
  onClose,
  samples = [],
  compSamples = [],
  comparisonData = null,
  isComparing = false,
  trackName = "Daytona International Speedway Road Course",
  carName = "Mercedes-AMG LMGT3",
  driverName = "Alfaruq Asri",
  refLapNumber = 2,
  compLapNumber = 1,
  initialFocusPct = 0,
  corners = [],
  activeCornerId = null,
  sessionTelemetry = null,
  sessionTelemetryLoading = false,
  multiLapEnabled = false,
  onToggleMultiLap = null,
  laps = []
}) {
  const mountRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const markerGroupRef = useRef(null);
  const activeCornerRef = useRef(null);

  // High-level playback controls
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState('chase'); // 'chase', 'hood', 'broadcast', 'topdown', 'orbit'
  const [lightingMode, setLightingMode] = useState('night'); // 'day', 'sunset', 'night'
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [broadcastStandName, setBroadcastStandName] = useState('');
  const [uiReplayTime, setUiReplayTime] = useState(0); // throttled React state for UI (20 Hz)
  const [minimapMode, setMinimapMode] = useState(isComparing ? 'gain_loss' : 'speed');
  const [activeCar, setActiveCar] = useState('driver'); // 'driver' or 'ghost'

  // Zoom controls (0.4x to 2.5x)
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const zoomLevelRef = useRef(1.0);

  // Minimap hover state for instant Gain/Loss inspection
  const [minimapHover, setMinimapHover] = useState(null);
  const [isMinimapCollapsed, setIsMinimapCollapsed] = useState(false);
  const [showHud, setShowHud] = useState(true);

  // Layout tier for the full-screen replay. Compact keeps the canvas usable on
  // laptops and phones instead of letting the sidebar and toolbar eat the view.
  const [layoutTier, setLayoutTier] = useState('wide');

  // Compact on-canvas telemetry strip, independent of the side HUD panel so the
  // live numbers stay visible when the panel is hidden or the screen is narrow.
  const [showTelemetryOverlay, setShowTelemetryOverlay] = useState(true);

  // Floating +/− delta tag above the cars. Can be hidden independently of the
  // rest of the HUD.
  const [showDeltaTag, setShowDeltaTag] = useState(true);
  const hiddenDeltaTagRef = useRef(false);

  // Chase Camera Smoothing Refs (Zero-Jitter critically damped crane)
  const chasePosRef = useRef(new THREE.Vector3());
  const chaseLookTargetRef = useRef(new THREE.Vector3());
  const chaseCamHeadingRef = useRef(null);
  const isChaseCamInitRef = useRef(false);

  // Orbit camera: the free camera owns its own position/target once the user
  // grabs it, so the target is only re-anchored when orbit mode is entered or
  // the focused car changes. Re-anchoring every frame fights OrbitControls'
  // wheel dolly and makes the view lurch and spin.
  const orbitInitRef = useRef(false);
  const orbitFocusRef = useRef(null);
  const orbitPrevTargetRef = useRef(new THREE.Vector3());
  const orbitRigDeltaRef = useRef(new THREE.Vector3());

  // Animation & Rendering Refs (60 FPS direct engine)
  const replayTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const playbackSpeedRef = useRef(1);
  const cameraModeRef = useRef('chase');
  const lightingModeRef = useRef('night');
  const minimapModeRef = useRef(isComparing ? 'gain_loss' : 'speed');
  const activeCarRef = useRef('driver');
  const lastUiTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  // Multi-lap replay refs read inside the animation loop, kept in sync with the
  // derived values so the loop never depends on stale closures.
  const multiLapActiveRef = useRef(false);
  const multiLapDurationRef = useRef(0);
  const lapDurationRef = useRef(118.28);
  const sampleAtSessionTimeRef = useRef(() => null);
  const lapMarksRef = useRef([]);

  // Adaptive quality: drops resolution and shadow cost when the frame time
  // climbs, then restores it when there is headroom again. Keeps the replay
  // usable on weaker GPUs without a manual quality setting.
  const qualityRef = useRef({ level: 2, frames: 0, elapsed: 0 });

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const carRef = useRef(null);
  const ghostCarRef = useRef(null);
  const reqAnimRef = useRef(null);

  // Systems refs
  const lightingRigRef = useRef(null);
  const carLightsRef = useRef(null);
  const audioEngineRef = useRef(null);
  const broadcastDirectorRef = useRef(null);
  const deltaTagRef = useRef(null);
  const skidmarksRef = useRef(null);
  const trackEnvRef = useRef(null);

  // Heading damping and body attitude trackers, one per car. Created before any
  // callback that touches them so the order of hooks stays valid.
  const poseTracker = useMemo(() => createPoseTracker(), []);
  const ghostTracker = useMemo(() => createPoseTracker(), []);

  // Sync state to refs
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { lightingModeRef.current = lightingMode; }, [lightingMode]);
  useEffect(() => { minimapModeRef.current = minimapMode; }, [minimapMode]);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { hiddenDeltaTagRef.current = !showDeltaTag; }, [showDeltaTag]);
  useEffect(() => { activeCornerRef.current = activeCornerId; }, [activeCornerId]);
  useEffect(() => {
    multiLapActiveRef.current = multiLapActive;
    multiLapDurationRef.current = multiLapDuration;
    lapDurationRef.current = lapDuration;
    sampleAtSessionTimeRef.current = sampleAtSessionTime;
    lapMarksRef.current = lapMarks;
  }, [multiLapActive, multiLapDuration, lapDuration, sampleAtSessionTime, lapMarks]);
  useEffect(() => {
    activeCarRef.current = activeCar;
    isChaseCamInitRef.current = false;
    chaseCamHeadingRef.current = null;
  }, [activeCar]);

  useEffect(() => {
    if (!isComparing && activeCar !== 'driver') {
      setActiveCar('driver');
    }
  }, [isComparing, activeCar]);

  // Audio mute handler
  const handleToggleAudio = useCallback(() => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = createEngineAudio();
    }
    const muted = audioEngineRef.current.toggleMute();
    setIsAudioMuted(muted);
  }, []);

  // Lighting mode handler
  const handleSetLightingMode = useCallback((mode) => {
    setLightingMode(mode);
    lightingModeRef.current = mode;
    if (lightingRigRef.current) {
      lightingRigRef.current.setMode(mode);
    }
    if (trackEnvRef.current) {
      trackEnvRef.current.setLightingMode(mode);
    }
  }, []);

  // Reset chase cam state on camera mode switch
  useEffect(() => {
    isChaseCamInitRef.current = false;
    chaseCamHeadingRef.current = null;
  }, [cameraMode]);

  // Re-seed the pose trackers whenever the replay jumps (restart or scrub), so
  // the damping never interpolates across the jump.
  const resetPoseTrackers = useCallback(() => {
    poseTracker.reset();
    ghostTracker.reset();
  }, [poseTracker, ghostTracker]);

  // Keyboard controls: Escape to close, 'c'/'C' to switch active car in ghost mode, Space to play/pause, 1-5 for camera, M for audio, L for lighting
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.key === 'c' || e.key === 'C') && isComparing) {
        e.preventDefault();
        setActiveCar(curr => (curr === 'driver' ? 'ghost' : 'driver'));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.key === '1') {
        setCameraMode('chase');
      } else if (e.key === '2') {
        setCameraMode('hood');
      } else if (e.key === '3') {
        setCameraMode('broadcast');
      } else if (e.key === '4') {
        setCameraMode('topdown');
      } else if (e.key === '5') {
        setCameraMode('orbit');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleAudio();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleSetLightingMode(lightingModeRef.current === 'day' ? 'sunset' : lightingModeRef.current === 'sunset' ? 'night' : 'day');
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setShowHud(curr => !curr);
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setShowTelemetryOverlay(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, isComparing, handleToggleAudio, handleSetLightingMode]);

  // Zoom Handlers
  const handleZoomIn = useCallback(() => {
    setZoomLevel(z => Math.min(2.5, +(z + 0.15).toFixed(2)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(z => Math.max(0.4, +(z - 0.15).toFixed(2)));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomLevel(1.0);
  }, []);

  useEffect(() => {
    if (isComparing && comparisonData?.comparison?.length > 0) {
      setMinimapMode('gain_loss');
    }
  }, [isComparing, comparisonData]);

  // Filter valid coordinates
  const validSamples = useMemo(() => {
    return samples.filter(s => s.world_x !== undefined && s.world_y !== undefined);
  }, [samples]);

  const validCompSamples = useMemo(() => {
    return compSamples.filter(s => s.world_x !== undefined && s.world_y !== undefined);
  }, [compSamples]);

  const compList = useMemo(() => {
    return comparisonData?.comparison || [];
  }, [comparisonData]);

  // Lap duration in seconds
  const lapDuration = useMemo(() => {
    if (validSamples.length < 2) return 118.28;
    const t0 = validSamples[0].time;
    const t1 = validSamples[validSamples.length - 1].time;
    const dur = t1 - t0;
    return dur > 0 ? dur : 118.28;
  }, [validSamples]);

  // Multi-lap replay: the session endpoint returns every flying lap laid out on
  // one continuous timeline (session_time). When active, the replay clock runs
  // over that whole span and the driver car is resolved per lap, while the
  // track spline still comes from the reference lap.
  const sessionSamples = useMemo(() => {
    const s = sessionTelemetry?.samples || [];
    return s.filter((x) => Number.isFinite(x.world_x) && Number.isFinite(x.world_y));
  }, [sessionTelemetry]);

  const multiLapActive = multiLapEnabled && sessionSamples.length > 1;

  const multiLapDuration = useMemo(() => {
    if (!multiLapActive) return 0;
    const total = sessionTelemetry?.total_duration;
    if (Number.isFinite(total) && total > 0) return total;
    const last = sessionSamples[sessionSamples.length - 1];
    return last?.session_time || 0;
  }, [multiLapActive, sessionTelemetry, sessionSamples]);

  const lapMarks = useMemo(() => sessionTelemetry?.laps || [], [sessionTelemetry]);

  // Continuous replay span: multi-lap when enabled, otherwise the reference lap.
  const replayDuration = multiLapActive ? multiLapDuration : lapDuration;

  // Resolve a session_time to the sample on the concatenated timeline.
  const sampleAtSessionTime = useCallback((t) => {
    if (sessionSamples.length === 0) return null;
    if (sessionSamples.length === 1) return sessionSamples[0];
    const first = sessionSamples[0].session_time ?? 0;
    const last = sessionSamples[sessionSamples.length - 1].session_time ?? 0;
    const span = last - first || 1;
    const u = Math.max(0, Math.min(1, (t - first) / span));
    const f = u * (sessionSamples.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(sessionSamples.length - 1, i0 + 1);
    const a = f - i0;
    const s0 = sessionSamples[i0];
    const s1 = sessionSamples[i1];
    return {
      ...s0,
      time: t,
      dist_pct: s0.dist_pct + a * (s1.dist_pct - s0.dist_pct),
      speed: s0.speed + a * (s1.speed - s0.speed),
      gear: a > 0.5 ? s1.gear : s0.gear,
      rpm: Math.round(s0.rpm + a * (s1.rpm - s0.rpm)),
      throttle: s0.throttle + a * (s1.throttle - s0.throttle),
      brake: s0.brake + a * (s1.brake - s0.brake),
      steering: Math.round(s0.steering + a * (s1.steering - s0.steering)),
      lat_g: s0.lat_g + a * (s1.lat_g - s0.lat_g),
      lon_g: s0.lon_g + a * (s1.lon_g - s0.lon_g),
      world_x: s0.world_x + a * (s1.world_x - s0.world_x),
      world_y: s0.world_y + a * (s1.world_y - s0.world_y),
      path_lateral:
        s0.path_lateral !== undefined && s1.path_lateral !== undefined
          ? s0.path_lateral + a * (s1.path_lateral - s0.path_lateral)
          : undefined,
      lap_number: s0.lap_number
    };
  }, [sessionSamples]);

  // --------------------------------------------------------------------------
  // 1. Precalculate Smooth Continuous Track Spline & Unwrapped Headings
  // --------------------------------------------------------------------------
  const normalizedBase = useMemo(() => {
    return computeSmoothTrackData(validSamples);
  }, [validSamples]);

  const normalizedCompBase = useMemo(() => {
    return computeSmoothTrackData(validCompSamples);
  }, [validCompSamples]);

  // Canonical track coordinate system: a centripetal Catmull-Rom spline with
  // analytic tangents and normals. Shared by the road ribbon, kerbs, both cars
  // and the minimap, so every part of the scene bends on the same curve.
  const trackModel = useMemo(() => {
    return buildTrackCenterline(normalizedBase, 2.0, 4, trackName);
  }, [normalizedBase, trackName]);

  const spline = useMemo(() => {
    if (trackModel) {
      const pts = [];
      for (let i = 0; i < trackModel.numSlices; i++) {
        pts.push({
          world_x: trackModel.xs[i],
          world_y: trackModel.ys[i],
          dist_pct: trackModel.pcts[i],
          world_z: trackModel.elevations ? trackModel.elevations[i] : undefined
        });
      }
      if (pts.length >= 6) {
        return buildSplineFromSamples(pts, {
          controlSpacing: 6.0,
          sampleSpacing: 1.5,
          smoothPasses: 1,
          trackName
        });
      }
    }
    return buildSplineFromSamples(validSamples, {
      controlSpacing: 6.0,
      sampleSpacing: 1.5,
      smoothPasses: 1,
      trackName
    });
  }, [trackModel, validSamples, trackName]);

  const normalizedSamples = useMemo(() => {
    return attachTrackFields(normalizedBase, trackModel);
  }, [normalizedBase, trackModel]);

  const normalizedCompSamples = useMemo(() => {
    return attachTrackFields(normalizedCompBase, trackModel);
  }, [normalizedCompBase, trackModel]);

  const hasInGameTrack = useMemo(() => {
    return (samples || []).some(s => s.track_center_x != null && s.path_lateral != null);
  }, [samples]);

  // Initialize replay time at the focus point handed over by the workspace
  useEffect(() => {
    if (isOpen && normalizedSamples.length > 1 && lapDuration > 0) {
      const initPct = Math.max(0, Math.min(1, initialFocusPct));
      const initSec = initPct * lapDuration;
      replayTimeRef.current = initSec;
      setUiReplayTime(initSec);
      poseTracker.reset();
      ghostTracker.reset();
    }
  }, [isOpen, initialFocusPct, normalizedSamples, lapDuration, poseTracker, ghostTracker]);

  // Interpolated active sample for UI gauge. Multi-lap replay reads the
  // concatenated session timeline so the HUD matches the car on screen.
  const activePoint = useMemo(() => {
    if (multiLapActive) {
      return sampleAtSessionTime(uiReplayTime);
    }
    if (normalizedSamples.length < 2) return null;
    return interpolateSpline(normalizedSamples, uiReplayTime, lapDuration);
  }, [multiLapActive, sampleAtSessionTime, uiReplayTime, normalizedSamples, lapDuration]);

  // Comparison point for UI gauge & delta calculation
  const activeCompPoint = useMemo(() => {
    if (!isComparing) return null;
    if (compList.length > 0 && activePoint) {
      const targetPct = activePoint.dist_pct;
      const cIdx = Math.min(compList.length - 1, Math.max(0, Math.floor(targetPct * (compList.length - 1))));
      return compList[cIdx] || null;
    } else if (normalizedCompSamples.length > 1 && activePoint) {
      return interpolateSpline(normalizedCompSamples, uiReplayTime, lapDuration);
    }
    return null;
  }, [isComparing, compList, normalizedCompSamples, activePoint, uiReplayTime, lapDuration]);

  // Dedicated active ghost sample for telemetry gauges & minimap
  const activeGhostPoint = useMemo(() => {
    if (!isComparing) return null;
    if (normalizedCompSamples.length > 1) {
      return interpolateSpline(normalizedCompSamples, uiReplayTime, lapDuration);
    } else if (compList.length > 0 && activePoint) {
      const targetPct = activePoint.dist_pct;
      const cIdx = Math.min(compList.length - 1, Math.max(0, Math.floor(targetPct * (compList.length - 1))));
      const cItem = compList[cIdx];
      if (cItem && cItem.comp) {
        return { ...cItem.comp, dist_pct: cItem.dist_pct !== undefined ? cItem.dist_pct : activePoint.dist_pct };
      }
    }
    return null;
  }, [isComparing, normalizedCompSamples, compList, activePoint, uiReplayTime, lapDuration]);

  // Telemetry sample feeding the HUD gauges (Speed, Gear, RPM, Throttle, Brake, Steering, Lat G, Track Limit)
  const hudTelemetry = useMemo(() => {
    if (activeCar === 'ghost' && activeGhostPoint) {
      return activeGhostPoint;
    }
    return activePoint;
  }, [activeCar, activeGhostPoint, activePoint]);

  // --------------------------------------------------------------------------
  // 2. Three.js Scene Setup
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || !mountRef.current || normalizedSamples.length < 10) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a0f);
    scene.fog = new THREE.FogExp2(0x070a0f, 0.0012);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.5, 6000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;

    qualityRef.current = { level: 2, frames: 0, elapsed: 0 };

    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 4;
    controls.maxDistance = 2500;
    controlsRef.current = controls;

    // Dynamic Lighting Rig (Day, Sunset, Night WEC)
    const lightingRig = createLightingRig(scene);
    lightingRig.setMode(lightingModeRef.current);
    lightingRigRef.current = lightingRig;

    // Find lowest point on the track spline to set ground plane
    let minTrackY = 0;
    if (spline && spline.positions) {
      for (let s = 0; s < spline.sampleCount; s++) {
        const py = spline.positions[s * 3 + 1];
        if (py < minTrackY) minTrackY = py;
      }
    }

    // TV Broadcast Camera Director (Scaffold Towers & Dynamic Optical Zoom)
    const broadcastDirector = createBroadcastCamDirector(spline, corners);
    broadcastDirectorRef.current = broadcastDirector;

    // Procedural Track Environment: Sky Dome, Grass Verges, Under-Road Skirt, Rolling Terrain, & 3D Forests
    // cameraStands are passed to guarantee ZERO tree obstruction along TV camera sightlines!
    const trackEnv = createTrackEnvironment(scene, spline, {
      initialLightingMode: lightingModeRef.current,
      minTrackY,
      cameraStands: broadcastDirector.cameraStands
    });
    trackEnvRef.current = trackEnv;

    // Build 3D Track Ribbon Geometry from the true track centerline
    buildTrackMesh(scene, spline);

    // Corner markers: the same numbered tab as the pit board rail
    if (corners.length > 0 && spline) {
      const group = new THREE.Group();
      for (const corner of corners) {
        const pose = spline.poseAtPct(corner.apex_pct);
        const marker = createCornerMarker(corner.number, false);
        marker.position.set(pose.x, (pose.y || 0) + 0.1, pose.z);
        marker.userData.cornerId = corner.id;
        group.add(marker);
      }
      scene.add(group);
      markerGroupRef.current = group;

      // 3D Corner Overhead Signs (Holographic Apex Gantries)
      const gantryGroup = new THREE.Group();
      for (const corner of corners) {
        const gantry = createCornerGantry(corner, spline);
        gantryGroup.add(gantry);
      }
      scene.add(gantryGroup);
    }

    // Dynamic Skidmarks system
    skidmarksRef.current = createSkidmarkSystem(scene);

    // Floating 3D Delta Tag between Driver and Ghost
    const deltaTag = createDeltaTagSprite();
    scene.add(deltaTag.sprite);
    deltaTagRef.current = deltaTag;


    // Build Main Driver Car (Orange Livery)
    const mainCar = createCarMesh(0xff6b00, `DRIVER L${refLapNumber}`, false, refLapNumber);
    mainCar.castShadow = true;
    scene.add(mainCar);
    carRef.current = mainCar;

    // Attach Projector Headlights & Ground Lights to Main Car
    carLightsRef.current = attachCarLights(mainCar);

    // Build Ghost Car if comparing
    if (isComparing && (normalizedCompSamples.length > 0 || compList.length > 0)) {
      const ghostCar = createCarMesh(0x00f0ff, `GHOST L${compLapNumber}`, true, compLapNumber);
      scene.add(ghostCar);
      ghostCarRef.current = ghostCar;
    }

    const mountElem = mountRef.current;
    const handleWheel = (e) => {
      if (cameraModeRef.current === 'orbit') return;
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoomLevel(z => Math.min(2.5, +(z + 0.1).toFixed(2)));
      } else {
        setZoomLevel(z => Math.max(0.4, +(z - 0.1).toFixed(2)));
      }
    };

    // Click on 3D cars to switch active camera focus
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    const onPointerDown = (e) => {
      downPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e) => {
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;
      if (!mountRef.current || !cameraRef.current) return;

      const rect = mountRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);
      const targets = [];
      if (carRef.current) targets.push(carRef.current);
      if (ghostCarRef.current) targets.push(ghostCarRef.current);

      const intersects = raycaster.intersectObjects(targets, true);
      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && obj !== carRef.current && obj !== ghostCarRef.current) {
          obj = obj.parent;
        }
        if (obj === ghostCarRef.current) {
          setActiveCar('ghost');
        } else if (obj === carRef.current) {
          setActiveCar('driver');
        }
      }
    };

    if (mountElem) {
      mountElem.addEventListener('wheel', handleWheel, { passive: false });
      mountElem.addEventListener('pointerdown', onPointerDown);
      mountElem.addEventListener('pointerup', onPointerUp);
    }

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (mountElem) {
        mountElem.removeEventListener('wheel', handleWheel);
        mountElem.removeEventListener('pointerdown', onPointerDown);
        mountElem.removeEventListener('pointerup', onPointerUp);
      }
      window.removeEventListener('resize', handleResize);
      if (reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current);
      if (trackEnvRef.current) {
        trackEnvRef.current.dispose();
        trackEnvRef.current = null;
      }
      markerGroupRef.current = null;
      renderer.dispose();
    };
  }, [isOpen, normalizedSamples, spline, isComparing, normalizedCompSamples, compList, corners, refLapNumber, compLapNumber]);

  // Pick a layout tier from the viewport so the replay stays usable on narrow
  // screens. wide >= 1100px, mid >= 760px, compact below that.
  useEffect(() => {
    if (!isOpen) return undefined;
    const apply = () => {
      const w = window.innerWidth;
      setLayoutTier(w >= 1100 ? 'wide' : w >= 760 ? 'mid' : 'compact');
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [isOpen]);

  // Resize Three.js viewport when HUD is toggled or the layout tier changes
  useEffect(() => {
    if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
    const timer = setTimeout(() => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / Math.max(1, h);
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    }, 40);
    return () => clearTimeout(timer);
  }, [showHud, layoutTier]);

  // Update 3D car visual styling (solid vs ghost opacity, label badge state) on activeCar switch
  useEffect(() => {
    updateCarFocusVisual(carRef.current, activeCar === 'driver', isComparing, cameraMode);
    if (ghostCarRef.current) {
      updateCarFocusVisual(ghostCarRef.current, activeCar === 'ghost', isComparing, cameraMode);
    }
  }, [activeCar, isComparing, cameraMode]);

  // --------------------------------------------------------------------------
  // 3. Replay loop: advances replay time, resolves both cars, drives the camera
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || normalizedSamples.length < 2) return;

    lastFrameTimeRef.current = performance.now();
    lastUiTimeRef.current = performance.now();

    const animate = (currentTime) => {
      reqAnimRef.current = requestAnimationFrame(animate);

      const deltaMs = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;
      const dt = Math.min(deltaMs / 1000, 0.05);

      if (trackEnvRef.current) {
        trackEnvRef.current.update(dt);
      }

      // Adaptive quality: sample the frame rate over one second windows and
      // step quality down below 40 FPS, back up above 55 FPS. Two seconds of
      // hysteresis each way so it does not oscillate at the threshold.
      const quality = qualityRef.current;
      quality.frames += 1;
      quality.elapsed += dt;
      if (quality.elapsed >= 1.0) {
        const fps = quality.frames / quality.elapsed;
        quality.frames = 0;
        quality.elapsed = 0;
        const renderer = rendererRef.current;
        if (renderer) {
          const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
          const prevLevel = quality.level;
          if (fps < 40 && quality.level > 0) {
            quality.level -= 1;
          } else if (fps > 55 && quality.level < 2) {
            quality.level += 1;
          }
          if (quality.level !== prevLevel) {
            const dprForLevel = [Math.min(maxDpr, 1.0), Math.min(maxDpr, 1.5), maxDpr];
            renderer.setPixelRatio(dprForLevel[quality.level]);
            // Level 0 also drops the shadow pass, the most expensive part of the
            // frame; materials recompile on the next render automatically.
            renderer.shadowMap.enabled = quality.level > 0;
          }
        }
      }

      // Advance replay time. The span is the whole session timeline when
      // multi-lap replay is on, otherwise a single reference lap.
      const spanDuration = multiLapActiveRef.current ? multiLapDurationRef.current : lapDurationRef.current;
      if (isPlayingRef.current) {
        let nextTime = replayTimeRef.current + dt * playbackSpeedRef.current;
        if (nextTime >= spanDuration) {
          nextTime = 0; // seamless loop
        }
        replayTimeRef.current = nextTime;

        // Throttle React state update to ~20 Hz (every 50ms) to prevent UI thread choking
        if (currentTime - lastUiTimeRef.current > 50) {
          lastUiTimeRef.current = currentTime;
          setUiReplayTime(nextTime);
        }
      }

      const curSec = replayTimeRef.current;

      // 1. Resolve driver car position on the spline, then smooth heading and body
      // attitude. The car never snaps: yaw rate is capped and the lateral G
      // channel drives roll, so a slow hairpin reads as a slow rotation.
      const p = multiLapActiveRef.current
        ? sampleAtSessionTimeRef.current(curSec)
        : interpolateSpline(normalizedSamples, curSec, lapDuration);
      let carPose = null;
      let carHeading = 0;
      let carX = 0, carZ = 0;
      let speed = 0;
      let attitude = { pitch: 0, heading: 0, roll: 0 };

      if (carRef.current && p) {
        carPose = resolveTrackRelative(p, trackModel, trackName);
        carX = carPose.x;
        carZ = carPose.z;
        speed = p.speed || 0;

        const carSplinePose = spline ? spline.poseAtPct(p.dist_pct || 0) : null;
        const roadPitch = carSplinePose ? carSplinePose.pitch : 0;
        const roadCamber = carSplinePose ? (carSplinePose.camber || 0) : 0;
        const carY = carPose.elevation != null ? carPose.elevation : (carSplinePose ? carSplinePose.y : 0);

        let travelHeading = carPose.heading;
        if (multiLapActiveRef.current) {
          // Look a fraction of a second ahead on the same continuous timeline so
          // the car keeps a sane heading across a lap boundary.
          const nextP = sampleAtSessionTimeRef.current(curSec + 0.08);
          if (nextP) {
            const nextPose = resolveTrackRelative(nextP, trackModel, trackName);
            if (nextPose) {
              const fdx = nextPose.x - carX;
              const fdz = nextPose.z - carZ;
              if (Math.hypot(fdx, fdz) > 0.005) {
                travelHeading = Math.atan2(fdx, fdz);
              }
            }
          }
        } else if (trackModel && normalizedSamples.length > 1) {
          const forwardSec = (curSec + 0.08) % lapDuration;
          const nextP = interpolateSpline(normalizedSamples, forwardSec, lapDuration);
          if (nextP) {
            const nextPose = resolveTrackRelative(nextP, trackModel, trackName);
            if (nextPose) {
              const fdx = nextPose.x - carX;
              const fdz = nextPose.z - carZ;
              if (Math.hypot(fdx, fdz) > 0.005) {
                travelHeading = Math.atan2(fdx, fdz);
              }
            }
          }
        }

        const yawRateLimit = Math.max(4.0, Math.min(10.0, 3.0 + speed * 0.04));
        attitude = poseTracker.update(
          travelHeading,
          p.lat_g || 0,
          p.lon_g || 0,
          dt,
          { yawRateLimit, headingAlpha: 24.0 }
        );
        carHeading = attitude.heading;

        carRef.current.position.set(carX, carY + CAR_RIDE_HEIGHT, carZ);
        // Roll = body lean from lateral G + the road's own cross-slope, so the
        // car banks with a banked oval instead of sitting flat on a tilted
        // surface.
        carRef.current.rotation.set(attitude.pitch + roadPitch, carHeading, attitude.roll + roadCamber, 'YXZ');
      }

      // 2. Smoothly interpolate ghost car position (track-relative, same centerline)
      let ghostPose = null;
      let ghostAttitude = null;
      let ghostSpeed = 0;
      let ghostP = null;

      if (ghostCarRef.current && p) {
        if (normalizedCompSamples.length > 1) {
          ghostP = interpolateSpline(normalizedCompSamples, curSec, lapDuration);
        } else if (compList.length > 0) {
          const cIdx = Math.min(compList.length - 1, Math.floor(p.dist_pct * compList.length));
          const cItem = compList[cIdx];
          if (cItem && cItem.comp) {
            ghostP = { ...cItem.comp, dist_pct: cItem.dist_pct !== undefined ? cItem.dist_pct : p.dist_pct };
          }
        }

        if (ghostP) {
          ghostPose = resolveTrackRelative(ghostP, trackModel, trackName);
          ghostSpeed = ghostP.speed || 0;

          const ghostSplinePose = spline ? spline.poseAtPct(ghostP.dist_pct || 0) : null;
          const ghostRoadPitch = ghostSplinePose ? ghostSplinePose.pitch : 0;
          const ghostRoadCamber = ghostSplinePose ? (ghostSplinePose.camber || 0) : 0;
          const ghostY = ghostPose.elevation != null ? ghostPose.elevation : (ghostSplinePose ? ghostSplinePose.y : 0);

          let travelHeading = ghostPose.heading;
          if (trackModel) {
            let nextP = null;
            if (normalizedCompSamples.length > 1) {
              const forwardSec = (curSec + 0.08) % lapDuration;
              nextP = interpolateSpline(normalizedCompSamples, forwardSec, lapDuration);
            } else if (ghostP.dist_pct !== undefined) {
              nextP = { ...ghostP, dist_pct: (ghostP.dist_pct + 0.003) % 1.0 };
            }
            if (nextP) {
              const nextPose = resolveTrackRelative(nextP, trackModel, trackName);
              if (nextPose) {
                const fdx = nextPose.x - ghostPose.x;
                const fdz = nextPose.z - ghostPose.z;
                if (Math.hypot(fdx, fdz) > 0.005) {
                  travelHeading = Math.atan2(fdx, fdz);
                }
              }
            }
          }

          ghostAttitude = ghostTracker.update(
            travelHeading,
            ghostP.lat_g || 0,
            ghostP.lon_g || 0,
            dt,
            { yawRateLimit: Math.max(4.0, Math.min(10.0, 3.0 + ghostSpeed * 0.04)), headingAlpha: 24.0 }
          );
          ghostCarRef.current.position.set(ghostPose.x, ghostY + CAR_RIDE_HEIGHT, ghostPose.z);
          ghostCarRef.current.rotation.set(
            ghostAttitude.pitch + ghostRoadPitch,
            ghostAttitude.heading,
            ghostAttitude.roll + ghostRoadCamber,
            'YXZ'
          );
        }
      }

      // 2b. Wheels, brake lights and body roll follow the live telemetry
      if (carRef.current && p) {
        updateCarVisuals(carRef.current, p, dt);
      }
      if (ghostCarRef.current && (ghostP || normalizedCompSamples.length > 1)) {
        const gp = ghostP || interpolateSpline(normalizedCompSamples, curSec, lapDuration);
        if (gp) updateCarVisuals(ghostCarRef.current, gp, dt);
      }

      // 2c. Highlight the active corner marker
      const group = markerGroupRef.current;
      if (group) {
        for (const marker of group.children) {
          const isActive = marker.userData.cornerId === activeCornerRef.current;
          const mat = marker.userData.ringMaterial;
          if (mat) {
            const targetColor = isActive ? 0xff8a3d : 0x35c7f0;
            const targetOpacity = isActive ? 0.85 : 0.28;
            mat.color.lerp(new THREE.Color(targetColor), 0.12);
            mat.opacity += (targetOpacity - mat.opacity) * 0.12;
          }
        }
      }

      // 2d. Active Car Camera Tracking (Driver or Ghost)
      const isGhostActive = activeCarRef.current === 'ghost' && ghostCarRef.current && ghostPose && ghostAttitude;
      const targetX = isGhostActive ? ghostPose.x : carX;
      const targetY = isGhostActive ? (ghostPose?.elevation || 0) : (carPose?.elevation || 0);
      const targetZ = isGhostActive ? ghostPose.z : carZ;
      const targetHeading = isGhostActive ? ghostAttitude.heading : carHeading;
      const targetRoll = isGhostActive ? ghostAttitude.roll : attitude.roll;
      const targetSpeed = isGhostActive ? ghostSpeed : speed;
      const targetCarObj = isGhostActive ? ghostCarRef.current : carRef.current;

      if (cameraRef.current && controlsRef.current && (carRef.current || ghostCarRef.current)) {
        const mode = cameraModeRef.current;
        const currentZoom = zoomLevelRef.current || 1.0;

        // Leaving orbit for any guided mode invalidates the free camera anchor,
        // so the next orbit entry re-seeds cleanly instead of reusing a stale
        // position that a previous dolly left far from the car.
        if (mode !== 'orbit') {
          orbitInitRef.current = false;
          orbitFocusRef.current = null;
        }

        // Hide the focused car's roof tag in first-person so the view stays clear
        if (carRef.current?.userData?.labelObj?.sprite) {
          carRef.current.userData.labelObj.sprite.visible = !(mode === 'hood' && !isGhostActive);
        }
        if (ghostCarRef.current?.userData?.labelObj?.sprite) {
          ghostCarRef.current.userData.labelObj.sprite.visible = !(mode === 'hood' && isGhostActive);
        }

        if (mode === 'chase') {
          controlsRef.current.enabled = false;

          // Chase FOV widens with speed to sell acceleration but stays in the
          // 38-48 degree band so the horizon never fisheyes. Zoom only changes
          // framing (distance/height), not distortion.
          const speedRatio = Math.min(1.0, Math.max(0, (targetSpeed - 60) / 200));
          const dynamicFov = Math.max(38, Math.min(48, 39 + speedRatio * 6.0));
          cameraRef.current.fov = dynamicFov;
          cameraRef.current.updateProjectionMatrix();

          // Chase distance/height scale linearly with zoom around the GT3
          // baseline (10.5m behind, 2.7m high), clamped so the closest shot
          // still frames the whole car.
          const effectiveDist = Math.max(6.5, Math.min(28.0, 10.5 / currentZoom));
          const effectiveHeight = Math.max(1.8, Math.min(6.0, 2.7 / Math.sqrt(currentZoom)));

          // 1. Smoothly lag camera heading behind target's heading
          if (chaseCamHeadingRef.current === null || !isChaseCamInitRef.current) {
            chaseCamHeadingRef.current = targetHeading;
          } else {
            let diff = (targetHeading - chaseCamHeadingRef.current) % (Math.PI * 2);
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            const angleAlpha = 1 - Math.exp(-6.5 * dt);
            chaseCamHeadingRef.current += diff * angleAlpha;
          }
          const smoothCamHeading = chaseCamHeadingRef.current;

          // 2. Compute ideal camera position behind target car
          const idealCamX = targetX - Math.sin(smoothCamHeading) * effectiveDist;
          const idealCamZ = targetZ - Math.cos(smoothCamHeading) * effectiveDist;
          const idealCamPos = new THREE.Vector3(idealCamX, targetY + effectiveHeight, idealCamZ);

          // 3. Dynamic Road Pitch Look-Ahead: tilts camera up when climbing hills like Eau Rouge
          const carPitch = (isGhostActive ? ghostPose?.pitch : carPose?.pitch) || 0;
          const lookAheadDist = 6.0 + Math.min(14.0, targetSpeed * 0.05);
          const idealLookX = targetX + Math.sin(targetHeading) * lookAheadDist;
          const idealLookZ = targetZ + Math.cos(targetHeading) * lookAheadDist;
          const idealLookY = targetY + 1.25 - Math.sin(carPitch) * (lookAheadDist * 0.7);
          const idealLookTarget = new THREE.Vector3(idealLookX, idealLookY, idealLookZ);

          // 4. Smoothly damp BOTH camera position and look target (zero shake)
          if (!isChaseCamInitRef.current) {
            chasePosRef.current.copy(idealCamPos);
            chaseLookTargetRef.current.copy(idealLookTarget);
            isChaseCamInitRef.current = true;
          } else {
            const posAlpha = 1 - Math.exp(-9.0 * dt);
            const lookAlpha = 1 - Math.exp(-14.0 * dt);
            chasePosRef.current.lerp(idealCamPos, posAlpha);
            chaseLookTargetRef.current.lerp(idealLookTarget, lookAlpha);
          }

          cameraRef.current.position.copy(chasePosRef.current);
          cameraRef.current.lookAt(chaseLookTargetRef.current);
        } else if (mode === 'hood') {
          controlsRef.current.enabled = false;
          isChaseCamInitRef.current = false;
          chaseCamHeadingRef.current = null;

          // First-person view built in the car's own frame so it follows yaw,
          // road pitch and body roll correctly. The eye sits just above the
          // cowl, ahead of the windshield base.
          const speedRatio = Math.min(1.0, Math.max(0, (targetSpeed - 70) / 180));
          const dynamicFov = Math.max(40, Math.min(52, 43 + speedRatio * 7.0));
          cameraRef.current.fov = dynamicFov;

          // Use the car's actual world pitch (body pitch + road slope) so the
          // onboard dips with the circuit instead of staring at the horizon.
          const carPitch = targetCarObj ? targetCarObj.rotation.x : 0;

          // Local eye offset (metres) in car space: +Z is forward, +Y is up.
          const eyeForward = 0.95;
          const eyeUp = 0.94;

          const sinH = Math.sin(targetHeading);
          const cosH = Math.cos(targetHeading);
          const eyeX = targetX + eyeForward * sinH;
          const eyeZ = targetZ + eyeForward * cosH;
          const eyeY = targetY + eyeUp;

          cameraRef.current.position.set(eyeX, eyeY, eyeZ);

          // Look down the car's forward axis, falling with the road pitch.
          const lookDist = 45;
          const lookX = targetX + sinH * lookDist;
          const lookZ = targetZ + cosH * lookDist;
          const lookY = eyeY - Math.tan(carPitch) * lookDist - 0.15;
          cameraRef.current.lookAt(lookX, lookY, lookZ);

          // Bank the view with the body so cornering reads like a real onboard.
          cameraRef.current.rotateZ(targetRoll);
          cameraRef.current.updateProjectionMatrix();
        } else if (mode === 'broadcast') {
          controlsRef.current.enabled = false;
          isChaseCamInitRef.current = false;
          chaseCamHeadingRef.current = null;
          if (broadcastDirectorRef.current) {
            const standInfo = broadcastDirectorRef.current.update(
              cameraRef.current,
              targetX,
              targetY,
              targetZ,
              (p?.dist_pct != null ? p.dist_pct : (curSec / lapDuration)),
              curSec,
              dt,
              currentZoom
            );
            if (standInfo && standInfo.standName !== broadcastStandName) {
              setBroadcastStandName(standInfo.standName);
            }
          }
        } else if (mode === 'topdown') {
          controlsRef.current.enabled = false;
          isChaseCamInitRef.current = false;
          chaseCamHeadingRef.current = null;
          // Top-down is a strategy view: keep enough altitude that the car is a
          // marker, and enough range that zooming out still shows the circuit.
          const altitude = Math.max(60.0, Math.min(600.0, 220.0 / currentZoom));
          cameraRef.current.position.set(targetX, targetY + altitude, targetZ);
          cameraRef.current.lookAt(targetX, targetY, targetZ);
        } else {
          // Free Orbit. OrbitControls owns the angle and distance, but the car
          // keeps moving, so the whole rig (camera + target) is translated by
          // the car's per-frame delta. That keeps the user's orbit framing while
          // the subject stays centred, instead of leaving the camera orbiting an
          // empty patch of track.
          controlsRef.current.enabled = true;
          isChaseCamInitRef.current = false;
          chaseCamHeadingRef.current = null;

          const focusKey = `${isGhostActive ? 'ghost' : 'driver'}:${activeCarRef.current}`;
          const desiredTarget = new THREE.Vector3(targetX, targetY + 0.5, targetZ);

          if (!orbitInitRef.current || orbitFocusRef.current !== focusKey) {
            orbitInitRef.current = true;
            orbitFocusRef.current = focusKey;
            // Re-apply dolly limits in case a guided mode left different
            // expectations, then seed a sensible entry framing.
            controlsRef.current.minDistance = 4;
            controlsRef.current.maxDistance = 2500;
            const orbitDist = Math.max(8.0, Math.min(30.0, 14.0 / currentZoom));
            cameraRef.current.position.set(
              desiredTarget.x - Math.sin(targetHeading) * orbitDist,
              desiredTarget.y + orbitDist * 0.45,
              desiredTarget.z - Math.cos(targetHeading) * orbitDist
            );
            controlsRef.current.target.copy(desiredTarget);
            orbitPrevTargetRef.current.copy(desiredTarget);
            controlsRef.current.update();
          } else {
            // Rigidly translate the rig with the car: shift the camera by the
            // same delta as the target so orbit angle and distance are kept.
            orbitRigDeltaRef.current.subVectors(desiredTarget, orbitPrevTargetRef.current);
            cameraRef.current.position.add(orbitRigDeltaRef.current);
            controlsRef.current.target.add(orbitRigDeltaRef.current);
            orbitPrevTargetRef.current.copy(desiredTarget);
            controlsRef.current.update();
          }
        }

        // 2e. Update Projector Headlights, Skidmarks, Delta Tag, and Engine Audio
        if (carLightsRef.current && p) {
          carLightsRef.current.update(lightingModeRef.current, (p.brake || 0) > 15);
        }

        if (skidmarksRef.current && p && carPose) {
          skidmarksRef.current.addPoint(carPose, p.brake || 0, speed, spline);
        }

        if (deltaTagRef.current) {
          if (isComparing && carPose && ghostPose && ghostP && !hiddenDeltaTagRef.current) {
            // Position-aligned delta: compare each lap's time at the SAME point
            // on the circuit. Using p.time - ghostP.time would always be ~0,
            // because both cars share one replay clock, so the badge would sit
            // at "-0.00s" forever. comparisonData already aligns both laps over
            // normalized distance and carries the true delta.
            let curDeltaSec = null;
            const driverPct = p.dist_pct;
            if (compList.length > 1 && driverPct != null) {
              const idx = Math.round(
                Math.max(0, Math.min(1, driverPct)) * (compList.length - 1)
              );
              curDeltaSec = compList[idx]?.delta ?? null;
            } else {
              // No aligned comparison available; fall back to each lap's own
              // elapsed time so the badge still shows a meaningful gap.
              const refTime = p.time;
              const compTime = ghostP.time;
              if (refTime != null && compTime != null) curDeltaSec = refTime - compTime;
            }

            const curDeltaMeters = Math.hypot(carPose.x - ghostPose.x, carPose.z - ghostPose.z);
            deltaTagRef.current.update(carPose, ghostPose, curDeltaSec, curDeltaMeters);
          } else {
            deltaTagRef.current.update(null);
          }
        }

        if (audioEngineRef.current && p) {
          audioEngineRef.current.update(p, isPlayingRef.current);
        }
      }

      // 3. Render WebGL Scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    reqAnimRef.current = requestAnimationFrame(animate);
    return () => {
      if (reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current);
    };
  }, [isOpen, normalizedSamples, lapDuration, normalizedCompSamples, compList, trackModel, poseTracker, ghostTracker]);

  // --------------------------------------------------------------------------
  // 4. Minimap canvas rendering
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;
    const canvas = minimapCanvasRef.current;
    if (!canvas || normalizedSamples.length < 10) return;

    const ctx = canvas.getContext('2d');

    // High-DPI Supersampling (2x or 3x devicePixelRatio)
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const displayW = 270;
    const displayH = 205;

    canvas.width = Math.floor(displayW * dpr);
    canvas.height = Math.floor(displayH * dpr);
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayW, displayH);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let maxSpeed = 0, minSpeed = Infinity;

    normalizedSamples.forEach(p => {
      const cx = p.track_center_x != null ? p.track_center_x : p.world_x;
      const cy = p.track_center_y != null ? p.track_center_y : p.world_y;
      if (p.world_x < minX) minX = p.world_x;
      if (p.world_x > maxX) maxX = p.world_x;
      if (p.world_y < minY) minY = p.world_y;
      if (p.world_y > maxY) maxY = p.world_y;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      if (p.speed > maxSpeed) maxSpeed = p.speed;
      if (p.speed < minSpeed) minSpeed = p.speed;
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 26;
    const scale = Math.min((displayW - padding * 2) / rangeX, (displayH - padding * 2) / rangeY);

    const offsetX = (displayW - rangeX * scale) / 2 - minX * scale;
    const offsetY = (displayH - rangeY * scale) / 2 - minY * scale;

    const toScreen = (wx, wy) => ({
      x: wx * scale + offsetX,
      y: displayH - (wy * scale + offsetY)
    });

    // 1. HD Roadbed (Double-bordered asphalt along true track centerline)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const cx0 = normalizedSamples[0].track_center_x != null ? normalizedSamples[0].track_center_x : normalizedSamples[0].world_x;
    const cy0 = normalizedSamples[0].track_center_y != null ? normalizedSamples[0].track_center_y : normalizedSamples[0].world_y;
    const p0 = toScreen(cx0, cy0);

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < normalizedSamples.length; i++) {
      const cx = normalizedSamples[i].track_center_x != null ? normalizedSamples[i].track_center_x : normalizedSamples[i].world_x;
      const cy = normalizedSamples[i].track_center_y != null ? normalizedSamples[i].track_center_y : normalizedSamples[i].world_y;
      const pt = toScreen(cx, cy);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#232b36';
    ctx.lineWidth = 13;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < normalizedSamples.length; i++) {
      const cx = normalizedSamples[i].track_center_x != null ? normalizedSamples[i].track_center_x : normalizedSamples[i].world_x;
      const cy = normalizedSamples[i].track_center_y != null ? normalizedSamples[i].track_center_y : normalizedSamples[i].world_y;
      const pt = toScreen(cx, cy);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#0d131d';
    ctx.lineWidth = 9;
    ctx.stroke();

    // 2. HD Colored Ribbon
    if (minimapMode === 'gain_loss' && compList.length > 10) {
      let currentStatus = null;
      let pathPoints = [];

      const flushPath = (status, pts) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) {
          ctx.lineTo(pts[j].x, pts[j].y);
        }
        if (status === 'gain') {
          ctx.strokeStyle = '#3fd68c'; // Green
          ctx.lineWidth = 4.5;
        } else if (status === 'loss') {
          ctx.strokeStyle = '#ff5c5c'; // Red
          ctx.lineWidth = 4.5;
        } else {
          ctx.strokeStyle = '#6b7785'; // Slate
          ctx.lineWidth = 3;
        }
        ctx.stroke();
      };

      for (let i = 0; i < compList.length; i++) {
        const item = compList[i];
        if (!item.ref) continue;
        const pt = toScreen(item.ref.world_x, item.ref.world_y);

        if (item.status !== currentStatus) {
          if (pathPoints.length > 0) {
            pathPoints.push(pt);
            flushPath(currentStatus, pathPoints);
          }
          currentStatus = item.status;
          pathPoints = [pt];
        } else {
          pathPoints.push(pt);
        }
      }
      if (pathPoints.length > 1) {
        flushPath(currentStatus, pathPoints);
      }

      // Max Gain & Max Loss Badges in HD
      if (comparisonData?.max_gain) {
        const mg = comparisonData.max_gain;
        const pt = toScreen(mg.world_x, mg.world_y);
        drawHDMinimapBadge(ctx, pt.x, pt.y, 'GAIN', `${mg.diff.toFixed(2)}s`, '#3fd68c', displayW);
      }

      if (comparisonData?.max_loss) {
        const ml = comparisonData.max_loss;
        const pt = toScreen(ml.world_x, ml.world_y);
        drawHDMinimapBadge(ctx, pt.x, pt.y, 'LOSS', `+${ml.diff.toFixed(2)}s`, '#ff5c5c', displayW);
      }

    } else if (minimapMode === 'speed') {
      for (let i = 0; i < normalizedSamples.length - 1; i++) {
        const pt1 = toScreen(normalizedSamples[i].world_x, normalizedSamples[i].world_y);
        const pt2 = toScreen(normalizedSamples[i + 1].world_x, normalizedSamples[i + 1].world_y);

        const spd = normalizedSamples[i].speed;
        const brk = normalizedSamples[i].brake;
        const norm = (spd - minSpeed) / (maxSpeed - minSpeed || 1);

        ctx.beginPath();
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);

        if (brk > 20 || spd < 110) {
          ctx.strokeStyle = '#ff5c5c'; // Braking
          ctx.lineWidth = 4.5;
        } else if (norm > 0.6) {
          ctx.strokeStyle = '#3fd68c'; // Fast Straight
          ctx.lineWidth = 4;
        } else {
          ctx.strokeStyle = '#f5b03e'; // Mid Corner
          ctx.lineWidth = 3.5;
        }
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < normalizedSamples.length; i++) {
        const pt = toScreen(normalizedSamples[i].world_x, normalizedSamples[i].world_y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#35c7f0';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    // 3. Start / Finish Line
    let sfSample = normalizedSamples[0];
    let minSfPct = 1.0;
    for (let i = 0; i < normalizedSamples.length; i++) {
      if (normalizedSamples[i].dist_pct !== undefined && normalizedSamples[i].dist_pct < minSfPct) {
        minSfPct = normalizedSamples[i].dist_pct;
        sfSample = normalizedSamples[i];
      }
    }
    const sf = toScreen(
      sfSample.track_center_x != null ? sfSample.track_center_x : sfSample.world_x,
      sfSample.track_center_y != null ? sfSample.track_center_y : sfSample.world_y
    );
    ctx.beginPath();
    ctx.arc(sf.x, sf.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4. Ghost Car Pip
    if (isComparing && activeGhostPoint) {
      const gSrc = activeGhostPoint.comp
        ? { ...activeGhostPoint.comp, dist_pct: activeGhostPoint.dist_pct }
        : activeGhostPoint;
      const gPose = resolveTrackRelative(gSrc, trackModel);
      if (gPose) {
        const gPt = toScreen(gPose.x, gPose.worldY != null ? gPose.worldY : -gPose.z);
        const isGhostActive = activeCar === 'ghost';

        if (isGhostActive) {
          const gHeading = Math.PI / 2 - (gPose.heading || 0);
          ctx.beginPath();
          ctx.arc(gPt.x, gPt.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(gPt.x, gPt.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#35c7f0';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // Heading chevron
          ctx.beginPath();
          ctx.moveTo(gPt.x + Math.cos(gHeading) * 9, gPt.y + Math.sin(gHeading) * 9);
          ctx.lineTo(gPt.x + Math.cos(gHeading + 2.5) * 4, gPt.y + Math.sin(gHeading + 2.5) * 4);
          ctx.lineTo(gPt.x + Math.cos(gHeading - 2.5) * 4, gPt.y + Math.sin(gHeading - 2.5) * 4);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(gPt.x, gPt.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(gPt.x, gPt.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#35c7f0';
          ctx.fill();
          ctx.strokeStyle = '#11151c';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // 5. Driver Car Pip with Direction Chevron (track-relative pose)
    if (activePoint) {
      const carPose = resolveTrackRelative(activePoint, trackModel);
      const cur = toScreen(carPose.x, carPose.worldY != null ? carPose.worldY : -carPose.z);
      const isDriverActive = activeCar === 'driver';

      if (isDriverActive) {
        const heading = Math.PI / 2 - (carPose.heading || 0);
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 107, 0, 0.25)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8a3d';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Heading arrow
        ctx.beginPath();
        ctx.moveTo(cur.x + Math.cos(heading) * 9, cur.y + Math.sin(heading) * 9);
        ctx.lineTo(cur.x + Math.cos(heading + 2.5) * 4, cur.y + Math.sin(heading + 2.5) * 4);
        ctx.lineTo(cur.x + Math.cos(heading - 2.5) * 4, cur.y + Math.sin(heading - 2.5) * 4);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 107, 0, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8a3d';
        ctx.fill();
        ctx.strokeStyle = '#11151c';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 6. Interactive Hover Inspection Reticle
    if (minimapHover && minimapHover.screenX !== undefined) {
      const hx = minimapHover.screenX;
      const hy = minimapHover.screenY;
      const isGain = minimapHover.compItem?.status === 'gain';
      const isLoss = minimapHover.compItem?.status === 'loss';
      const color = isGain ? '#3fd68c' : isLoss ? '#ff5c5c' : '#35c7f0';

      // Outer glowing ring
      ctx.beginPath();
      ctx.arc(hx, hy, 8, 0, Math.PI * 2);
      ctx.fillStyle = isGain ? 'rgba(16, 185, 129, 0.25)' : isLoss ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.25)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner ping core
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [isOpen, normalizedSamples, compList, activePoint, activeGhostPoint, activeCompPoint, activeCar, minimapMode, isComparing, comparisonData, minimapHover, trackModel]);

  // Hover tracking for Gain/Loss and speed info on Minimap
  const handleMinimapMouseMove = useCallback((e) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || normalizedSamples.length < 10) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    normalizedSamples.forEach(p => {
      const cx = p.track_center_x != null ? p.track_center_x : p.world_x;
      const cy = p.track_center_y != null ? p.track_center_y : p.world_y;
      if (p.world_x < minX) minX = p.world_x;
      if (p.world_x > maxX) maxX = p.world_x;
      if (p.world_y < minY) minY = p.world_y;
      if (p.world_y > maxY) maxY = p.world_y;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 26;
    const scale = Math.min((rect.width - padding * 2) / rangeX, (rect.height - padding * 2) / rangeY);

    const offsetX = (rect.width - rangeX * scale) / 2 - minX * scale;
    const offsetY = (rect.height - rangeY * scale) / 2 - minY * scale;

    let closestIdx = 0;
    let minD = Infinity;

    for (let i = 0; i < normalizedSamples.length; i++) {
      const p = normalizedSamples[i];
      const sx = p.world_x * scale + offsetX;
      const sy = rect.height - (p.world_y * scale + offsetY);
      const d = (sx - mouseX) ** 2 + (sy - mouseY) ** 2;
      if (d < minD) {
        minD = d;
        closestIdx = i;
      }
    }

    if (minD < 2000) {
      const s = normalizedSamples[closestIdx];
      const screenX = s.world_x * scale + offsetX;
      const screenY = rect.height - (s.world_y * scale + offsetY);

      let compItem = null;
      if (compList.length > 0) {
        const cIdx = Math.min(compList.length - 1, Math.floor((closestIdx / (normalizedSamples.length - 1)) * compList.length));
        compItem = compList[cIdx];
      }

      setMinimapHover({
        idx: closestIdx,
        sample: s,
        compItem,
        mouseX,
        mouseY,
        screenX,
        screenY,
        containerWidth: rect.width,
        containerHeight: rect.height
      });
    } else {
      setMinimapHover(null);
    }
  }, [normalizedSamples, compList]);

  const handleMinimapMouseLeave = useCallback(() => {
    setMinimapHover(null);
  }, []);

  // Click-to-Scrub on Minimap
  const handleMinimapClick = useCallback((e) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || normalizedSamples.length < 10) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    normalizedSamples.forEach(p => {
      if (p.world_x < minX) minX = p.world_x;
      if (p.world_x > maxX) maxX = p.world_x;
      if (p.world_y < minY) minY = p.world_y;
      if (p.world_y > maxY) maxY = p.world_y;
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 26;
    const scale = Math.min((rect.width - padding * 2) / rangeX, (rect.height - padding * 2) / rangeY);

    const offsetX = (rect.width - rangeX * scale) / 2 - minX * scale;
    const offsetY = (rect.height - rangeY * scale) / 2 - minY * scale;

    let closestIdx = 0;
    let minD = Infinity;

    for (let i = 0; i < normalizedSamples.length; i++) {
      const p = normalizedSamples[i];
      const sx = p.world_x * scale + offsetX;
      const sy = rect.height - (p.world_y * scale + offsetY);
      const d = (sx - clickX) ** 2 + (sy - clickY) ** 2;
      if (d < minD) {
        minD = d;
        closestIdx = i;
      }
    }

    const pct = closestIdx / (normalizedSamples.length - 1);
    const targetSec = pct * lapDuration;
    replayTimeRef.current = targetSec;
    setUiReplayTime(targetSec);
    resetPoseTrackers();
  }, [normalizedSamples, lapDuration, resetPoseTrackers]);

  if (!isOpen) return null;

  // Viewport readiness. The scene only builds with enough validated samples, so
  // the modal must say why it is blank instead of showing an empty black canvas.
  const sampleCount = normalizedSamples.length;
  const hasEnoughSamples = sampleCount >= 10;
  const viewportState = !hasEnoughSamples
    ? (samples.length === 0 ? 'empty' : 'insufficient')
    : 'ready';

  const isCompact = layoutTier === 'compact';
  const isMid = layoutTier === 'mid';
  const isNarrow = isCompact || isMid;

  // The HUD is a side panel on wide screens but becomes an overlay on narrow
  // ones, so it stops shrinking the 3D canvas to nothing.
  const hudWidth = isCompact ? 260 : 320;
  const hudIsOverlay = isNarrow;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#0b0e13',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 1. Header Toolbar */}
      <div style={{
        minHeight: '52px',
        padding: isNarrow ? '0.4rem 0.7rem' : '0 1.25rem',
        background: '#11151c',
        borderBottom: '1px solid #232b36',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: isNarrow ? 'wrap' : 'nowrap',
        gap: isNarrow ? '0.4rem' : 0,
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? '0.5rem' : '0.85rem', flexWrap: 'wrap', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '700', fontSize: isNarrow ? '0.82rem' : '0.95rem', color: '#e8edf2' }}>
            <span className="tag tag-comp" style={{ letterSpacing: '0.05em' }}>3D REPLAY</span>
            <span>{trackName}</span>
          </div>

          {!isCompact && (
            <span style={{ fontSize: '0.8rem', color: '#9aa6b2' }}>
              {carName} &bull; <strong style={{ color: '#e8edf2' }}>{driverName}</strong>
            </span>
          )}

          {isComparing ? (
            <span className="tag tag-warn" style={{ fontSize: '0.7rem' }}>
              Dual Ghost Mode (Lap {refLapNumber} vs Lap {compLapNumber})
            </span>
          ) : (
            <span className="tag tag-quiet" style={{ fontSize: '0.7rem' }}>
              Lap {refLapNumber}
            </span>
          )}

          {hasInGameTrack && (
            <span
              className="tag"
              style={{
                fontSize: '0.68rem',
                background: 'rgba(63, 214, 140, 0.12)',
                color: '#3fd68c',
                border: '1px solid rgba(63, 214, 140, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5
              }}
              title="Track road surface and boundaries derived directly from in-game track centerline and physical track limits"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fd68c', boxShadow: '0 0 5px #3fd68c' }} />
              IN-GAME ROADBED
            </span>
          )}
        </div>

        {/* Camera, Lighting, Sound & Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? '0.35rem' : '0.55rem', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>

          {/* Engine Audio Toggle */}
          <button
            className={`btn btn-sm ${!isAudioMuted ? 'btn-primary' : ''}`}
            onClick={handleToggleAudio}
            aria-pressed={!isAudioMuted}
            style={{
              padding: '0.22rem 0.55rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.7rem',
              color: !isAudioMuted ? '#ffffff' : '#9aa6b2'
            }}
            title="Toggle GT3 Engine Sound [M]"
          >
            {!isAudioMuted ? <Volume2 size={13} style={{ color: '#3fd68c' }} /> : <VolumeX size={13} />}
            <span style={{ fontWeight: '600' }}>{!isAudioMuted ? 'SOUND' : 'MUTE'}</span>
          </button>

          {/* Lighting Mode Selector (Day, Sunset, Night WEC) */}
          <div role="group" aria-label="Lighting" style={{ display: 'flex', alignItems: 'center', background: '#171c24', padding: '2px', borderRadius: '4px', border: '1px solid #333d4b', gap: '1px' }}>
            <button
              className={`btn btn-sm ${lightingMode === 'day' ? 'btn-primary' : ''}`}
              onClick={() => handleSetLightingMode('day')}
              aria-pressed={lightingMode === 'day'}
              style={{ border: 'none', padding: '0.2rem 0.45rem', display: 'flex', alignItems: 'center' }}
              title="Daylight Mode [L]"
            >
              <Sun size={13} />
            </button>
            <button
              className={`btn btn-sm ${lightingMode === 'sunset' ? 'btn-primary' : ''}`}
              onClick={() => handleSetLightingMode('sunset')}
              aria-pressed={lightingMode === 'sunset'}
              style={{ border: 'none', padding: '0.2rem 0.45rem', display: 'flex', alignItems: 'center' }}
              title="Golden Hour Sunset [L]"
            >
              <Sunset size={13} />
            </button>
            <button
              className={`btn btn-sm ${lightingMode === 'night' ? 'btn-primary' : ''}`}
              onClick={() => handleSetLightingMode('night')}
              aria-pressed={lightingMode === 'night'}
              style={{ border: 'none', padding: '0.2rem 0.45rem', display: 'flex', alignItems: 'center' }}
              title="Night WEC Mode (Projector Headlights) [L]"
            >
              <Moon size={13} />
            </button>
          </div>

          {/* Camera Mode Selector */}
          <div role="group" aria-label="Camera mode" style={{ display: 'flex', background: '#171c24', padding: '2px', borderRadius: '4px', border: '1px solid #333d4b' }}>
            <button
              className={`btn btn-sm ${cameraMode === 'chase' ? 'btn-primary' : ''}`}
              onClick={() => setCameraMode('chase')}
              aria-pressed={cameraMode === 'chase'}
              style={{ border: 'none', padding: '0.2rem 0.48rem' }}
              title="Chase Cam [1]"
            >
              Chase
            </button>
            <button
              className={`btn btn-sm ${cameraMode === 'hood' ? 'btn-primary' : ''}`}
              onClick={() => setCameraMode('hood')}
              aria-pressed={cameraMode === 'hood'}
              style={{ border: 'none', padding: '0.2rem 0.48rem' }}
              title="Hood Cam [2]"
            >
              Hood
            </button>
            <button
              className={`btn btn-sm ${cameraMode === 'broadcast' ? 'btn-primary' : ''}`}
              onClick={() => setCameraMode('broadcast')}
              aria-pressed={cameraMode === 'broadcast'}
              style={{ border: 'none', padding: '0.2rem 0.48rem', display: 'flex', alignItems: 'center', gap: '3px' }}
              title="TV Broadcast Cam [3]"
            >
              <Video size={12} />
              TV Cam
            </button>
            <button
              className={`btn btn-sm ${cameraMode === 'topdown' ? 'btn-primary' : ''}`}
              onClick={() => setCameraMode('topdown')}
              aria-pressed={cameraMode === 'topdown'}
              style={{ border: 'none', padding: '0.2rem 0.48rem' }}
              title="Top-Down Cam [4]"
            >
              Top-Down
            </button>
            <button
              className={`btn btn-sm ${cameraMode === 'orbit' ? 'btn-primary' : ''}`}
              onClick={() => setCameraMode('orbit')}
              aria-pressed={cameraMode === 'orbit'}
              style={{ border: 'none', padding: '0.2rem 0.48rem' }}
              title="360° Free Cam [5]"
            >
              360° Free
            </button>
          </div>

          {/* Zoom In / Zoom Out Controls */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#171c24', padding: '2px', borderRadius: '4px', border: '1px solid #333d4b', gap: '2px' }}>
            <button
              className="btn btn-sm"
              onClick={handleZoomOut}
              style={{ border: 'none', padding: '0.2rem 0.42rem', display: 'flex', alignItems: 'center' }}
              title="Zoom Out (or Scroll Wheel Down)"
            >
              <ZoomOut size={13} />
            </button>
            <button
              className="btn btn-sm"
              onClick={handleResetZoom}
              style={{ border: 'none', padding: '0.2rem 0.35rem', fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '38px', color: '#35c7f0' }}
              title="Reset Zoom (100%)"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              className="btn btn-sm"
              onClick={handleZoomIn}
              style={{ border: 'none', padding: '0.2rem 0.42rem', display: 'flex', alignItems: 'center' }}
              title="Zoom In (or Scroll Wheel Up)"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Toggle HUD Button */}
          <button
            className={`btn btn-sm ${showHud ? 'btn-primary' : ''}`}
            onClick={() => setShowHud(h => !h)}
            aria-pressed={showHud}
            style={{ padding: '0.2rem 0.55rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Toggle Live Telemetry HUD (or Press 'H')"
          >
            <Activity size={12} />
            HUD
          </button>

          {/* Toggle on-canvas telemetry strip */}
          <button
            className={`btn btn-sm ${showTelemetryOverlay ? 'btn-primary' : ''}`}
            onClick={() => setShowTelemetryOverlay(v => !v)}
            aria-pressed={showTelemetryOverlay}
            style={{ padding: '0.2rem 0.55rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Toggle the on-canvas telemetry strip"
          >
            <Gauge size={12} />
            Live data
          </button>

          {/* Toggle floating delta tag */}
          <button
            className={`btn btn-sm ${showDeltaTag ? 'btn-primary' : ''}`}
            onClick={() => setShowDeltaTag(v => !v)}
            aria-pressed={showDeltaTag}
            disabled={!isComparing}
            style={{ padding: '0.2rem 0.55rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            title={isComparing ? 'Show or hide the +/− delta tag above the cars' : 'Delta tag needs a comparison lap'}
          >
            <Diff size={12} />
            Delta tag
          </button>

          {/* Multi-lap replay toggle */}
          {onToggleMultiLap && (
            <button
              className={`btn btn-sm ${multiLapEnabled ? 'btn-primary' : ''}`}
              onClick={onToggleMultiLap}
              aria-pressed={multiLapEnabled}
              disabled={laps.length < 2 || sessionTelemetryLoading}
              style={{ padding: '0.2rem 0.55rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              title={
                laps.length < 2
                  ? 'Needs at least two flying laps'
                  : 'Replay every flying lap back to back on one timeline'
              }
            >
              <Layers size={12} />
              {sessionTelemetryLoading
                ? 'Loading…'
                : multiLapEnabled
                  ? `All laps (${laps.length})`
                  : 'All laps'}
            </button>
          )}

          <button 
            className="btn btn-sm"
            onClick={onClose}
            style={{ padding: '0.35rem 0.65rem' }}
            title="Close 3D replay (or press Escape)"
          >
            <X size={15} />
            Exit
          </button>
        </div>
      </div>

      {/* 2. Main 3D Viewport & HUD */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        
        {/* Live TV Broadcast Stand Banner */}
        {cameraMode === 'broadcast' && (
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10, 14, 22, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 92, 92, 0.4)',
            borderRadius: '6px',
            padding: '5px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 15,
            boxShadow: '0 4px 18px rgba(0,0,0,0.6)'
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff5c5c', boxShadow: '0 0 8px #ff5c5c' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: '800', color: '#ff5c5c', letterSpacing: '0.06em' }}>LIVE TV</span>
            <span style={{ fontSize: '0.72rem', color: '#6b7785' }}>|</span>
            <span style={{ fontSize: '0.74rem', fontWeight: '700', color: '#e8edf2' }}>
              {broadcastStandName || 'Trackside Camera'}
            </span>
          </div>
        )}
        
        {/* Three.js Canvas Container */}
        <div 
          ref={mountRef} 
          style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            cursor: cameraMode === 'orbit' ? 'grab' : isComparing ? 'pointer' : 'default'
          }}
          title={isComparing ? "Click on either car to switch camera focus, or press 'C'" : undefined}
        />

        {/* Viewport state overlay: empty / insufficient telemetry */}
        {viewportState !== 'ready' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            background: '#0b0e13',
            zIndex: 30,
            textAlign: 'center',
            padding: '2rem'
          }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '2px solid #232b36',
              borderTopColor: viewportState === 'empty' ? '#6b7785' : '#35c7f0',
              animation: viewportState === 'empty' ? 'none' : 't3d-spin 0.9s linear infinite'
            }} />
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e8edf2' }}>
              {viewportState === 'empty'
                ? 'No telemetry to replay'
                : `Building 3D scene (${sampleCount}/10 samples)`}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#9aa6b2', maxWidth: 360 }}>
              {viewportState === 'empty'
                ? 'This session has no GPS samples for the selected lap. Import a lap with position data to use 3D replay.'
                : 'Waiting for more position samples before the track and cars can be built.'}
            </div>
            <style>{'@keyframes t3d-spin { to { transform: rotate(360deg); } }'}</style>
          </div>
        )}

        {/* Floating Active Focus HUD Badge (Top-Left) */}
        {viewportState === 'ready' && isComparing && (
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: 'rgba(10, 14, 22, 0.9)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${activeCar === 'ghost' ? 'rgba(53, 199, 240, 0.5)' : 'rgba(255, 138, 61, 0.5)'}`,
            borderRadius: '6px',
            padding: '5px 9px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 15,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d',
              boxShadow: `0 0 8px ${activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d'}`
            }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.6rem', color: '#6b7785', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Camera Target
              </span>
              <span style={{ fontSize: '0.76rem', fontWeight: '800', color: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d' }}>
                {activeCar === 'ghost' ? `Ghost Car (Lap ${compLapNumber})` : `Driver Car (Lap ${refLapNumber})`}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setActiveCar(curr => curr === 'driver' ? 'ghost' : 'driver')}
              style={{
                border: '1px solid #333d4b',
                padding: '0.2rem 0.5rem',
                fontSize: '0.67rem',
                background: '#171c24',
                marginLeft: '3px'
              }}
              title="Click or press 'C' to switch between cars"
            >
              Switch <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>[C]</span>
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* ON-CANVAS TELEMETRY OVERLAY (broadcast style, top-left)            */}
        {/* ------------------------------------------------------------------ */}
        {viewportState === 'ready' && showTelemetryOverlay && hudTelemetry && (() => {
          const t = hudTelemetry;
          const accent = activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d';
          const rpmPct = Math.min(100, ((t.rpm || 0) / 8000) * 100);
          const rpmRed = (t.rpm || 0) > 7300;
          const throttle = Math.max(0, Math.min(100, t.throttle || 0));
          const brake = Math.max(0, Math.min(100, t.brake || 0));
          const overlayTop = isComparing ? '58px' : '16px';
          return (
            <div style={{
              position: 'absolute',
              top: overlayTop,
              left: isCompact ? '10px' : '16px',
              width: isCompact ? '172px' : '208px',
              background: 'rgba(10, 14, 22, 0.88)',
              backdropFilter: 'blur(8px)',
              border: '1px solid #232b36',
              borderRadius: '8px',
              padding: '0.55rem 0.65rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              zIndex: 15,
              boxShadow: '0 6px 22px rgba(0,0,0,0.6)',
              pointerEvents: 'none'
            }}>
              {/* Speed + gear */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span className="mono" style={{ fontSize: isCompact ? '1.5rem' : '1.75rem', fontWeight: 800, color: accent, lineHeight: 1 }}>
                    {Math.round(t.speed || 0)}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: '#6b7785' }}>km/h</span>
                </div>
                <span className="mono" style={{ fontSize: isCompact ? '1.3rem' : '1.5rem', fontWeight: 800, color: '#facc15', lineHeight: 1 }}>
                  {t.gear ? `G${t.gear}` : 'N'}
                </span>
              </div>

              {/* RPM bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: '#9aa6b2', marginBottom: '2px' }}>
                  <span style={{ fontWeight: 700 }}>RPM</span>
                  <span className="mono" style={{ color: rpmRed ? '#ff5c5c' : '#c084fc', fontWeight: 700 }}>
                    {Math.round(t.rpm || 0)}
                  </span>
                </div>
                <div style={{ height: 5, background: '#1e2530', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${rpmPct}%`, height: '100%', background: rpmRed ? '#ff5c5c' : '#c084fc', transition: 'width 0.08s linear' }} />
                </div>
              </div>

              {/* Throttle / brake bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '0.55rem', color: '#6b7785', width: '34px', fontWeight: 700 }}>THR</span>
                  <div style={{ flex: 1, height: 5, background: '#1e2530', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${throttle}%`, height: '100%', background: '#3fd68c' }} />
                  </div>
                  <span className="mono" style={{ fontSize: '0.55rem', color: '#9aa6b2', width: '24px', textAlign: 'right' }}>
                    {Math.round(throttle)}%
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '0.55rem', color: '#6b7785', width: '34px', fontWeight: 700 }}>BRK</span>
                  <div style={{ flex: 1, height: 5, background: '#1e2530', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${brake}%`, height: '100%', background: '#ff5c5c' }} />
                  </div>
                  <span className="mono" style={{ fontSize: '0.55rem', color: '#9aa6b2', width: '24px', textAlign: 'right' }}>
                    {Math.round(brake)}%
                  </span>
                </div>
              </div>

              {/* Steering + lateral G */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', borderTop: '1px solid #1e2530', paddingTop: '4px' }}>
                <span style={{ color: '#6b7785' }}>
                  STR <strong className="mono" style={{ color: '#e8edf2' }}>{Math.round(t.steering || 0)}&deg;</strong>
                </span>
                <span style={{ color: '#6b7785' }}>
                  G <strong className="mono" style={{ color: (t.lat_g || 0) < 0 ? '#35c7f0' : '#ff8a3d' }}>
                    {(t.lat_g || 0).toFixed(2)}
                  </strong>
                </span>
              </div>
            </div>
          );
        })()}

        {/* ------------------------------------------------------------------ */}
        {/* FLOATING MINIMAP HUD (Bottom-Left)                                 */}
        {/* ------------------------------------------------------------------ */}
        <div style={{
          position: 'absolute',
          bottom: isCompact ? '150px' : '128px',
          left: isCompact ? '10px' : '20px',
          width: isMinimapCollapsed ? 'auto' : isCompact ? '200px' : '280px',
          maxWidth: isCompact ? '60vw' : 'none',
          background: 'rgba(10, 14, 22, 0.94)',
          border: '1px solid #232b36',
          borderRadius: '8px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.75)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 20
        }}>
          {/* Minimap Header */}
          <div style={{
            padding: '0.45rem 0.65rem',
            background: 'rgba(15, 23, 36, 0.95)',
            borderBottom: isMinimapCollapsed ? 'none' : '1px solid #232b36',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <button
              type="button"
              onClick={() => setIsMinimapCollapsed(c => !c)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9aa6b2',
                cursor: 'pointer',
                padding: 0,
                fontSize: '0.72rem',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title={isMinimapCollapsed ? "Expand Minimap" : "Collapse Minimap"}
            >
              {isMinimapCollapsed ? <ChevronUp size={13} color="#35c7f0" /> : <ChevronDown size={13} color="#35c7f0" />}
              <span>TRACK MINIMAP</span>
            </button>

            {!isMinimapCollapsed && (
              <div style={{ display: 'flex', gap: '2px', background: '#0d1116', padding: '1px', borderRadius: '3px' }}>
              {isComparing && (
                <button
                  className={`btn btn-sm ${minimapMode === 'gain_loss' ? 'btn-primary' : ''}`}
                  onClick={() => setMinimapMode('gain_loss')}
                  style={{ border: 'none', padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                  title="Show time gained (Green) vs lost (Red)"
                >
                  <Zap size={10} />
                  Gain/Loss
                </button>
              )}
              <button
                className={`btn btn-sm ${minimapMode === 'speed' ? 'btn-primary' : ''}`}
                onClick={() => setMinimapMode('speed')}
                style={{ border: 'none', padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                title="Speed heatmap"
              >
                Speed
              </button>
              <button
                className={`btn btn-sm ${minimapMode === 'line' ? 'btn-primary' : ''}`}
                onClick={() => setMinimapMode('line')}
                style={{ border: 'none', padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                title="Line"
              >
                Line
              </button>
            </div>
            )}
          </div>

          {/* Minimap Canvas with click-to-seek & hover info */}
          {!isMinimapCollapsed && (
            <>
              <div 
                style={{ padding: '0.35rem', cursor: 'crosshair', position: 'relative', display: 'flex', justifyContent: 'center' }}
            onMouseLeave={handleMinimapMouseLeave}
          >
            <canvas
              ref={minimapCanvasRef}
              onClick={handleMinimapClick}
              onMouseMove={handleMinimapMouseMove}
              style={{ display: 'block', borderRadius: '4px' }}
              title="Hover to inspect Gain/Loss delta, click to jump replay"
            />

            {/* Hover Gain / Loss Info Tooltip. Position is derived from the
                canvas rect stored on minimapHover so it tracks the real size. */}
            {minimapHover && (() => {
              const wrapPad = 6;
              const boxW = 176;
              const canvasW = minimapHover.containerWidth || 270;
              const canvasH = minimapHover.containerHeight || 205;
              const left = Math.max(wrapPad, Math.min(canvasW - boxW + wrapPad, minimapHover.screenX - boxW / 2 + wrapPad));
              const flipUp = minimapHover.screenY > canvasH * 0.45;
              const top = flipUp
                ? Math.max(wrapPad, minimapHover.screenY - 96 + wrapPad)
                : minimapHover.screenY + 18 + wrapPad;
              return (
              <div style={{
                position: 'absolute',
                top: `${top}px`,
                left: `${left}px`,
                width: `${boxW}px`,
                background: 'rgba(9, 13, 21, 0.96)',
                border: `1px solid ${minimapHover.compItem?.status === 'gain' ? '#3fd68c' : minimapHover.compItem?.status === 'loss' ? '#ff5c5c' : '#475467'}`,
                borderRadius: '6px',
                padding: '6px 8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
                pointerEvents: 'none',
                zIndex: 35,
              }}>
                {/* Header: Gain or Loss delta */}
                {isComparing && minimapHover.compItem ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '0.66rem',
                      fontWeight: '800',
                      letterSpacing: '0.04em',
                      color: minimapHover.compItem.status === 'gain' ? '#3fd68c' : minimapHover.compItem.status === 'loss' ? '#ff5c5c' : '#9aa6b2'
                    }}>
                      {minimapHover.compItem.status === 'gain' ? '▲ TIME GAIN' : minimapHover.compItem.status === 'loss' ? '▼ TIME LOSS' : '• NEUTRAL'}
                    </span>
                    <span className="mono" style={{
                      fontSize: '0.78rem',
                      fontWeight: '800',
                      color: minimapHover.compItem.delta <= 0 ? '#3fd68c' : '#ff5c5c'
                    }}>
                      {minimapHover.compItem.delta <= 0 ? `${minimapHover.compItem.delta.toFixed(3)}s` : `+${minimapHover.compItem.delta.toFixed(3)}s`}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#35c7f0', marginBottom: '3px' }}>
                    TRACK TELEMETRY
                  </div>
                )}

                {/* Speed comparison */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.67rem', color: '#9aa6b2', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '4px' }}>
                  <span>Speed: <strong style={{ color: '#ff8a3d' }} className="mono">{Math.round(minimapHover.sample.speed)} km/h</strong></span>
                  {isComparing && (
                    <span>Ghost: <strong style={{ color: '#35c7f0' }} className="mono">
                      {Math.round(minimapHover.compItem?.comp?.speed || minimapHover.compItem?.speed || 0)} km/h
                    </strong></span>
                  )}
                </div>

                {/* Throttle / Brake & Distance */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: '#6b7785', marginTop: '3px' }}>
                  <span>T: <strong style={{ color: '#3fd68c' }}>{Math.round(minimapHover.sample.throttle || 0)}%</strong> B: <strong style={{ color: '#ff5c5c' }}>{Math.round(minimapHover.sample.brake || 0)}%</strong></span>
                  <span className="mono">{Math.round((minimapHover.sample.dist_pct || 0) * 100)}% lap</span>
                </div>

                <div style={{ fontSize: '0.58rem', color: '#35c7f0', textAlign: 'center', marginTop: '4px', borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: '3px' }}>
                  Click to jump replay here
                </div>
              </div>
              );
            })()}
          </div>

          {/* Minimap Legend */}
          <div style={{
            padding: '4px 8px 6px 8px',
            borderTop: '1px solid rgba(30, 41, 59, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.62rem',
            color: '#9aa6b2'
          }}>
            {minimapMode === 'gain_loss' ? (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fd68c' }}></span> Gain
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5c5c' }}></span> Loss
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b7785' }}></span> Even
                </span>
              </>
            ) : minimapMode === 'speed' ? (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5c5c' }}></span> Slow
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f5b03e' }}></span> Mid
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fd68c' }}></span> Fast
                </span>
              </>
            ) : (
              <span>Click track to scrub</span>
            )}

            {isComparing && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', borderLeft: '1px solid #475467', paddingLeft: '5px' }}>
                <button
                  type="button"
                  onClick={() => setActiveCar('driver')}
                  style={{
                    background: activeCar === 'driver' ? 'rgba(255, 138, 61, 0.2)' : 'none',
                    border: `1px solid ${activeCar === 'driver' ? '#ff8a3d' : 'transparent'}`,
                    borderRadius: '3px',
                    padding: '1px 4px',
                    color: activeCar === 'driver' ? '#ff8a3d' : '#9aa6b2',
                    fontWeight: activeCar === 'driver' ? '700' : '500',
                    cursor: 'pointer',
                    fontSize: '0.62rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                  title="Focus Driver Car (Press 'C')"
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff8a3d' }}></span> Car
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCar('ghost')}
                  style={{
                    background: activeCar === 'ghost' ? 'rgba(53, 199, 240, 0.2)' : 'none',
                    border: `1px solid ${activeCar === 'ghost' ? '#35c7f0' : 'transparent'}`,
                    borderRadius: '3px',
                    padding: '1px 4px',
                    color: activeCar === 'ghost' ? '#35c7f0' : '#9aa6b2',
                    fontWeight: activeCar === 'ghost' ? '700' : '500',
                    cursor: 'pointer',
                    fontSize: '0.62rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                  title="Focus Ghost Car (Press 'C')"
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#35c7f0' }}></span> Ghost
                </button>
              </span>
            )}
          </div>
          </>)}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* HUD FLOATING PLAYBACK CONTROLS (Bottom-Center)                     */}
        {/* ------------------------------------------------------------------ */}
        <div style={{
          position: 'absolute',
          bottom: isCompact ? '10px' : '16px',
          left: isCompact ? '10px' : '20px',
          right: showHud && !hudIsOverlay ? '340px' : isCompact ? '10px' : '20px',
          background: 'rgba(10, 14, 22, 0.94)',
          border: '1px solid #232b36',
          borderRadius: '8px',
          padding: isCompact ? '0.5rem 0.6rem' : '0.65rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          zIndex: 26,
          transition: 'right 0.2s ease'
        }}>
          {/* Progress Timeline Scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#35c7f0', minWidth: '65px', fontWeight: '700' }} className="mono">
              {formatTime(uiReplayTime)}
            </span>

            <input
              type="range"
              min="0"
              max={replayDuration}
              step="0.05"
              value={uiReplayTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                replayTimeRef.current = val;
                setUiReplayTime(val);
                resetPoseTrackers();
              }}
              style={{
                flex: 1,
                cursor: 'pointer',
                accentColor: '#35c7f0'
              }}
            />

            <span style={{ fontSize: '0.72rem', color: '#9aa6b2', minWidth: '65px', textAlign: 'right' }} className="mono">
              {formatTime(replayDuration)}
            </span>

            {multiLapActive && activePoint?.lap_number != null ? (
              <span style={{ fontSize: '0.72rem', color: '#ff8a3d', minWidth: '52px', fontWeight: 700 }} className="mono">
                Lap {activePoint.lap_number}
              </span>
            ) : (
              <span style={{ fontSize: '0.72rem', color: '#6b7785', minWidth: '52px' }} className="mono">
                {activePoint ? `${(activePoint.dist_pct * 100).toFixed(0)}%` : '0%'}
              </span>
            )}
          </div>

          {/* Multi-lap lap markers */}
          {multiLapActive && lapMarks.length > 1 && (
            <div style={{ display: 'flex', gap: '2px', height: 4, marginTop: '-2px' }}>
              {lapMarks.map((m) => (
                <span
                  key={m.lap_number}
                  title={`Lap ${m.lap_number}${m.lap_time ? ` · ${formatTime(m.lap_time)}` : ''}`}
                  style={{
                    flex: Math.max(0.001, (m.end_time - m.start_time) / Math.max(0.001, replayDuration)),
                    background: activePoint?.lap_number === m.lap_number ? '#ff8a3d' : '#333d4b',
                    borderRadius: 2
                  }}
                />
              ))}
            </div>
          )}

          {/* Transport Buttons: Play, Pause, Speeds, Reset */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button 
                className={`btn btn-sm ${isPlaying ? 'btn-primary' : ''}`}
                onClick={() => setIsPlaying(!isPlaying)}
                style={{ minWidth: '105px', fontWeight: '600' }}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                {isPlaying ? 'Pause' : 'Play Replay'}
              </button>

              <button 
                className="btn btn-sm"
                onClick={() => {
                  setIsPlaying(false);
                  replayTimeRef.current = 0;
                  setUiReplayTime(0);
                  resetPoseTrackers();
                }}
              >
                <RotateCcw size={13} />
                Restart
              </button>
            </div>

            {/* Playback speed multipliers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#9aa6b2' }}>
              <span>Rate:</span>
              {[0.25, 0.5, 1, 2, 4].map(s => (
                <button
                  key={s}
                  className={`btn btn-sm ${playbackSpeed === s ? 'btn-primary' : ''}`}
                  onClick={() => setPlaybackSpeed(s)}
                  style={{ padding: '0.15rem 0.45rem', fontWeight: playbackSpeed === s ? '700' : '500' }}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* RIGHT INSTRUMENT & TELEMETRY PANEL                                 */}
        {/* ------------------------------------------------------------------ */}
        {showHud && viewportState === 'ready' && (
        <div style={{
          width: `${hudWidth}px`,
          maxWidth: isCompact ? '82vw' : 'none',
          flexShrink: 0,
          background: isNarrow ? 'rgba(17, 21, 28, 0.96)' : '#11151c',
          borderLeft: '1px solid #232b36',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: isCompact ? '0.7rem' : '1rem',
          gap: isCompact ? '0.6rem' : '0.85rem',
          zIndex: isNarrow ? 25 : 10,
          ...(hudIsOverlay
            ? { position: 'absolute', top: 0, right: 0, bottom: 0, boxShadow: '-12px 0 30px rgba(0,0,0,0.55)' }
            : {})
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #232b36', paddingBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#9aa6b2', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.04em' }}>
                LIVE TELEMETRY HUD
              </div>
              {isComparing && (
                <span
                  className="tag"
                  style={{
                    fontSize: '0.62rem',
                    padding: '1px 6px',
                    fontWeight: '700',
                    background: activeCar === 'ghost' ? 'rgba(53, 199, 240, 0.15)' : 'rgba(255, 138, 61, 0.15)',
                    color: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d',
                    border: `1px solid ${activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d'}55`
                  }}
                >
                  {activeCar === 'ghost' ? `GHOST L${compLapNumber}` : `DRIVER L${refLapNumber}`}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d' }} className="mono">
              T+{uiReplayTime.toFixed(2)}s
            </div>
          </div>

          {/* Quick Car Switcher in HUD */}
          {isComparing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#0d1116',
              padding: '0.45rem 0.65rem',
              borderRadius: '6px',
              border: `1px solid ${activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d'}44`
            }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.62rem', color: '#6b7785', textTransform: 'uppercase', fontWeight: '700' }}>Active View</span>
                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d' }}>
                  {activeCar === 'ghost' ? `Ghost (Lap ${compLapNumber})` : `Driver (Lap ${refLapNumber})`}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setActiveCar(curr => curr === 'driver' ? 'ghost' : 'driver')}
                style={{
                  border: '1px solid #333d4b',
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.68rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
                title="Switch active car (or press 'C')"
              >
                Switch to {activeCar === 'driver' ? 'Ghost' : 'Driver'} <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>[C]</span>
              </button>
            </div>
          )}

          {hudTelemetry && (
            <>
              {/* Speed & Gear Gauge */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.5rem' }}>
                <div style={{ background: '#0d1116', padding: '0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                  <div style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600' }}>SPEED</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: '800', color: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d', lineHeight: 1.1 }} className="mono">
                    {Math.round(hudTelemetry.speed || 0)}
                    <span style={{ fontSize: '0.75rem', color: '#6b7785', marginLeft: '4px' }}>km/h</span>
                  </div>
                </div>

                <div style={{ background: '#0d1116', padding: '0.75rem', borderRadius: '6px', border: '1px solid #232b36', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600' }}>GEAR</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#facc15', lineHeight: 1.1 }} className="mono">
                    {hudTelemetry.gear ? `G${hudTelemetry.gear}` : 'N'}
                  </div>
                </div>
              </div>

              {/* RPM Bar Gauge */}
              <div style={{ background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: '4px' }}>
                  <span style={{ color: '#9aa6b2', fontWeight: '600' }}>ENGINE RPM</span>
                  <span style={{ color: (hudTelemetry.rpm || 0) > 7300 ? '#ff5c5c' : '#c084fc', fontWeight: '700' }} className="mono">
                    {hudTelemetry.rpm || 0} RPM
                  </span>
                </div>
                <div style={{ height: 8, background: '#1e2530', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, ((hudTelemetry.rpm || 0) / 8000) * 100)}%`,
                    height: '100%',
                    background: (hudTelemetry.rpm || 0) > 7300 ? '#ff5c5c' : (hudTelemetry.rpm || 0) > 6500 ? '#f5b03e' : '#35c7f0',
                    transition: 'width 0.05s'
                  }}></div>
                </div>
              </div>

              {/* Pedals Input Gauges */}
              <div style={{ background: '#0d1116', padding: '0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                <div style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600', marginBottom: '0.5rem' }}>
                  PEDAL TELEMETRY
                </div>

                {/* Throttle */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#3fd68c', marginBottom: '2px' }}>
                    <span>Throttle</span>
                    <span className="mono">{Math.round(hudTelemetry.throttle || 0)}%</span>
                  </div>
                  <div style={{ height: 7, background: '#1e2530', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(hudTelemetry.throttle || 0)}%`, height: '100%', background: '#3fd68c', transition: 'width 0.05s' }}></div>
                  </div>
                </div>

                {/* Brake */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#ff5c5c', marginBottom: '2px' }}>
                    <span>Brake</span>
                    <span className="mono">{Math.round(hudTelemetry.brake || 0)}%</span>
                  </div>
                  <div style={{ height: 7, background: '#1e2530', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(hudTelemetry.brake || 0)}%`, height: '100%', background: '#ff5c5c', transition: 'width 0.05s' }}></div>
                  </div>
                </div>
              </div>

              {/* Steering & G-Force */}
              <div style={{ background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#9aa6b2', marginBottom: '4px' }}>
                  <span>STEERING</span>
                  <span>LATERAL G</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: '700', color: '#7aa2ff' }} className="mono">
                    {Math.round(hudTelemetry.steering || 0)}°
                  </span>
                  <span style={{ fontSize: '1.1rem', fontWeight: '700', color: Math.abs(hudTelemetry.lat_g || 0) > 2 ? '#ff5c8a' : '#e8edf2' }} className="mono">
                    {(hudTelemetry.lat_g || 0) > 0 ? `+${(hudTelemetry.lat_g || 0).toFixed(2)}` : (hudTelemetry.lat_g || 0).toFixed(2)} G
                  </span>
                </div>
              </div>

              {/* Real-Time Track Elevation & Grade HUD */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div style={{ background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                  <div style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600' }}>ALTITUDE</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#35c7f0', lineHeight: 1.1 }} className="mono">
                    {spline ? spline.poseAtPct(hudTelemetry.dist_pct || 0).y.toFixed(1) : '0.0'}
                    <span style={{ fontSize: '0.7rem', color: '#6b7785', marginLeft: '3px' }}>m</span>
                  </div>
                </div>
                <div style={{ background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                  <div style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600' }}>SLOPE / GRADE</div>
                  {(() => {
                    const slope = spline ? (spline.poseAtPct(hudTelemetry.dist_pct || 0).slopePct || 0) : 0;
                    const slopeColor = slope > 0.8 ? '#ff8a3d' : slope < -0.8 ? '#35c7f0' : '#9aa6b2';
                    return (
                      <div style={{ fontSize: '1.25rem', fontWeight: '800', color: slopeColor, lineHeight: 1.1 }} className="mono">
                        {slope >= 0 ? `+${slope.toFixed(1)}` : slope.toFixed(1)}
                        <span style={{ fontSize: '0.7rem', color: '#6b7785', marginLeft: '2px' }}>%</span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Track Lateral Position & Kerb Contact HUD */}
              {(hudTelemetry.path_lateral !== undefined || hudTelemetry.track_edge !== undefined) && (() => {
                const plat = hudTelemetry.path_lateral || 0;
                const edge = Math.abs(hudTelemetry.track_edge || 6.0);
                const carHalfW = 1.0;
                const outerWheelDist = Math.abs(plat) + carHalfW;
                const isOnKerb = outerWheelDist >= edge;
                const isCutting = Math.abs(plat) >= edge;
                
                const statusColor = isCutting ? '#ff5c5c' : isOnKerb ? '#f5b03e' : '#3fd68c';
                const statusText = isCutting ? 'TRACK LIMIT 🔴' : isOnKerb ? 'ON KERB 🏎️' : 'ON TRACK 🟢';
                const kerbSide = plat > 0 ? 'RIGHT' : 'LEFT';
                const roadPct = Math.max(0, Math.min(100, ((plat + edge) / (2 * edge)) * 100));

                return (
                  <div style={{ background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#9aa6b2', fontWeight: '600' }}>TRACK POSITION & KERB</span>
                      <span style={{
                        fontSize: '0.62rem',
                        fontWeight: '700',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background: isCutting ? 'rgba(239, 68, 68, 0.15)' : isOnKerb ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        color: statusColor,
                        border: `1px solid ${statusColor}44`
                      }}>
                        {statusText}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '2px' }}>
                      <div>
                        <span style={{ fontSize: '1.15rem', fontWeight: '700', color: '#e8edf2' }} className="mono">
                          {plat > 0 ? `+${plat.toFixed(2)}` : plat.toFixed(2)}m
                        </span>
                        <span style={{ fontSize: '0.65rem', color: '#6b7785', marginLeft: '5px' }}>
                          from center ({kerbSide})
                        </span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '0.68rem', color: '#9aa6b2' }}>
                        Limit: <strong style={{ color: '#9aa6b2' }} className="mono">{edge.toFixed(1)}m</strong>
                      </div>
                    </div>

                    {/* Road cross-section visualizer */}
                    <div style={{ position: 'relative', height: '14px', background: '#171c24', borderRadius: '3px', marginTop: '6px', overflow: 'hidden', border: '1px solid #232b36' }}>
                      {/* Left kerb zone */}
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%', background: 'repeating-linear-gradient(45deg, #ff5c5c, #ff5c5c 4px, #e8edf2 4px, #e8edf2 8px)', opacity: 0.6 }}></div>
                      {/* Right kerb zone */}
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%', background: 'repeating-linear-gradient(45deg, #ff5c5c, #ff5c5c 4px, #e8edf2 4px, #e8edf2 8px)', opacity: 0.6 }}></div>
                      {/* Centerline dashed */}
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.25)', transform: 'translateX(-50%)' }}></div>
                      {/* Car Position Marker */}
                      <div style={{
                        position: 'absolute',
                        left: `${roadPct}%`,
                        top: '1px',
                        bottom: '1px',
                        width: '10px',
                        transform: 'translateX(-50%)',
                        background: activeCar === 'ghost' ? '#35c7f0' : '#ff8a3d',
                        borderRadius: '2px',
                        border: '1px solid #ffffff',
                        transition: 'left 0.05s ease-out'
                      }}></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: '#6b7785', marginTop: '2px' }}>
                      <span>LEFT KERB</span>
                      <span>CENTER</span>
                      <span>RIGHT KERB</span>
                    </div>
                  </div>
                );
              })()}

              {/* Dual Car Ghost Delta Comparison HUD */}
              {isComparing && (
                <div style={{
                  background: '#11151c',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #333d4b',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.68rem', color: '#e879f9', fontWeight: '700' }}>
                      {activeCar === 'ghost' ? 'TIME DELTA (VS DRIVER)' : 'TIME DELTA (VS GHOST)'}
                    </span>
                    {activeCompPoint && activeCompPoint.status && (() => {
                      const isGhost = activeCar === 'ghost';
                      const rawDelta = activeCompPoint.delta;
                      const relativeDelta = isGhost ? -rawDelta : rawDelta;
                      const isGaining = relativeDelta < -0.01;
                      const isLosing = relativeDelta > 0.01;
                      const statusLabel = isGaining ? 'GAINING TIME' : isLosing ? 'LOSING TIME' : 'EVEN';
                      const statusTagClass = isGaining ? 'tag-gain' : isLosing ? 'tag-loss' : 'tag-quiet';

                      return (
                        <span className={`tag ${statusTagClass}`} style={{ fontSize: '0.62rem' }}>
                          {statusLabel}
                        </span>
                      );
                    })()}
                  </div>

                  {activeCompPoint ? (() => {
                    const isGhost = activeCar === 'ghost';
                    const rawDelta = activeCompPoint.delta;
                    const relativeDelta = isGhost ? -rawDelta : rawDelta;
                    const otherSpeed = isGhost
                      ? Math.round(activePoint?.speed || 0)
                      : Math.round(activeCompPoint.comp?.speed || activeCompPoint.speed || 0);
                    const otherLabel = isGhost ? `Driver Speed (L${refLapNumber}):` : `Ghost Speed (L${compLapNumber}):`;
                    const otherColor = isGhost ? '#ff8a3d' : '#35c7f0';

                    return (
                      <div>
                        <div style={{
                          fontSize: '1.6rem',
                          fontWeight: '800',
                          color: relativeDelta <= 0 ? '#3fd68c' : '#ff5c5c',
                          lineHeight: 1.1
                        }} className="mono">
                          {relativeDelta <= 0 ? `${relativeDelta.toFixed(3)}s` : `+${relativeDelta.toFixed(3)}s`}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#9aa6b2', marginTop: '4px' }}>
                          <span>{otherLabel} <strong style={{ color: otherColor }} className="mono">{otherSpeed} km/h</strong></span>
                          <span>Diff: <strong style={{ color: relativeDelta <= 0 ? '#3fd68c' : '#ff5c5c' }} className="mono">{relativeDelta > 0 ? `+${relativeDelta.toFixed(2)}` : relativeDelta.toFixed(2)}s</strong></span>
                        </div>
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: '0.75rem', color: '#6b7785' }}>Calculating delta...</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Key Gain / Loss Highlights Box */}
          {isComparing && comparisonData && (
            <div style={{ marginTop: 'auto', background: '#0d1116', padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #232b36', fontSize: '0.72rem' }}>
              <div style={{ color: '#6b7785', fontWeight: '700', marginBottom: '4px' }}>
                SECTOR GAIN / LOSS APEX
              </div>
              {comparisonData.max_gain && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3fd68c', marginBottom: '2px' }}>
                  <span>Max Time Gained:</span>
                  <span className="mono"><strong>{comparisonData.max_gain.diff.toFixed(2)}s</strong> @ {Math.round(comparisonData.max_gain.speed)} km/h</span>
                </div>
              )}
              {comparisonData.max_loss && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ff5c5c' }}>
                  <span>Max Time Lost:</span>
                  <span className="mono"><strong>+{comparisonData.max_loss.diff.toFixed(2)}s</strong> @ {Math.round(comparisonData.max_loss.speed)} km/h</span>
                </div>
              )}
            </div>
          )}
        </div>
        )}

      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Spline Interpolation & Math Helpers (Zero Jitter Guaranteed)
// --------------------------------------------------------------------------

function computeSmoothTrackData(pts) {
  if (!pts || pts.length < 2) return [];
  const n = pts.length;

  // 1. Calculate cumulative physical distance
  const cumDist = new Float64Array(n);
  cumDist[0] = 0;
  for (let i = 1; i < n; i++) {
    const dx = pts[i].world_x - pts[i - 1].world_x;
    const dy = pts[i].world_y - pts[i - 1].world_y;
    cumDist[i] = cumDist[i - 1] + Math.hypot(dx, dy);
  }

  // 2. Spatial lookahead/lookbehind window (~8 meters) for stable heading tangent
  const windowDist = 8.0;
  const rawHeadings = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const dCur = cumDist[i];

    let iPrev = i;
    while (iPrev > 0 && (dCur - cumDist[iPrev]) < windowDist) {
      iPrev--;
    }
    let iNext = i;
    while (iNext < n - 1 && (cumDist[iNext] - dCur) < windowDist) {
      iNext++;
    }

    let dx = pts[iNext].world_x - pts[iPrev].world_x;
    let dz = -(pts[iNext].world_y - pts[iPrev].world_y);
    let len = Math.hypot(dx, dz);

    if (len < 0.05) {
      const ip = Math.max(0, i - 12);
      const inx = Math.min(n - 1, i + 12);
      dx = pts[inx].world_x - pts[ip].world_x;
      dz = -(pts[inx].world_y - pts[ip].world_y);
      len = Math.hypot(dx, dz);
    }

    if (len > 0.001) {
      rawHeadings[i] = Math.atan2(dx, dz);
    } else {
      rawHeadings[i] = i > 0 ? rawHeadings[i - 1] : 0;
    }
  }

  // 3. Continuous phase unwrap to eliminate any 2*PI wrap jumps
  const unwrapped = new Float64Array(n);
  unwrapped[0] = rawHeadings[0];
  for (let i = 1; i < n; i++) {
    let diff = (rawHeadings[i] - unwrapped[i - 1]) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    unwrapped[i] = unwrapped[i - 1] + diff;
  }

  // 4. Moving average smoothing (7-point window)
  const smoothed = new Float64Array(n);
  const filterHalf = 3;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -filterHalf; k <= filterHalf; k++) {
      const idx = Math.max(0, Math.min(n - 1, i + k));
      sum += unwrapped[idx];
      count++;
    }
    smoothed[i] = sum / count;
  }

  return pts.map((s, i) => ({
    ...s,
    heading: smoothed[i],
    cum_dist: cumDist[i]
  }));
}

// --------------------------------------------------------------------------
// Track-Relative Coordinate System (world-space car placement)
// --------------------------------------------------------------------------
//
// Telemetry gives the car's GPS position (world_x / world_y) plus its lateral
// distance from the track centreline in metres (path_lateral, + = right of
// centreline). To place the car correctly through corners we rebuild the true
// track centreline, then express every sample as:
//
//     carPosition = centerPosition + rightVector * lateralOffset
//
// and derive the car's heading from the track tangent at that centreline point.
// The returned model is shared by the road ribbon, both cars and the minimap.

function buildTrackCenterline(points, stepM = 2.0, smoothHalf = 4, trackName = '') {
  if (!points || points.length < 10) return null;

  const hasInGameCenter = points.some(p => p.track_center_x != null && p.track_center_y != null);

  let lateralSamples = 0;
  for (let i = 0; i < points.length; i++) {
    const plat = points[i].path_lateral;
    if (plat !== undefined && plat !== null) lateralSamples++;
  }
  // Without in-game center or lateral channel, there is no offset to apply; keep legacy path.
  if (!hasInGameCenter && lateralSamples < points.length * 0.5) return null;

  const model = buildTrackCenterlineOnce(points, stepM, smoothHalf, trackName);

  // If in-game centerline was not already provided, perform refinement pass
  if (!hasInGameCenter && model) {
    const refined = points.map(s => {
      const frame = trackFrameAtPct(model, s.dist_pct || 0);
      return frame ? { ...s, heading: frame.heading } : s;
    });
    const refinedModel = buildTrackCenterlineOnce(refined, stepM, smoothHalf, trackName);
    if (refinedModel) return refinedModel;
  }

  return model;
}

function buildTrackCenterlineOnce(points, stepM, smoothHalf, trackName = '') {
  const n = points.length;
  const rawX = new Float64Array(n);
  const rawY = new Float64Array(n);
  const rawPct = new Float64Array(n);

  const hasInGameCenter = points.some(p => p.track_center_x != null && p.track_center_y != null);

  // Recover the centreline from in-game data or by walking the car back along its right vector.
  for (let i = 0; i < n; i++) {
    if (hasInGameCenter && points[i].track_center_x != null) {
      rawX[i] = points[i].track_center_x;
      rawY[i] = points[i].track_center_y;
    } else {
      const h = points[i].heading || 0;
      const plat = points[i].path_lateral || 0;
      // Right vector in telemetry (x, y) coords is (-cos h, -sin h)
      rawX[i] = points[i].world_x + Math.cos(h) * plat;
      rawY[i] = points[i].world_y + Math.sin(h) * plat;
    }
    rawPct[i] = points[i].dist_pct || 0;
  }

  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(rawX[i] - rawX[i - 1], rawY[i] - rawY[i - 1]);
  }
  const totalLen = cum[n - 1];
  if (totalLen < 50) return null;

  const numSlices = Math.max(10, Math.floor(totalLen / stepM));
  const sliceX = new Float64Array(numSlices);
  const sliceY = new Float64Array(numSlices);
  const slicePct = new Float64Array(numSlices);

  let cursor = 0;
  for (let s = 0; s < numSlices; s++) {
    const target = s * stepM;
    while (cursor < n - 2 && cum[cursor + 1] < target) cursor++;
    const segLen = cum[cursor + 1] - cum[cursor];
    const a = segLen > 0.001 ? (target - cum[cursor]) / segLen : 0;
    sliceX[s] = rawX[cursor] + a * (rawX[cursor + 1] - rawX[cursor]);
    sliceY[s] = rawY[cursor] + a * (rawY[cursor + 1] - rawY[cursor]);
    slicePct[s] = rawPct[cursor] + a * (rawPct[cursor + 1] - rawPct[cursor]);
  }

  const gap = Math.hypot(sliceX[numSlices - 1] - sliceX[0], sliceY[numSlices - 1] - sliceY[0]);
  const isLoop = gap < 35.0;

  // Smooth the centreline (wrap-aware for closed circuits)
  const smoothX = new Float64Array(numSlices);
  const smoothY = new Float64Array(numSlices);
  for (let i = 0; i < numSlices; i++) {
    let sx = 0, sy = 0, cnt = 0;
    for (let k = -smoothHalf; k <= smoothHalf; k++) {
      let idx = i + k;
      if (isLoop) idx = ((idx % numSlices) + numSlices) % numSlices;
      else idx = Math.max(0, Math.min(numSlices - 1, idx));
      sx += sliceX[idx];
      sy += sliceY[idx];
      cnt++;
    }
    smoothX[i] = sx / cnt;
    smoothY[i] = sy / cnt;
  }

  // Continuous tangent headings (Three.js convention: atan2(dx, dz), dz = -dy)
  const headings = new Float64Array(numSlices);
  const span = Math.max(2, Math.round(8.0 / stepM));
  for (let i = 0; i < numSlices; i++) {
    let ip, inx;
    if (isLoop) {
      ip = (i - span + numSlices) % numSlices;
      inx = (i + span) % numSlices;
    } else {
      ip = Math.max(0, i - span);
      inx = Math.min(numSlices - 1, i + span);
    }
    const dx = smoothX[inx] - smoothX[ip];
    const dy = smoothY[inx] - smoothY[ip];
    headings[i] = Math.atan2(dx, -dy);
  }

  // Unwrap + smooth headings so interpolation never sees a 2*PI jump
  const unwrapped = new Float64Array(numSlices);
  unwrapped[0] = headings[0];
  for (let i = 1; i < numSlices; i++) {
    let diff = (headings[i] - unwrapped[i - 1]) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    unwrapped[i] = unwrapped[i - 1] + diff;
  }
  const period = unwrapped[numSlices - 1] - unwrapped[0];

  const smoothH = new Float64Array(numSlices);
  const hHalf = 3;
  for (let i = 0; i < numSlices; i++) {
    let sum = 0, cnt = 0;
    for (let k = -hHalf; k <= hHalf; k++) {
      let idx = i + k;
      let off = 0;
      if (isLoop) {
        while (idx < 0) { idx += numSlices; off -= period; }
        while (idx >= numSlices) { idx -= numSlices; off += period; }
      } else {
        idx = Math.max(0, Math.min(numSlices - 1, idx));
      }
      sum += unwrapped[idx] + off;
      cnt++;
    }
    smoothH[i] = sum / cnt;
  }

  const elevations = new Float64Array(numSlices);
  for (let s = 0; s < numSlices; s++) {
    const { elevation } = getTrackElevation(trackName, slicePct[s]);
    elevations[s] = elevation;
  }

  return {
    xs: smoothX,
    ys: smoothY,
    elevations,
    headings: smoothH,
    pcts: slicePct,
    isLoop,
    stepM,
    numSlices
  };
}

// Frame (centerPosition + tangent + elevation) of the track at a normalized lap distance
function trackFrameAtPct(model, pct) {
  if (!model) return null;
  const { xs, ys, headings, pcts, numSlices, elevations } = model;
  let p = pct;
  if (!(p >= 0)) p = 0;
  if (p <= pcts[0]) {
    return {
      x: xs[0],
      y: ys[0],
      elevation: elevations ? elevations[0] : 0,
      heading: headings[0]
    };
  }
  if (p >= pcts[numSlices - 1]) {
    return {
      x: xs[numSlices - 1],
      y: ys[numSlices - 1],
      elevation: elevations ? elevations[numSlices - 1] : 0,
      heading: headings[numSlices - 1]
    };
  }
  let lo = 0;
  let hi = numSlices - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (pcts[mid] <= p) lo = mid;
    else hi = mid;
  }
  const span = pcts[hi] - pcts[lo];
  const a = span > 1e-6 ? (p - pcts[lo]) / span : 0;
  return {
    x: xs[lo] + a * (xs[hi] - xs[lo]),
    y: ys[lo] + a * (ys[hi] - ys[lo]),
    elevation: elevations ? elevations[lo] + a * (elevations[hi] - elevations[lo]) : 0,
    heading: lerpAngle(headings[lo], headings[hi], a)
  };
}

// Attach track-frame data (center, tangent, lateral offset in metres) to samples
function attachTrackFields(points, model) {
  if (!points) return [];
  return points.map(s => {
    const frame = model ? trackFrameAtPct(model, s.dist_pct || 0) : null;
    if (!frame) {
      return {
        ...s,
        track_center_x: s.world_x,
        track_center_y: s.world_y,
        track_heading: s.heading,
        lateral_offset: 0
      };
    }
    const rx = -Math.cos(frame.heading);
    const ry = -Math.sin(frame.heading);
    const hasLateral = s.path_lateral !== undefined && s.path_lateral !== null;
    const lateral = hasLateral
      ? s.path_lateral
      : (s.world_x - frame.x) * rx + (s.world_y - frame.y) * ry;
    return {
      ...s,
      track_center_x: frame.x,
      track_center_y: frame.y,
      track_heading: frame.heading,
      lateral_offset: lateral
    };
  });
}

// Final world-space car pose: centerPosition + rightVector * lateralOffset
function resolveTrackRelative(point, model, trackName = '') {
  if (!point) return null;

  let th;
  let cx;
  let cy;
  let trackH;
  let elev = 0;

  // Preferred: resolve against the canonical centerline model at this lap
  // distance, so the car always sits exactly on the rendered road surface.
  const frame = model ? trackFrameAtPct(model, point.dist_pct || 0) : null;
  if (frame) {
    trackH = frame.heading;
    cx = frame.x;
    cy = frame.y;
    elev = frame.elevation || 0;
  } else {
    trackH = point.track_heading !== undefined ? point.track_heading : (point.heading || 0);
    cx = point.track_center_x !== undefined ? point.track_center_x : (point.world_x || 0);
    cy = point.track_center_y !== undefined ? point.track_center_y : (point.world_y || 0);
    elev = getTrackElevation(trackName, point.dist_pct || 0, point).elevation || 0;
  }

  // Car body heading aligns with its actual travel path trajectory
  if (point.heading !== undefined && Number.isFinite(point.heading)) {
    th = point.heading;
  } else {
    th = trackH;
  }

  if (th === undefined) th = 0;
  if (cx === undefined) cx = 0;
  if (cy === undefined) cy = 0;

  // Lateral offset in metres (+ = right of centreline)
  // Perpendicular right vector along the road frame
  const rx = -Math.cos(trackH);
  const ry = -Math.sin(trackH);
  let plat;
  if (point.lateral_offset !== undefined) plat = point.lateral_offset;
  else if (point.path_lateral !== undefined && point.path_lateral !== null) plat = point.path_lateral;
  else if (point.world_x !== undefined && point.world_y !== undefined) {
    // Recover the offset by projecting the GPS position onto the right vector
    plat = (point.world_x - cx) * rx + (point.world_y - cy) * ry;
  } else plat = 0;

  const x = cx + rx * plat;
  const mapY = cy + ry * plat;

  return {
    x,
    y: elev,
    z: -mapY,
    worldY: mapY,
    elevation: elev,
    heading: th,
    trackHeading: trackH,
    centerX: cx,
    centerY: cy,
    lat: plat
  };
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00.000';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const secStr = s.toFixed(3);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${secStr}`;
}

// Angle interpolation taking shortest angular path
function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// Continuous sub-millimeter spline interpolation by replay time
function interpolateSpline(points, targetTime, totalDuration) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return points[0];

  const dur = totalDuration > 0 ? totalDuration : 118.28;
  const progress = Math.max(0, Math.min(1, (targetTime % dur) / dur));
  const u = progress * (points.length - 1);
  const i0 = Math.floor(u);
  const i1 = Math.min(points.length - 1, i0 + 1);
  const alpha = u - i0;

  const s0 = points[i0];
  const s1 = points[i1];

  return {
    world_x: s0.world_x + alpha * (s1.world_x - s0.world_x),
    world_y: s0.world_y + alpha * (s1.world_y - s0.world_y),
    speed: s0.speed + alpha * (s1.speed - s0.speed),
    gear: alpha > 0.5 ? s1.gear : s0.gear,
    rpm: Math.round(s0.rpm + alpha * (s1.rpm - s0.rpm)),
    throttle: s0.throttle + alpha * (s1.throttle - s0.throttle),
    brake: s0.brake + alpha * (s1.brake - s0.brake),
    steering: Math.round(s0.steering + alpha * (s1.steering - s0.steering)),
    lat_g: s0.lat_g + alpha * (s1.lat_g - s0.lat_g),
    lon_g: s0.lon_g + alpha * (s1.lon_g - s0.lon_g),
    dist_pct: s0.dist_pct + alpha * (s1.dist_pct - s0.dist_pct),
    heading: lerpAngle(s0.heading, s1.heading, alpha),
    path_lateral: s0.path_lateral !== undefined && s1.path_lateral !== undefined ? s0.path_lateral + alpha * (s1.path_lateral - s0.path_lateral) : undefined,
    track_edge: s0.track_edge !== undefined && s1.track_edge !== undefined ? s0.track_edge + alpha * (s1.track_edge - s0.track_edge) : undefined,
    track_center_x: s0.track_center_x !== undefined && s1.track_center_x !== undefined ? s0.track_center_x + alpha * (s1.track_center_x - s0.track_center_x) : undefined,
    track_center_y: s0.track_center_y !== undefined && s1.track_center_y !== undefined ? s0.track_center_y + alpha * (s1.track_center_y - s0.track_center_y) : undefined,
    track_heading: s0.track_heading !== undefined && s1.track_heading !== undefined ? lerpAngle(s0.track_heading, s1.track_heading, alpha) : undefined,
    lateral_offset: s0.lateral_offset !== undefined && s1.lateral_offset !== undefined ? s0.lateral_offset + alpha * (s1.lateral_offset - s0.lateral_offset) : undefined,
    track_width: s0.track_width !== undefined && s1.track_width !== undefined ? s0.track_width + alpha * (s1.track_width - s0.track_width) : undefined
  };
}

// Minimap gain/loss badge
function drawHDMinimapBadge(ctx, x, y, title, value, color, maxW) {
  ctx.save();
  ctx.font = '700 8.5px "JetBrains Mono", monospace';
  const text = `${title} ${value}`;
  const w = ctx.measureText(text).width + 8;
  const h = 14;

  const bx = Math.max(6, Math.min(maxW - w - 6, x - w / 2));
  const by = y < 24 ? y + 10 : y - 18;

  // Pin line
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bx + w / 2, by + h / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Badge box
  ctx.fillStyle = '#0d1116';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 2);
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 4, by + 10);
  ctx.restore();
}

// --------------------------------------------------------------------------
// Procedural canvas textures for road, kerbs and start/finish line
// --------------------------------------------------------------------------

function createHDAsphaltTextures() {
  const width = 1024;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Base dark asphalt
  ctx.fillStyle = '#181b22';
  ctx.fillRect(0, 0, width, height);

  // High-frequency tarmac grain & stone aggregate noise
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 32;
    const pebble = Math.random() < 0.025 ? (Math.random() * 50 + 15) : 0;
    const v = Math.max(0, Math.min(255, data[i] + noise + pebble));
    data[i] = v;
    data[i + 1] = Math.max(0, Math.min(255, v * 1.02));
    data[i + 2] = Math.max(0, Math.min(255, v * 1.06));
  }
  ctx.putImageData(imgData, 0, 0);

  // Dark rubbered racing groove along track center
  const rubberGrad = ctx.createLinearGradient(0, 0, width, 0);
  rubberGrad.addColorStop(0, 'rgba(0,0,0,0)');
  rubberGrad.addColorStop(0.25, 'rgba(0,0,0,0)');
  rubberGrad.addColorStop(0.38, 'rgba(9, 11, 15, 0.55)');
  rubberGrad.addColorStop(0.50, 'rgba(5, 7, 10, 0.72)');
  rubberGrad.addColorStop(0.62, 'rgba(9, 11, 15, 0.55)');
  rubberGrad.addColorStop(0.75, 'rgba(0,0,0,0)');
  rubberGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rubberGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle tire skid / braking streaks
  ctx.save();
  ctx.strokeStyle = 'rgba(8, 10, 14, 0.35)';
  ctx.lineWidth = 12;
  for (let s = 0; s < 5; s++) {
    const xOffset = 330 + s * 80 + (Math.random() * 20 - 10);
    ctx.beginPath();
    ctx.moveTo(xOffset, 0);
    ctx.lineTo(xOffset + (Math.random() * 10 - 5), height);
    ctx.stroke();
  }
  ctx.restore();

  // Crisp Painted White Boundary Lines on Left and Right Track Edges (FIA limits)
  // Left white line
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(38, 0, 24, height);
  // Edge soft shadow for left white line
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(62, 0, 5, height);

  // Right white line
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(width - 38 - 24, 0, 24, height);
  // Edge soft shadow for right white line
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(width - 38 - 24 - 5, 0, 5, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;

  // Bump map for asphalt physical roughness
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bCtx = bumpCanvas.getContext('2d');
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 512, 512);
  const bImg = bCtx.getImageData(0, 0, 512, 512);
  const bData = bImg.data;
  for (let i = 0; i < bData.length; i += 4) {
    const n = Math.random() * 90 - 45;
    const val = Math.max(0, Math.min(255, 128 + n));
    bData[i] = val;
    bData[i + 1] = val;
    bData[i + 2] = val;
  }
  bCtx.putImageData(bImg, 0, 0);
  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = THREE.RepeatWrapping;
  bumpTexture.wrapT = THREE.RepeatWrapping;
  bumpTexture.anisotropy = 8;

  return { texture, bumpTexture };
}

function createHDKerbTextures() {
  const width = 512;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Height is mapped to 1.8m (1 full period of Red and White stripe)
  // Top half: Red stripe (0 to 512)
  const redGradient = ctx.createLinearGradient(0, 0, 0, 512);
  redGradient.addColorStop(0, '#e11d48'); // Vibrant FIA Red
  redGradient.addColorStop(0.5, '#ff5c5c');
  redGradient.addColorStop(1, '#991b1b');
  ctx.fillStyle = redGradient;
  ctx.fillRect(0, 0, width, 512);

  // Bottom half: White stripe (512 to 1024)
  const whiteGradient = ctx.createLinearGradient(0, 512, 0, 1024);
  whiteGradient.addColorStop(0, '#e8edf2'); // Crisp White
  whiteGradient.addColorStop(0.5, '#e8edf2');
  whiteGradient.addColorStop(1, '#9aa6b2');
  ctx.fillStyle = whiteGradient;
  ctx.fillRect(0, 512, width, 512);

  // Concrete aggregate noise
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 24;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  // 3D Rumble Strip Ribs / Teeth (Embossed physical ridges)
  const numRibs = 32;
  const ribHeight = height / numRibs;
  for (let r = 0; r < numRibs; r++) {
    const y = r * ribHeight;
    // Top highlight of rib
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.fillRect(0, y, width, ribHeight * 0.24);
    // Groove shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(0, y + ribHeight * 0.68, width, ribHeight * 0.32);
  }

  // Heavy rubber tire scrub marks on the inner half (where racing cars ride the kerb!)
  const rubberOverlay = ctx.createLinearGradient(0, 0, width, 0);
  rubberOverlay.addColorStop(0, 'rgba(15, 23, 42, 0.82)');
  rubberOverlay.addColorStop(0.2, 'rgba(15, 23, 42, 0.65)');
  rubberOverlay.addColorStop(0.45, 'rgba(15, 23, 42, 0.28)');
  rubberOverlay.addColorStop(0.7, 'rgba(15, 23, 42, 0.08)');
  rubberOverlay.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = rubberOverlay;
  ctx.fillRect(0, 0, width, height);

  // Longitudinal tire scrub scratch marks
  ctx.strokeStyle = 'rgba(10, 15, 25, 0.55)';
  ctx.lineWidth = 3;
  for (let s = 0; s < 7; s++) {
    const sx = 18 + s * 26 + (Math.random() * 8 - 4);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + (Math.random() * 8 - 4), height);
    ctx.stroke();
  }

  // Outer bevel edge shadow
  const outerEdgeShadow = ctx.createLinearGradient(width - 50, 0, width, 0);
  outerEdgeShadow.addColorStop(0, 'rgba(0,0,0,0)');
  outerEdgeShadow.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = outerEdgeShadow;
  ctx.fillRect(width - 50, 0, 50, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;

  // Bump Map for Kerb Rumble Ribs
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 512;
  const bCtx = bumpCanvas.getContext('2d');
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 256, 512);
  const bRibH = 512 / 16;
  for (let r = 0; r < 16; r++) {
    const y = r * bRibH;
    bCtx.fillStyle = '#ffffff';
    bCtx.fillRect(0, y, 256, bRibH * 0.4);
    bCtx.fillStyle = '#222222';
    bCtx.fillRect(0, y + bRibH * 0.6, 256, bRibH * 0.4);
  }
  const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = THREE.RepeatWrapping;
  bumpTexture.wrapT = THREE.RepeatWrapping;
  bumpTexture.anisotropy = 8;

  return { texture, bumpTexture };
}

function createStartFinishTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Checkered pattern: 4 rows of 16 squares
  const cols = 16;
  const rows = 4;
  const sqW = 512 / cols;
  const sqH = 128 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#0f172a';
      ctx.fillRect(c * sqW, r * sqH, sqW, sqH);
    }
  }

  // Red FIA border line before and after
  ctx.fillStyle = '#ff5c5c';
  ctx.fillRect(0, 0, 512, 5);
  ctx.fillRect(0, 123, 512, 5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return texture;
}

// --------------------------------------------------------------------------
// 3D Geometry Generators (Spline-driven road, kerb and verge)
// --------------------------------------------------------------------------

const TRACK_HALF_WIDTH = 6.0;
const KERB_WIDTH = 1.35;
const VERGE_WIDTH = 4.0;

// The road ribbon renders its asphalt `surfaceY` metres above the spline line
// (see buildRoadRibbon). Wheel pivots are authored with the axle at wheel-centre
// height, so the tire contact patch already lands on the car group origin. The
// origin therefore only needs lifting by the asphalt thickness to sit on the
// visible road, instead of the old 0.38m offset that left the car hovering.
const CAR_RIDE_HEIGHT = 0.02;

function buildTrackMesh(scene, spline) {
  if (!spline || spline.sampleCount < 8) return null;

  const halfWidth = spline.halfWidth || TRACK_HALF_WIDTH;

  const roadGeo = buildRoadRibbon(spline, {
    halfWidth,
    bevelWidth: 0.32,
    bevelDrop: 0.05,
    surfaceY: 0.02
  });
  const { texture: asphaltTex, bumpTexture: asphaltBumpTex } = createHDAsphaltTextures();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    bumpMap: asphaltBumpTex,
    bumpScale: 0.045,
    roughness: 0.82,
    metalness: 0.08,
    side: THREE.DoubleSide
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  scene.add(road);

  const vergeMat = new THREE.MeshStandardMaterial({
    color: 0x121720,
    roughness: 0.96,
    metalness: 0.03,
    side: THREE.DoubleSide
  });
  for (const side of ['left', 'right']) {
    const geo = buildVergeRibbon(spline, side, {
      halfWidth,
      kerbWidth: KERB_WIDTH,
      vergeWidth: VERGE_WIDTH
    });
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, vergeMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const maskInfo = kerbMask(spline, 0.0035, 22.0);
  const { texture: kerbTex, bumpTexture: kerbBumpTex } = createHDKerbTextures();
  const kerbMat = new THREE.MeshStandardMaterial({
    map: kerbTex,
    bumpMap: kerbBumpTex,
    bumpScale: 0.05,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide
  });
  for (const side of ['left', 'right']) {
    const geo = buildKerbRibbon(spline, maskInfo, side, {
      halfWidth,
      kerbWidth: KERB_WIDTH
    });
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, kerbMat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = `kerb-${side}`;
    scene.add(mesh);
  }

  buildCentreGuide(scene, spline);
  buildStartFinish(scene, spline);

  return { road, maskInfo };
}

function buildCentreGuide(scene, spline) {
  const { sampleCount, closed, positions } = spline;
  const pts = [];
  for (let s = 0; s < sampleCount; s += 2) {
    pts.push(new THREE.Vector3(positions[s * 3], positions[s * 3 + 1] + 0.035, positions[s * 3 + 2]));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x35c7f0,
    opacity: 0.28,
    transparent: true
  });
  const line = closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
  scene.add(line);
}

function buildStartFinish(scene, spline) {
  const pose = spline.poseAtPct(0);
  const forward = spline.poseAtPct(Math.min(1, 3.0 / spline.totalLength));

  const halfW = spline.halfWidth || TRACK_HALF_WIDTH;
  const verts = [];
  const uvs = [];
  const indices = [];

  const strips = 12;
  const cells = 3;
  const depth = 2.2;

  const fx = pose.normalX;
  const fz = pose.normalZ;
  const dx = forward.x - pose.x;
  const dz = forward.z - pose.z;
  const dlen = Math.hypot(dx, dz) || 1;
  const tx = dx / dlen;
  const tz = dz / dlen;

  for (let i = 0; i <= strips; i++) {
    for (let j = 0; j <= cells; j++) {
      const lat = -halfW + (i / strips) * (halfW * 2);
      const lon = (j / cells) * depth;
      verts.push(pose.x + fx * lat + tx * lon, (pose.y || 0) + 0.028, pose.z + fz * lat + tz * lon);
      uvs.push(i / strips, j / cells);
    }
  }

  for (let i = 0; i < strips; i++) {
    for (let j = 0; j < cells; j++) {
      const a = i * (cells + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (cells + 1) + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const tex = createStartFinishTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  scene.add(new THREE.Mesh(geo, mat));
}


function createCarLabelSprite(text, colorHex, isActive = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');

  const labelObj = { canvas, ctx, text, colorHex, tex: null, sprite: null };
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  labelObj.tex = tex;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: isActive ? 0.98 : 0.65
    })
  );
  sprite.scale.set(1.8, 0.5, 1);
  sprite.position.set(0, 3.4, 0); // Elevated well above car roof so it doesn't obstruct camera line of sight to road
  sprite.renderOrder = 10;
  labelObj.sprite = sprite;

  updateCarLabelTexture(labelObj, isActive);
  return labelObj;
}

function updateCarLabelTexture(labelObj, isFocused) {
  const { canvas, tex, ctx, text, colorHex } = labelObj;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = isFocused ? 'rgba(15, 23, 36, 0.95)' : 'rgba(11, 15, 23, 0.82)';
  ctx.beginPath();
  ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 10);
  ctx.fill();

  ctx.strokeStyle = colorHex;
  ctx.lineWidth = isFocused ? 4 : 2;
  ctx.stroke();

  // Color dot
  ctx.beginPath();
  ctx.arc(28, canvas.height / 2, isFocused ? 7 : 5, 0, Math.PI * 2);
  ctx.fillStyle = colorHex;
  ctx.fill();

  ctx.fillStyle = isFocused ? '#ffffff' : '#94a3b8';
  ctx.font = isFocused ? '800 20px "JetBrains Mono", monospace' : '600 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const displayText = isFocused ? `★ ${text}` : text;
  ctx.fillText(displayText, 46, canvas.height / 2);

  labelObj.sprite.material.opacity = isFocused ? 0.98 : 0.65;
  tex.needsUpdate = true;
}

function updateCarFocusVisual(carGroup, isFocused, isComparing = false, cameraMode = 'chase') {
  if (!carGroup || !carGroup.userData) return;
  const { bodyMaterial, cabinMaterial, wheelMaterial, discMaterial, isGhost, labelObj } = carGroup.userData;

  if (isGhost) {
    const opacity = isFocused ? 1.0 : 0.72;
    for (const mat of [bodyMaterial, wheelMaterial, discMaterial]) {
      if (mat) {
        mat.opacity = opacity;
        mat.transparent = !isFocused;
      }
    }
    // The canopy stays glass-like even when unfocused, so it keeps its own alpha.
    if (cabinMaterial) {
      cabinMaterial.opacity = opacity * 0.85;
      cabinMaterial.transparent = true;
    }
  }

  if (labelObj && labelObj.sprite) {
    // Only show 3D floating tag when comparing 2 cars and not in first-person camera
    const isFirstPerson = cameraMode === 'hood';
    labelObj.sprite.visible = isComparing && !isFirstPerson;
    if (labelObj.sprite.visible) {
      updateCarLabelTexture(labelObj, isFocused);
    }
  }
}

// Lateral body profile (z = length, y = height). The car points towards +z.
// Rebuilt to read as a GT3 silhouette rather than a stack of boxes: long
// nose with a low splitter, raked canopy over the cockpit, high rear deck,
// and a swan-neck wing overhanging the tail.
//
// The silhouette is kept as an ordered table so part placement can query the
// real upper surface instead of guessing offsets. After extrudeGT3Body the
// authored X maps to world -Z, so the table stores world Z directly.
const GT3_SILHOUETTE = [
  { z: -2.28, top: 0.16 },  // rear diffuser lip
  { z: -2.24, top: 0.62 },  // rear deck edge
  { z: -1.55, top: 0.72 },  // engine cover base
  { z: -0.75, top: 0.78 },  // roof rear
  { z: -0.28, top: 1.02 },  // roof peak (cockpit)
  { z: 0.62, top: 0.86 },   // windshield base
  { z: 1.32, top: 0.60 },   // cowl
  { z: 2.14, top: 0.42 },   // nose tip
  { z: 2.24, top: 0.24 },   // front fascia
  { z: 2.18, top: 0.14 }    // splitter lip
];

// Upper body surface height at a given length position, linear between nodes.
function gt3TopAt(z) {
  const t = GT3_SILHOUETTE;
  if (z <= t[0].z) return t[0].top;
  if (z >= t[t.length - 1].z) return t[t.length - 1].top;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i];
    const b = t[i + 1];
    if (z >= a.z && z <= b.z) {
      const f = (z - a.z) / (b.z - a.z);
      return a.top + (b.top - a.top) * f;
    }
  }
  return 0.6;
}

function createGT3BodyProfile() {
  // Points are authored in extrusion space. After the rotateY(PI/2) below the
  // shape's X maps to world -Z, so the nose is authored at negative X so it
  // ends up pointing towards world +Z (the car's forward axis).
  const shape = new THREE.Shape();
  shape.moveTo(2.28, 0.16);    // rear diffuser lip
  shape.lineTo(2.24, 0.62);    // rear deck edge
  shape.lineTo(1.55, 0.72);    // engine cover base
  shape.lineTo(0.75, 0.78);    // roof rear
  shape.lineTo(0.28, 1.02);    // roof peak (cockpit)
  shape.lineTo(-0.62, 0.86);   // windshield base
  shape.lineTo(-1.32, 0.60);   // cowl
  shape.lineTo(-2.14, 0.42);   // nose tip
  shape.lineTo(-2.24, 0.24);   // front fascia
  shape.lineTo(-2.18, 0.14);   // splitter lip
  shape.lineTo(-1.10, 0.10);   // floor front
  shape.lineTo(1.90, 0.10);    // floor rear
  shape.closePath();
  return shape;
}

// Extrude the side profile across the car width, then bevel the outer walls so
// the flanks taper instead of reading as a slab.
function extrudeGT3Body(profile, halfWidth, depth, steps = 1) {
  const geo = new THREE.ExtrudeGeometry(profile, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.09,
    bevelSegments: 2,
    steps
  });
  // Extrude builds along +z; centre it, then rotate so the profile becomes the
  // side view (x = width, y = height, z = length).
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();

  // Squeeze the roof inward so the greenhouse is narrower than the arches.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.78) {
      const taper = 1 - Math.min(0.42, (y - 0.78) * 1.05);
      pos.setX(i, pos.getX(i) * taper);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  void halfWidth;
  return geo;
}

// GT3 wheel: a wide slick, a recessed multi-spoke face, a centre-lock nut and
// a brake disc with a caliper. The tire and disc spin with rolling; the caliper
// and rim face stay with the upright, which is what sells the corner at speed.
//
// Local frame: the axle runs along X, so the wheel face is the YZ plane. The
// face sits on the outboard side: positive X for the right-side wheels, and
// mirrored to negative X when `outboard` is -1 so both flanks show the spokes.
function createWheelAssembly(rt, steerable, wheelMat, rimMat, discMat, caliperMat, glowMat, outboard = 1) {
  const group = new THREE.Group();
  const tireWidth = rt * 0.92;
  const faceX = (tireWidth * 0.5 - 0.02) * outboard;

  // Slick tire.
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(rt, rt, tireWidth, 24, 1), wheelMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);

  // Brake disc, slightly inset from the tire so it reads behind the spokes.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rt * 0.62, rt * 0.62, tireWidth * 0.5, 20, 1), discMat);
  disc.rotation.z = Math.PI / 2;
  group.add(disc);

  // Rim barrel: an open tube joining the two bead faces.
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(rt * 0.72, rt * 0.72, tireWidth * 0.9, 20, 1, true),
    rimMat
  );
  barrel.rotation.z = Math.PI / 2;
  group.add(barrel);

  // Outboard face: a thin disc the spokes sit proud of.
  const face = new THREE.Mesh(new THREE.CylinderGeometry(rt * 0.72, rt * 0.72, 0.025, 24, 1), rimMat);
  face.rotation.z = Math.PI / 2;
  face.position.x = faceX;
  group.add(face);

  // Spokes: boxes laid radially in the YZ plane, rotated so each points outward
  // from the hub. Rotation about X spins them within the wheel face.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, rt * 0.66, 0.075), rimMat);
    const rMid = rt * 0.34;
    spoke.position.set(faceX + 0.02 * outboard, Math.cos(a) * rMid, Math.sin(a) * rMid);
    spoke.rotation.x = -a;
    group.add(spoke);
  }

  // Centre-lock nut.
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(rt * 0.2, rt * 0.22, 0.09, 6, 1),
    new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.35, metalness: 0.9 })
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.x = faceX + 0.055 * outboard;
  group.add(hub);

  // Brake caliper: clamped over the disc at the upright, not the spinning hub.
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(tireWidth * 0.4, rt * 0.3, rt * 0.42),
    caliperMat
  );
  caliper.position.set(faceX * 0.35, 0, -rt * 0.5);
  caliper.castShadow = true;
  group.add(caliper);

  // Glowing disc edge when the pads bite.
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(rt * 0.63, rt * 0.63, 0.02, 24, 1, true), glowMat);
  glow.rotation.z = Math.PI / 2;
  glow.position.x = faceX - 0.005 * outboard;
  group.add(glow);

  void steerable;

  return { group, tire, spoke: hub, face };
}

// Start number medallion: the pit-board tab from DESIGN.md, reused as livery.
function createCarNumberTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  ctx.fillStyle = '#0b0e13';
  ctx.beginPath();
  ctx.roundRect(28, 28, 200, 200, 20);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 130px "Saira", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 128, 138);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function createCarMesh(colorHex = 0xff6b00, label = "Driver", isGhost = false, carNumber = 1) {
  const carGroup = new THREE.Group();

  const opacity = isGhost ? 0.72 : 1.0;
  const transparent = isGhost;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.28,
    metalness: 0.6,
    opacity,
    transparent
  });

  // 1. Sculpted main body from the GT3 side profile
  const profile = createGT3BodyProfile();
  const bodyGeo = extrudeGT3Body(profile, 0.95, 1.82, 1);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  carGroup.add(body);

  // 2. Dark technical parts: splitter, diffuser, side skirts, vents, arches
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x11161f,
    roughness: 0.5,
    metalness: 0.4,
    opacity,
    transparent
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x191d24,
    roughness: 0.32,
    metalness: 0.6,
    opacity,
    transparent
  });

  // Front splitter: a flat plane at floor level with a raised leading lip.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.05, 0.5), carbonMat);
  splitter.position.set(0, 0.085, 1.98);
  carGroup.add(splitter);

  const splitterLip = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.04, 0.12), trimMat);
  splitterLip.position.set(0, 0.135, 2.2);
  carGroup.add(splitterLip);

  // Dive planes on each corner of the front fascia.
  for (const side of [1, -1]) {
    const canard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), carbonMat);
    canard.position.set(side * 0.82, 0.26, 1.98);
    canard.rotation.z = side * -0.1;
    carGroup.add(canard);
  }

  // Rear diffuser: a raked plane under the tail with vertical strakes.
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.6), carbonMat);
  diffuser.position.set(0, 0.14, -2.16);
  diffuser.rotation.x = 0.18;
  carGroup.add(diffuser);

  for (let i = -2; i <= 2; i++) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.6), trimMat);
    strake.position.set(i * 0.36, 0.2, -2.16);
    carGroup.add(strake);
  }

  // Twin centre-exit exhausts under the rear deck.
  const exhaustMat = new THREE.MeshStandardMaterial({
    color: 0x8d949c,
    roughness: 0.28,
    metalness: 0.95,
    opacity,
    transparent
  });
  for (const ex of [-0.3, 0.3]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 12, 1, true), exhaustMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex, 0.3, -2.34);
    carGroup.add(pipe);
  }

  // Side skirts sitting on the floor edge, plus the door intake.
  const bodyHalfWidth = 0.91;
  for (const side of [1, -1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 2.6), trimMat);
    skirt.position.set(side * (bodyHalfWidth + 0.04), 0.14, -0.1);
    carGroup.add(skirt);

    // Door-side intake feeding the rear.
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.5), trimMat);
    intake.position.set(side * (bodyHalfWidth - 0.02), 0.48, -0.6);
    intake.rotation.y = side * -0.15;
    carGroup.add(intake);

    // Rear fender louvres behind the door.
    for (let i = 0; i < 3; i++) {
      const louvre = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.18), trimMat);
      louvre.position.set(side * (bodyHalfWidth - 0.01), 0.42 + i * 0.06, -0.95);
      louvre.rotation.x = 0.3;
      carGroup.add(louvre);
    }

    // Side mirror: stalk out of the A-pillar shoulder at door height.
    const mirrorY = 0.72;
    const mirrorStalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.04), carbonMat);
    mirrorStalk.position.set(side * (bodyHalfWidth + 0.03), mirrorY, 0.55);
    carGroup.add(mirrorStalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.08), carbonMat);
    mirror.position.set(side * (bodyHalfWidth + 0.12), mirrorY + 0.01, 0.55);
    carGroup.add(mirror);
  }

  // Carbon hood panel laid on the real cowl surface, plus extraction louvres.
  const hoodZ = 1.0;
  const hoodY = gt3TopAt(hoodZ);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.9), carbonMat);
  hood.position.set(0, hoodY + 0.012, hoodZ);
  hood.rotation.x = -0.13;
  carGroup.add(hood);
  for (let i = -1; i <= 1; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.06), trimMat);
    vent.position.set(0, hoodY + 0.03, hoodZ - 0.28 + i * 0.2);
    vent.rotation.x = -0.13;
    carGroup.add(vent);
  }

  // Roof scoop sitting flush on the roof peak.
  const scoopZ = -0.1;
  const scoopY = gt3TopAt(scoopZ);
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.44), carbonMat);
  scoop.position.set(0, scoopY + 0.03, scoopZ);
  carGroup.add(scoop);
  const scoopMouth = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.04), trimMat);
  scoopMouth.position.set(0, scoopY + 0.05, scoopZ + 0.22);
  carGroup.add(scoopMouth);

  // 3. Greenhouse: smoked canopy over the cockpit, following the roofline.
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x050810,
    roughness: 0.08,
    metalness: 0.95,
    opacity: isGhost ? opacity * 0.85 : opacity,
    transparent: true
  });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.68, 20, 12), canopyMat);
  canopy.scale.set(0.74, 0.42, 1.25);
  canopy.position.set(0, 0.63, 0.06);
  carGroup.add(canopy);

  // 4. Rear wing: swan-neck mounts + main plane + endplates.
  // The mounts stand on the real rear-deck surface so the wing is supported
  // instead of floating above the tail.
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x0d1219,
    roughness: 0.35,
    metalness: 0.62
  });
  const deckZ = -2.0;
  const deckY = gt3TopAt(deckZ);
  const wingY = deckY + 0.5;

  const wingPlane = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.42), wingMat);
  wingPlane.position.set(0, wingY, deckZ - 0.06);
  wingPlane.rotation.x = -0.14;
  carGroup.add(wingPlane);

  const wingUpper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.28), wingMat);
  wingUpper.position.set(0, wingY + 0.15, deckZ - 0.14);
  wingUpper.rotation.x = -0.2;
  carGroup.add(wingUpper);

  for (const side of [1, -1]) {
    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.6), wingMat);
    endplate.position.set(side * 0.93, wingY + 0.05, deckZ - 0.08);
    carGroup.add(endplate);

    // Swan-neck: rises from the deck up to the underside of the main plane.
    const neckH = wingY - deckY + 0.16;
    const swanNeck = new THREE.Mesh(new THREE.BoxGeometry(0.06, neckH, 0.12), wingMat);
    swanNeck.position.set(side * 0.42, deckY + neckH / 2 - 0.06, deckZ + 0.12);
    carGroup.add(swanNeck);
  }

  // 5. Rear light bar, the mandatory GT3 rain light plus twin brake lamps
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x5a0d0d,
    emissive: 0xff2d2d,
    emissiveIntensity: 0.0,
    opacity,
    transparent
  });
  const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.04), brakeMat);
  rainLight.position.set(0, 0.62, -2.26);
  carGroup.add(rainLight);
  const brakeL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.04), brakeMat);
  brakeL.position.set(0.66, 0.56, -2.24);
  const brakeR = brakeL.clone();
  brakeR.position.x = -0.66;
  carGroup.add(brakeL);
  carGroup.add(brakeR);

  // Tail lamp clusters flanking the light bar.
  for (const side of [1, -1]) {
    const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), trimMat);
    cluster.position.set(side * 0.72, 0.62, -2.2);
    carGroup.add(cluster);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.02), brakeMat);
    lens.position.set(side * 0.72, 0.62, -2.23);
    carGroup.add(lens);
  }

  // 6. Front lighting: GT3 twin DRL blades per corner, set into the nose slope.
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x0a0f16, roughness: 0.4, metalness: 0.4 });
  const drlMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xdff0ff,
    emissiveIntensity: 2.2
  });
  const lightZ = 2.02;
  const lightY = gt3TopAt(lightZ) - 0.02;
  for (const side of [1, -1]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.17, 0.12), housingMat);
    housing.position.set(side * 0.66, lightY, lightZ);
    housing.rotation.x = -0.12;
    carGroup.add(housing);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.05), drlMat);
    drl.position.set(side * 0.66, lightY + 0.035, lightZ + 0.05);
    drl.rotation.x = -0.12;
    carGroup.add(drl);

    const drlLower = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.05), drlMat);
    drlLower.position.set(side * 0.66, lightY - 0.045, lightZ + 0.045);
    drlLower.rotation.x = -0.12;
    carGroup.add(drlLower);
  }

  // Livery accent stripe down the spine and nose.
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x0b0e13,
    roughness: 0.4,
    metalness: 0.35,
    opacity,
    transparent
  });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 2.0), stripeMat);
  stripe.position.set(0, gt3TopAt(-0.5) + 0.012, -0.5);
  stripe.rotation.x = -0.1;
  carGroup.add(stripe);

  // Side livery number on both doors
  const numberTex = createCarNumberTexture(carNumber);
  const numberMat = new THREE.MeshStandardMaterial({
    map: numberTex,
    transparent: true,
    roughness: 0.5,
    metalness: 0.1,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  for (const side of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), numberMat);
    plate.position.set(side * (bodyHalfWidth + 0.02), 0.48, -0.15);
    plate.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    carGroup.add(plate);
  }

  // Roof number roundel lying flat on the roof panel, clear of the scoop.
  const roofPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.42), numberMat);
  roofPlate.rotation.x = -Math.PI / 2;
  roofPlate.rotation.z = Math.PI;
  roofPlate.position.set(0, gt3TopAt(-0.5) + 0.014, -0.75);
  carGroup.add(roofPlate);

  // 7. Wheels: tire + rim + brake disc, front pair steerable
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    roughness: 0.82,
    metalness: 0.05,
    opacity,
    transparent
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xb9bfc7,
    roughness: 0.24,
    metalness: 0.95,
    opacity,
    transparent
  });
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f36,
    roughness: 0.45,
    metalness: 0.75,
    opacity,
    transparent
  });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0xd23a2a,
    roughness: 0.4,
    metalness: 0.3,
    opacity,
    transparent
  });
  const brakeGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff5a1e,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const allWheels = [];
  const wheelZFront = 1.42;
  const wheelZRear = -1.42;
  const wheelTrack = 0.99;
  const frontR = 0.36;
  const rearR = 0.38;

  const makePivot = (x, z, radius, steerable) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, radius, z);
    const { group, tire } = createWheelAssembly(radius, steerable, wheelMat, rimMat, discMat, caliperMat, brakeGlowMat, Math.sign(x));
    pivot.add(group);
    carGroup.add(pivot);
    allWheels.push(tire);
    return pivot;
  };

  const steerFL = makePivot(wheelTrack, wheelZFront, frontR, true);
  const steerFR = makePivot(-wheelTrack, wheelZFront, frontR, true);
  makePivot(wheelTrack, wheelZRear, rearR, false);
  makePivot(-wheelTrack, wheelZRear, rearR, false);

  // Wheel arches: half-torus lips hugging each wheel, sized just larger than
  // the tire and sitting at the wheel centre so the arc caps the tire cleanly.
  for (const z of [wheelZFront, wheelZRear]) {
    const r = z > 0 ? frontR : rearR;
    for (const side of [1, -1]) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(r + 0.07, 0.055, 8, 16, Math.PI),
        trimMat
      );
      // Torus lies in XY; rotate about Y so the arc sits in the Z-Y rolling
      // plane, then the half arc caps the top of the wheel.
      arch.rotation.set(0, Math.PI / 2, 0);
      arch.position.set(side * (wheelTrack + 0.02), r, z);
      arch.castShadow = true;
      carGroup.add(arch);
    }
  }

  // Invisible raycast hit-box for easy clicking
  const hitGeo = new THREE.BoxGeometry(2.6, 2.2, 5.0);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = 1.0;
  carGroup.add(hitMesh);

  // Floating 3D label badge
  const labelObj = createCarLabelSprite(label, colorHex === 0x00f0ff ? '#35c7f0' : '#ff8a3d', !isGhost);
  labelObj.sprite.visible = false;
  carGroup.add(labelObj.sprite);

  carGroup.userData.steerPivots = [steerFL, steerFR];
  carGroup.userData.wheels = allWheels;
  carGroup.userData.brakeMaterial = brakeMat;
  carGroup.userData.brakeGlowMaterial = brakeGlowMat;
  carGroup.userData.bodyMaterial = bodyMat;
  carGroup.userData.cabinMaterial = canopyMat;
  carGroup.userData.wheelMaterial = wheelMat;
  carGroup.userData.discMaterial = discMat;
  carGroup.userData.isGhost = isGhost;
  carGroup.userData.labelObj = labelObj;

  return carGroup;
}

function createCornerMarker(number, isActive) {
  const group = new THREE.Group();

  const ringGeo = new THREE.RingGeometry(0.75, 1.0, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: isActive ? 0xff8a3d : 0x35c7f0,
    transparent: true,
    opacity: isActive ? 0.85 : 0.28,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = isActive ? '#ff8a3d' : 'rgba(17, 21, 28, 0.85)';
  ctx.beginPath();
  ctx.roundRect(8, 12, 48, 40, 6);
  ctx.fill();
  ctx.strokeStyle = isActive ? '#10141a' : '#35c7f0';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = isActive ? '#10141a' : '#9aa6b2';
  ctx.font = '700 30px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 32, 33);

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.85
    })
  );
  sprite.scale.set(1.5, 1.5, 1);
  sprite.position.y = 1.7;
  sprite.renderOrder = 5;
  group.add(sprite);

  group.userData.ringMaterial = ringMat;
  return group;
}

function updateCarVisuals(carGroup, sample, dt = 0.016) {
  const pivots = carGroup.userData?.steerPivots;
  if (pivots && pivots.length >= 2) {
    let rawSteer = sample.steering;
    if (rawSteer === undefined || Math.abs(rawSteer) < 0.2) {
      if (sample.lat_g && Math.abs(sample.lat_g) > 0.05) {
        // Derive steering angle from lateral acceleration if steering channel is 0 or missing
        rawSteer = -sample.lat_g * 28.0;
      }
    }
    const steerVal = -(rawSteer || 0) * 0.32;
    const steerDeg = Math.max(-33, Math.min(33, steerVal));
    const steerRad = THREE.MathUtils.degToRad(steerDeg);

    // Front Left pivot is pivots[0], Front Right pivot is pivots[1]
    // In Ackermann steering, inside wheel turns slightly tighter than outside wheel
    for (let i = 0; i < pivots.length; i++) {
      const pivot = pivots[i];
      let wheelAngle = steerRad;
      if (steerDeg > 0) {
        // Turning right: right wheel (FR, index 1) is inside
        wheelAngle = i === 1 ? steerRad * 1.08 : steerRad * 0.94;
      } else if (steerDeg < 0) {
        // Turning left: left wheel (FL, index 0) is inside
        wheelAngle = i === 0 ? steerRad * 1.08 : steerRad * 0.94;
      }
      pivot.rotation.y += (wheelAngle - pivot.rotation.y) * 0.35;
    }
  }

  // Wheel rolling animation along local axle
  const wheels = carGroup.userData?.wheels;
  if (wheels && sample.speed !== undefined) {
    const speedMs = Math.max(0, sample.speed) / 3.6;
    const rollAngle = (speedMs * dt) / 0.34;
    for (const w of wheels) {
      w.rotation.x = (w.rotation.x + rollAngle) % (Math.PI * 2);
    }
  }

  const brakeMat = carGroup.userData?.brakeMaterial;
  if (brakeMat) {
    const target = (sample.brake || 0) > 3 ? 1.8 : 0.0;
    brakeMat.emissiveIntensity += (target - brakeMat.emissiveIntensity) * 0.3;
  }

  const glowMat = carGroup.userData?.brakeGlowMaterial;
  if (glowMat) {
    const heavy = (sample.brake || 0) > 40;
    const targetOpacity = heavy ? 0.75 : 0.0;
    glowMat.opacity += (targetOpacity - glowMat.opacity) * 0.25;
  }
}
