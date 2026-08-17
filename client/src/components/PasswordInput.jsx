import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ icon: Icon, className = '', ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      {Icon && <Icon size={16} className="password-field-icon" />}
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`form-input password-field-input ${Icon ? 'has-left-icon' : ''} ${className}`}
      />
      <button
        type="button"
        className="password-field-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
