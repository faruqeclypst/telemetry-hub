import React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

export function PanelLoading({ rows = 3, label = 'Loading' }) {
  return (
    <div className="panel-body" role="status" aria-live="polite">
      <span className="visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 34, width: `${100 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PanelEmpty({ title, hint, icon = <Inbox size={20} /> }) {
  return (
    <div className="state">
      <span style={{ color: 'var(--text-dim)' }}>{icon}</span>
      <span className="state-title">{title}</span>
      {hint && <span className="state-hint">{hint}</span>}
    </div>
  );
}

export function PanelError({ title = 'Could not load this panel', hint }) {
  return (
    <div className="state">
      <span style={{ color: 'var(--loss)' }}>
        <AlertTriangle size={20} />
      </span>
      <span className="state-title">{title}</span>
      {hint && <span className="state-hint">{hint}</span>}
    </div>
  );
}

export function InlineSpinner({ label = 'Working' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <Loader2 size={13} style={{ animation: 'spin 0.9s linear infinite' }} />
      {label}
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </span>
  );
}
