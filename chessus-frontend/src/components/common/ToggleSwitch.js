import React, { useId } from 'react';
import styles from './ToggleSwitch.module.scss';

/**
 * Reusable toggle switch component.
 *
 * Props:
 *  - checked: boolean
 *  - onChange: (newChecked) => void
 *  - label: string|node — text shown next to the toggle
 *  - hint: string|node — small helper text below the label
 *  - tooltip: node — optional element rendered inline with the label (e.g., InfoTooltip)
 *  - disabled: boolean
 *  - size: 'small' | 'medium' | 'large' (default 'medium')
 *  - id: string (auto-generated if omitted) — links label to checkbox for a11y
 *  - className: extra wrapper class
 *  - labelPlacement: 'right' (default) or 'left' — switch position relative to label
 *  - inline: boolean — when true, label/tooltip live on a single row, no flex-grow spacing
 */
const ToggleSwitch = ({
  checked = false,
  onChange,
  label,
  hint,
  tooltip,
  disabled = false,
  size = 'medium',
  id,
  className = '',
  labelPlacement = 'right',
  inline = false,
  ariaLabel,
}) => {
  const generatedId = useId();
  const inputId = id || `toggle-${generatedId}`;

  const handleClick = (e) => {
    if (disabled) return;
    // Avoid double-firing when the native input onChange will also fire
    if (e.target.tagName === 'INPUT') return;
    onChange?.(!checked);
  };

  const handleInputChange = (e) => {
    if (disabled) return;
    onChange?.(e.target.checked);
  };

  const wrapperClasses = [
    styles.toggleField,
    styles[`size-${size}`],
    inline ? styles.inline : '',
    disabled ? styles.disabled : '',
    labelPlacement === 'left' ? styles.labelLeft : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const renderLabelBlock = () => {
    if (!label && !hint && !tooltip) return null;
    return (
      <div className={styles.labelBlock}>
        <span className={styles.labelRow}>
          {label && (
            <label htmlFor={inputId} className={styles.label}>
              {label}
            </label>
          )}
          {tooltip && <span className={styles.tooltipSlot}>{tooltip}</span>}
        </span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
    );
  };

  const switchEl = (
    <span className={`${styles.switch} ${checked ? styles.on : ''}`} aria-hidden="true">
      <span className={styles.knob} />
    </span>
  );

  return (
    <div data-toggleswitch="" className={wrapperClasses} onClick={handleClick} role="presentation">
      <input
        id={inputId}
        type="checkbox"
        className={styles.nativeInput}
        checked={!!checked}
        onChange={handleInputChange}
        disabled={disabled}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      />
      {labelPlacement === 'left' ? (
        <>
          {renderLabelBlock()}
          {switchEl}
        </>
      ) : (
        <>
          {switchEl}
          {renderLabelBlock()}
        </>
      )}
    </div>
  );
};

export default ToggleSwitch;
