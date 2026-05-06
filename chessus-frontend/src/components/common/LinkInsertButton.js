import React, { useState, useRef, useEffect } from "react";
import styles from "./link-insert-button.module.scss";

const isValidUrl = (url) => {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  // Allow gridgrove.gg, chess.com, and lichess.org links
  return /^https?:\/\/(?:www\.)?(?:gridgrove\.gg|chess\.com|lichess\.org)(?:\/|$)/i.test(url);
};

/**
 * Props:
 *   onInsert(text)    – legacy callback; called with the formatted [label](url) string.
 *   textareaRef       – optional React ref to the target <textarea>.
 *   onChange(newVal)  – optional setter for controlled textareas.
 *
 * When textareaRef + onChange are provided the button:
 *   1. Saves the cursor position when the form opens.
 *   2. Inserts the link text at that position on confirm.
 *   3. Restores focus and advances the cursor past the inserted text.
 */
const LinkInsertButton = ({ onInsert, textareaRef, onChange }) => {
  const [showForm, setShowForm] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  // Saved cursor coords captured when the link form is opened.
  const savedCursor = useRef({ start: null, end: null });
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowForm(false);
      }
    };
    if (showForm) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showForm]);

  const handleOpen = () => {
    if (!showForm) {
      setError('');
      setDisplayText('');
      setUrl('');
      // Snapshot cursor position so we can insert at the right place.
      if (textareaRef?.current) {
        savedCursor.current = {
          start: textareaRef.current.selectionStart ?? textareaRef.current.value.length,
          end:   textareaRef.current.selectionEnd   ?? textareaRef.current.value.length,
        };
      }
    }
    setShowForm((prev) => !prev);
  };

  const handleInsert = () => {
    if (!url.trim()) {
      setError('Please enter a URL.');
      return;
    }
    if (!isValidUrl(url.trim())) {
      setError('Only gridgrove.gg, chess.com, lichess.org links or site paths starting with / are supported.');
      return;
    }
    const label = displayText.trim() || url.trim();
    const linkText = `[${label}](${url.trim()})`;

    if (textareaRef?.current && onChange) {
      const ta = textareaRef.current;
      const start = savedCursor.current.start ?? ta.value.length;
      const end   = savedCursor.current.end   ?? ta.value.length;
      const newVal = ta.value.substring(0, start) + linkText + ta.value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        const newPos = start + linkText.length;
        ta.selectionStart = newPos;
        ta.selectionEnd   = newPos;
        ta.focus();
      });
    } else if (onInsert) {
      onInsert(linkText);
    }

    setShowForm(false);
    setDisplayText('');
    setUrl('');
    setError('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInsert();
    }
    if (e.key === 'Escape') {
      setShowForm(false);
    }
  };

  return (
    <div className={styles["link-insert-wrapper"]} ref={wrapperRef}>
      <button
        type="button"
        className={styles["link-toggle-btn"]}
        onClick={handleOpen}
        title="Insert link"
      >
        🔗
      </button>
      {showForm && (
        <div className={styles["link-form-dropdown"]}>
          <p className={styles["link-note"]}>
            Supported links: gridgrove.gg, chess.com, lichess.org, or relative site paths.
          </p>
          <label className={styles["link-label"]}>
            Display text <span className={styles["optional"]}>(optional)</span>
            <input
              type="text"
              className={styles["link-input"]}
              value={displayText}
              onChange={(e) => setDisplayText(e.target.value)}
              placeholder="e.g. Check out this game"
              maxLength={200}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </label>
          <label className={styles["link-label"]}>
            URL <span className={styles["required"]}>*</span>
            <input
              type="text"
              className={styles["link-input"]}
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(''); }}
              placeholder="https://gridgrove.gg/... or /page-path"
              maxLength={500}
              onKeyDown={handleKeyDown}
            />
          </label>
          {error && <p className={styles["link-error"]}>{error}</p>}
          <div className={styles["link-actions"]}>
            <button
              type="button"
              className={styles["link-insert-btn"]}
              onClick={handleInsert}
            >
              Insert
            </button>
            <button
              type="button"
              className={styles["link-cancel-btn"]}
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkInsertButton;
