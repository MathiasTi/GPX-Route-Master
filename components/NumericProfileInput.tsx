import React, { useState, useEffect } from 'react';

interface NumericProfileInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  allowDecimal?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
  onCommit?: () => void;
}

/**
 * Controlled numeric input with local draft buffering so users can freely clear,
 * edit, and type multi-digit or decimal values (including German numpad comma)
 * without mid-typing clamping or focus disruption.
 */
export const NumericProfileInput: React.FC<NumericProfileInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  allowDecimal = false,
  className = '',
  ariaLabel,
  id,
  onCommit
}) => {
  const [draft, setDraft] = useState<string>(() => String(value));
  const [isFocused, setIsFocused] = useState<boolean>(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(value));
    }
  }, [value, isFocused]);

  const clampValue = (num: number): number => {
    const bounded = Math.max(min, Math.min(max, num));
    if (allowDecimal) {
      return Math.round(bounded * 10) / 10;
    }
    return Math.round(bounded);
  };

  const allowNegative = min < 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    if (raw === '') {
      setDraft('');
      return;
    }

    const pattern = allowDecimal
      ? (allowNegative ? /^-?[0-9]*[.,]?[0-9]*$/ : /^[0-9]*[.,]?[0-9]*$/)
      : (allowNegative ? /^-?[0-9]*$/ : /^[0-9]*$/);
    if (!pattern.test(raw)) {
      return;
    }

    setDraft(raw);

    if (raw === '-') {
      return;
    }

    const normalized = allowDecimal ? raw.replace(',', '.') : raw;
    if (allowDecimal && (normalized === '.' || normalized === '-.' || normalized.endsWith('.'))) {
      return;
    }

    const parsed = allowDecimal ? parseFloat(normalized) : parseInt(normalized, 10);
    if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) {
      onChange(allowDecimal ? Math.round(parsed * 10) / 10 : parsed);
    }
  };

  const commitDraft = () => {
    const normalized = allowDecimal ? draft.replace(',', '.').trim() : draft.trim();
    if (!normalized || normalized === '.' || normalized === '-' || normalized === '-.') {
      setDraft(String(value));
      return;
    }

    const parsed = allowDecimal ? parseFloat(normalized) : parseInt(normalized, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }

    const clamped = clampValue(parsed);
    onChange(clamped);
    setDraft(String(clamped));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
      e.currentTarget.blur();
      onCommit?.();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(String(value));
      e.currentTarget.blur();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const normalized = allowDecimal ? draft.replace(',', '.') : draft;
      const current = allowDecimal ? parseFloat(normalized) : parseInt(normalized, 10);
      const base = Number.isNaN(current) ? value : current;
      const delta = e.key === 'ArrowUp' ? step : -step;
      const next = clampValue(base + delta);
      onChange(next);
      setDraft(String(next));
    }
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      aria-label={ariaLabel}
      value={draft}
      onFocus={() => setIsFocused(true)}
      onChange={handleChange}
      onBlur={() => {
        setIsFocused(false);
        commitDraft();
      }}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
};
