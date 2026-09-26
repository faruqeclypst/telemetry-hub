import React, { useMemo } from 'react';
import { Flag, CornerDownRight, CornerDownLeft } from 'lucide-react';
import { PanelEmpty, PanelError, PanelLoading } from './PanelState';

function fmtSpeed(v) {
  return v === null || v === undefined ? '--' : `${Math.round(v)}`;
}

function fmtDelta(v) {
  if (v === null || v === undefined) return null;
  const sign = v <= 0 ? '' : '+';
  return `${sign}${v.toFixed(3)}s`;
}

function CornerPanel({
  corners = [],
  loading = false,
  error = null,
  activeCornerId = null,
  onSelectCorner,
  isComparing = false,
  refLapNumber = null,
  compLapNumber = null
}) {
  const withDelta = useMemo(
    () => corners.some((c) => c.compare && c.compare.delta_exit !== null && c.compare.delta_exit !== undefined),
    [corners]
  );

  const slowest = useMemo(() => {
    if (corners.length === 0) return null;
    return corners.reduce((a, b) => (a.min_speed <= b.min_speed ? a : b));
  }, [corners]);

  const biggestGain = useMemo(() => {
    if (!withDelta) return null;
    return corners.reduce((best, c) => {
      const d = c.compare?.delta_exit;
      if (d === null || d === undefined) return best;
      if (!best || d < best.compare.delta_exit) return c;
      return best;
    }, null);
  }, [corners, withDelta]);

  return (
    <section className="panel" aria-label="Corner analysis">
      <div className="panel-head">
        <span className="panel-title">
          <Flag size={13} />
          Corners
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {refLapNumber !== null && <span className="tag tag-ref">L{refLapNumber}</span>}
          {isComparing && compLapNumber !== null && <span className="tag tag-comp">L{compLapNumber}</span>}
          {corners.length > 0 && <span className="tag tag-quiet">{corners.length} found</span>}
        </div>
      </div>

      {loading && <PanelLoading rows={4} label="Detecting corners" />}

      {!loading && error && <PanelError hint={error} />}

      {!loading && !error && corners.length === 0 && (
        <PanelEmpty
          title="No corners detected"
          hint="Corner detection needs steering, curvature and speed in the telemetry for this lap."
        />
      )}

      {!loading && !error && corners.length > 0 && (
        <>
          <div className="corner-list" role="list">
            {corners.map((corner) => {
              const isActive = activeCornerId === corner.id;
              const delta = corner.compare?.delta_exit;
              const deltaColor =
                delta === null || delta === undefined
                  ? 'var(--text-dim)'
                  : delta <= -0.01
                  ? 'var(--gain)'
                  : delta >= 0.01
                  ? 'var(--loss)'
                  : 'var(--text-muted)';

              return (
                <button
                  key={corner.id}
                  type="button"
                  role="listitem"
                  className={`corner-row${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectCorner && onSelectCorner(corner)}
                  aria-pressed={isActive}
                  title={`Jump telemetry, map and replay to ${corner.id}`}
                >
                  <span className="corner-num">{corner.number}</span>

                  <span className="corner-main">
                    <span className="corner-line">
                      {corner.direction === 'left' ? (
                        <CornerDownLeft size={12} color="var(--accent-comp)" />
                      ) : (
                        <CornerDownRight size={12} color="var(--accent-ref)" />
                      )}
                      <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                        {corner.name ? corner.name.toUpperCase() : corner.direction.toUpperCase()}
                      </span>
                      <span className="corner-dir">{corner.length_m}m</span>
                    </span>
                    <span className="corner-facts">
                      <span>vmin {fmtSpeed(corner.min_speed)}</span>
                      <span>apex {(corner.apex_pct * 100).toFixed(0)}%</span>
                      <span>{corner.max_lat_g.toFixed(1)}g</span>
                      {corner.turn_deg ? <span>{Math.round(corner.turn_deg)}&deg;</span> : null}
                      {corner.apex?.gear ? <span>G{corner.apex.gear}</span> : null}
                    </span>
                  </span>

                  <span className="corner-delta" style={{ color: deltaColor }}>
                    {withDelta ? (fmtDelta(delta) ?? '--') : `${corner.duration.toFixed(1)}s`}
                  </span>
                </button>
              );
            })}
          </div>

          {(slowest || biggestGain) && (
            <div
              style={{
                borderTop: '1px solid var(--border-dim)',
                padding: '0.55rem 0.7rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                fontSize: '0.74rem'
              }}
            >
              {slowest && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Slowest apex</span>
                  <span className="mono" style={{ color: 'var(--warn)' }}>
                    T{slowest.number} {slowest.name ? `(${slowest.name})` : ''} · {fmtSpeed(slowest.min_speed)} km/h
                  </span>
                </div>
              )}
              {biggestGain && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Biggest gain at exit</span>
                  <span className="mono" style={{ color: 'var(--gain)' }}>
                    T{biggestGain.number} {biggestGain.name ? `(${biggestGain.name})` : ''} · {fmtDelta(biggestGain.compare?.delta_exit)}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default React.memo(CornerPanel);
