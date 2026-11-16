import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../utils/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="GPX Route Master als App installieren"
      >
        <Download size={13} />
        <span className="hidden xl:inline">App installieren</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          title="Auf iPhone / iPad installieren"
        >
          <Download size={13} />
          <span className="hidden sm:inline">App</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Auf iPhone oder iPad installieren
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Schließen"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                1. Tippe in Safari unten oder oben auf das <strong>Teilen</strong>-Symbol.<br />
                2. Wähle <strong>Zum Home-Bildschirm</strong>, um GPX Route Master als App zu nutzen.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 py-2 text-xs font-semibold cursor-pointer"
              >
                Verstanden
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
