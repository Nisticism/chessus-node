import React, { useState, useRef, useEffect } from "react";
import EmojiPicker from "emoji-picker-react";
import styles from "./emoji-picker-button.module.scss";

/**
 * Props:
 *   onEmojiSelect(emoji)  – legacy callback; called with the emoji char.
 *   textareaRef           – optional React ref to the target <textarea>.
 *   onChange(newValue)    – optional setter for controlled textareas.
 *
 * When textareaRef + onChange are provided the button inserts the emoji at
 * the current cursor position and restores focus.  When only onEmojiSelect
 * is provided the original append behaviour is kept.
 */
const EmojiPickerButton = ({ onEmojiSelect, textareaRef, onChange }) => {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    if (showPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  const handleEmojiClick = (emojiData) => {
    const emoji = emojiData.emoji;
    setShowPicker(false);

    if (textareaRef?.current && onChange) {
      const ta = textareaRef.current;
      const start = ta.selectionStart ?? ta.value.length;
      const end   = ta.selectionEnd   ?? ta.value.length;
      const newVal = ta.value.substring(0, start) + emoji + ta.value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = start + emoji.length;
        ta.selectionEnd   = start + emoji.length;
        ta.focus();
      });
    } else if (onEmojiSelect) {
      onEmojiSelect(emoji);
    }
  };

  return (
    <div className={styles["emoji-picker-wrapper"]} ref={pickerRef}>
      <button
        type="button"
        className={styles["emoji-toggle-btn"]}
        onClick={() => setShowPicker(!showPicker)}
        title="Insert emoji"
      >
        😀
      </button>
      {showPicker && (
        <div className={styles["emoji-picker-dropdown"]}>
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            theme="dark"
            width={320}
            height={400}
            searchPlaceholder="Search emojis..."
            previewConfig={{ showPreview: false }}
            lazyLoadEmojis={true}
          />
        </div>
      )}
    </div>
  );
};

export default EmojiPickerButton;
