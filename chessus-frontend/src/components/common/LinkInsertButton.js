import React, { useState, useRef, useEffect } from "react";
import styles from "./link-insert-button.module.scss";

const isValidUrl = (url) => {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  return /^https?:\/\/(?:www\.)?gridgrove\.gg(?:\/|$)/i.test(url);
};

const LinkInsertButton = ({ onInsert }) => {
  const [showForm, setShowForm] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
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
    }
    setShowForm((prev) => !prev);
  };

  const handleInsert = () => {
    if (!url.trim()) {
      setError('Please enter a URL.');
      return;
    }
    if (!isValidUrl(url.trim())) {
      setError('Only gridgrove.gg links or site paths starting with / are supported.');
      return;
    }
    const label = displayText.trim() || url.trim();
    onInsert(`[${label}](${url.trim()})`);
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
            Only gridgrove.gg links are supported at this time.
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
