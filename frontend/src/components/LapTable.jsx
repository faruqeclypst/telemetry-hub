import React, { useMemo } from 'react';
import { ArrowRightLeft, ListOrdered } from 'lucide-react';
import { PanelEmpty } from './PanelState';

function fmtLapTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function fmtSector(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '--.---';
  return seconds.toFixed(3);
}

function LapTable({
  laps = [],
  selectedLapNumber,
  onSelectLap,
  compareLapNumber = null,
  onToggleCompare
}) {
  const bestLapTime = useMemo(
    () =>
      laps
        .filter((l) => l.is_valid && !l.is_pit_lap)
        .reduce((best, l) => (best === null || l.lap_time < best ? l.lap_time : best), null),
    [laps]
  );

  const sectorBest = useMemo(() => {
    const out = { sector1: null, sector2: null, sector3: null };
    for (const key of Object.keys(out)) {
      for (const lap of laps) {
        const v = lap[key];
        if (!v || Number.isNaN(v)) continue;
        if (out[key] === null || v < out[key]) out[key] = v;
      }
    }
    return out;
  }, [laps]);

  return (
    <section className="panel" aria-label="Lap timing">
      <div className="panel-head">
        <span className="panel-title">
          <ListOrdered size={13} />
          Lap timing
        </span>
        <span className="tag tag-quiet">{laps.length} laps</span>
      </div>

      {laps.length === 0 ? (
        <PanelEmpty
          title="No laps in this session"
          hint="Import a session with at least one completed lap to see timing here."
        />
      ) : (
        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lap</th>
                <th>Time</th>
                <th>S1</th>
                <th>S2</th>
                <th>S3</th>
                <th>Vmax</th>
                <th style={{ textAlign: 'right' }}>Set</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((lap) => {
                const isRef = selectedLapNumber === lap.lap_number;
                const isComp = compareLapNumber === lap.lap_number;
                const isBest = bestLapTime !== null && lap.lap_time === bestLapTime;
                const delta = bestLapTime !== null && lap.lap_time ? lap.lap_time - bestLapTime : null;

                const cls = isRef ? 'is-ref' : isComp ? 'is-comp' : '';

                return (
                  <tr key={lap.id || lap.lap_number} className={cls}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => onSelectLap(lap.lap_number)}
                        aria-pressed={isRef}
                        title={isRef ? 'Current reference lap' : `Make lap ${lap.lap_number} the reference`}
                        style={{ border: 'none', background: 'transparent', padding: '0.1rem 0.3rem' }}
                      >
                        <span className="mono" style={{ fontWeight: 700, color: isRef ? 'var(--accent-ref)' : 'var(--text-main)' }}>
                          L{lap.lap_number}
                        </span>
                      </button>
                      {isBest && <span className="tag tag-gain" style={{ marginLeft: 2 }}>best</span>}
                      {lap.is_pit_lap ? <span className="tag tag-warn" style={{ marginLeft: 2 }}>pit</span> : null}
                      {!lap.is_valid && !lap.is_pit_lap ? (
                        <span className="tag tag-loss" style={{ marginLeft: 2 }}>invalid</span>
                      ) : null}
                    </td>

                    <td>
                      <div className="mono" style={{ fontWeight: 700, color: isBest ? 'var(--gain)' : 'var(--text-main)' }}>
                        {fmtLapTime(lap.lap_time)}
                      </div>
                      {delta !== null && delta > 0.001 && (
                        <div className="mono" style={{ fontSize: '0.68rem', color: 'var(--loss)' }}>
                          +{delta.toFixed(3)}
                        </div>
                      )}
                    </td>

                    {['sector1', 'sector2', 'sector3'].map((key) => {
                      const v = lap[key];
                      const isSectorBest = v && sectorBest[key] !== null && Math.abs(v - sectorBest[key]) < 0.0005;
                      return (
                        <td
                          key={key}
                          className="mono"
                          style={{
                            color: isSectorBest ? 'var(--ch-rpm)' : 'var(--text-muted)',
                            fontWeight: isSectorBest ? 700 : 400
                          }}
                        >
                          {fmtSector(v)}
                        </td>
                      );
                    })}

                    <td className="mono" style={{ color: 'var(--ch-speed)' }}>
                      {lap.max_speed ? lap.max_speed : '--'}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className={`btn btn-sm${isComp ? ' btn-compare' : ''}`}
                        onClick={() => onToggleCompare(lap.lap_number)}
                        aria-pressed={isComp}
                        disabled={!isComp && (!lap.is_valid || !!lap.is_pit_lap)}
                        title={
                          !isComp && (!lap.is_valid || !!lap.is_pit_lap)
                            ? 'An out or invalid lap covers only part of the circuit, so its delta is not comparable'
                            : isComp
                            ? 'Stop comparing this lap'
                            : `Compare lap ${lap.lap_number} against the reference`
                        }
                      >
                        <ArrowRightLeft size={11} />
                        {isComp ? 'On' : 'Compare'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default React.memo(LapTable);
