import React, { useState, useEffect, useRef } from 'react';
import { parseFreeNumberInput } from '../utils/workspaceQoL';

export interface FreeMetricInputProps {
  value: number;
  onCommit: (nextValue: number) => void;
  allowZero?: boolean;
  allowDecimal?: boolean;
  precision?: number;
  className?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Unconstrained numeric input that lets users freely clear, edit, and type decimal or
 * integer values (with `.` or `,`) without mid-typing clamping. Commits on Enter or blur
 * and restores the last valid value if the field is left empty or invalid.
 */
export const FreeMetricInput: React.FC<FreeMetricInputProps> = ({
  value,
  onCommit,
  allowZero = false,
  allowDecimal = false,
  precision = 1,
  className = '',
  id,
  placeholder,
  ariaLabel
}) => {
  const [draft, setDraft] = useState<string>(() => (Number.isFinite(value) ? String(value) : ''));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(Number.isFinite(value) ? String(value) : '');
    }
  }, [value]);

  const commitDraft = () => {
    const parsed = parseFreeNumberInput(draft, { allowZero, allowDecimal, precision });
    if (parsed !== null) {
      setDraft(String(parsed));
      if (parsed !== value) {
        onCommit(parsed);
      }
    } else {
      setDraft(Number.isFinite(value) ? String(value) : '');
    }
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={(e) => {
        isFocusedRef.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        commitDraft();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(Number.isFinite(value) ? String(value) : '');
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};
