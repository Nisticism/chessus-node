import React, { useRef, useState } from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";

const PieceStep1BasicInfo = ({ pieceData, updatePieceData, isEditMode = false }) => {
  const [visibleImageCount, setVisibleImageCount] = useState(2);
  const fileInputRefs = useRef([]);

  const handleChange = (field, value) => {
    updatePieceData({ [field]: value });
  };

  const handleImageUpload = (e, index) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        const newImages = [...(pieceData.piece_images || [])];
        const newPreviews = [...(pieceData.piece_image_previews || [])];
        newImages[index] = file;
        newPreviews[index] = reader.result;
        
        updatePieceData({
          piece_images: newImages,
          piece_image_previews: newPreviews
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageClick = (index) => {
    fileInputRefs.current[index]?.click();
  };

  const handleRemoveImage = (index) => {
    const newImages = [...(pieceData.piece_images || [])];
    const newPreviews = [...(pieceData.piece_image_previews || [])];
    newImages[index] = null;
    newPreviews[index] = null;
    
    updatePieceData({
      piece_images: newImages,
      piece_image_previews: newPreviews
    });
    
    if (fileInputRefs.current[index]) {
      fileInputRefs.current[index].value = '';
    }
  };

  const addMoreImages = () => {
    if (visibleImageCount < 8) {
      setVisibleImageCount(visibleImageCount + 1);
    }
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Basic Piece Information</h2>
      <p className={styles["step-description"]}>
        Enter the basic details about your custom piece and upload an image.
      </p>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Piece Name <span className={styles["required"]}>*</span>
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={pieceData.piece_name}
          onChange={(e) => handleChange("piece_name", e.target.value)}
          placeholder="Enter piece name (e.g., Knight, Rook)"
          maxLength={50}
        />
        {pieceData.piece_name && pieceData.piece_name.length < 2 && (
          <p className={styles["validation-error"]}>
            Piece name must be at least 2 characters
          </p>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Description
        </label>
        <textarea
          className={styles["form-textarea"]}
          value={pieceData.piece_description}
          onChange={(e) => handleChange("piece_description", e.target.value)}
          placeholder="Describe your piece and its role in the game"
          rows={4}
          maxLength={1000}
        />
        <div className={styles["char-count"]}>
          {pieceData.piece_description.length} / 1000 characters
        </div>
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Category
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={pieceData.piece_category}
          onChange={(e) => handleChange("piece_category", e.target.value)}
          placeholder="e.g., Major Piece, Minor Piece, Pawn"
          maxLength={50}
        />
        <p className={styles["field-hint"]}>
          Optional category to organize your pieces
        </p>
      </div>

      <div className={styles["image-upload-section"]}>
        <h3>Piece Images <span className={styles["required"]}>*</span></h3>
        <p className={styles["field-hint"]}>
          Upload up to 8 images for this piece (e.g., different player colors). At least one image is required.
        </p>
        
        {[...Array(visibleImageCount)].map((_, index) => {
          const preview = pieceData.piece_image_previews?.[index];
          const label = index === 0 ? "Player 1 Image" : index === 1 ? "Player 2 Image" : `Image ${index + 1}`;
          
          return (
            <div key={index} className={styles["single-image-upload"]} style={{ marginTop: index === 0 ? '1.5rem' : '0' }}>
              <label className={styles["image-label"]}>{label}</label>
              <input
                type="file"
                ref={el => fileInputRefs.current[index] = el}
                onChange={(e) => handleImageUpload(e, index)}
                accept="image/*"
                style={{ display: 'none' }}
              />
              
              <div className={styles["image-upload-area"]}>
                {preview ? (
                  <div className={styles["image-preview-container"]}>
                    <img 
                      src={preview} 
                      alt={`Piece preview ${index + 1}`} 
                      className={styles["piece-image-preview"]}
                    />
                    <div className={styles["image-actions"]}>
                      <button 
                        className={styles["change-image-btn"]} 
                        onClick={() => handleImageClick(index)}
                        type="button"
                      >
                        Change Image
                      </button>
                      <button 
                        className={styles["remove-image-btn"]} 
                        onClick={() => handleRemoveImage(index)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles["image-placeholder"]}>
                    <button 
                      type="button"
                      className={styles["upload-trigger-btn"]}
                      onClick={() => handleImageClick(index)}
                    >
                      <div className={styles["upload-icon"]}>📁</div>
                      <p>Click to upload image</p>
                      <p className={styles["upload-hint"]}>PNG, JPG up to 5MB</p>
                    </button>
                    {index >= 2 && (
                      <button 
                        className={styles["delete-slot-btn"]} 
                        onClick={() => {
                          setVisibleImageCount(visibleImageCount - 1);
                        }}
                        type="button"
                        title="Remove this upload slot"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {visibleImageCount < 8 && (
          <button 
            className={styles["add-more-images-btn"]} 
            onClick={addMoreImages}
            type="button"
          >
            + Add More Images
          </button>
        )}
      </div>

      <div className={styles["form-row"]}>
        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Piece Width (squares)
          </label>
          <input
            type="number"
            className={styles["form-input-small"]}
            value={pieceData.piece_width}
            onChange={(e) => handleChange("piece_width", parseInt(e.target.value) || 1)}
            min="1"
            max="9"
          />
          <p className={styles["field-hint"]}>Usually 1</p>
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Piece Height (squares)
          </label>
          <input
            type="number"
            className={styles["form-input-small"]}
            value={pieceData.piece_height}
            onChange={(e) => handleChange("piece_height", parseInt(e.target.value) || 1)}
            min="1"
            max="9"
          />
          <p className={styles["field-hint"]}>Usually 1</p>
        </div>
      </div>

      {/* Board Preview - Only show in edit mode */}
      {isEditMode && (
        <div className={styles["board-preview-section"]}>
          <h3>Movement & Attack Preview</h3>
          <p className={styles["field-hint"]}>
            Hover over the piece to see movement (blue) and attack (red) patterns based on your settings.
          </p>
          <PieceBoardPreview pieceData={pieceData} />
        </div>
      )}
    </div>
  );
};

export default PieceStep1BasicInfo;
