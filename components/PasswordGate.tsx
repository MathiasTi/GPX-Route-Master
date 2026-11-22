import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { getApiUrl, apiFetch } from '../utils/api';
import { BrandLogo } from './BrandLogo';

interface PasswordGateProps {
  onUnlocked: (token?: string) => void;
  setupRequired?: boolean;
}

const MIN_SETUP_PASSWORD_LENGTH = 10;

async function postAuthViaXhr(url: string, password: string): Promise<{ ok: boolean; status: number; data: any }> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.timeout = 15000;
      xhr.onload = () => {
        let data: any = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = null;
        }
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          data
        });
      };
      xhr.onerror = () => reject(new Error(`XHR network error (status ${xhr.status || 0})`));
      xhr.ontimeout = () => reject(new Error('XHR timeout after 15s'));
      xhr.send(JSON.stringify({ password }));
    } catch (err) {
      reject(err);
    }
  });
}

export const PasswordGate: React.FC<PasswordGateProps> = ({ onUnlocked, setupRequired = false }) => {
  const [isSetupMode, setIsSetupMode] = useState(setupRequired);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setIsSetupMode(setupRequired);
  }, [setupRequired]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed || isSubmitting) return;

    if (isSetupMode) {
      if (trimmed.length < MIN_SETUP_PASSWORD_LENGTH) {
        setError(`Das Passwort muss mindestens ${MIN_SETUP_PASSWORD_LENGTH} Zeichen lang sein.`);
        return;
      }
      if (trimmed !== confirmPassword.trim()) {
        setError('Die beiden Passwörter stimmen nicht überein.');
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    const targetUrl = getApiUrl(isSetupMode ? '/api/auth/setup' : '/api/auth/unlock');
    try {
      let ok = false;
      let status = 0;
      let data: any = null;

      try {
        const res = await apiFetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: trimmed })
        });
        ok = res.ok;
        status = res.status;
        data = await res.json().catch(() => null);
      } catch (fetchErr: any) {
        try {
          const xhrRes = await postAuthViaXhr(targetUrl, trimmed);
          ok = xhrRes.ok;
          status = xhrRes.status;
          data = xhrRes.data;
        } catch (xhrErr: any) {
          const fetchMsg = fetchErr?.message || String(fetchErr || 'Fetch error');
          const xhrMsg = xhrErr?.message || String(xhrErr || 'XHR error');
          throw new Error(`${fetchMsg} | ${xhrMsg}`);
        }
      }

      if (ok && data?.authenticated) {
        onUnlocked(data.token);
      } else if (status === 409 && data?.setupRequired) {
        setIsSetupMode(true);
        setError(data?.error || 'Bitte lege zuerst ein Zugangspasswort fest.');
      } else if (status === 409 && isSetupMode) {
        setIsSetupMode(false);
        setError(data?.error || 'Ein Passwort ist bereits eingerichtet. Bitte melde dich an.');
      } else if (status === 429) {
        setError(data?.error || 'Zu viele Versuche. Bitte warte einige Minuten und versuche es erneut.');
      } else if (status === 401 || status === 403) {
        setError(data?.error || 'Falsches Passwort. Bitte versuche es erneut.');
      } else if (!ok) {
        setError(data?.error || `Serverfehler (HTTP ${status}). Bitte versuche es erneut.`);
      } else {
        setError(data?.error || 'Unerwartete Serverantwort beim Entsperren.');
      }
    } catch (err: any) {
      console.error('[PasswordGate] Auth request failed:', err);
      setError('Verbindungsfehler zum Server. Bitte versuche es erneut.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 pb-6 border-b border-slate-800">
          <BrandLogo size={44} variant="badge" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
              GPX Route Master
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSetupMode
                ? 'Ersteinrichtung · Admin-Passwort festlegen'
                : 'Geschützter Workspace · Passwort erforderlich'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {isSetupMode && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-900/60 text-blue-200 text-xs">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <span>
                Lege ein sicheres Passwort (mindestens {MIN_SETUP_PASSWORD_LENGTH} Zeichen) fest, um diesen Workspace für den Internetzugriff abzusichern.
              </span>
            </div>
          )}

          <div>
            <label
              htmlFor="app-unlock-password"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
            >
              {isSetupMode ? 'Neues Zugangspasswort' : 'Zugangspasswort'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="app-unlock-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={isSetupMode ? `Mindestens ${MIN_SETUP_PASSWORD_LENGTH} Zeichen...` : 'Passwort eingeben...'}
                autoFocus
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                disabled={isSubmitting}
                className="w-full pl-10 pr-11 py-3 bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl text-sm font-mono text-white placeholder-slate-600 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {isSetupMode && (
            <div>
              <label
                htmlFor="app-unlock-password-confirm"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                Passwort bestätigen
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="app-unlock-password-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Passwort wiederholen..."
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl text-sm font-mono text-white placeholder-slate-600 outline-none transition-all"
                />
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-red-950/50 border border-red-900/60 text-red-300 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!password.trim() || (isSetupMode && !confirmPassword.trim()) || isSubmitting}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{isSetupMode ? 'Wird eingerichtet...' : 'Wird geprüft...'}</span>
              </>
            ) : (
              <>
                <span>{isSetupMode ? 'Passwort festlegen & starten' : 'Workspace entsperren'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 text-center font-mono tabular-nums pt-1">
            Geschützte Sitzung (HttpOnly-Cookie · 30 Tage gültig)
          </p>
        </form>
      </div>
    </div>
  );
};
