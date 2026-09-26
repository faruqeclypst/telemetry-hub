import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Panel crashed:', error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="panel">
          <div className="state">
            <span style={{ color: 'var(--loss)' }}>
              <AlertTriangle size={20} />
            </span>
            <span className="state-title">{this.props.title || 'This panel failed to render'}</span>
            <span className="state-hint">{error.message}</span>
            <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
