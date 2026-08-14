import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Download } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetWorkspace = () => {
    try {
      localStorage.removeItem('velo_workspace_tracks');
      localStorage.removeItem('velo_text_markers');
      localStorage.removeItem('velo_workspace_marked_track');
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
    window.location.reload();
  };

  private handleExportRescueData = () => {
    try {
      const tracksData = localStorage.getItem('velo_workspace_tracks') || '[]';
      const blob = new Blob([tracksData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gpx_route_master_rescue_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export rescue data:', e);
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div 
          className="min-h-[300px] w-full flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100"
          id="error-boundary-container"
        >
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 shadow-2xl border border-rose-200 dark:border-rose-900/50 text-center space-y-5">
            <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle className="w-8 h-8 stroke-[2.5]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
                {this.props.fallbackTitle || 'Ein unerwarteter Fehler ist aufgetreten'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {this.props.fallbackMessage || 'Beim Rendern dieser Komponente ist ein Problem aufgetreten. Ihre Daten im Speicher sind nicht verloren.'}
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-left font-mono text-xs text-rose-600 dark:text-rose-400 overflow-x-auto max-h-32 border border-slate-200 dark:border-slate-700 select-all">
                {this.state.error.toString()}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                id="btn-error-reload"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Neu laden</span>
              </button>

              <button
                type="button"
                onClick={this.handleExportRescueData}
                className="py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                title="Workspace als JSON sichern"
                id="btn-error-export-rescue"
              >
                <Download className="w-4 h-4" />
                <span>Rettungs-Export</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={this.handleResetWorkspace}
                className="text-xs font-semibold text-rose-500 hover:text-rose-700 dark:text-rose-400 transition-colors flex items-center justify-center gap-1 mx-auto cursor-pointer"
                id="btn-error-reset"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Workspace-Cache leeren und zurücksetzen</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
