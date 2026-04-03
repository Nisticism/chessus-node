import React, { useRef, useState, useEffect, useCallback } from "react";
import styles from "./piecewizard.module.scss";
import PieceBoardPreview from "./PieceBoardPreview";
import InfoTooltip from "./InfoTooltip";
import NumberInput from "../common/NumberInput";
import { pieceImageLibrary } from "../../assets/piece-images";

// Compute average perceived brightness (0-255) of an image from its data URL
const computeImageBrightness = (dataUrl) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 64; // sample at small size for performance
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      try {
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        let totalBrightness = 0;
        let pixelCount = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 30) continue; // skip mostly transparent pixels
          // Perceived brightness formula (ITU BT.601)
          totalBrightness += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          pixelCount++;
        }
        resolve(pixelCount > 0 ? totalBrightness / pixelCount : 128);
      } catch {
        resolve(128); // fallback if canvas is tainted
      }
    };
    img.onerror = () => resolve(128);
    img.src = dataUrl;
  });
};

const PieceStep1BasicInfo = ({ pieceData, updatePieceData, isEditMode = false, existingImages = [], setExistingImages, currentUser }) => {
  const [visibleImageCount, setVisibleImageCount] = useState(2);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryTargetIndex, setLibraryTargetIndex] = useState(0);
  const [libraryColorFilter, setLibraryColorFilter] = useState('All');
  const [libraryTypeFilter, setLibraryTypeFilter] = useState('All');
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState('All');
  const [libraryStyleFilter, setLibraryStyleFilter] = useState('All');
  const [categorySectionOpen, setCategorySectionOpen] = useState(false);
  const [brightnessWarning, setBrightnessWarning] = useState('');
  const [libraryPage, setLibraryPage] = useState(1);
  const LIBRARY_PAGE_SIZE = 60;
  const fileInputRefs = useRef([]);

  // Check brightness whenever both P1 and P2 previews are set
  const checkBrightness = useCallback(async () => {
    const p1 = pieceData.piece_image_previews?.[0];
    const p2 = pieceData.piece_image_previews?.[1];
    if (!p1 || !p2) {
      setBrightnessWarning('');
      return;
    }
    try {
      const [b1, b2] = await Promise.all([
        computeImageBrightness(p1),
        computeImageBrightness(p2)
      ]);
      if (b1 < b2 - 15) {
        setBrightnessWarning(
          `Player 1's image appears darker (brightness: ${Math.round(b1)}) than Player 2's (brightness: ${Math.round(b2)}). ` +
          `Player 1 should typically use the lighter colored piece.`
        );
      } else {
        setBrightnessWarning('');
      }
    } catch {
      setBrightnessWarning('');
    }
  }, [pieceData.piece_image_previews]);

  useEffect(() => {
    checkBrightness();
  }, [checkBrightness]);

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
      // Extract extension from blob type, handling special cases like 'svg+xml'
      let extension = 'png';
      if (blob.type) {
        const typePart = blob.type.split('/').pop();
        // Handle svg+xml -> svg
        extension = typePart.split('+')[0] || typePart;
      }
      const safeName = libraryImage.name.replace(/[^a-zA-Z0-9]/g, '_');
      const file = new File([blob], `${safeName}.${extension}`, { type: blob.type || 'image/png' });
      
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

  const libraryColorOptions = ['All', 'White', 'Black'];
  const libraryTypeOptions = ['All', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King', 'Other'];
  const libraryCategories = ['All', ...new Set(pieceImageLibrary.map(img => img.category).filter(c => c !== 'Legacy'))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b));

  // Styles available for the selected category
  const libraryStyles = libraryCategoryFilter !== 'All'
    ? ['All', ...new Set(pieceImageLibrary.filter(img => img.category === libraryCategoryFilter && img.style).map(img => img.style))].sort((a, b) => a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b))
    : [];

  // Credit for the selected category/style (if consistent)
  const selectedCredit = (() => {
    if (libraryCategoryFilter === 'All') return null;
    const relevant = pieceImageLibrary.filter(img => {
      if (img.category !== libraryCategoryFilter) return false;
      if (libraryStyleFilter !== 'All' && img.style !== libraryStyleFilter) return false;
      return true;
    });
    const credits = relevant.filter(img => img.credit).map(img => img.credit);
    if (credits.length === 0) return null;
    // Check if all same author
    const firstAuthor = credits[0].author;
    const allSame = credits.every(c => c.author === firstAuthor);
    return allSame ? credits[0] : null;
  })();

  const filteredLibraryImages = pieceImageLibrary.filter(img => {
    if (libraryColorFilter !== 'All' && img.color !== libraryColorFilter) return false;
    if (libraryTypeFilter !== 'All' && img.type !== libraryTypeFilter) return false;
    if (libraryCategoryFilter !== 'All' && img.category !== libraryCategoryFilter) return false;
    if (libraryStyleFilter !== 'All' && img.style !== libraryStyleFilter) return false;
    // Hide legacy images when no filters active (they'll show under "Legacy" category)
    return true;
  });

  const totalLibraryPages = Math.ceil(filteredLibraryImages.length / LIBRARY_PAGE_SIZE);
  const paginatedLibraryImages = filteredLibraryImages.slice(
    (libraryPage - 1) * LIBRARY_PAGE_SIZE,
    libraryPage * LIBRARY_PAGE_SIZE
  );

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

      <div className={styles["form-group"]}>
        <label className={styles["checkbox-label"]}>
          <input
            type="checkbox"
            checked={!currentUser || pieceData.is_anonymous_creator}
            onChange={(e) => handleChange("is_anonymous_creator", e.target.checked)}
            disabled={!currentUser}
          />
          <span>Create anonymously</span>
        </label>
        <p className={styles["field-hint"]}>
          {!currentUser
            ? "You are not logged in — your piece will be created anonymously."
            : "When checked, your username will not be shown publicly as the creator of this piece."}
        </p>
      </div>

      <div className={styles["image-upload-section"]}>
        <h3>Piece Images <InfoTooltip text="Upload images for each player. Player 1 (light) and Player 2 (dark) are required. You can add more variant images for additional players. PNG, JPG, or SVG formats up to 5MB. SVG is recommended for multi-tile pieces as it scales without distortion." /> <span className={styles["required"]}>*</span></h3>
        
        {brightnessWarning && (
          <div className={styles["brightness-warning"]}>
            <span className={styles["warning-icon"]}>⚠️</span>
            {brightnessWarning}
          </div>
        )}
        
        {[...Array(visibleImageCount)].map((_, index) => {
          const preview = pieceData.piece_image_previews?.[index];
          const isRequired = index < 2;
          const label = index === 0 ? "Player 1 Image (Light)" : index === 1 ? "Player 2 Image (Dark)" : `Image ${index + 1}`;
          
          return (
            <div key={index} className={styles["single-image-upload"]} style={{ marginTop: index === 0 ? '1.5rem' : '0' }}>
              <label className={styles["image-label"]}>
                {label} {isRequired && <span className={styles["required"]}>*</span>}
              </label>
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
            Piece Width (squares) <InfoTooltip text="How many squares wide this piece occupies on the board. Standard chess pieces are 1 square wide. Multi-tile pieces can be up to 4 squares wide. The piece's anchor point is the top-left square." />
          </label>
          <NumberInput
            value={pieceData.piece_width}
            onChange={(val) => handleChange("piece_width", val || 1)}
            options={{ min: 1, max: 4, className: styles["form-input-small"] }}
          />
        </div>

        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Piece Height (squares) <InfoTooltip text="How many squares tall this piece occupies on the board. Standard chess pieces are 1 square tall. Multi-tile pieces can be up to 4 squares tall. The piece's anchor point is the top-left square." />
          </label>
          <NumberInput
            value={pieceData.piece_height}
            onChange={(val) => handleChange("piece_height", val || 1)}
            options={{ min: 1, max: 4, className: styles["form-input-small"] }}
          />
        </div>
      </div>

      {(pieceData.piece_width > 1 || pieceData.piece_height > 1) && (
        <p className={styles["field-hint"]} style={{ color: 'var(--accent-orange)', marginBottom: '1rem' }}>
          ⚠️ Multi-tile pieces ({pieceData.piece_width}×{pieceData.piece_height}) cannot hop over other pieces. Movement is calculated from the anchor (top-left square). The entire footprint must fit on the board and not overlap other pieces.
        </p>
      )}

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
              {/* Color filter */}
              <div className={styles["filter-section"]}>
                <span className={styles["filter-label"]}>Color</span>
                <div className={styles["filter-row"]}>
                  {libraryColorOptions.map(color => (
                    <button
                      key={color}
                      type="button"
                      className={`${styles["filter-btn"]} ${libraryColorFilter === color ? styles["active"] : ''}`}
                      onClick={() => { setLibraryColorFilter(color); setLibraryPage(1); }}
                    >
                      {color === 'White' ? <><span className={styles["color-circle"] + ' ' + styles["color-circle-white"]} /> White</> : color === 'Black' ? <><span className={styles["color-circle"] + ' ' + styles["color-circle-black"]} /> Black</> : color}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type filter */}
              <div className={styles["filter-section"]}>
                <span className={styles["filter-label"]}>Type</span>
                <div className={styles["filter-row"]}>
                  {libraryTypeOptions.map(type => (
                    <button
                      key={type}
                      type="button"
                      className={`${styles["filter-btn"]} ${libraryTypeFilter === type ? styles["active"] : ''}`}
                      onClick={() => { setLibraryTypeFilter(type); setLibraryPage(1); }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category filter — collapsible */}
              <div className={styles["filter-section"]}>
                <span 
                  className={styles["filter-label"] + ' ' + styles["filter-label-collapsible"]}
                  onClick={() => setCategorySectionOpen(prev => !prev)}
                >
                  <span className={styles["collapse-chevron"]} style={{ transform: categorySectionOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  Category
                </span>
                {categorySectionOpen && (
                  <div className={styles["filter-row"]}>
                    {libraryCategories.map(category => (
                      <button
                        key={category}
                        type="button"
                        className={`${styles["filter-btn"]} ${libraryCategoryFilter === category ? styles["active"] : ''}`}
                        onClick={() => { setLibraryCategoryFilter(category); setLibraryStyleFilter('All'); setLibraryPage(1); }}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Style filter — only when category is selected */}
              {libraryCategoryFilter !== 'All' && libraryStyles.length > 2 && (
                <div className={styles["filter-section"]}>
                  <span className={styles["filter-label"]}>Style</span>
                  <div className={styles["filter-row"]}>
                    {libraryStyles.map(style => (
                      <button
                        key={style}
                        type="button"
                        className={`${styles["filter-btn"]} ${libraryStyleFilter === style ? styles["active"] : ''}`}
                        onClick={() => { setLibraryStyleFilter(style); setLibraryPage(1); }}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Artist credit */}
              {selectedCredit && (
                <div className={styles["library-credit"]}>
                  <span>
                    Art by <strong>{selectedCredit.author}</strong>
                    {selectedCredit.variantBy && <> · Color variant by <strong>{selectedCredit.variantBy}</strong></>}
                    {selectedCredit.license && <> · {selectedCredit.license}</>}
                    {selectedCredit.source && <> · <a href={selectedCredit.source} target="_blank" rel="noopener noreferrer">Source</a></>}
                  </span>
                </div>
              )}
            </div>
            
            <div className={styles["library-grid"]}>
              {filteredLibraryImages.length === 0 && (
                <div className={styles["library-empty"]}>No images match the selected filters.</div>
              )}
              {paginatedLibraryImages.map((image, idx) => (
                <button
                  key={`${libraryPage}-${idx}`}
                  type="button"
                  className={styles["library-item"]}
                  onClick={() => handleLibrarySelect(image)}
                  title={`${image.name}${image.credit ? `\nArt by ${image.credit.author}` : ''}`}
                >
                  <img src={image.src} alt={image.name} loading="lazy" />
                  <span className={styles["library-item-name"]}>{image.name}</span>
                </button>
              ))}
            </div>
            {totalLibraryPages > 1 && (
              <div className={styles["library-pagination"]}>
                <button type="button" disabled={libraryPage === 1} onClick={() => setLibraryPage(1)}>««</button>
                <button type="button" disabled={libraryPage === 1} onClick={() => setLibraryPage(p => p - 1)}>«</button>
                <span>Page {libraryPage} of {totalLibraryPages} ({filteredLibraryImages.length} images)</span>
                <button type="button" disabled={libraryPage === totalLibraryPages} onClick={() => setLibraryPage(p => p + 1)}>»</button>
                <button type="button" disabled={libraryPage === totalLibraryPages} onClick={() => setLibraryPage(totalLibraryPages)}>»»</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PieceStep1BasicInfo;
