
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary 
      fallbackTitle="GPX Route Master konnte nicht gestartet werden" 
      fallbackMessage="Ein unerwarteter Systemfehler ist aufgetreten. Sie können die Anwendung neu laden oder Ihren Workspace als JSON-Rettungsdatei herunterladen."
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Non-blocking cleanup of stale workers/caches safely after mount
if (typeof window !== 'undefined') {
  const deferTask = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 250));
  deferTask(() => {
    try {
      import('./utils/serviceWorker').then((sw) => {
        sw.registerServiceWorker();
      }).catch(() => {});
    } catch (e) {}
  });
}
