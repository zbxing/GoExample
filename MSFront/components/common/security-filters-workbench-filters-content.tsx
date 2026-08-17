'use client';

import { Search } from 'lucide-react';

interface SecurityWorkbenchOption {
  value: string;
  label: string;
}

interface SecurityFiltersWorkbenchFiltersContentProps {
  focusLabel: string;
  focusValue: string;
  focusOptions: readonly SecurityWorkbenchOption[];
  onFocusChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  roleLabel: string;
  roleValue: string;
  roleOptions: readonly SecurityWorkbenchOption[];
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  statusLabel: string;
  statusValue: string;
  statusOptions: readonly SecurityWorkbenchOption[];
}

export function SecurityFiltersWorkbenchFiltersContent({
  focusLabel,
  focusOptions,
  focusValue,
  onFocusChange,
  onRoleChange,
  onSearchChange,
  onStatusChange,
  roleLabel,
  roleOptions,
  roleValue,
  searchLabel,
  searchPlaceholder,
  searchValue,
  statusLabel,
  statusOptions,
  statusValue,
}: SecurityFiltersWorkbenchFiltersContentProps) {
  return (
    <div className="portfolioFilters accessFilterGrid">
      <label className="filterField filterFieldWide">
        <span>{searchLabel}</span>
        <div className="filterFieldInline">
          <Search size={16} />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      </label>
      <label className="filterField">
        <span>{focusLabel}</span>
        <select value={focusValue} onChange={(event) => onFocusChange(event.target.value)}>
          {focusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filterField">
        <span>{statusLabel}</span>
        <select value={statusValue} onChange={(event) => onStatusChange(event.target.value)}>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="filterField">
        <span>{roleLabel}</span>
        <select value={roleValue} onChange={(event) => onRoleChange(event.target.value)}>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
