
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerServiceWorker } from './utils/serviceWorker';
import { ErrorBoundary } from './components/ErrorBoundary';

registerServiceWorker();

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
