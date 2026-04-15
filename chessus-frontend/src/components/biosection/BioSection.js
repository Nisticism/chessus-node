import React, { useState } from "react";
import styles from "./bio-section.module.scss";
import ValidationWarningModal from "../common/ValidationWarningModal";

const BIO_MAX = 500;

const BioSection = ({ 
  bio, 
  isEditable = false, 
  onBioChange = null,
  emptyMessage = "No bio yet. Tell the community about yourself!",
  wrapperClassName = ""
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(bio || "");
  const [validationWarnings, setValidationWarnings] = useState(null);

  const handleEdit = () => {
    setIsEditing(true);
    setEditValue(bio || "");
  };

  const handleSave = () => {
    if (editValue && editValue.length > BIO_MAX) {
      setValidationWarnings([`Bio must be ${BIO_MAX} characters or fewer.`]);
      return;
    }
    if (onBioChange) {
      onBioChange(editValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(bio || "");
  };

  return (
    <div className={`${styles["bio-section"]} ${wrapperClassName}`.trim()}>
      <div className={styles["bio-header"]}>
        <h2 className={styles["card-title"]}>Bio</h2>
        {isEditable && !isEditing && (
          <button 
            type="button"
            className={styles["edit-button"]}
            onClick={handleEdit}
            title="Edit bio"
          >
            ✏️
          </button>
        )}
      </div>

      {isEditing ? (
        <div className={styles["bio-edit-container"]}>
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Tell us about yourself..."
            rows="5"
            className={styles["bio-textarea"]}
            maxLength={BIO_MAX}
            autoFocus
          />
          <div style={{ textAlign: 'right', fontSize: '0.8rem', color: editValue.length > BIO_MAX * 0.9 ? '#e74c3c' : '#999', marginTop: '4px' }}>
            {editValue.length}/{BIO_MAX}
          </div>
          <div className={styles["edit-actions"]}>
            <button 
              type="button"
              className={styles["save-button"]}
              onClick={handleSave}
            >
              Save
            </button>
            <button 
              type="button"
              className={styles["cancel-button"]}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles["bio-content"]}>
          {bio && bio.trim() !== "" && bio !== "null" ? (
            <p className={styles["bio-text"]}>{bio}</p>
          ) : (
            <div className={styles["bio-empty"]}>
              {emptyMessage}
            </div>
          )}
        </div>
      )}
      <ValidationWarningModal warnings={validationWarnings} onClose={() => setValidationWarnings(null)} />
    </div>
  );
};

export default BioSection;
