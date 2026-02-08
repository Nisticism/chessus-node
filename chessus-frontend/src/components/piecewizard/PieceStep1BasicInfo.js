import React, { useRef, useState } from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import NumberInput from "../common/NumberInput";
import { pieceImageLibrary } from "../../assets/piece-images";

const PieceStep1BasicInfo = ({ pieceData, updatePieceData, isEditMode = false, existingImages = [], setExistingImages }) => {
  const [visibleImageCount, setVisibleImageCount] = useState(2);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryTargetIndex, setLibraryTargetIndex] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState('All');
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
      
      // If in edit mode and replacing an existing image, remove it from existingImages
      if (isEditMode && setExistingImages && existingImages.length > 0 && index < existingImages.length) {
        const newExistingImages = [...existingImages];
        newExistingImages.splice(index, 1);
        setExistingImages(newExistingImages);
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
    
    // If in edit mode and removing an existing image (not a new upload)
    // We need to also update existingImages so it's not sent to the server
    if (isEditMode && setExistingImages && existingImages.length > 0) {
      // Check if this index corresponds to an existing image
      // Existing images are at the beginning, new uploads come after
      if (index < existingImages.length && !newImages[index]) {
        // This is an existing image being removed
        const newExistingImages = [...existingImages];
        newExistingImages.splice(index, 1);
        setExistingImages(newExistingImages);
        
        // Also need to remove from previews
        newPreviews.splice(index, 1);
        updatePieceData({
          piece_images: newImages.filter((_, i) => i !== index),
          piece_image_previews: newPreviews
        });
        
        if (fileInputRefs.current[index]) {
          fileInputRefs.current[index].value = '';
        }
        return;
      }
    }
    
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

  const openLibrary = (index) => {
    setLibraryTargetIndex(index);
    setShowLibraryModal(true);
  };

  const handleLibrarySelect = async (libraryImage) => {
    // Fetch the image as a blob to create a File object
    try {
      const response = await fetch(libraryImage.src);
      const blob = await response.blob();
      const file = new File([blob], `${libraryImage.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`, { type: 'image/png' });
      
      // If in edit mode and replacing an existing image, remove it from existingImages
      if (isEditMode && setExistingImages && existingImages.length > 0 && libraryTargetIndex < existingImages.length) {
        const newExistingImages = [...existingImages];
        newExistingImages.splice(libraryTargetIndex, 1);
        setExistingImages(newExistingImages);
      }
      
      const newImages = [...(pieceData.piece_images || [])];
      const newPreviews = [...(pieceData.piece_image_previews || [])];
      newImages[libraryTargetIndex] = file;
      newPreviews[libraryTargetIndex] = libraryImage.src;
      
      updatePieceData({
        piece_images: newImages,
        piece_image_previews: newPreviews
      });
      
      setShowLibraryModal(false);
    } catch (error) {
      console.error('Error selecting library image:', error);
      alert('Failed to select image. Please try again.');
    }
  };

  const libraryCategories = ['All', ...new Set(pieceImageLibrary.map(img => img.category))];
  const filteredLibraryImages = libraryFilter === 'All' 
    ? pieceImageLibrary 
    : pieceImageLibrary.filter(img => img.category === libraryFilter);

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
                        Upload New
                      </button>
                      <button 
                        className={styles["change-image-btn"]} 
                        onClick={() => openLibrary(index)}
                        type="button"
                      >
                        Library
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
                    <div className={styles["image-picker-buttons"]}>
                      <button 
                        type="button"
                        className={styles["upload-trigger-btn"]}
                        onClick={() => handleImageClick(index)}
                      >
                        <div className={styles["upload-icon"]}>📁</div>
                        <p>Upload Image</p>
                        <p className={styles["upload-hint"]}>PNG, JPG up to 5MB</p>
                      </button>
                      <button 
                        type="button"
                        className={styles["library-trigger-btn"]}
                        onClick={() => openLibrary(index)}
                      >
                        <div className={styles["upload-icon"]}>🖼️</div>
                        <p>Browse Library</p>
                        <p className={styles["upload-hint"]}>Choose from collection</p>
                      </button>
                    </div>
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
          <NumberInput
            value={pieceData.piece_width}
            onChange={(val) => handleChange("piece_width", val || 1)}
            options={{ min: 1, max: 9, className: styles["form-input-small"] }}
          />
          <p className={styles["field-hint"]}>Usually 1</p>
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Piece Height (squares)
          </label>
          <NumberInput
            value={pieceData.piece_height}
            onChange={(val) => handleChange("piece_height", val || 1)}
            options={{ min: 1, max: 9, className: styles["form-input-small"] }}
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

      {/* Library Modal */}
      {showLibraryModal && (
        <div className={styles["library-modal-overlay"]} onClick={() => setShowLibraryModal(false)}>
          <div className={styles["library-modal"]} onClick={e => e.stopPropagation()}>
            <div className={styles["library-modal-header"]}>
              <h3>Piece Image Library</h3>
              <button 
                className={styles["library-modal-close"]}
                onClick={() => setShowLibraryModal(false)}
                type="button"
              >
                ×
              </button>
            </div>
            
            <div className={styles["library-filter"]}>
              {libraryCategories.map(category => (
                <button
                  key={category}
                  type="button"
                  className={`${styles["filter-btn"]} ${libraryFilter === category ? styles["active"] : ''}`}
                  onClick={() => setLibraryFilter(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            
            <div className={styles["library-grid"]}>
              {filteredLibraryImages.map((image, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={styles["library-item"]}
                  onClick={() => handleLibrarySelect(image)}
                  title={image.name}
                >
                  <img src={image.src} alt={image.name} />
                  <span className={styles["library-item-name"]}>{image.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PieceStep1BasicInfo;
