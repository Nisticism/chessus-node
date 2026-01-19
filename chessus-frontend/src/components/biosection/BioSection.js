import React, { useState } from "react";
import styles from "./bio-section.module.scss";

const BioSection = ({ 
  bio, 
  isEditable = false, 
  onBioChange = null,
  emptyMessage = "No bio yet. Tell the community about yourself!",
  wrapperClassName = ""
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(bio || "");

  const handleEdit = () => {
    setIsEditing(true);
    setEditValue(bio || "");
  };

  const handleSave = () => {
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
            autoFocus
          />
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
    </div>
  );
};

export default BioSection;
