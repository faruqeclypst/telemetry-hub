import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, AlertCircle, Check, Database, HardDrive, Loader2 } from 'lucide-react';
import { apiUrl } from '../lib/api';

const FOCUSABLE = 'button, input, select, textarea, a[href]';

export default function ImportModal({ isOpen, onClose, onImportSuccess }) {
  const [tab, setTab] = useState('duckdb');
  const [urlOrId, setUrlOrId] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [filePath, setFilePath] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const nodes = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)).filter(
        (n) => !n.disabled
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const firstField = dialogRef.current?.querySelector(FOCUSABLE);
    if (firstField) firstField.focus();

    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const finishImport = (sessionId) => {
    onImportSuccess(sessionId);
    onClose();
  };

  const handleCloudImport = async (e) => {
    e.preventDefault();
    if (!urlOrId.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(apiUrl('/api/sessions/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_or_id: urlOrId.trim(),
          session_token: sessionToken.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Import failed');

      setSuccessMsg(`Imported ${data.track_name || data.session_id}`);
      setTimeout(() => finishImport(data.session_id), 700);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuckdbImport = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let res;
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        res = await fetch(apiUrl('/api/sessions/upload-duckdb'), { method: 'POST', body: formData });
      } else {
        if (!filePath.trim()) throw new Error('Enter a file path or choose a file');
        res = await fetch(apiUrl('/api/sessions/import-duckdb'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: filePath.trim() })
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Import failed');

      setSuccessMsg(`Imported ${data.track_name || data.session_id}`);
      setTimeout(() => finishImport(data.session_id), 700);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(11, 14, 19, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="panel"
        style={{ width: '100%', maxWidth: 540 }}
      >
        <div className="panel-head">
          <span className="panel-title" id="import-title">
            <Upload size={13} />
            Import session
          </span>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close import dialog">
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)' }} role="tablist">
          <TabButton
            active={tab === 'duckdb'}
            onClick={() => setTab('duckdb')}
            icon={<Database size={13} />}
            label="LMU recording"
          />
          <TabButton
            active={tab === 'cloud'}
            onClick={() => setTab('cloud')}
            icon={<Upload size={13} />}
            label="SimTelemetry"
          />
        </div>

        <div className="panel-body">
          {errorMsg && (
            <div className="banner banner-error" role="alert" style={{ marginBottom: '0.85rem' }}>
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              className="banner"
              role="status"
              style={{
                marginBottom: '0.85rem',
                background: 'rgba(63, 214, 140, 0.1)',
                border: '1px solid rgba(63, 214, 140, 0.3)',
                color: 'var(--gain)'
              }}
            >
              <Check size={15} />
              <span>{successMsg}</span>
            </div>
          )}

          {tab === 'duckdb' ? (
            <form onSubmit={handleDuckdbImport}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
                Load a Le Mans Ultimate recording. The parser reads every channel it needs for the
                channels view, the 3D replay and corner detection.
              </p>

              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Recording file
              </label>
              <input
                type="file"
                accept=".duckdb"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  setSelectedFile(file || null);
                  if (file) setFilePath('');
                }}
                style={{ width: '100%', marginBottom: '0.9rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}
              />

              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Or a path on the machine running the API
              </label>
              <input
                type="text"
                className="input"
                placeholder="D:\\recordings\\session.duckdb"
                value={filePath}
                onChange={(e) => {
                  setFilePath(e.target.value);
                  setSelectedFile(null);
                }}
                style={{ width: '100%', marginBottom: '0.9rem' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>
                <HardDrive size={12} />
                {selectedFile ? `Using ${selectedFile.name}` : 'Nothing selected yet'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn" onClick={onClose} disabled={isLoading}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isLoading || (!selectedFile && !filePath.trim())}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={13} />
                      Parsing
                    </>
                  ) : (
                    'Load recording'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCloudImport}>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
                Paste a SimTelemetry session URL or ID. The server downloads the binary telemetry and
                indexes it locally.
              </p>

              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Session URL or ID
              </label>
              <input
                type="text"
                className="input"
                placeholder="2BaXHUMzT9lHtox0"
                value={urlOrId}
                onChange={(e) => setUrlOrId(e.target.value)}
                style={{ width: '100%', marginBottom: '0.9rem' }}
              />

              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Session token, only for private sessions
              </label>
              <input
                type="password"
                className="input"
                placeholder="Leave empty for public sessions"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                style={{ width: '100%', marginBottom: '1rem' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn" onClick={onClose} disabled={isLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isLoading || !urlOrId.trim()}>
                  {isLoading ? (
                    <>
                      <Loader2 size={13} />
                      Fetching
                    </>
                  ) : (
                    'Import session'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.4rem',
        minHeight: 40,
        padding: '0.6rem',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-ref)' : '2px solid transparent',
        background: active ? 'var(--bg-raised)' : 'transparent',
        color: active ? 'var(--text-main)' : 'var(--text-muted)',
        fontFamily: 'inherit',
        fontSize: '0.8rem',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer'
      }}
    >
      {icon}
      {label}
    </button>
  );
}
