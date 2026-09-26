import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { MapPin, Box, Zap, Gauge, Navigation } from 'lucide-react';
import { PanelEmpty, PanelError, PanelLoading } from './PanelState';

const MAP_COLORS = {
  kerb: '#2a3442',
  asphalt: '#0d131d',
  edge: 'rgba(232, 237, 242, 0.07)',
  gain: '#3fd68c',
  loss: '#ff5c5c',
  even: '#4a5563',
  slow: '#ff5c5c',
  mid: '#f5b03e',
  fast: '#3fd68c',
  line: '#35c7f0',
  car: '#ff8a3d',
  ghost: '#35c7f0',
  corner: '#ff8a3d'
};

export default function TrackMap({ 
  samples = [], 
  comparisonData = null,
  isComparing = false,
  hoverIndex = null, 
  onHoverIndex = null,
  trackName = "Track Map", 
  lapNumber = null,
  compareLapNumber = null,
  corners = [],
  activeCornerId = null,
  onOpen3D,
  loading = false,
  error = null
}) {
  const canvasWrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [mapMode, setMapMode] = useState('speed'); // 'gain_loss', 'speed', 'line'
  const [isHovered, setIsHovered] = useState(false);
  const [mapHover, setMapHover] = useState(null);

  // Automatically switch to gain_loss when compare mode is activated
  useEffect(() => {
    setMapMode((current) => {
      if (isComparing && comparisonData?.comparison?.length > 0) return 'gain_loss';
      if (current === 'gain_loss') return 'speed';
      return current;
    });
  }, [isComparing, comparisonData]);

  // Points to render
  const validPoints = useMemo(() => {
    return samples.filter(s => s.world_x !== undefined && s.world_y !== undefined);
  }, [samples]);

  const hasInGameCenterline = useMemo(() => {
    return validPoints.some(p => p.track_center_x != null && p.path_lateral != null);
  }, [validPoints]);

  const compList = useMemo(() => {
    return comparisonData?.comparison || [];
  }, [comparisonData]);

  // Screen-space projection shared by the canvas render and the hit test, so a
  // click on a corner badge lands on the same pixel it was drawn at.
  const projection = useMemo(() => {
    if (validPoints.length < 10) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let maxSpeed = 0, minSpeed = Infinity;

    validPoints.forEach(p => {
      const cx = p.track_center_x != null ? p.track_center_x : p.world_x;
      const cy = p.track_center_y != null ? p.track_center_y : p.world_y;
      minX = Math.min(minX, p.world_x, cx);
      maxX = Math.max(maxX, p.world_x, cx);
      minY = Math.min(minY, p.world_y, cy);
      maxY = Math.max(maxY, p.world_y, cy);
      maxSpeed = Math.max(maxSpeed, p.speed);
      minSpeed = Math.min(minSpeed, p.speed);
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padding = 36;

    return { minX, maxX, minY, maxY, rangeX, rangeY, padding, maxSpeed, minSpeed };
  }, [validPoints]);

  const [containerSize, setContainerSize] = useState({ width: 480, height: 330 });
  const bgCanvasRef = useRef(null);
  const [bgReady, setBgReady] = useState(0);

  useEffect(() => {
    if (!canvasWrapRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          const w = Math.floor(entry.contentRect.width);
          const h = Math.floor(entry.contentRect.height) || Math.round(w * (11 / 16));
          setContainerSize({ width: w, height: h });
        }
      }
    });
    observer.observe(canvasWrapRef.current);
    return () => observer.disconnect();
  }, []);

  const displayWidth = containerSize.width;
  const displayHeight = containerSize.height;

  const cornerAnchors = useMemo(() => {
    if (!projection || corners.length === 0 || validPoints.length < 10) return [];

    const { minX, minY, rangeX, rangeY, padding } = projection;
    const scale = Math.min(
      (displayWidth - padding * 2) / rangeX,
      (displayHeight - padding * 2) / rangeY
    );
    const offsetX = (displayWidth - rangeX * scale) / 2 - minX * scale;
    const offsetY = (displayHeight - rangeY * scale) / 2 - minY * scale;

    return corners.map((corner) => {
      const idx = Math.max(
        0,
        Math.min(validPoints.length - 1, Math.round(corner.apex_pct * (validPoints.length - 1)))
      );
      const p = validPoints[idx];
      return {
        corner,
        x: p.world_x * scale + offsetX,
        y: displayHeight - (p.world_y * scale + offsetY)
      };
    });
  }, [projection, corners, validPoints, displayWidth, displayHeight]);

  // ------------------------------------------------------------------------
  // BACKGROUND CACHE: Pre-render static track, roadbed, heatmap & corners
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (validPoints.length < 10 || !projection) return;
    if (!bgCanvasRef.current) {
      bgCanvasRef.current = document.createElement('canvas');
    }
    const bgCanvas = bgCanvasRef.current;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const targetW = Math.floor(displayWidth * dpr);
    const targetH = Math.floor(displayHeight * dpr);
    if (bgCanvas.width !== targetW || bgCanvas.height !== targetH) {
      bgCanvas.width = targetW;
      bgCanvas.height = targetH;
    }

    const ctx = bgCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const { minX, minY, rangeX, rangeY, padding, maxSpeed, minSpeed } = projection;
    const scale = Math.min((displayWidth - padding * 2) / rangeX, (displayHeight - padding * 2) / rangeY);
    const offsetX = (displayWidth - rangeX * scale) / 2 - minX * scale;
    const offsetY = (displayHeight - rangeY * scale) / 2 - minY * scale;

    const toScreen = (wx, wy) => ({
      x: wx * scale + offsetX,
      y: displayHeight - (wy * scale + offsetY)
    });

    const getCenterScreen = (p) => {
      const cx = p.track_center_x != null ? p.track_center_x : p.world_x;
      const cy = p.track_center_y != null ? p.track_center_y : p.world_y;
      return toScreen(cx, cy);
    };

    // 1. HD Track Asphalt Bed (Double-bordered asphalt ribbon along true track centerline)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer kerb boundary glow
    ctx.beginPath();
    const p0 = getCenterScreen(validPoints[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < validPoints.length; i++) {
      const pt = getCenterScreen(validPoints[i]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = MAP_COLORS.kerb;
    ctx.lineWidth = 14;
    ctx.stroke();

    // Dark asphalt track roadbed
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < validPoints.length; i++) {
      const pt = getCenterScreen(validPoints[i]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = MAP_COLORS.asphalt;
    ctx.lineWidth = 10;
    ctx.stroke();

    // Subtle track edges white guide lines
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < validPoints.length; i++) {
      const pt = getCenterScreen(validPoints[i]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = MAP_COLORS.edge;
    ctx.lineWidth = 9;
    ctx.stroke();

    // 2. High-Definition Colored Heatmap Ribbon
    if (mapMode === 'gain_loss' && compList.length > 10) {
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
          ctx.strokeStyle = MAP_COLORS.gain;
          ctx.lineWidth = 5;
        } else if (status === 'loss') {
          ctx.strokeStyle = MAP_COLORS.loss;
          ctx.lineWidth = 5;
        } else {
          ctx.strokeStyle = MAP_COLORS.even;
          ctx.lineWidth = 3.5;
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

      if (comparisonData?.max_gain) {
        const mg = comparisonData.max_gain;
        const pt = toScreen(mg.world_x, mg.world_y);
        drawHDCalloutBadge(ctx, pt.x, pt.y, 'MAX GAIN', `${mg.diff.toFixed(2)}s`, MAP_COLORS.gain, displayWidth);
      }

      if (comparisonData?.max_loss) {
        const ml = comparisonData.max_loss;
        const pt = toScreen(ml.world_x, ml.world_y);
        drawHDCalloutBadge(ctx, pt.x, pt.y, 'MAX LOSS', `+${ml.diff.toFixed(2)}s`, MAP_COLORS.loss, displayWidth);
      }
    } else if (mapMode === 'speed') {
      for (let i = 0; i < validPoints.length - 1; i++) {
        const pt1 = toScreen(validPoints[i].world_x, validPoints[i].world_y);
        const pt2 = toScreen(validPoints[i + 1].world_x, validPoints[i + 1].world_y);

        const spd = validPoints[i].speed;
        const brk = validPoints[i].brake;
        const norm = (spd - minSpeed) / (maxSpeed - minSpeed || 1);

        ctx.beginPath();
        ctx.moveTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);

        if (brk > 20 || spd < 110) {
          ctx.strokeStyle = MAP_COLORS.slow;
          ctx.lineWidth = 5;
        } else if (norm > 0.6) {
          ctx.strokeStyle = MAP_COLORS.fast;
          ctx.lineWidth = 4.5;
        } else {
          ctx.strokeStyle = MAP_COLORS.mid;
          ctx.lineWidth = 4;
        }
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < validPoints.length; i++) {
        const pt = toScreen(validPoints[i].world_x, validPoints[i].world_y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.strokeStyle = MAP_COLORS.line;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Corner tabs
    cornerAnchors.forEach(({ corner, x, y }) => {
      const isActive = activeCornerId === corner.id;

      ctx.beginPath();
      ctx.arc(x, y, isActive ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? MAP_COLORS.corner : 'rgba(17, 21, 28, 0.9)';
      ctx.fill();
      ctx.strokeStyle = isActive ? MAP_COLORS.corner : MAP_COLORS.kerb;
      ctx.lineWidth = isActive ? 2 : 1.4;
      ctx.stroke();

      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isActive ? '#10141a' : '#9aa6b2';
      ctx.fillText(String(corner.number), x, y + 0.5);
      ctx.textBaseline = 'alphabetic';
    });

    // Start/Finish Line Gate
    if (validPoints.length > 2) {
      const p1 = toScreen(validPoints[0].world_x, validPoints[0].world_y);
      const p2 = toScreen(validPoints[1].world_x, validPoints[1].world_y);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      ctx.beginPath();
      ctx.moveTo(p1.x - nx * 9, p1.y - ny * 9);
      ctx.lineTo(p1.x + nx * 9, p1.y + ny * 9);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ff0033';
      ctx.fill();
    }

    setBgReady((v) => v + 1);
  }, [validPoints, compList, mapMode, projection, cornerAnchors, activeCornerId, displayWidth, displayHeight, comparisonData]);

  // ------------------------------------------------------------------------
  // DYNAMIC OVERLAY: Instant blit of cached track + smooth interpolated car
  // ------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || validPoints.length < 10 || !projection) return;
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const targetW = Math.floor(displayWidth * dpr);
    const targetH = Math.floor(displayHeight * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Blit pre-rendered track in 0.03ms!
    ctx.drawImage(bgCanvas, 0, 0, displayWidth, displayHeight);

    const { minX, minY, rangeX, rangeY, padding } = projection;
    const scale = Math.min((displayWidth - padding * 2) / rangeX, (displayHeight - padding * 2) / rangeY);
    const offsetX = (displayWidth - rangeX * scale) / 2 - minX * scale;
    const offsetY = (displayHeight - rangeY * scale) / 2 - minY * scale;

    const toScreen = (wx, wy) => ({
      x: wx * scale + offsetX,
      y: displayHeight - (wy * scale + offsetY)
    });

    const activeIndex = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < validPoints.length
      ? hoverIndex
      : 0;

    // 4. Comparison Ghost Car with smooth sub-sample interpolation
    if (isComparing && compList.length > 0) {
      const compProgress = (activeIndex / Math.max(1, validPoints.length - 1)) * (compList.length - 1);
      const cBase = Math.floor(compProgress);
      const cNext = Math.min(compList.length - 1, cBase + 1);
      const cT = compProgress - cBase;
      const c0 = compList[cBase]?.comp;
      const c1 = compList[cNext]?.comp || c0;

      if (c0 && c1 && c0.world_x !== undefined && c1.world_x !== undefined) {
        const gWx = c0.world_x + (c1.world_x - c0.world_x) * cT;
        const gWy = c0.world_y + (c1.world_y - c0.world_y) * cT;
        const ghostPt = toScreen(gWx, gWy);

        ctx.beginPath();
        ctx.arc(ghostPt.x, ghostPt.y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(53, 199, 240, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ghostPt.x, ghostPt.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = MAP_COLORS.ghost;
        ctx.fill();
        ctx.strokeStyle = MAP_COLORS.asphalt;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    // 5. Active Driver Car with smooth sub-sample interpolation & heading
    const baseIdx = Math.floor(activeIndex);
    const nextIdx = Math.min(validPoints.length - 1, baseIdx + 1);
    const t = activeIndex - baseIdx;
    const p0 = validPoints[baseIdx] || validPoints[0];
    const p1 = validPoints[nextIdx] || p0;

    if (p0) {
      const curWx = p0.world_x + (p1.world_x - p0.world_x) * t;
      const curWy = p0.world_y + (p1.world_y - p0.world_y) * t;
      const cur = toScreen(curWx, curWy);

      const lookAheadIdx = Math.min(validPoints.length - 1, baseIdx + 2);
      const lookPt = validPoints[lookAheadIdx] || p1;
      const lookScreen = toScreen(lookPt.world_x, lookPt.world_y);
      const heading = Math.atan2(lookScreen.y - cur.y, lookScreen.x - cur.x);

      const interpSpeed = Math.round(p0.speed + (p1.speed - p0.speed) * t);
      const activeGear = t < 0.5 ? p0.gear : p1.gear;

      // Reference lap marker glow
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 138, 61, 0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 138, 61, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Main car pip
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS.car;
      ctx.fill();
      ctx.strokeStyle = '#e8edf2';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Forward direction pointer arrow
      ctx.beginPath();
      ctx.moveTo(cur.x + Math.cos(heading) * 11, cur.y + Math.sin(heading) * 11);
      ctx.lineTo(cur.x + Math.cos(heading + 2.5) * 5, cur.y + Math.sin(heading + 2.5) * 5);
      ctx.lineTo(cur.x + Math.cos(heading - 2.5) * 5, cur.y + Math.sin(heading - 2.5) * 5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Telemetry pill badge
      let badgeText = `${interpSpeed} km/h • G${activeGear || 'N'}`;
      if (isComparing && compList.length > 0) {
        const compProg = (activeIndex / Math.max(1, validPoints.length - 1)) * (compList.length - 1);
        const curComp = compList[Math.min(compList.length - 1, Math.round(compProg))];
        if (curComp && curComp.delta !== undefined) {
          const sign = curComp.delta <= 0 ? '' : '+';
          badgeText += ` | Δ ${sign}${curComp.delta.toFixed(2)}s`;
        }
      }

      ctx.font = '600 11px "JetBrains Mono", monospace';
      const textW = ctx.measureText(badgeText).width;

      const tagX = Math.min(displayWidth - textW - 14, Math.max(10, cur.x + 10));
      const tagY = Math.min(displayHeight - 18, Math.max(18, cur.y - 14));

      // Badge shadow & container
      ctx.fillStyle = 'rgba(10, 14, 22, 0.95)';
      ctx.strokeStyle = '#2b3952';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tagX - 5, tagY - 13, textW + 10, 18, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e8edf2';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, tagX, tagY - 4);
      ctx.textBaseline = 'alphabetic';
    }

    // 6. Interactive Hover Inspection Reticle
    if (mapHover && mapHover.screenX !== undefined) {
      const hx = mapHover.screenX;
      const hy = mapHover.screenY;
      const isGain = mapHover.compItem?.status === 'gain';
      const isLoss = mapHover.compItem?.status === 'loss';
      const color = isGain ? MAP_COLORS.gain : isLoss ? MAP_COLORS.loss : MAP_COLORS.line;

      ctx.beginPath();
      ctx.arc(hx, hy, 10, 0, Math.PI * 2);
      ctx.fillStyle = isGain
        ? 'rgba(63, 214, 140, 0.25)'
        : isLoss
        ? 'rgba(255, 92, 92, 0.25)'
        : 'rgba(53, 199, 240, 0.25)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e8edf2';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [bgReady, hoverIndex, mapHover, isComparing, compList, validPoints, projection, displayWidth, displayHeight]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || validPoints.length < 10) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    validPoints.forEach(p => {
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
    const padding = 36;
    const scale = Math.min((rect.width - padding * 2) / rangeX, (rect.height - padding * 2) / rangeY);

    const offsetX = (rect.width - rangeX * scale) / 2 - minX * scale;
    const offsetY = (rect.height - rangeY * scale) / 2 - minY * scale;

    let closestIdx = 0;
    let minD = Infinity;

    for (let i = 0; i < validPoints.length; i++) {
      const p = validPoints[i];
      const sx = p.world_x * scale + offsetX;
      const sy = rect.height - (p.world_y * scale + offsetY);
      const d = (sx - mouseX) ** 2 + (sy - mouseY) ** 2;
      if (d < minD) {
        minD = d;
        closestIdx = i;
      }
    }

    if (minD < 2500) {
      const s = validPoints[closestIdx];
      const screenX = s.world_x * scale + offsetX;
      const screenY = rect.height - (s.world_y * scale + offsetY);

      let compItem = null;
      if (compList.length > 0) {
        const cIdx = Math.min(compList.length - 1, Math.floor((closestIdx / (validPoints.length - 1)) * compList.length));
        compItem = compList[cIdx];
      }

      setMapHover({
        idx: closestIdx,
        sample: s,
        compItem,
        screenX,
        screenY,
        containerWidth: rect.width,
        containerHeight: rect.height
      });

      if (onHoverIndex) {
        onHoverIndex(closestIdx);
      }
    } else {
      setMapHover(null);
    }
  }, [validPoints, compList, onHoverIndex]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setMapHover(null);
    if (onHoverIndex) {
      onHoverIndex(null);
    }
  }, [onHoverIndex]);

  return (
    <section className="panel" aria-label="Track map">
      <div className="panel-head">
        <span className="panel-title">
          <MapPin size={13} />
          {trackName}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
          {lapNumber !== null && <span className="tag tag-ref">L{lapNumber}</span>}
          {isComparing && compareLapNumber !== null && (
            <span className="tag tag-comp">L{compareLapNumber}</span>
          )}

          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {isComparing && (
              <button
                type="button"
                className={`btn btn-sm${mapMode === 'gain_loss' ? ' btn-primary' : ''}`}
                onClick={() => setMapMode('gain_loss')}
                aria-pressed={mapMode === 'gain_loss'}
                title="Colour the track by where time was gained or lost"
              >
                <Zap size={11} />
                Gain / loss
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm${mapMode === 'speed' ? ' btn-primary' : ''}`}
              onClick={() => setMapMode('speed')}
              aria-pressed={mapMode === 'speed'}
              title="Colour the track by speed"
            >
              <Gauge size={11} />
              Speed
            </button>
            <button
              type="button"
              className={`btn btn-sm${mapMode === 'line' ? ' btn-primary' : ''}`}
              onClick={() => setMapMode('line')}
              aria-pressed={mapMode === 'line'}
              title="Show the driven line only"
            >
              <Navigation size={11} />
              Line
            </button>
          </div>
        </div>
      </div>

      {loading && <PanelLoading rows={3} label="Loading track map" />}

      {!loading && error && <PanelError hint={error} />}

      {!loading && !error && validPoints.length < 10 && (
        <PanelEmpty
          title="No track outline for this lap"
          hint="The map needs world position samples. This lap has none cached."
        />
      )}

      {!loading && !error && validPoints.length >= 10 && (
        <div className="panel-body" style={{ padding: '0.6rem' }}>
          <div
            ref={canvasWrapRef}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16/11',
              background: 'var(--bg-sunken)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-dim)',
              overflow: 'hidden'
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

            {mapHover && (
              <div
                style={{
                  position: 'absolute',
                  top: mapHover.screenY > 105 ? `${mapHover.screenY - 96}px` : `${mapHover.screenY + 18}px`,
                  left: Math.max(10, Math.min(460 - 180, mapHover.screenX - 90)),
                  width: '180px',
                  background: 'var(--bg-surface)',
                  border: `1px solid ${
                    mapHover.compItem?.status === 'gain'
                      ? 'var(--gain)'
                      : mapHover.compItem?.status === 'loss'
                      ? 'var(--loss)'
                      : 'var(--border-mid)'
                  }`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  pointerEvents: 'none',
                  zIndex: 30
                }}
              >
                {isComparing && mapHover.compItem ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        color:
                          mapHover.compItem.status === 'gain'
                            ? 'var(--gain)'
                            : mapHover.compItem.status === 'loss'
                            ? 'var(--loss)'
                            : 'var(--text-muted)'
                      }}
                    >
                      {mapHover.compItem.status === 'gain'
                        ? 'GAIN'
                        : mapHover.compItem.status === 'loss'
                        ? 'LOSS'
                        : 'EVEN'}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: mapHover.compItem.delta <= 0 ? 'var(--gain)' : 'var(--loss)'
                      }}
                    >
                      {mapHover.compItem.delta <= 0
                        ? `${mapHover.compItem.delta.toFixed(3)}s`
                        : `+${mapHover.compItem.delta.toFixed(3)}s`}
                    </span>
                  </div>
                ) : (
                  <div className="strip-label" style={{ marginBottom: 3 }}>
                    Track telemetry
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-dim)', paddingTop: 4 }}>
                  <span>
                    Speed{' '}
                    <strong className="mono" style={{ color: 'var(--accent-ref)' }}>
                      {Math.round(mapHover.sample.speed)}
                    </strong>
                  </span>
                  {isComparing && (
                    <span>
                      Ghost{' '}
                      <strong className="mono" style={{ color: 'var(--accent-comp)' }}>
                        {Math.round(mapHover.compItem?.comp?.speed || mapHover.compItem?.speed || 0)}
                      </strong>
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--text-dim)', marginTop: 3 }}>
                  <span className="mono">
                    T {Math.round(mapHover.sample.throttle || 0)}% · B {Math.round(mapHover.sample.brake || 0)}%
                  </span>
                  <span className="mono">{Math.round((mapHover.sample.dist_pct || 0) * 100)}% lap</span>
                </div>
              </div>
            )}

            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                background: 'rgba(17, 21, 28, 0.92)',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--radius-xs)',
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '0.68rem',
                color: 'var(--text-muted)'
              }}
            >
              {mapMode === 'gain_loss' ? (
                <>
                  <LegendDot color="var(--gain)" label="Gained" />
                  <LegendDot color="var(--loss)" label="Lost" />
                  <LegendDot color="var(--even)" label="Even" />
                </>
              ) : mapMode === 'speed' ? (
                <>
                  <LegendDot color="var(--loss)" label="Braking" />
                  <LegendDot color="var(--warn)" label="Mid" />
                  <LegendDot color="var(--gain)" label="Fast" />
                </>
              ) : (
                <LegendDot color="var(--accent-comp)" label="Driven line" />
              )}

              {isComparing && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderLeft: '1px solid var(--border-mid)', paddingLeft: 8 }}>
                  <LegendDot color="var(--accent-ref)" label="Ref" round />
                  <LegendDot color="var(--accent-comp)" label="Comp" round />
                </span>
              )}

              {hasInGameCenterline && (
                <span
                  title="Track roadbed rendered from in-game centerline & track boundary data"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    borderLeft: '1px solid var(--border-mid)',
                    paddingLeft: 8,
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    color: 'var(--gain)'
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gain)', boxShadow: '0 0 6px var(--gain)' }} />
                  IN-GAME ROADBED
                </span>
              )}
            </div>

            {isHovered && !mapHover && (
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'rgba(17, 21, 28, 0.92)',
                  border: '1px solid var(--border-mid)',
                  color: 'var(--text-muted)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '3px 8px',
                  fontSize: '0.7rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5
                }}
              >
                <Box size={12} /> Hover to inspect the lap
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              {corners.length > 0
                ? `Numbered tabs mark each detected corner (${corners.length}).`
                : 'Corner tabs appear once corner detection finishes.'}
            </span>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={onOpen3D}
              title="Open the interactive 3D replay"
            >
              <Box size={12} />
              Open 3D replay
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function LegendDot({ color, label, round = false }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: round ? 7 : 9,
          height: round ? 7 : 4,
          background: color,
          borderRadius: round ? '50%' : 1
        }}
      />
      {label}
    </span>
  );
}

// Ultra HD Callout badge
function drawHDCalloutBadge(ctx, x, y, title, value, color, maxW) {
  ctx.save();
  ctx.font = '700 9.5px "JetBrains Mono", monospace';
  const text = `${title} ${value}`;
  const w = ctx.measureText(text).width + 10;
  const h = 16;

  const bx = Math.max(8, Math.min(maxW - w - 8, x - w / 2));
  const by = y < 35 ? y + 14 : y - 22;

  // Connecting line
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bx + w / 2, by + h / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Pin dot at track
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Badge box
  ctx.fillStyle = '#080c14';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 3);
  ctx.fill();
  ctx.stroke();

  // Badge text
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 5, by + 11.5);
  ctx.restore();
}
