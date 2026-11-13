import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Layers, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { getApiUrl, apiFetch } from '../utils/api';

interface PasswordGateProps {
  onUnlocked: (token?: string) => void;
}

export const PasswordGate: React.FC<PasswordGateProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch(getApiUrl('/api/auth/unlock'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed })
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.authenticated) {
        onUnlocked(data.token);
      } else {
        setError(data?.error || 'Falsches Passwort. Bitte versuche es erneut.');
      }
    } catch {
      setError('Verbindungsfehler zum Server. Bitte versuche es erneut.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 pb-6 border-b border-slate-800">
          <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
            <Layers className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
              VeloGPX Analyzer
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Geschützter Workspace · Passwort erforderlich
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="app-unlock-password"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
            >
              Zugangspasswort
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
                placeholder="Passwort eingeben..."
                autoFocus
                autoComplete="current-password"
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
            disabled={!password.trim() || isSubmitting}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Wird geprüft...</span>
              </>
            ) : (
              <>
                <span>Workspace entsperren</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 text-center font-mono tabular-nums pt-1">
            Sitzung bleibt auf diesem Gerät für 30 Tage aktiv
          </p>
        </form>
      </div>
    </div>
  );
};
