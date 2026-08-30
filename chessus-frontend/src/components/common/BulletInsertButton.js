import React from "react";
import { FaListUl } from "react-icons/fa";
import styles from "./emoji-picker-button.module.scss";

/**
 * Exported helper — call this from a textarea's onKeyDown handler to
 * continue bullet lists when the user presses Enter.
 *
 * • If the current line starts with "• " and has content, pressing Enter
 *   inserts a new "• " on the next line.
 * • If the current line is just "• " (empty bullet), pressing Enter removes
 *   the empty bullet and exits bullet mode.
 *
 * @param {KeyboardEvent} e        - the keydown event
 * @param {string}        value    - current string value of the textarea
 * @param {Function}      onChange - (newValue: string) => void setter
 * @returns {boolean} true if the event was handled (Enter was consumed)
 */
export const handleBulletKeyDown = (e, value, onChange) => {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return false;
  const ta = e.target;
  const cursorPos = ta.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
  const currentLine = value.slice(lineStart, cursorPos);
  if (!currentLine.startsWith('\u2022 ')) return false;

  e.preventDefault();
  if (currentLine === '\u2022 ') {
    // Empty bullet — remove it and exit bullet mode
    const newValue = value.slice(0, lineStart) + value.slice(cursorPos);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.selectionStart = lineStart;
      ta.selectionEnd = lineStart;
    });
  } else {
    // Continue bullet on the next line
    const insertion = '\n\u2022 ';
    const newValue = value.slice(0, cursorPos) + insertion + value.slice(cursorPos);
    onChange(newValue);
    requestAnimationFrame(() => {
      const newPos = cursorPos + insertion.length;
      ta.selectionStart = newPos;
      ta.selectionEnd = newPos;
    });
  }
  return true;
};

/**
 * Toolbar button that inserts a bullet point (• ) at the current cursor
 * position in a textarea, or prepends one to the current line.
 *
 * Props:
 *   textareaRef  – React ref to the target <textarea> element
 *   value        – current string value of the textarea
 *   onChange     – (newValue: string) => void  setter called with updated value
 */
const BulletInsertButton = ({ textareaRef, value, onChange }) => {
  const handleInsert = () => {
    const ta = textareaRef?.current;
    const bullet = '\u2022 ';

    if (ta) {
      // Use the DOM's live value so cursor-based insertion is always accurate.
      const actualValue = ta.value;
      const start = ta.selectionStart ?? actualValue.length;
      const end   = ta.selectionEnd   ?? actualValue.length;
      const before = actualValue.slice(0, start);
      const after  = actualValue.slice(end);

      // If we're at the very beginning of a line already, just insert the bullet.
      // Otherwise insert a newline first so the bullet starts on its own line.
      const needsNewline = start > 0 && actualValue[start - 1] !== '\n';
      const insertion = (needsNewline ? '\n' : '') + bullet;
      const newValue = before + insertion + after;
      onChange(newValue);

      // Restore cursor after the inserted bullet
      requestAnimationFrame(() => {
        const newPos = start + insertion.length;
        ta.selectionStart = newPos;
        ta.selectionEnd   = newPos;
        ta.focus();
      });
    } else {
      // Fallback when no ref: just append a bullet line
      const needsNewline = value.length > 0 && value[value.length - 1] !== '\n';
      onChange(value + (needsNewline ? '\n' : '') + bullet);
    }
  };

  return (
    <div className={styles["emoji-picker-wrapper"]}>
      <button
        type="button"
        className={styles["emoji-toggle-btn"]}
        onClick={handleInsert}
        title="Insert bullet list item"
      >
        <FaListUl />
      </button>
    </div>
  );
};

export default BulletInsertButton;
