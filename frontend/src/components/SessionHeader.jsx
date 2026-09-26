import React from 'react';
import { Download, ArrowRightLeft, Gauge } from 'lucide-react';

function fmtLapTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function sessionTypeColor(type) {
  if (type === 'race') return 'var(--loss)';
  if (type === 'qualifying') return 'var(--warn)';
  return 'var(--accent-comp)';
}

function SessionHeader({
  session,
  activeLapNumber,
  activeLap,
  isComparing,
  compareLap,
  canCompare = true,
  onToggleCompareMode,
  onExportCsv
}) {
  if (!session) return null;

  const laps = session.laps || [];
  const bestLap = laps
    .filter((l) => l.is_valid && !l.is_pit_lap)
    .reduce((best, l) => (!best || l.lap_time < best.lap_time ? l : best), null);

  const activeIsBest = bestLap && activeLap && bestLap.lap_number === activeLap.lap_number;
  const gapToBest =
    bestLap && activeLap && activeLap.lap_time ? activeLap.lap_time - bestLap.lap_time : null;

  const tires = Array.isArray(session.tire_pressures) ? session.tire_pressures : [];

  return (
    <section className="strip" aria-label="Session summary">
      <div className="strip-id">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
          <span className="tag tag-quiet">{session.sim ? session.sim.toUpperCase() : 'LMU'}</span>
          <span className="tag tag-quiet">{session.car_class || 'GT3'}</span>
          <span
            className="mono"
            style={{
              fontSize: '0.66rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: sessionTypeColor(session.session_type)
            }}
          >
            {(session.session_type || 'race').toUpperCase()}
          </span>
        </div>

        <h1 className="strip-track" title={session.track_name}>
          {session.track_name}
        </h1>

        <div className="strip-meta">
          <span>
            <strong style={{ color: 'var(--text-main)' }}>{session.driver_name}</strong>
          </span>
          <span>{session.car_name}</span>
          <span>{(session.track_length / 1000).toFixed(2)} km</span>
        </div>
      </div>

      <div className="strip-cell">
        <span className="strip-label">{activeIsBest ? 'Best lap' : 'Active lap'}</span>
        <span className="strip-value" style={{ color: activeIsBest ? 'var(--gain)' : 'var(--accent-ref)' }}>
          {activeLap ? fmtLapTime(activeLap.lap_time) : '--:--.---'}
        </span>
        <span className="strip-sub">
          L{activeLapNumber}
          {!activeIsBest && gapToBest !== null && gapToBest > 0.001 ? ` · +${gapToBest.toFixed(3)}` : ''}
        </span>
      </div>

      <div className="strip-cell">
        <span className="strip-label">Reference lap</span>
        <span className="strip-value">{bestLap ? fmtLapTime(bestLap.lap_time) : '--:--.---'}</span>
        <span className="strip-sub">{bestLap ? `L${bestLap.lap_number}` : 'no valid lap'}</span>
      </div>

      <div className="strip-cell">
        <span className="strip-label">Conditions</span>
        <span className="strip-value" style={{ fontSize: '0.86rem' }}>
          {session.air_temp ? `${session.air_temp.toFixed(0)}°C air` : '--'}
        </span>
        <span className="strip-sub">
          {session.track_temp ? `${session.track_temp.toFixed(0)}°C track` : '--'} · {session.weather || 'Clear'}
        </span>
      </div>

      <div className="strip-cell">
        <span className="strip-label">Setup</span>
        <span className="strip-value" style={{ fontSize: '0.86rem' }}>
          <Gauge size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {session.brake_bias ? `${session.brake_bias}% bias` : '--'}
        </span>
        <span className="strip-sub">
          ABS {session.abs_level ?? '--'} · TC {session.tc_level ?? '--'}
          {tires.length > 0 ? ` · ${Math.round(tires.reduce((a, b) => a + b, 0) / tires.length)} kPa` : ''}
        </span>
      </div>

      <div className="strip-cell" style={{ gap: '0.35rem' }}>
        <button
          type="button"
          className={`btn btn-sm${isComparing ? ' btn-compare' : ''}`}
          onClick={onToggleCompareMode}
          disabled={!isComparing && !canCompare}
          style={{ width: '100%' }}
          title={
            !isComparing && !canCompare
              ? 'This session has no second flying lap to compare against'
              : isComparing
              ? `Stop comparing lap ${compareLap}`
              : 'Compare the active lap against another flying lap'
          }
        >
          <ArrowRightLeft size={12} />
          {isComparing ? `Stop comparing L${compareLap}` : 'Compare a lap'}
        </button>

        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onExportCsv}
          style={{ width: '100%' }}
          title={`Download telemetry CSV for lap ${activeLapNumber}`}
        >
          <Download size={12} />
          Export L{activeLapNumber} CSV
        </button>
      </div>
    </section>
  );
}

export default React.memo(SessionHeader);
