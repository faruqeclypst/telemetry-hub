import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  Rewind,
  FastForward,
  Activity,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { PanelEmpty, PanelError, PanelLoading } from './PanelState';

const CHART = {
  bg: '#0d1116',
  gutter: '#0a0e13',
  grid: '#171d26',
  border: '#232b36',
  zero: '#3b4552',
  cursor: '#e8edf2',
  cursorGlow: 'rgba(232, 237, 242, 0.18)',
  // Active Car (Driver) Traces
  speed: '#35c7f0',
  throttle: '#3fd68c',
  brake: '#ff5c5c',
  rpm: '#c084fc',
  steer: '#7aa2ff',
  gforce: '#ff5c8a',
  delta: '#e879f9',
  corner: '#ff8a3d',
  // Ghost Car (Comparison) Traces - Distinctive Hues & Dashed
  speedComp: '#ff8a3d',
  throttleComp: '#a3e635',
  brakeComp: '#fb923c',
  rpmComp: '#f472b6',
  steerComp: '#38bdf8',
  gforceComp: '#fbbf24',
  textMuted: '#9aa6b2',
  textDim: '#6b7785'
};

export default function TelemetryChart({
  samples = [],
  compareData = null,
  isComparing = false,
  refLapNumber = null,
  compLapNumber = null,
  onHoverIndex = null,
  hoverIndex = null,
  loading = false,
  error = null,
  corners = [],
  activeCornerId = null,
  onSeekReady = null
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const chartBgCanvasRef = useRef(null);
  const [chartBgReady, setChartBgReady] = useState(0);
  const [internalHoverIdx, setInternalHoverIdx] = useState(null);
  const [containerWidth, setContainerWidth] = useState(860);

  // Zoom & Pan Range [viewStartPct, viewEndPct] (0.0 to 1.0)
  const [viewRange, setViewRange] = useState([0, 1]);
  const viewRangeRef = useRef([0, 1]);
  useEffect(() => {
    viewRangeRef.current = viewRange;
  }, [viewRange]);

  // Reset zoom on lap switch
  useEffect(() => {
    setViewRange([0, 1]);
  }, [refLapNumber, compLapNumber]);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, range: [0, 1] });
  const hasDraggedPanRef = useRef(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const isPlayingRef = useRef(false);
  const playbackSpeedRef = useRef(1);
  const reqAnimRef = useRef(null);
  const lastTimeRef = useRef(0);
  const currentProgressRef = useRef(0);

  const viewStart = viewRange[0];
  const viewEnd = viewRange[1];
  const zoomSpan = Math.max(0.001, viewEnd - viewStart);
  const zoomFactor = 1 / zoomSpan;
  const isZoomed = zoomSpan < 0.999;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  const activeIdx =
    hoverIndex !== null ? hoverIndex : internalHoverIdx !== null ? internalHoverIdx : 0;

  useEffect(() => {
    if (samples.length > 1 && !isPlayingRef.current && activeIdx !== null) {
      currentProgressRef.current = activeIdx / (samples.length - 1);
    }
  }, [activeIdx, samples.length]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const lapDuration = useMemo(() => {
    if (!samples || samples.length < 2) return 0;
    const t0 = samples[0].time;
    const t1 = samples[samples.length - 1].time;
    const dur = t1 - t0;
    return dur > 0 ? dur : 0;
  }, [samples]);

  const activeSample = useMemo(() => {
    if (!samples || samples.length === 0) return null;
    const baseIdx = Math.floor(Math.max(0, Math.min(samples.length - 1, activeIdx ?? 0)));
    const nextIdx = Math.min(samples.length - 1, baseIdx + 1);
    const t = (activeIdx ?? 0) - baseIdx;
    const s0 = samples[baseIdx] || samples[0];
    const s1 = samples[nextIdx] || s0;
    if (t <= 0.0001 || !s1 || s0 === s1) return s0;
    return {
      ...s0,
      speed: s0.speed + (s1.speed - s0.speed) * t,
      throttle: s0.throttle + (s1.throttle - s0.throttle) * t,
      brake: s0.brake + (s1.brake - s0.brake) * t,
      rpm: Math.round(s0.rpm + (s1.rpm - s0.rpm) * t),
      steering: Math.round(s0.steering + (s1.steering - s0.steering) * t),
      lat_g: s0.lat_g + (s1.lat_g - s0.lat_g) * t,
      dist_pct: s0.dist_pct + (s1.dist_pct - s0.dist_pct) * t,
      time: s0.time + (s1.time - s0.time) * t,
      gear: t < 0.5 ? s0.gear : s1.gear
    };
  }, [samples, activeIdx]);

  const activeCompSample = useMemo(() => {
    if (!isComparing || !compareData?.comparison) return null;
    const list = compareData.comparison;
    if (list.length === 0) return null;
    const compProg = ((activeIdx ?? 0) / Math.max(1, samples.length - 1)) * (list.length - 1);
    const baseIdx = Math.floor(Math.max(0, Math.min(list.length - 1, compProg)));
    const nextIdx = Math.min(list.length - 1, baseIdx + 1);
    const t = compProg - baseIdx;
    const c0 = list[baseIdx] || list[0];
    const c1 = list[nextIdx] || c0;
    const s0 = c0.comp || {};
    const s1 = c1.comp || {};
    return {
      ...c0,
      delta: c0.delta !== undefined && c1.delta !== undefined ? c0.delta + (c1.delta - c0.delta) * t : (c0.delta || 0),
      speed: s0.speed !== undefined && s1.speed !== undefined ? s0.speed + (s1.speed - s0.speed) * t : (s0.speed || 0),
      throttle: s0.throttle !== undefined && s1.throttle !== undefined ? s0.throttle + (s1.throttle - s0.throttle) * t : (s0.throttle || 0),
      brake: s0.brake !== undefined && s1.brake !== undefined ? s0.brake + (s1.brake - s0.brake) * t : (s0.brake || 0),
      rpm: s0.rpm !== undefined && s1.rpm !== undefined ? Math.round(s0.rpm + (s1.rpm - s0.rpm) * t) : (s0.rpm || 0),
      gear: t < 0.5 ? s0.gear : s1.gear,
      steering: s0.steering !== undefined && s1.steering !== undefined ? Math.round(s0.steering + (s1.steering - s0.steering) * t) : (s0.steering || 0),
      lat_g: s0.lat_g !== undefined && s1.lat_g !== undefined ? s0.lat_g + (s1.lat_g - s0.lat_g) * t : (s0.lat_g || 0),
      comp: {
        speed: s0.speed !== undefined && s1.speed !== undefined ? s0.speed + (s1.speed - s0.speed) * t : (s0.speed || 0),
        throttle: s0.throttle !== undefined && s1.throttle !== undefined ? s0.throttle + (s1.throttle - s0.throttle) * t : (s0.throttle || 0),
        brake: s0.brake !== undefined && s1.brake !== undefined ? s0.brake + (s1.brake - s0.brake) * t : (s0.brake || 0),
        rpm: s0.rpm !== undefined && s1.rpm !== undefined ? Math.round(s0.rpm + (s1.rpm - s0.rpm) * t) : (s0.rpm || 0),
        gear: t < 0.5 ? s0.gear : s1.gear,
        steering: s0.steering !== undefined && s1.steering !== undefined ? Math.round(s0.steering + (s1.steering - s0.steering) * t) : (s0.steering || 0),
        lat_g: s0.lat_g !== undefined && s1.lat_g !== undefined ? s0.lat_g + (s1.lat_g - s0.lat_g) * t : (s0.lat_g || 0)
      }
    };
  }, [isComparing, compareData, activeIdx, samples.length]);

  // Playback engine
  useEffect(() => {
    if (!isPlaying || !samples || samples.length < 2) return;
    lastTimeRef.current = performance.now();

    const animate = (now) => {
      reqAnimRef.current = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      if (isPlayingRef.current && lapDuration > 0) {
        const ratePerSec = 1.0 / lapDuration;
        let nextProg = currentProgressRef.current + dt * ratePerSec * playbackSpeedRef.current;
        if (nextProg >= 1.0) nextProg = 0.0;
        currentProgressRef.current = nextProg;

        // Smooth sub-sample continuous float index for locked 60fps/120fps motion
        const nextIdx = nextProg * (samples.length - 1);
        setInternalHoverIdx(nextIdx);
        if (onHoverIndex) onHoverIndex(nextIdx);

        // Auto-scroll viewport if zoomed in so playhead stays in view
        if (viewRangeRef.current) {
          const [vStart, vEnd] = viewRangeRef.current;
          const span = vEnd - vStart;
          if (span < 0.999) {
            if (nextProg < vStart || nextProg > vEnd) {
              let nStart = nextProg - span * 0.15;
              if (nStart < 0) nStart = 0;
              if (nStart + span > 1) nStart = 1 - span;
              setViewRange([nStart, nStart + span]);
            }
          }
        }
      }
    };

    reqAnimRef.current = requestAnimationFrame(animate);
    return () => {
      if (reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current);
    };
  }, [isPlaying, samples, lapDuration, onHoverIndex]);

  const handleZoomIn = useCallback(() => {
    const [start, end] = viewRangeRef.current;
    const currentSpan = end - start;
    const newSpan = Math.max(0.015, currentSpan * 0.7);
    const center = activeIdx !== null && samples.length > 1
      ? activeIdx / (samples.length - 1)
      : (start + end) / 2;
    let newStart = center - newSpan / 2;
    let newEnd = center + newSpan / 2;
    if (newStart < 0) { newStart = 0; newEnd = newSpan; }
    if (newEnd > 1) { newEnd = 1; newStart = 1 - newSpan; }
    setViewRange([newStart, newEnd]);
  }, [activeIdx, samples.length]);

  const handleZoomOut = useCallback(() => {
    const [start, end] = viewRangeRef.current;
    const currentSpan = end - start;
    const newSpan = Math.min(1.0, currentSpan * 1.4);
    if (newSpan >= 0.99) {
      setViewRange([0, 1]);
      return;
    }
    const center = (start + end) / 2;
    let newStart = center - newSpan / 2;
    let newEnd = center + newSpan / 2;
    if (newStart < 0) { newStart = 0; newEnd = newSpan; }
    if (newEnd > 1) { newEnd = 1; newStart = 1 - newSpan; }
    setViewRange([newStart, newEnd]);
  }, []);

  const handleResetZoom = useCallback(() => {
    setViewRange([0, 1]);
  }, []);

  const setZoomPreset = useCallback((factor) => {
    if (factor <= 1) {
      setViewRange([0, 1]);
      return;
    }
    const newSpan = 1 / factor;
    const center = activeIdx !== null && samples.length > 1
      ? activeIdx / (samples.length - 1)
      : (viewRangeRef.current[0] + viewRangeRef.current[1]) / 2;
    let newStart = center - newSpan / 2;
    let newEnd = center + newSpan / 2;
    if (newStart < 0) { newStart = 0; newEnd = newSpan; }
    if (newEnd > 1) { newEnd = 1; newStart = 1 - newSpan; }
    setViewRange([newStart, newEnd]);
  }, [activeIdx, samples.length]);

  const handlePan = useCallback((direction) => {
    const [start, end] = viewRangeRef.current;
    const span = end - start;
    const delta = span * 0.25 * direction;
    let newStart = start + delta;
    let newEnd = end + delta;
    if (newStart < 0) { newStart = 0; newEnd = span; }
    if (newEnd > 1) { newEnd = 1; newStart = 1 - span; }
    setViewRange([newStart, newEnd]);
  }, []);

  // Keyboard zoom and pan shortcuts (+ / - / 0 / Esc / Shift+Arrows)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === '0' || e.key === 'Escape') {
        handleResetZoom();
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        handlePan(-1);
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        handlePan(1);
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleZoomIn, handleZoomOut, handleResetZoom, handlePan]);

  // Non-passive wheel listener for smooth cursor-anchored zoom & trackpad pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const gutterW = 78;
      const marginR = 14;
      const plotW = Math.max(100, rect.width - gutterW - marginR);

      const relX = clientX - gutterW;
      const mouseFraction = Math.max(0, Math.min(1, relX / plotW));

      const [start, end] = viewRangeRef.current;
      const currentSpan = end - start;
      const anchorPct = start + mouseFraction * currentSpan;

      // Horizontal trackpad swipe or Shift+Wheel: Pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const panDelta = (e.deltaX || e.deltaY) * 0.0008 * currentSpan;
        let newStart = start + panDelta;
        let newEnd = end + panDelta;
        if (newStart < 0) { newStart = 0; newEnd = currentSpan; }
        if (newEnd > 1) { newEnd = 1; newStart = 1 - currentSpan; }
        setViewRange([newStart, newEnd]);
        return;
      }

      // Vertical wheel: Zoom in or out centered at anchorPct
      const zoomMul = e.deltaY < 0 ? 0.78 : 1.28;
      let newSpan = currentSpan * zoomMul;
      newSpan = Math.max(0.015, Math.min(1.0, newSpan));

      if (newSpan >= 0.999) {
        setViewRange([0, 1]);
        return;
      }

      let newStart = anchorPct - mouseFraction * newSpan;
      let newEnd = newStart + newSpan;

      if (newStart < 0) {
        newStart = 0;
        newEnd = newSpan;
      } else if (newEnd > 1) {
        newEnd = 1;
        newStart = 1 - newSpan;
      }

      setViewRange([newStart, newEnd]);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const seekToPct = useCallback(
    (pct) => {
      if (!samples || samples.length < 2) return;
      const clamped = Math.max(0, Math.min(1, pct));
      currentProgressRef.current = clamped;
      const idx = clamped * (samples.length - 1);
      setInternalHoverIdx(idx);
      setIsPlaying(false);
      if (onHoverIndex) onHoverIndex(idx);
    },
    [samples, onHoverIndex]
  );

  useEffect(() => {
    if (onSeekReady) onSeekReady(seekToPct);
  }, [onSeekReady, seekToPct]);

  const handleTogglePlay = () => setIsPlaying((p) => !p);

  const handleRestart = () => {
    setIsPlaying(false);
    seekToPct(0);
  };

  const handleStep = (seconds) => {
    if (lapDuration <= 0) return;
    const delta = seconds / lapDuration;
    seekToPct(currentProgressRef.current + delta);
  };

  const handleScrubberChange = (e) => {
    seekToPct(parseFloat(e.target.value));
  };

  const isComp = isComparing && compareData?.comparison?.length > 0;
  const channelConfigs = useMemo(() => {
    return isComp
      ? [
        { id: 'delta', label: 'DELTA', unit: 'sec', height: 62, min: -2, max: 2, zeroLine: true },
        { id: 'speed', label: 'SPEED', unit: 'km/h', height: 132, min: 0, max: 280 },
        { id: 'pedals', label: 'PEDALS', unit: '%', height: 92, min: 0, max: 100 },
        { id: 'rpm', label: 'RPM', unit: 'rpm', height: 82, min: 0, max: 8000 },
        { id: 'steer_g', label: 'G-FORCE', unit: 'lat g', height: 78, min: -3, max: 3, zeroLine: true }
      ]
      : [
        { id: 'speed', label: 'SPEED', unit: 'km/h', height: 160, min: 0, max: 280 },
        { id: 'pedals', label: 'PEDALS', unit: '%', height: 108, min: 0, max: 100 },
        { id: 'rpm', label: 'RPM', unit: 'rpm', height: 92, min: 0, max: 8000 },
        { id: 'steer_g', label: 'G-FORCE', unit: 'lat g', height: 86, min: -3, max: 3, zeroLine: true }
      ];
  }, [isComp]);

  const channelSpacing = 8;
  const totalHeight = useMemo(() => {
    return channelConfigs.reduce((acc, c) => acc + c.height + channelSpacing, 0) + 16;
  }, [channelConfigs]);

  // ------------------------------------------------------------------------
  // BACKGROUND CACHE: Pre-render channel grids, ticks, zero lines & traces
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!samples || samples.length === 0) return;
    if (!chartBgCanvasRef.current) {
      chartBgCanvasRef.current = document.createElement('canvas');
    }
    const bgCanvas = chartBgCanvasRef.current;
    const ctx = bgCanvas.getContext('2d');
    const width = containerWidth;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);

    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(totalHeight * dpr);
    if (bgCanvas.width !== targetW || bgCanvas.height !== targetH) {
      bgCanvas.width = targetW;
      bgCanvas.height = targetH;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, totalHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const gutterW = 78;
    const marginR = 14;
    const plotX = gutterW;
    const plotW = Math.max(100, width - plotX - marginR);
    const [viewStart, viewEnd] = viewRangeRef.current || [0, 1];
    const zoomSpan = Math.max(0.001, viewEnd - viewStart);

    let currentY = 8;

    const getX = (idx, total) => {
      const pct = idx / Math.max(1, total - 1);
      return plotX + ((pct - viewStart) / zoomSpan) * plotW;
    };
    const getXFromPct = (pct) => {
      return plotX + ((pct - viewStart) / zoomSpan) * plotW;
    };
    const getY = (val, min, max, top, chH) => {
      const clamped = Math.max(min, Math.min(max, val));
      return top + chH - ((clamped - min) / (max - min)) * chH;
    };

    // Corner markers run behind every channel so the pit board selection is
    // visible on the traces themselves.
    const pctToIndex = (pct) => Math.round(pct * (samples.length - 1));

    channelConfigs.forEach((channel) => {
      const top = currentY;
      const chH = channel.height;

      ctx.fillStyle = CHART.gutter;
      ctx.fillRect(0, top, gutterW, chH);

      ctx.fillStyle = CHART.textMuted;
      ctx.font = '600 10px "Saira", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(channel.label, 8, top + 15);

      ctx.fillStyle = CHART.textDim;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillText(channel.unit, 8, top + 27);

      ctx.fillStyle = CHART.textDim;
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${channel.max}`, gutterW - 6, top + 11);
      const midVal = ((channel.max + channel.min) / 2).toFixed(channel.zeroLine ? 1 : 0);
      ctx.fillText(`${midVal}`, gutterW - 6, top + chH / 2 + 3);
      ctx.fillText(`${channel.min}`, gutterW - 6, top + chH - 3);

      ctx.fillStyle = CHART.bg;
      ctx.fillRect(plotX, top, plotW, chH);
      ctx.strokeStyle = CHART.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(plotX, top, plotW, chH);

      for (let g = 1; g < 4; g++) {
        const gy = top + (g / 4) * chH;
        ctx.beginPath();
        ctx.moveTo(plotX, gy);
        ctx.lineTo(plotX + plotW, gy);
        ctx.strokeStyle = CHART.grid;
        ctx.stroke();
      }

      if (channel.zeroLine) {
        const zy = getY(0, channel.min, channel.max, top, chH);
        ctx.beginPath();
        ctx.moveTo(plotX, zy);
        ctx.lineTo(plotX + plotW, zy);
        ctx.strokeStyle = CHART.zero;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Vertical distance/percentage grid lines
      const step = zoomSpan > 0.5 ? 0.1 : zoomSpan > 0.2 ? 0.05 : zoomSpan > 0.08 ? 0.02 : 0.01;
      const firstTick = Math.ceil(viewStart / step) * step;
      ctx.strokeStyle = CHART.grid;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 4]);
      for (let p = firstTick; p <= viewEnd + 1e-5; p += step) {
        const gx = getXFromPct(p);
        if (gx >= plotX && gx <= plotX + plotW) {
          ctx.beginPath();
          ctx.moveTo(gx, top);
          ctx.lineTo(gx, top + chH);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Clip channel traces and corner markers cleanly to plot bounds
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotX, top, plotW, chH);
      ctx.clip();

      // Corner markers. Only the active corner gets a band; the rest stay as
      // thin top ticks so the traces are never obscured.
      corners.forEach((corner) => {
        const isActive = activeCornerId === corner.id;
        const x0 = getXFromPct(corner.start_pct);
        const x1 = getXFromPct(corner.end_pct);
        const ax = getXFromPct(corner.apex_pct);

        if (corner.end_pct < viewStart || corner.start_pct > viewEnd) return;

        if (isActive) {
          ctx.fillStyle = 'rgba(255, 138, 61, 0.12)';
          ctx.fillRect(x0, top + 1, Math.max(2, x1 - x0), chH - 2);

          ctx.beginPath();
          ctx.moveTo(ax, top + 1);
          ctx.lineTo(ax, top + chH - 1);
          ctx.strokeStyle = CHART.corner;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255, 138, 61, 0.35)';
          ctx.fillRect(x0, top + 1, Math.max(2, x1 - x0), 2);
        }
      });

      if (channel.id === 'delta' && isComp) {
        const compList = compareData.comparison;
        ctx.beginPath();
        compList.forEach((pt, i) => {
          const x = getX(i, compList.length);
          const y = getY(pt.delta, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.delta;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (channel.id === 'speed') {
        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.speed, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.speed;
        ctx.lineWidth = 2.1;
        ctx.stroke();
      }

      if (channel.id === 'pedals') {
        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.throttle, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.throttle;
        ctx.lineWidth = 1.9;
        ctx.stroke();

        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.brake, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.brake;
        ctx.lineWidth = 1.9;
        ctx.stroke();
      }

      if (channel.id === 'rpm') {
        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.rpm, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.rpm;
        ctx.lineWidth = 1.9;
        ctx.stroke();

        let lastGear = samples[0]?.gear;
        let lastShiftX = -100;
        samples.forEach((s, i) => {
          if (s.gear !== lastGear && s.gear > 0) {
            const sx = getX(i, samples.length);
            if (sx - lastShiftX >= 34) {
              lastShiftX = sx;
              const sy = getY(s.rpm, channel.min, channel.max, top, chH);
              ctx.fillStyle = CHART.corner;
              ctx.beginPath();
              ctx.roundRect(sx - 7, sy - 9, 14, 13, 2);
              ctx.fill();
              ctx.fillStyle = '#10141a';
              ctx.font = '700 9px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`${s.gear}`, sx, sy + 1);
            }
            lastGear = s.gear;
          }
        });
      }

      if (channel.id === 'steer_g') {
        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.steering / 30.0, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.steer;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        samples.forEach((s, i) => {
          const x = getX(i, samples.length);
          const y = getY(s.lat_g, channel.min, channel.max, top, chH);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = CHART.gforce;
        ctx.lineWidth = 1.7;
        ctx.stroke();
      }

      ctx.restore();

      currentY += chH + channelSpacing;
    });

    setChartBgReady((v) => v + 1);
  }, [samples, isComparing, compareData, containerWidth, corners, activeCornerId, viewRange, channelConfigs, totalHeight]);

  // ------------------------------------------------------------------------
  // COMPOSITE OVERLAY: Instant blit of cached channels + smooth cursor line
  // ------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !samples || samples.length === 0) return;
    const bgCanvas = chartBgCanvasRef.current;
    if (!bgCanvas) return;

    const ctx = canvas.getContext('2d');
    const width = containerWidth;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);

    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(totalHeight * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.height = `${totalHeight}px`;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, totalHeight);

    // Blit pre-rendered channels in 0.04ms!
    ctx.drawImage(bgCanvas, 0, 0, width, totalHeight);

    // Synchronized cursor at continuous float getX
    if (activeIdx !== null && activeIdx >= 0 && activeIdx < samples.length) {
      const gutterW = 78;
      const marginR = 14;
      const plotX = gutterW;
      const plotW = Math.max(100, width - plotX - marginR);
      const [viewStart, viewEnd] = viewRangeRef.current || [0, 1];
      const zoomSpan = Math.max(0.001, viewEnd - viewStart);

      const pct = activeIdx / Math.max(1, samples.length - 1);
      const scrubX = plotX + ((pct - viewStart) / zoomSpan) * plotW;

      if (scrubX >= plotX && scrubX <= plotX + plotW) {
        ctx.beginPath();
        ctx.moveTo(scrubX, 8);
        ctx.lineTo(scrubX, totalHeight - 8);
        ctx.strokeStyle = CHART.cursorGlow;
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(scrubX, 8);
        ctx.lineTo(scrubX, totalHeight - 8);
        ctx.strokeStyle = CHART.cursor;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Cursor off-screen indicator
        const isLeft = scrubX < plotX;
        const edgeX = isLeft ? plotX + 4 : plotX + plotW - 4;
        ctx.fillStyle = 'rgba(232, 237, 242, 0.7)';
        ctx.beginPath();
        if (isLeft) {
          ctx.moveTo(edgeX + 5, 12);
          ctx.lineTo(edgeX, 16);
          ctx.lineTo(edgeX + 5, 20);
        } else {
          ctx.moveTo(edgeX - 5, 12);
          ctx.lineTo(edgeX, 16);
          ctx.lineTo(edgeX - 5, 20);
        }
        ctx.fill();
      }
    }
  }, [chartBgReady, activeIdx, containerWidth, viewRange, samples.length, totalHeight]);

  const handleMouseDown = (e) => {
    if (e.shiftKey || e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanningRef.current = true;
      hasDraggedPanRef.current = false;
      panStartRef.current = {
        x: e.clientX,
        range: [...viewRangeRef.current]
      };
    }
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !samples || samples.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const gutterW = 78;
    const marginR = 14;
    const plotW = Math.max(100, rect.width - gutterW - marginR);

    if (isPanningRef.current) {
      hasDraggedPanRef.current = true;
      const dx = e.clientX - panStartRef.current.x;
      const span = panStartRef.current.range[1] - panStartRef.current.range[0];
      const deltaPct = -(dx / plotW) * span;

      let newStart = panStartRef.current.range[0] + deltaPct;
      let newEnd = panStartRef.current.range[1] + deltaPct;

      if (newStart < 0) {
        newStart = 0;
        newEnd = span;
      } else if (newEnd > 1) {
        newEnd = 1;
        newStart = 1 - span;
      }

      setViewRange([newStart, newEnd]);
      return;
    }

    const relX = clientX - gutterW;
    const screenFraction = Math.max(0, Math.min(1, relX / plotW));
    const [start, end] = viewRangeRef.current;
    const currentSpan = end - start;
    const pct = Math.max(0, Math.min(1, start + screenFraction * currentSpan));
    const targetIdx = pct * (samples.length - 1);

    currentProgressRef.current = pct;
    setInternalHoverIdx(targetIdx);
    if (onHoverIndex) onHoverIndex(targetIdx);
  };

  const handleMouseUp = () => {
    isPanningRef.current = false;
  };

  const currentElapsedSec = useMemo(() => {
    if (!samples || samples.length === 0 || activeIdx === null) return 0;
    const s0 = samples[0].time;
    const baseIdx = Math.floor(Math.max(0, Math.min(samples.length - 1, activeIdx)));
    const nextIdx = Math.min(samples.length - 1, baseIdx + 1);
    const t = activeIdx - baseIdx;
    const t0 = samples[baseIdx]?.time ?? s0;
    const t1 = samples[nextIdx]?.time ?? t0;
    const curTime = t0 + (t1 - t0) * t;
    return Math.max(0, curTime - s0);
  }, [samples, activeIdx]);

  const progress = lapDuration > 0 ? currentElapsedSec / lapDuration : 0;

  return (
    <section className="panel" aria-label="Telemetry channels">
      <div className="panel-head">
        <span className="panel-title">
          <Activity size={13} />
          Channels
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          {/* Zoom controls */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'var(--bg-sunken)',
              border: '1px solid var(--border-dim)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px',
              gap: '2px'
            }}
          >
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleZoomOut}
              disabled={!isZoomed}
              title="Zoom out (- or scroll down)"
              style={{ padding: '0.15rem 0.35rem', border: 'none', background: 'transparent' }}
            >
              <ZoomOut size={12} />
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={handleResetZoom}
              title="Reset zoom to 1.0x (0 or Esc)"
              style={{
                padding: '0.15rem 0.45rem',
                border: 'none',
                background: isZoomed ? 'rgba(53, 199, 240, 0.15)' : 'transparent',
                color: isZoomed ? 'var(--ch-speed)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: '0.72rem',
                minWidth: '40px',
                textAlign: 'center'
              }}
            >
              {zoomFactor.toFixed(1)}x
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={handleZoomIn}
              disabled={zoomSpan <= 0.016}
              title="Zoom in (+ or scroll up)"
              style={{ padding: '0.15rem 0.35rem', border: 'none', background: 'transparent' }}
            >
              <ZoomIn size={12} />
            </button>

            {isZoomed && (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handlePan(-1)}
                  title="Pan left (Shift+Left)"
                  style={{ padding: '0.15rem 0.25rem', border: 'none', background: 'transparent', color: 'var(--text-dim)' }}
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handlePan(1)}
                  title="Pan right (Shift+Right)"
                  style={{ padding: '0.15rem 0.25rem', border: 'none', background: 'transparent', color: 'var(--text-dim)' }}
                >
                  <ChevronRight size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleResetZoom}
                  title="Reset zoom to 100%"
                  style={{ padding: '0.15rem 0.35rem', border: 'none', background: 'transparent', color: 'var(--ch-speed)' }}
                >
                  <RotateCcw size={11} />
                </button>
              </>
            )}
          </div>

          {/* Quick Zoom Presets */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            {[1, 2, 4, 8].map((lvl) => {
              const isSelected = Math.abs(zoomFactor - lvl) < 0.2;
              return (
                <button
                  key={lvl}
                  type="button"
                  className={`btn btn-sm ${isSelected ? 'btn-primary' : ''}`}
                  onClick={() => setZoomPreset(lvl)}
                  style={{ padding: '0.15rem 0.35rem', fontSize: '0.68rem', minWidth: '26px' }}
                  title={`Zoom ${lvl}x`}
                >
                  {lvl}x
                </button>
              );
            })}
          </div>

          {refLapNumber !== null && <span className="tag tag-ref">L{refLapNumber}</span>}
          {isComparing && compLapNumber !== null && (
            <span className="tag tag-comp">L{compLapNumber}</span>
          )}
          {activeSample && (
            <span className="tag tag-quiet mono">
              {(activeSample.dist_pct * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {loading && <PanelLoading rows={5} label="Loading telemetry" />}

      {!loading && error && <PanelError hint={error} />}

      {!loading && !error && samples.length === 0 && (
        <PanelEmpty
          title="No telemetry for this lap"
          hint="This lap has no cached samples. Import the session again or pick another lap."
        />
      )}

      {!loading && !error && samples.length > 0 && (
        <>
          <div className="panel-body" style={{ paddingBottom: '0.5rem' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
                gap: '0.5rem'
              }}
            >
              <Readout
                label="Speed"
                value={activeSample ? `${Math.round(activeSample.speed)}` : '--'}
                unit="km/h"
                color="var(--ch-speed)"
                secondary={
                  isComparing && activeCompSample
                    ? `Ghost (L${compLapNumber}): ${Math.round(activeCompSample.speed || 0)} km/h`
                    : null
                }
              />
              <Readout
                label="Pedals"
                value={activeSample ? `${Math.round(activeSample.throttle)} / ${Math.round(activeSample.brake)}` : '--'}
                unit="t/b"
                color="var(--ch-throttle)"
                secondary={
                  isComparing && activeCompSample
                    ? `Ghost: ${Math.round(activeCompSample.throttle || 0)} / ${Math.round(activeCompSample.brake || 0)}`
                    : null
                }
              />
              <Readout
                label="Gear"
                value={activeSample ? (activeSample.gear ? `${activeSample.gear}` : 'N') : '--'}
                unit={activeSample ? `${Math.round(activeSample.rpm)} rpm` : 'rpm'}
                color="var(--ch-gear)"
                secondary={
                  isComparing && activeCompSample
                    ? `Ghost: ${activeCompSample.gear || 'N'} • ${Math.round(activeCompSample.rpm || 0)} rpm`
                    : null
                }
              />
              <Readout
                label="Steering"
                value={activeSample ? `${Math.round(activeSample.steering)}` : '--'}
                unit="deg"
                color="var(--ch-steer)"
                secondary={
                  isComparing && activeCompSample
                    ? `Ghost: ${Math.round(activeCompSample.steering || 0)} deg`
                    : null
                }
              />
              <Readout
                label="Lateral G"
                value={activeSample ? activeSample.lat_g.toFixed(2) : '--'}
                unit="g"
                color="var(--ch-gforce)"
                secondary={
                  isComparing && activeCompSample
                    ? `Ghost: ${(activeCompSample.lat_g || 0).toFixed(2)} g`
                    : null
                }
              />
              {isComparing && activeCompSample && (
                <Readout
                  label="Delta"
                  value={
                    activeCompSample.delta > 0
                      ? `+${activeCompSample.delta.toFixed(3)}`
                      : activeCompSample.delta.toFixed(3)
                  }
                  unit="sec"
                  color={activeCompSample.delta <= 0 ? 'var(--gain)' : 'var(--loss)'}
                />
              )}
            </div>
          </div>

          {/* Lap Overview & Zoom Navigator Bar */}
          {isZoomed && (
            <ZoomOverviewBar
              samples={samples}
              viewRange={viewRange}
              onRangeChange={setViewRange}
              activeIdx={activeIdx}
              corners={corners}
              activeCornerId={activeCornerId}
              onSeekPct={seekToPct}
              width={containerWidth}
            />
          )}

          <div
            ref={containerRef}
            style={{
              position: 'relative',
              width: '100%',
              cursor: isPanningRef.current
                ? 'grabbing'
                : isShiftPressed && isZoomed
                  ? 'grab'
                  : 'crosshair',
              padding: '0 0.7rem'
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={(e) => {
              if (isZoomed) e.preventDefault();
            }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
          </div>

          <div className="panel-body" style={{ paddingTop: '0.5rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.5rem 0.6rem',
                background: 'var(--bg-sunken)',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <span className="mono" style={{ fontSize: '0.74rem', color: 'var(--accent-ref)', minWidth: 62 }}>
                {formatClock(currentElapsedSec)}
              </span>

              <input
                type="range"
                min="0"
                max="1"
                step="0.0005"
                value={progress}
                onChange={handleScrubberChange}
                aria-label="Lap position"
                style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--accent-ref)' }}
              />

              <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: 62, textAlign: 'right' }}>
                {formatClock(lapDuration)}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginTop: '0.5rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button type="button" className="btn btn-sm" onClick={handleRestart} title="Jump to lap start">
                  <SkipBack size={12} />
                  Start
                </button>
                <button type="button" className="btn btn-sm" onClick={() => handleStep(-5)} title="Back 5 seconds">
                  <Rewind size={12} />
                  -5s
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${isPlaying ? 'btn-primary' : ''}`}
                  onClick={handleTogglePlay}
                  style={{ minWidth: 78 }}
                  aria-pressed={isPlaying}
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => handleStep(5)} title="Forward 5 seconds">
                  <FastForward size={12} />
                  +5s
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Rate</span>
                {[0.5, 1, 2, 4].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn btn-sm ${playbackSpeed === s ? 'btn-primary' : ''}`}
                    onClick={() => setPlaybackSpeed(s)}
                    aria-pressed={playbackSpeed === s}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.85rem',
              padding: '0.5rem 0.7rem',
              borderTop: '1px solid var(--border-dim)',
              fontSize: '0.72rem',
              color: 'var(--text-muted)'
            }}
          >
            {isComparing && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  background: 'var(--bg-sunken)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-dim)'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-bright)', fontWeight: 600 }}>
                  <span style={{ width: 14, height: 2.5, background: 'var(--text-bright)', borderRadius: 1 }} />
                  Active (L{refLapNumber})
                </span>
                <span style={{ color: 'var(--border-dim)' }}>|</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)', fontWeight: 600 }}>
                  Ghost L{compLapNumber} di panel Head to head
                </span>
              </div>
            )}
            <LegendItem color={CHART.speed} label="Speed" />
            <LegendItem color={CHART.throttle} label="Throttle" />
            <LegendItem color={CHART.brake} label="Brake" />
            <LegendItem color={CHART.rpm} label="RPM" />
            <LegendItem color={CHART.steer} label="Steering" />
            <LegendItem color={CHART.gforce} label="Lateral G" />
            {isComparing && <LegendItem color={CHART.delta} label="Delta" />}
            {corners.length > 0 && <LegendItem color={CHART.corner} label="Corner band" />}
          </div>
        </>
      )}
    </section>
  );
}

function Readout({ label, value, unit, color, secondary }) {
  return (
    <div
      style={{
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border-dim)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.45rem 0.55rem',
        minWidth: 0
      }}
    >
      <div className="strip-label">{label}</div>
      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color, lineHeight: 1.2 }}>
        {value}
        <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)', marginLeft: 4, fontWeight: 500 }}>
          {unit}
        </span>
      </div>
      {secondary && (
        <div className="mono" style={{ fontSize: '0.64rem', color: 'var(--text-dim)' }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label, dashed = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          width: 14,
          height: 3,
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color}, ${color} 4px, transparent 4px, transparent 7px)`
            : color,
          borderRadius: 1
        }}
      />
      {label}
    </span>
  );
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function ZoomOverviewBar({
  samples,
  viewRange,
  onRangeChange,
  activeIdx,
  corners,
  activeCornerId,
  onSeekPct,
  width
}) {
  const canvasRef = useRef(null);
  const barRef = useRef(null);
  const dragModeRef = useRef(null);
  const dragStartRef = useRef({ clientX: 0, range: [0, 1] });

  const viewStart = viewRange[0];
  const viewEnd = viewRange[1];
  const span = Math.max(0.01, viewEnd - viewStart);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !samples || samples.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth || 600;
    const h = 24;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Draw full-lap speed sparkline
    ctx.beginPath();
    const maxSpeed = 280;
    const step = Math.max(1, Math.floor(samples.length / 320));
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      const x = (i / (samples.length - 1)) * w;
      const y = h - ((s.speed || 0) / maxSpeed) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(53, 199, 240, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Corner bands on mini trackbar
    (corners || []).forEach((c) => {
      const cx0 = c.start_pct * w;
      const cx1 = c.end_pct * w;
      ctx.fillStyle = activeCornerId === c.id ? 'rgba(255, 138, 61, 0.45)' : 'rgba(255, 138, 61, 0.18)';
      ctx.fillRect(cx0, 0, Math.max(2, cx1 - cx0), 3);
    });
  }, [samples, corners, activeCornerId, width]);

  const handlePointerDown = (e, mode) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragModeRef.current = mode;
    dragStartRef.current = {
      clientX: e.clientX,
      range: [...viewRange]
    };
  };

  const handlePointerMove = (e) => {
    if (!dragModeRef.current || !barRef.current) return;
    const barRect = barRef.current.getBoundingClientRect();
    const dx = e.clientX - dragStartRef.current.clientX;
    const deltaPct = dx / barRect.width;
    const [origStart, origEnd] = dragStartRef.current.range;
    const origSpan = origEnd - origStart;

    if (dragModeRef.current === 'window') {
      let nextStart = origStart + deltaPct;
      let nextEnd = origEnd + deltaPct;
      if (nextStart < 0) { nextStart = 0; nextEnd = origSpan; }
      if (nextEnd > 1) { nextEnd = 1; nextStart = 1 - origSpan; }
      onRangeChange([nextStart, nextEnd]);
    } else if (dragModeRef.current === 'left') {
      let nextStart = Math.max(0, Math.min(origEnd - 0.015, origStart + deltaPct));
      onRangeChange([nextStart, origEnd]);
    } else if (dragModeRef.current === 'right') {
      let nextEnd = Math.min(1, Math.max(origStart + 0.015, origEnd + deltaPct));
      onRangeChange([origStart, nextEnd]);
    }
  };

  const handlePointerUp = () => {
    dragModeRef.current = null;
  };

  const handleBarClick = (e) => {
    if (dragModeRef.current || !barRef.current) return;
    const barRect = barRef.current.getBoundingClientRect();
    const clickPct = Math.max(0, Math.min(1, (e.clientX - barRect.left) / barRect.width));
    let nextStart = clickPct - span / 2;
    let nextEnd = clickPct + span / 2;
    if (nextStart < 0) { nextStart = 0; nextEnd = span; }
    if (nextEnd > 1) { nextEnd = 1; nextStart = 1 - span; }
    onRangeChange([nextStart, nextEnd]);
    if (onSeekPct) onSeekPct(clickPct);
  };

  const cursorPct = samples && samples.length > 1 && activeIdx !== null
    ? activeIdx / (samples.length - 1)
    : 0;

  return (
    <div style={{ padding: '0 0.7rem', marginTop: '0.4rem', marginBottom: '0.35rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px',
          fontSize: '0.68rem'
        }}
      >
        <span style={{ color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ch-speed)' }} />
          Lap Overview & Pan Navigator
        </span>
        <span className="mono" style={{ color: 'var(--ch-speed)', fontWeight: 600 }}>
          {(viewStart * 100).toFixed(1)}% – {(viewEnd * 100).toFixed(1)}%
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 5 }}>
            ({(1 / span).toFixed(1)}x view)
          </span>
        </span>
      </div>

      <div
        ref={barRef}
        onClick={handleBarClick}
        style={{
          position: 'relative',
          height: 24,
          background: '#080c10',
          border: '1px solid #1f2732',
          borderRadius: '4px',
          cursor: 'pointer',
          overflow: 'hidden',
          userSelect: 'none'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        {/* Playhead position line */}
        <div
          style={{
            position: 'absolute',
            left: `${cursorPct * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#ffffff',
            boxShadow: '0 0 5px #ffffff',
            zIndex: 3,
            pointerEvents: 'none'
          }}
        />

        {/* Viewport Window Box */}
        <div
          onPointerDown={(e) => handlePointerDown(e, 'window')}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            position: 'absolute',
            left: `${viewStart * 100}%`,
            width: `${span * 100}%`,
            top: 0,
            bottom: 0,
            background: 'rgba(53, 199, 240, 0.16)',
            border: '1.5px solid #35c7f0',
            borderRadius: '2px',
            boxShadow: '0 0 8px rgba(53, 199, 240, 0.25)',
            cursor: 'grab',
            zIndex: 4,
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          {/* Left Handle */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'left')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            title="Drag to resize left edge"
            style={{
              width: 8,
              height: '100%',
              cursor: 'ew-resize',
              background: 'rgba(53, 199, 240, 0.4)',
              borderRadius: '1px 0 0 1px'
            }}
          />
          {/* Right Handle */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'right')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            title="Drag to resize right edge"
            style={{
              width: 8,
              height: '100%',
              cursor: 'ew-resize',
              background: 'rgba(53, 199, 240, 0.4)',
              borderRadius: '0 1px 1px 0'
            }}
          />
        </div>
      </div>
    </div>
  );
}
