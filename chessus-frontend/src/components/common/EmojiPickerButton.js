import React, { useState, useRef, useEffect } from "react";
import EmojiPicker from "emoji-picker-react";
import styles from "./emoji-picker-button.module.scss";

const EmojiPickerButton = ({ onEmojiSelect }) => {
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
    onEmojiSelect(emojiData.emoji);
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
