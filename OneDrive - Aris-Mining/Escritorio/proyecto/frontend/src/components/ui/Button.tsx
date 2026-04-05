import React from 'react';
import './ui.css';

type Props = {
  children: React.ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function Button({
  children,
  type = 'button',
  onClick,
  disabled,
  loading,
}: Props) {
  return (
    <button
      className="uiButton"
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? 'Iniciando sesión…' : children}
    </button>
  );
}

