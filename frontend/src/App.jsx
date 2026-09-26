import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Plus, Box, AlertTriangle } from 'lucide-react';
import SessionHeader from './components/SessionHeader';
import TelemetryChart from './components/TelemetryChart';
import HeadToHeadPanel from './components/HeadToHeadPanel';
import TrackMap from './components/TrackMap';
import LapTable from './components/LapTable';
import CornerPanel from './components/CornerPanel';
import ImportModal from './components/ImportModal';
import Track3DModal from './components/Track3DModal';
import ErrorBoundary from './components/ErrorBoundary';
import { apiUrl } from './lib/api';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [selectedLap, setSelectedLap] = useState(null);
  const [compareLap, setCompareLap] = useState(null);
  const [isComparing, setIsComparing] = useState(false);

  const [telemetrySamples, setTelemetrySamples] = useState([]);
  const [compTelemetrySamples, setCompTelemetrySamples] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const [corners, setCorners] = useState([]);
  const [cornersLoading, setCornersLoading] = useState(false);
  const [cornersError, setCornersError] = useState(null);
  const [activeCornerId, setActiveCornerId] = useState(null);

  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [is3DModalOpen, setIs3DModalOpen] = useState(false);
  const [is3DFocusPct, setIs3DFocusPct] = useState(0);

  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const seekRef = useRef(null);

  // 1. Session list
  const fetchSessions = useCallback(async (preferSessionId) => {
    try {
      const res = await fetch(apiUrl('/api/sessions'));
      if (!res.ok) throw new Error('Session list unavailable');
      const data = await res.json();
      const list = data.sessions || [];
      setSessions(list);
      setSessionsLoaded(true);

      setSelectedSessionId((current) => {
        if (preferSessionId) return preferSessionId;
        if (current && list.some((s) => s.id === current)) return current;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      setSessions([]);
      setSessionsLoaded(true);
      setSessionError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 2. Session detail
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionData(null);
      setSessionLoading(false);
      return;
    }

    let cancelled = false;
    setSessionLoading(true);
    setSessionError(null);

    fetch(apiUrl(`/api/sessions/${selectedSessionId}`))
      .then((res) => {
        if (!res.ok) throw new Error('Session not found');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSessionData(data);
        const laps = data.laps || [];
        const clean = laps.filter((l) => l.is_valid && !l.is_pit_lap);
        const best = clean.reduce(
          (fastest, l) => (!fastest || l.lap_time < fastest.lap_time ? l : fastest),
          null
        );
        const fallback = laps.find((l) => !l.is_pit_lap) || laps[0];
        const chosen = best || fallback;
        setSelectedLap(chosen ? chosen.lap_number : null);
        setCompareLap(null);
        setIsComparing(false);
        setActiveCornerId(null);
        setHoverIndex(null);
      })
      .catch((err) => {
        if (!cancelled) setSessionError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  // 3. Reference lap telemetry
  useEffect(() => {
    if (!selectedSessionId || selectedLap === null) {
      setTelemetrySamples([]);
      return;
    }

    let cancelled = false;
    setTelemetryLoading(true);
    setTelemetryError(null);

    fetch(apiUrl(`/api/sessions/${selectedSessionId}/laps/${selectedLap}/telemetry?lod=1200`))
      .then((res) => {
        if (!res.ok) throw new Error('Telemetry unavailable for this lap');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTelemetrySamples(data.samples || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setTelemetrySamples([]);
          setTelemetryError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setTelemetryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, selectedLap]);

  // 4. Comparison telemetry for the 3D ghost
  useEffect(() => {
    if (!selectedSessionId || compareLap === null) {
      setCompTelemetrySamples([]);
      return;
    }

    let cancelled = false;
    fetch(apiUrl(`/api/sessions/${selectedSessionId}/laps/${compareLap}/telemetry?lod=1200`))
      .then((res) => {
        if (!res.ok) throw new Error('Comparison telemetry unavailable');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setCompTelemetrySamples(data.samples || []);
      })
      .catch(() => {
        if (!cancelled) setCompTelemetrySamples([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, compareLap]);

  // 5. Delta comparison
  useEffect(() => {
    if (!isComparing || compareLap === null || !selectedSessionId || selectedLap === null) {
      setComparisonData(null);
      return;
    }

    let cancelled = false;
    fetch(
      apiUrl(`/api/sessions/${selectedSessionId}/compare?lap_ref=${selectedLap}&lap_comp=${compareLap}&points=1000`)
    )
      .then((res) => {
        if (!res.ok) throw new Error('Delta calculation failed');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setComparisonData(data);
      })
      .catch(() => {
        if (!cancelled) setComparisonData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isComparing, compareLap, selectedSessionId, selectedLap]);

  // 6. Corner detection for the active lap
  useEffect(() => {
    if (!selectedSessionId || selectedLap === null) {
      setCorners([]);
      setCornersError(null);
      return;
    }

    let cancelled = false;
    setCornersLoading(true);
    setCornersError(null);

    const activeTrack = sessionData?.session?.track_name || sessions.find((s) => s.id === selectedSessionId)?.track_name || '';
    const trackParam = activeTrack ? `track_name=${encodeURIComponent(activeTrack)}` : '';
    const compParam = isComparing && compareLap !== null ? `lap_comp=${compareLap}` : '';
    const queryParts = [compParam, trackParam].filter(Boolean);
    const compQuery = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    fetch(apiUrl(`/api/sessions/${selectedSessionId}/laps/${selectedLap}/corners${compQuery}`))
      .then((res) => {
        if (!res.ok) throw new Error('Corner detection failed for this lap');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setCorners(data.corners || []);
        setActiveCornerId((current) => {
          if (current && (data.corners || []).some((c) => c.id === current)) return current;
          return null;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setCorners([]);
          setCornersError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setCornersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, selectedLap, isComparing, compareLap]);

  const handleSelectLap = useCallback(
    (lapNum) => {
      setSelectedLap(lapNum);
      setActiveCornerId(null);
      if (compareLap === lapNum) {
        setCompareLap(null);
        setIsComparing(false);
      }
    },
    [compareLap]
  );

  const handleToggleCompare = useCallback(
    (lapNum) => {
      if (compareLap === lapNum && isComparing) {
        setCompareLap(null);
        setIsComparing(false);
      } else {
        setCompareLap(lapNum);
        setIsComparing(true);
      }
    },
    [compareLap, isComparing]
  );

  const handleToggleCompareMode = useCallback(() => {
    if (isComparing) {
      setIsComparing(false);
      setCompareLap(null);
      return;
    }

    const laps = sessionData?.laps || [];
    const others = laps.filter((l) => l.lap_number !== selectedLap);
    // Prefer a clean flying lap so the delta means something. An out lap only
    // covers part of the circuit, which makes every delta meaningless.
    const other = others.find((l) => l.is_valid && !l.is_pit_lap);

    if (other) {
      setCompareLap(other.lap_number);
      setIsComparing(true);
    }
  }, [isComparing, sessionData, selectedLap]);

  const handleExportCsv = useCallback(() => {
    if (!selectedSessionId || selectedLap === null) return;
    window.location.href = apiUrl(`/api/sessions/${selectedSessionId}/laps/${selectedLap}/export/csv`);
  }, [selectedSessionId, selectedLap]);

  const handleSelectCorner = useCallback(
    (corner) => {
      setActiveCornerId(corner.id);
      if (seekRef.current) {
        seekRef.current(corner.apex.pct);
      }
    },
    []
  );

  const handleOpen3D = useCallback(() => {
    // Open the replay at the corner the user is studying, otherwise at the
    // current telemetry cursor.
    const activeCorner = corners.find((c) => c.id === activeCornerId);
    let focus = activeCorner ? activeCorner.apex.pct : 0;
    if (!activeCorner && hoverIndex !== null && telemetrySamples.length > 1) {
      focus = hoverIndex / (telemetrySamples.length - 1);
    }
    setIs3DFocusPct(focus);
    setIs3DModalOpen(true);
  }, [corners, activeCornerId, hoverIndex, telemetrySamples.length]);

  const activeLap = sessionData?.laps?.find((l) => l.lap_number === selectedLap) || null;
  const compareLapData = sessionData?.laps?.find((l) => l.lap_number === compareLap) || null;
  const hasSessions = sessions.length > 0;

  // A comparison needs a second flying lap. Without one the control is
  // disabled rather than silently doing nothing.
  const canCompare = (sessionData?.laps || []).some(
    (l) => l.lap_number !== selectedLap && l.is_valid && !l.is_pit_lap
  );

  return (
    <div className="app">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0, flexWrap: 'wrap' }}>
          <span className="brand">
            <span className="brand-mark">
              <Activity size={15} />
            </span>
            TelemetryHub
          </span>

          {hasSessions && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Active session
              </span>
              <select
                className="select"
                value={selectedSessionId || ''}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                title="Switch session"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.track_name} · {s.car_name} · {s.driver_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="topbar-tools">
          <button
            type="button"
            className="btn"
            onClick={() => handleOpen3D()}
            disabled={telemetrySamples.length < 10}
            title={
              telemetrySamples.length < 10
                ? 'Load a lap with position data first'
                : 'Open the interactive 3D track replay'
            }
          >
            <Box size={13} color="var(--accent-comp)" />
            3D replay
          </button>

          <button type="button" className="btn btn-primary" onClick={() => setIsImportModalOpen(true)}>
            <Plus size={13} />
            Import session
          </button>
        </div>
      </header>

      <main className="workspace">
        {sessionError && (
          <div className="banner banner-error" role="alert">
            <AlertTriangle size={16} />
            <span>{sessionError}</span>
          </div>
        )}

        {!sessionsLoaded && (
          <div className="panel">
            <div className="panel-body">
              <div className="skeleton" style={{ height: 84 }} />
            </div>
          </div>
        )}

        {sessionsLoaded && !hasSessions && (
          <div className="panel">
            <div className="state">
              <span className="state-title">No sessions yet</span>
              <span className="state-hint">
                Import a Le Mans Ultimate DuckDB recording or a SimTelemetry session to start analysis.
              </span>
              <button type="button" className="btn btn-primary" onClick={() => setIsImportModalOpen(true)}>
                <Plus size={13} />
                Import session
              </button>
            </div>
          </div>
        )}

        {sessionLoading && !sessionData && hasSessions && (
          <div className="panel">
            <div className="panel-body">
              <div className="skeleton" style={{ height: 84 }} />
            </div>
          </div>
        )}

        {sessionData && (
          <>
            <SessionHeader
              session={sessionData}
              activeLapNumber={selectedLap}
              activeLap={activeLap}
              isComparing={isComparing}
              compareLap={compareLap}
              canCompare={canCompare}
              onToggleCompareMode={handleToggleCompareMode}
              onExportCsv={handleExportCsv}
            />

            <div className="split">
              <div className="main-col" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)', minWidth: 0 }}>
                <ErrorBoundary title="Channels panel failed">
                  <TelemetryChart
                    samples={telemetrySamples}
                    compareData={comparisonData}
                    isComparing={isComparing}
                    refLapNumber={selectedLap}
                    compLapNumber={compareLap}
                    hoverIndex={hoverIndex}
                    onHoverIndex={setHoverIndex}
                    loading={telemetryLoading}
                    error={telemetryError}
                    corners={corners}
                    activeCornerId={activeCornerId}
                    onSeekReady={(fn) => {
                      seekRef.current = fn;
                    }}
                  />
                </ErrorBoundary>

                <ErrorBoundary title="Head to head panel failed">
                  <HeadToHeadPanel
                    comparisonData={comparisonData}
                    isComparing={isComparing}
                    refLapNumber={selectedLap}
                    compLapNumber={compareLap}
                    refLapTime={activeLap?.lap_time ?? null}
                    compLapTime={compareLapData?.lap_time ?? null}
                    trackName={sessionData.track_name}
                    hoverIndex={hoverIndex}
                    onHoverIndex={setHoverIndex}
                    sampleCount={telemetrySamples.length}
                    loading={telemetryLoading}
                    error={telemetryError}
                  />
                </ErrorBoundary>

                <ErrorBoundary title="Lap table failed">
                  <LapTable
                    laps={sessionData.laps || []}
                    selectedLapNumber={selectedLap}
                    onSelectLap={handleSelectLap}
                    compareLapNumber={compareLap}
                    onToggleCompare={handleToggleCompare}
                  />
                </ErrorBoundary>
              </div>

              <div className="rail">
                <ErrorBoundary title="Track map failed">
                  <TrackMap
                    samples={telemetrySamples}
                    comparisonData={comparisonData}
                    isComparing={isComparing}
                    hoverIndex={hoverIndex}
                    onHoverIndex={setHoverIndex}
                    trackName={sessionData.track_name}
                    lapNumber={selectedLap}
                    compareLapNumber={compareLap}
                    corners={corners}
                    activeCornerId={activeCornerId}
                    onOpen3D={() => handleOpen3D()}
                    loading={telemetryLoading}
                    error={telemetryError}
                  />
                </ErrorBoundary>

                <ErrorBoundary title="Corner panel failed">
                  <CornerPanel
                    corners={corners}
                    loading={cornersLoading}
                    error={cornersError}
                    activeCornerId={activeCornerId}
                    onSelectCorner={handleSelectCorner}
                    isComparing={isComparing}
                    refLapNumber={selectedLap}
                    compLapNumber={compareLap}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="foot">
        <span>TelemetryHub · Le Mans Ultimate telemetry analysis</span>
        <span>{sessions.length > 0 ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} stored` : 'No sessions stored'}</span>
      </footer>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={(newSessionId) => {
          fetchSessions(newSessionId);
        }}
      />

      <ErrorBoundary title="3D replay failed">
        <Track3DModal
          isOpen={is3DModalOpen}
          onClose={() => setIs3DModalOpen(false)}
          samples={telemetrySamples}
          compSamples={compTelemetrySamples}
          comparisonData={comparisonData}
          isComparing={isComparing}
          trackName={sessionData?.track_name}
          carName={sessionData?.car_name}
          driverName={sessionData?.driver_name}
          refLapNumber={selectedLap}
          compLapNumber={compareLap}
          initialFocusPct={is3DFocusPct}
          corners={corners}
          activeCornerId={activeCornerId}
        />
      </ErrorBoundary>
    </div>
  );
}
