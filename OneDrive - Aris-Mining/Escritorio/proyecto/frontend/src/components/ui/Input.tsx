import React from 'react';
import './ui.css';

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
};

export function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  error,
}: Props) {
  return (
    <div className="uiField">
      <label className="uiLabel">{label}</label>
      <input
        className={`uiInput ${error ? 'uiInputError' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      {error ? <div className="uiErrorText">{error}</div> : null}
    </div>
  );
}

