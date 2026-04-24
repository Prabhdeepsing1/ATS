import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/layout.css';

export const Header = () => {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-logo">
          <Link to="/" className="logo-link">
            <div className="logo-icon">Q</div>
            <span className="logo-text">QueueGate</span>
          </Link>
        </div>
        <nav className="header-nav">
          <Link to="/" className="nav-link">Dashboard</Link>
          <a href="https://github.com/Prabhdeepsing1/ATS/blob/main/README.md" className="nav-link" target="_blank" rel="noopener noreferrer">
            Docs
          </a>
        </nav>
      </div>
    </header>
  );
};

export const PageHeader = ({ title, subtitle, action }) => {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
};

export const Card = ({ children, className = '' }) => {
  return <div className={`card ${className}`}>{children}</div>;
};

export const CardHeader = ({ title, subtitle, actions }) => {
  return (
    <div className="card-header">
      <div>
        <h3 style={{ marginBottom: '4px' }}>{title}</h3>
        {subtitle && <p className="text-muted" style={{ fontSize: '13px', marginBottom: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
};

export const CardBody = ({ children }) => {
  return <div className="card-body">{children}</div>;
};

export const CardFooter = ({ children }) => {
  return <div className="card-footer">{children}</div>;
};

export const Modal = ({ isOpen, onClose, title, children, actions, size = 'md' }) => {
  if (!isOpen) return null;

  const sizeClass = {
    sm: 'modal-sm',
    md: 'modal-md',
    lg: 'modal-lg',
  }[size];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${sizeClass}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && (
          <div className="modal-footer">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  block = false,
  type = 'button',
  onClick,
  className = '',
  ...props
}) => {
  const sizeClass = `btn-${size}`;
  const variantClass = `btn-${variant}`;
  const blockClass = block ? 'btn-block' : '';

  return (
    <button
      type={type}
      className={`btn ${variantClass} ${sizeClass} ${blockClass} ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};

export const Badge = ({ children, variant = 'info' }) => {
  return <span className={`badge badge-${variant}`}>{children}</span>;
};

export const Status = ({ type, label }) => {
  return (
    <div className="status">
      <div className={`status-dot ${type}`}></div>
      <span>{label}</span>
    </div>
  );
};

export const Spinner = () => {
  return <div className="spinner"></div>;
};

export const Loading = ({ text = 'Loading...' }) => {
  return (
    <div className="loading">
      <Spinner />
      <span>{text}</span>
    </div>
  );
};

export const Alert = ({ variant = 'info', message, onClose, icon = null }) => {
  return (
    <div className={`alert alert-${variant}`}>
      {icon && <span>{icon}</span>}
      <div style={{ flex: 1 }}>
        <p style={{ marginBottom: 0 }}>{message}</p>
      </div>
      {onClose && (
        <button
          className="btn btn-sm"
          style={{ background: 'transparent', padding: 0, minWidth: 'auto' }}
          onClick={onClose}
        >
          ×
        </button>
      )}
    </div>
  );
};

export const Table = ({ columns, data, loading = false }) => {
  if (loading) {
    return <Loading text="Loading data..." />;
  }

  if (data.length === 0) {
    return (
      <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
        <p>No data available</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const Input = ({ label, placeholder, value, onChange, type = 'text', error = '', ...props }) => {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '12px', marginTop: '4px', marginBottom: 0 }}>{error}</p>}
    </div>
  );
};

export const Select = ({ label, options, value, onChange, ...props }) => {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
        <option value="">Select an option</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export const Textarea = ({ label, placeholder, value, onChange, rows = 4, ...props }) => {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        {...props}
      />
    </div>
  );
};

export const EmptyState = ({ icon, title, description, action }) => {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--spacing-2xl) var(--spacing-lg)' }}>
      {icon && <div style={{ fontSize: '48px', marginBottom: 'var(--spacing-md)' }}>{icon}</div>}
      <h3>{title}</h3>
      {description && <p className="text-muted">{description}</p>}
      {action && <div style={{ marginTop: 'var(--spacing-lg)' }}>{action}</div>}
    </div>
  );
};
