import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import styles from './physicalboard.module.scss';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const BORDER_WOODS = [
  'No preference',
  'Walnut',
  'Mahogany',
  'Cherry',
  'Oak',
  'Maple',
  'Rosewood',
  'Ebony',
  'Wenge',
  'Teak',
  'Other (describe in message)',
];

const LIGHT_WOODS = [
  'No preference',
  'Maple',
  'Ash',
  'Birch',
  'Beech',
  'Sycamore',
  'Holly',
  'Boxwood',
  'Spruce',
  'Other (describe in message)',
];

const DARK_WOODS = [
  'No preference',
  'Walnut',
  'Rosewood',
  'Ebony',
  'Mahogany',
  'Wenge',
  'Padauk',
  'Cherry',
  'Teak',
  'Other (describe in message)',
];

// Dimension options for length/width dropdowns (max 30 in / 76 cm ≈ 30 in)
const INCH_OPTIONS = Array.from({ length: 27 }, (_, i) => i + 4); // 4" – 30"
const CM_OPTIONS = Array.from({ length: 67 }, (_, i) => i + 10); // 10 cm – 76 cm

const PLACEHOLDER_IMAGES = [
  { src: '/board-images/PXL_20201226_234922519.jpg', alt: 'Handcrafted board with algebraic notation', caption: 'Handcrafted board with algebraic notation' },
  { src: '/board-images/PXL_20240730_180404527.jpg', alt: 'Custom chess board with curly maple and walnut', caption: 'Custom chess board with curly maple and walnut' },
  { src: '/board-images/chess-table-top.png', alt: 'Chess table in progress', caption: 'Chess table in progress' },
  { src: '/board-images/custom-board.png', alt: 'Custom 11x11 board example', caption: 'Custom 11x11 board example' },
];

const PhysicalBoardRequest = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [formData, setFormData] = useState({
    name: currentUser?.username || '',
    email: currentUser?.email || '',
    borderWood: 'No preference',
    lightSquareWood: 'No preference',
    darkSquareWood: 'No preference',
    dimensionUnit: 'in',
    boardLength: '',
    boardWidth: '',
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!gameId) return;
    fetch(`${API_URL}/api/games/${gameId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load game');
        return r.json();
      })
      .then((data) => {
        setGame(data);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError('Could not load game details.');
        setLoading(false);
        console.error(err);
      });
  }, [gameId]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);

    const boardWidth = game?.board_width || '?';
    const boardHeight = game?.board_height || '?';
    const gameName = game?.game_name || `Game #${gameId}`;

    const subject = `Physical Board Request — ${gameName}`;

    const dimLine = (formData.boardLength && formData.boardWidth)
      ? `${formData.boardLength} × ${formData.boardWidth} ${formData.dimensionUnit}`
      : '(not specified)';

    const body = `Physical Board Request
======================
Game: ${gameName} (ID: ${gameId})
Grid Size: ${boardWidth} × ${boardHeight} squares
Requester: ${formData.name}
Email: ${formData.email}

Requested Physical Dimensions
------------------------------
${dimLine}

Wood Choices
------------
Border:        ${formData.borderWood}
Light Squares: ${formData.lightSquareWood}
Dark Squares:  ${formData.darkSquareWood}

Message
-------
${formData.message || '(none)'}
`;

    try {
      const response = await fetch(`${API_URL}/api/physical-board-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          subject,
          message: body,
        }),
      });

      if (!response.ok) throw new Error('Failed to send request');

      setSubmitted(true);
      setFormData((prev) => ({ ...prev, message: '' }));
    } catch (err) {
      setError('Failed to send your request. Please try again or email support@gridgrove.gg directly.');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <p className={styles.loadingText}>Loading game details…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.container}>
        <p className={styles.errorText}>{loadError}</p>
      </div>
    );
  }

  const boardWidth = game?.board_width || '?';
  const boardHeight = game?.board_height || '?';
  const gameName = game?.game_name || `Game #${gameId}`;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <button className={styles.backBtn} onClick={() => navigate(`/games/${gameId}`)}>
          ← Back to {gameName}
        </button>

        <h1 className={styles.title}>🪵 Request a Physical Board</h1>
        <p className={styles.subtitle}>
          Get a custom handcrafted wooden chess board made specifically for your game,{' '}
          mailed right to your door.
        </p>

        {/* Gallery placeholder */}
        <div className={styles.gallerySection}>
          <h2 className={styles.sectionTitle}>Example Boards</h2>
          <p className={styles.galleryNote}>
            A sample of handcrafted boards — each one built to order. More options can be discussed when we reply with your quote.
          </p>
          <div className={styles.gallery}>
            {PLACEHOLDER_IMAGES.map((img, i) => (
              <div key={i} className={styles.galleryItem}>
                <img
                  src={img.src}
                  alt={img.alt}
                  className={styles.galleryImg}
                />
                <p className={styles.galleryCaption}>{img.caption}</p>
              </div>
            ))}
          </div>
        </div>

        <hr className={styles.divider} />

        {/* Board details */}
        <div className={styles.boardInfo}>
          <h2 className={styles.sectionTitle}>Your Board Details</h2>
          <div className={styles.boardInfoGrid}>
            <div className={styles.boardInfoItem}>
              <span className={styles.boardInfoLabel}>Game</span>
              <span className={styles.boardInfoValue}>{gameName}</span>
            </div>
            <div className={styles.boardInfoItem}>
              <span className={styles.boardInfoLabel}>Grid Size</span>
              <span className={styles.boardInfoValue}>{boardWidth} × {boardHeight} squares</span>
            </div>
            <div className={styles.boardInfoItem}>
              <span className={styles.boardInfoLabel}>Square Count</span>
              <span className={styles.boardInfoValue}>{boardWidth * boardHeight} squares</span>
            </div>
          </div>
          <p className={styles.boardInfoNote}>
            We'll confirm exact physical dimensions (square size in inches, total board size,
            border width) and shipping costs when we reply with your quote.
          </p>
        </div>

        <hr className={styles.divider} />

        {/* Quote note */}
        <div className={styles.quoteNote}>
          <span className={styles.quoteNoteIcon}>💬</span>
          <div>
            <strong>How it works:</strong> Fill out the form below and we'll get back to you
            with a custom quote based on your board size, wood selection, and any additional
            requests. No payment is required upfront.
          </div>
        </div>

        <hr className={styles.divider} />

        {/* Form */}
        <h2 className={styles.sectionTitle}>Request Form</h2>

        {submitted ? (
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <h3>Request Sent!</h3>
            <p>
              Thanks for your interest! We'll review your request and reply to{' '}
              <strong>{formData.email}</strong> with a quote as soon as possible.
            </p>
            <button className={styles.backBtn} onClick={() => navigate(`/games/${gameId}`)}>
              Back to Game
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="name">Your Name or GG Username *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter your name or GridGrove username"
                  className={styles.formInput}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="email">Your Email *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="you@example.com"
                  className={styles.formInput}
                />
              </div>
            </div>

            <h3 className={styles.woodSectionTitle}>Requested Dimensions <span className={styles.optionalTag}>(optional)</span></h3>
            <p className={styles.woodSectionHint}>
              Specify the physical size you'd like for your board. This doesn't need to match the number
              of squares — e.g. a 5×5 grid board can still be 12″×12″ or larger.
              Leave blank if you'd like us to recommend a size.
            </p>
            <div className={styles.dimensionRow}>
              <div className={styles.formGroup} style={{ flex: '0 0 auto', minWidth: 120 }}>
                <label htmlFor="dimensionUnit">Unit</label>
                <select
                  id="dimensionUnit"
                  name="dimensionUnit"
                  value={formData.dimensionUnit}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  <option value="in">Inches (in)</option>
                  <option value="cm">Centimeters (cm)</option>
                </select>
              </div>
              <div className={styles.formGroup} style={{ flex: 1 }}>
                <label htmlFor="boardLength">Length ({formData.dimensionUnit})</label>
                <select
                  id="boardLength"
                  name="boardLength"
                  value={formData.boardLength}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  <option value="">— Select —</option>
                  {(formData.dimensionUnit === 'in' ? INCH_OPTIONS : CM_OPTIONS).map((v) => (
                    <option key={v} value={v}>{v} {formData.dimensionUnit}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup} style={{ flex: 1 }}>
                <label htmlFor="boardWidth">Width ({formData.dimensionUnit})</label>
                <select
                  id="boardWidth"
                  name="boardWidth"
                  value={formData.boardWidth}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  <option value="">— Select —</option>
                  {(formData.dimensionUnit === 'in' ? INCH_OPTIONS : CM_OPTIONS).map((v) => (
                    <option key={v} value={v}>{v} {formData.dimensionUnit}</option>
                  ))}
                </select>
              </div>
            </div>

            <h3 className={styles.woodSectionTitle}>Wood Selections <span className={styles.optionalTag}>(optional)</span></h3>
            <p className={styles.woodSectionHint}>
              Choose your preferred wood types for each part of the board. Select "No preference" to
              let us choose. Final availability confirmed at quote time.
            </p>

            <div className={styles.formRow3}>
              <div className={styles.formGroup}>
                <label htmlFor="borderWood">Border Wood</label>
                <select
                  id="borderWood"
                  name="borderWood"
                  value={formData.borderWood}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  {BORDER_WOODS.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="lightSquareWood">Light Squares Wood</label>
                <select
                  id="lightSquareWood"
                  name="lightSquareWood"
                  value={formData.lightSquareWood}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  {LIGHT_WOODS.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="darkSquareWood">Dark Squares Wood</label>
                <select
                  id="darkSquareWood"
                  name="darkSquareWood"
                  value={formData.darkSquareWood}
                  onChange={handleChange}
                  className={styles.formSelect}
                >
                  {DARK_WOODS.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="message">Additional Notes / Customization Requests</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={5}
                placeholder="Any special requests, finish preferences, engraving ideas, shipping address country, etc."
                className={styles.formTextarea}
              />
            </div>

            {error && (
              <div className={styles.errorBox}>
                <span>⚠ </span>{error}
              </div>
            )}

            <div className={styles.formFooter}>
              <p className={styles.formFooterNote}>
                Submitting this form sends your request to{' '}
                <strong>support@gridgrove.gg</strong>. We'll reply with a quote — no
                payment or commitment required.
              </p>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={sending}
              >
                {sending ? 'Sending Request…' : '📬 Send Request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default PhysicalBoardRequest;
