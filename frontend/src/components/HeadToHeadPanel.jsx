import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Swords } from 'lucide-react';
import { PanelEmpty, PanelError, PanelLoading } from './PanelState';

// Sector boundaries in normalized lap distance. The backend stores three
// sectors per lap, so the head-to-head uses the same split.
const SECTOR_BOUNDS = [
  { id: 'S1', from: 0.0, to: 1 / 3 },
  { id: 'S2', from: 1 / 3, to: 2 / 3 },
  { id: 'S3', from: 2 / 3, to: 1.0 }
];

// Number of mini-sectors per sector, as F1 graphics use.
const MINI_PER_SECTOR = 8;

const CHART = {
  bg: '#0b0e13',
  grid: '#1b2029',
  border: '#232b36',
  ref: '#ff8a3d',
  comp: '#35c7f0',
  gain: '#3fd68c',
  loss: '#ff5c5c',
  neutral: '#4a5560',
  text: '#9aa6b2',
  textDim: '#6b7785'
};

function fmtLapTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function fmtDelta(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  const sign = v <= 0 ? '' : '+';
  return `${sign}${v.toFixed(3)}`;
}

function deltaColor(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'var(--text-dim)';
  if (v <= -0.01) return 'var(--gain)';
  if (v >= 0.01) return 'var(--loss)';
  return 'var(--text-muted)';
}

// Cumulative-time delta at a lap position, read from the aligned comparison.
function deltaAtPct(comparison, pct) {
  if (!comparison || comparison.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, pct));
  const idx = Math.round(clamped * (comparison.length - 1));
  return comparison[idx]?.delta ?? 0;
}

function HeadToHeadPanel({
  comparisonData = null,
  isComparing = false,
  refLapNumber = null,
  compLapNumber = null,
  refLapTime = null,
  compLapTime = null,
  loading = false,
  error = null,
  hoverIndex = null,
  onHoverIndex = null,
  sampleCount = 0,
  trackName = ''
}) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 640, height: 210 });

  const comparison = useMemo(
    () => comparisonData?.comparison || [],
    [comparisonData]
  );
  const hasData = comparison.length > 1;

  // Sector deltas: cumulative delta at each sector boundary, differenced.
  const sectors = useMemo(() => {
    if (!hasData) return [];
    return SECTOR_BOUNDS.map((sector) => {
      const atEnd = deltaAtPct(comparison, sector.to);
      const atStart = deltaAtPct(comparison, sector.from);
      const delta = atEnd - atStart;
      const idxFrom = Math.round(sector.from * (comparison.length - 1));
      const idxTo = Math.round(sector.to * (comparison.length - 1));
      let refBest = Infinity;
      let compBest = Infinity;
      for (let i = idxFrom; i <= idxTo; i++) {
        const pt = comparison[i];
        if (pt?.ref?.speed > refBest) refBest = pt.ref.speed;
        if (pt?.comp?.speed > compBest) compBest = pt.comp.speed;
      }
      return {
        id: sector.id,
        delta,
        vmaxRef: Number.isFinite(refBest) ? refBest : null,
        vmaxComp: Number.isFinite(compBest) ? compBest : null
      };
    });
  }, [comparison, hasData]);

  // Mini-sectors: each third split into MINI_PER_SECTOR slots, coloured by the
  // dominant gain/loss status inside that slot.
  const miniSectors = useMemo(() => {
    if (!hasData) return [];
    const out = [];
    SECTOR_BOUNDS.forEach((sector) => {
      const span = (sector.to - sector.from) / MINI_PER_SECTOR;
      for (let m = 0; m < MINI_PER_SECTOR; m++) {
        const from = sector.from + m * span;
        const to = from + span;
        const idxFrom = Math.round(from * (comparison.length - 1));
        const idxTo = Math.max(idxFrom, Math.round(to * (comparison.length - 1)));
        let gain = 0;
        let loss = 0;
        for (let i = idxFrom; i <= idxTo; i++) {
          const st = comparison[i]?.status;
          if (st === 'gain') gain++;
          else if (st === 'loss') loss++;
        }
        const status = gain > loss ? 'gain' : loss > gain ? 'loss' : 'neutral';
        out.push({ sector: sector.id, from, to, status });
      }
    });
    return out;
  }, [comparison, hasData]);

  const bounds = useMemo(() => {
    if (!hasData) return { speedMax: 320, deltaAbs: 1 };
    let speedMax = 0;
    let deltaAbs = 0.2;
    for (const pt of comparison) {
      const rs = pt?.ref?.speed || 0;
      const cs = pt?.comp?.speed || 0;
      if (rs > speedMax) speedMax = rs;
      if (cs > speedMax) speedMax = cs;
      const d = Math.abs(pt?.delta || 0);
      if (d > deltaAbs) deltaAbs = d;
    }
    return {
      speedMax: Math.ceil((speedMax + 20) / 20) * 20,
      deltaAbs: Math.ceil(deltaAbs * 10) / 10
    };
  }, [comparison, hasData]);

  // Track the container width so the canvas is crisp at any layout size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const measure = () => {
      const w = canvas.parentElement.clientWidth;
      if (w > 0) setSize((prev) => (prev.width === w ? prev : { ...prev, width: w }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  // Draw the speed traces and the delta band.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const W = size.width;
    const H = size.height;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 42;
    const padR = 10;
    const padT = 10;
    const speedH = Math.round((H - padT - 22) * 0.66);
    const deltaH = (H - padT - 22) - speedH - 6;
    const plotW = Math.max(40, W - padL - padR);
    const speedTop = padT;
    const deltaTop = speedTop + speedH + 6;

    const xAt = (pct) => padL + pct * plotW;
    const ySpeed = (v) => speedTop + speedH - (Math.max(0, Math.min(bounds.speedMax, v)) / bounds.speedMax) * speedH;

    // Panels
    ctx.fillStyle = CHART.bg;
    ctx.fillRect(padL, speedTop, plotW, speedH);
    ctx.fillRect(padL, deltaTop, plotW, deltaH);

    // Speed grid
    ctx.strokeStyle = CHART.grid;
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const gy = speedTop + (g / 4) * speedH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = CHART.border;
    ctx.strokeRect(padL, speedTop, plotW, speedH);
    ctx.strokeRect(padL, deltaTop, plotW, deltaH);

    // Speed labels
    ctx.fillStyle = CHART.textDim;
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(bounds.speedMax)}`, padL - 5, speedTop + 6);
    ctx.fillText('km/h', padL - 5, speedTop + speedH / 2);
    ctx.fillText('0', padL - 5, speedTop + speedH - 4);

    // Sector dividers across both panels
    ctx.strokeStyle = CHART.grid;
    ctx.setLineDash([3, 4]);
    SECTOR_BOUNDS.slice(1).forEach((s) => {
      const gx = xAt(s.from);
      ctx.beginPath();
      ctx.moveTo(gx, speedTop);
      ctx.lineTo(gx, deltaTop + deltaH);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Delta zero line
    const zeroY = deltaTop + deltaH / 2;
    ctx.strokeStyle = CHART.border;
    ctx.beginPath();
    ctx.moveTo(padL, zeroY);
    ctx.lineTo(padL + plotW, zeroY);
    ctx.stroke();

    // Delta labels
    ctx.fillStyle = CHART.textDim;
    ctx.textAlign = 'right';
    ctx.fillText(`+${bounds.deltaAbs.toFixed(1)}`, padL - 5, deltaTop + 5);
    ctx.fillText('δ s', padL - 5, zeroY);
    ctx.fillText(`-${bounds.deltaAbs.toFixed(1)}`, padL - 5, deltaTop + deltaH - 4);

    // Ghost (comparison) speed trace, dashed
    ctx.beginPath();
    comparison.forEach((pt, i) => {
      const x = xAt(i / (comparison.length - 1));
      const y = ySpeed(pt?.comp?.speed || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = CHART.comp;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Reference speed trace, solid
    ctx.beginPath();
    comparison.forEach((pt, i) => {
      const x = xAt(i / (comparison.length - 1));
      const y = ySpeed(pt?.ref?.speed || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = CHART.ref;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Delta band: filled between the cumulative delta curve and zero, green when
    // the reference is ahead (negative delta) and red when behind.
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, deltaTop, plotW, deltaH);
    ctx.clip();

    const yDelta = (d) => zeroY - (d / bounds.deltaAbs) * (deltaH / 2);

    ctx.beginPath();
    comparison.forEach((pt, i) => {
      const x = xAt(i / (comparison.length - 1));
      const y = yDelta(pt?.delta || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + plotW, zeroY);
    ctx.lineTo(padL, zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, deltaTop, 0, deltaTop + deltaH);
    grad.addColorStop(0, 'rgba(255, 92, 92, 0.5)');
    grad.addColorStop(0.5, 'rgba(255, 92, 92, 0.04)');
    grad.addColorStop(0.5, 'rgba(63, 214, 140, 0.04)');
    grad.addColorStop(1, 'rgba(63, 214, 140, 0.5)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Delta curve
    ctx.beginPath();
    comparison.forEach((pt, i) => {
      const x = xAt(i / (comparison.length - 1));
      const y = yDelta(pt?.delta || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#dfe6ee';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Cursor from the shared hover position, converted from lap fraction.
    if (comparisonHoverIdx !== null && comparisonHoverIdx >= 0 && comparisonHoverIdx < comparison.length) {
      const cx = xAt(comparisonHoverIdx / (comparison.length - 1));
      ctx.beginPath();
      ctx.moveTo(cx, speedTop);
      ctx.lineTo(cx, deltaTop + deltaH);
      ctx.strokeStyle = 'rgba(232, 237, 242, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [comparison, hasData, bounds, size, comparisonHoverIdx]);

  const handleMove = (e) => {
    if (!hasData || !onHoverIndex) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 42;
    const padR = 10;
    const plotW = Math.max(1, rect.width - padL - padR);
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / plotW));
    // Emit in the reference-lap sample index space so every panel stays in sync.
    const refCount = sampleCount > 1 ? sampleCount : comparison.length;
    onHoverIndex(Math.round(pct * (refCount - 1)));
  };

  const totalDelta = comparisonData?.total_delta ?? null;

  // The shared hoverIndex is an index into the reference lap samples, while this
  // panel plots the distance-aligned comparison array. Convert through the
  // normalized lap fraction so the cursor stays synced with the other panels.
  const hoverPct = useMemo(() => {
    if (hoverIndex === null || sampleCount < 2) return null;
    return Math.max(0, Math.min(1, hoverIndex / (sampleCount - 1)));
  }, [hoverIndex, sampleCount]);

  const comparisonHoverIdx = useMemo(() => {
    if (hoverPct === null || comparison.length < 2) return null;
    return Math.round(hoverPct * (comparison.length - 1));
  }, [hoverPct, comparison.length]);

  return (
    <section className="panel" aria-label="Head to head qualifying comparison">
      <div className="panel-head">
        <span className="panel-title">
          <Swords size={13} />
          Head to head
          {trackName ? <span className="h2h-track">{trackName}</span> : null}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {refLapNumber !== null && <span className="tag tag-ref">L{refLapNumber}</span>}
          {isComparing && compLapNumber !== null && <span className="tag tag-comp">L{compLapNumber}</span>}
          {totalDelta !== null && (
            <span className={`tag ${totalDelta <= -0.01 ? 'tag-gain' : totalDelta >= 0.01 ? 'tag-loss' : 'tag-quiet'}`}>
              {fmtDelta(totalDelta)}s
            </span>
          )}
        </div>
      </div>

      {loading && <PanelLoading rows={4} label="Loading head to head" />}

      {!loading && error && <PanelError hint={error} />}

      {!loading && !error && !isComparing && (
        <PanelEmpty
          title="No comparison lap selected"
          hint="Pick a second flying lap from the lap table to open the head-to-head view."
          icon={<Swords size={20} />}
        />
      )}

      {!loading && !error && isComparing && !hasData && (
        <PanelEmpty
          title="Comparison unavailable"
          hint="A head-to-head needs telemetry for both laps. One of them may be missing position or speed data."
          icon={<Swords size={20} />}
        />
      )}

      {!loading && !error && hasData && (
        <>
          <div className="h2h-drivers">
            <div className="h2h-driver">
              <span className="h2h-swatch" style={{ background: 'var(--accent-ref)' }} />
              <span className="h2h-driver-label">Active L{refLapNumber}</span>
              <span className="h2h-driver-time mono">{fmtLapTime(refLapTime)}</span>
            </div>
            <div className="h2h-driver">
              <span className="h2h-swatch" style={{ background: 'var(--accent-comp)' }} />
              <span className="h2h-driver-label">Ghost L{compLapNumber}</span>
              <span className="h2h-driver-time mono">{fmtLapTime(compLapTime)}</span>
            </div>
          </div>

          <div className="h2h-canvas-wrap" onMouseMove={handleMove} onMouseLeave={() => onHoverIndex && onHoverIndex(null)}>
            <canvas ref={canvasRef} />
          </div>

          <div className="h2h-sectors" role="table" aria-label="Sector comparison">
            {sectors.map((s) => (
              <div className="h2h-sector" key={s.id} role="row">
                <span className="h2h-sector-id" role="cell">{s.id}</span>
                <span className="h2h-sector-delta mono" role="cell" style={{ color: deltaColor(s.delta) }}>
                  {fmtDelta(s.delta)}s
                </span>
                <span className="h2h-sector-vmax" role="cell">
                  <span className="mono" style={{ color: 'var(--accent-ref)' }}>{s.vmaxRef ? Math.round(s.vmaxRef) : '--'}</span>
                  <span className="h2h-vs">/</span>
                  <span className="mono" style={{ color: 'var(--accent-comp)' }}>{s.vmaxComp ? Math.round(s.vmaxComp) : '--'}</span>
                  <span className="h2h-unit">vmax</span>
                </span>
              </div>
            ))}
          </div>

          <div className="h2h-mini" aria-label="Mini sectors">
            {miniSectors.map((m, i) => (
              <span
                key={i}
                className={`h2h-mini-cell is-${m.status}`}
                title={`${m.sector} · ${(m.from * 100).toFixed(1)}%–${(m.to * 100).toFixed(1)}% · ${m.status}`}
              />
            ))}
          </div>

          <div className="h2h-legend">
            <span><span className="h2h-swatch" style={{ background: 'var(--accent-ref)' }} />Active</span>
            <span><span className="h2h-swatch h2h-swatch-dash" style={{ background: 'var(--accent-comp)' }} />Ghost</span>
            <span><span className="h2h-swatch" style={{ background: 'var(--gain)' }} />Gain</span>
            <span><span className="h2h-swatch" style={{ background: 'var(--loss)' }} />Loss</span>
          </div>
        </>
      )}
    </section>
  );
}

export default React.memo(HeadToHeadPanel);
