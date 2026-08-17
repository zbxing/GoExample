'use client';

import type { ReactNode } from 'react';

interface AccessSelectionGridProps {
  children: ReactNode;
}

interface AccessSelectionOptionCardProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  inputAriaLabel?: string;
  content: ReactNode;
  actions?: ReactNode;
}

interface AccessCustomInputFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function AccessSelectionGrid({ children }: AccessSelectionGridProps) {
  return <div className="accessSelectionGrid">{children}</div>;
}

export function AccessSelectionOptionCard({
  checked,
  disabled = false,
  onChange,
  inputAriaLabel,
  content,
  actions,
}: AccessSelectionOptionCardProps) {
  const className = checked ? 'accessOption accessOptionActive' : 'accessOption';
  const body = (
    <>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={inputAriaLabel}
      />
      <div className="accessOptionCopy">
        {content}
        {actions}
      </div>
    </>
  );

  if (actions) {
    return <div className={className}>{body}</div>;
  }

  return <label className={className}>{body}</label>;
}

export function AccessCustomInputField({
  label,
  value,
  placeholder,
  disabled = false,
  onChange,
}: AccessCustomInputFieldProps) {
  return (
    <label className="field fieldWide">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
