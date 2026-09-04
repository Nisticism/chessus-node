import React, { useRef, useState } from "react";
import styles from "./piecewizard.module.scss";
import InfoTooltip from "./InfoTooltip";
import ValidationWarningModal from "../common/ValidationWarningModal";
import PiecesService from "../../services/pieces.service";
import {
  PIECE_SOUND_SLOTS,
  PIECE_SOUND_MAX_SECONDS,
  preparePieceSound,
  canUseCustomSounds,
} from "../../helpers/pieceSoundUtils";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const soundSrc = (url) => (url && url.startsWith('http') ? url : `${ASSET_URL}${url}`);

/**
 * Per-piece custom sounds, a Silver Supporter perk.
 *
 * Each slot uploads independently and stores the returned URL on the piece, so
 * the sound survives as an ordinary field when the piece is saved. Clips longer
 * than the limit prompt before anything is uploaded: re-pick a file, or proceed
 * and let us keep the first PIECE_SOUND_MAX_SECONDS seconds.
 */
const PieceSoundUploader = ({ pieceData, updatePieceData, currentUser }) => {
  const allowed = canUseCustomSounds(currentUser);
  const inputRefs = useRef({});
  const previewRef = useRef(null);
  const [busySlot, setBusySlot] = useState(null);
  const [errors, setErrors] = useState({});
  // { file, slot, originalDuration } while we wait for the user to decide.
  const [cropPrompt, setCropPrompt] = useState(null);

  const setSlotError = (slot, message) =>
    setErrors((prev) => ({ ...prev, [slot]: message }));

  const upload = async (slot, column, file, allowCrop) => {
    setBusySlot(slot);
    setSlotError(slot, '');
    try {
      const { blob, wasCropped } = await preparePieceSound(file, { allowCrop });
      const res = await PiecesService.uploadPieceSound(blob, `${slot}.wav`);
      updatePieceData({ [column]: res.data.url });
      if (wasCropped) {
        setSlotError(slot, `Saved the first ${PIECE_SOUND_MAX_SECONDS} seconds.`);
      }
    } catch (err) {
      if (err.code === 'TOO_LONG') {
        setCropPrompt({ file, slot, column, originalDuration: err.originalDuration });
      } else {
        setSlotError(slot, err.response?.data?.message || err.message || 'Upload failed.');
      }
    } finally {
      setBusySlot(null);
    }
  };

  const handlePick = (slot, column) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // let the same file be re-picked later
    if (file) upload(slot, column, file, false);
  };

  const playPreview = (url) => {
    if (previewRef.current) previewRef.current.pause();
    const audio = new Audio(soundSrc(url));
    audio.volume = 0.6;
    previewRef.current = audio;
    audio.play().catch(() => {});
  };

  return (
    <div className={styles["condition-section"]}>
      <h3>Piece Sounds (optional)</h3>
      <p className={styles["field-hint"]}>
        Give this piece its own sounds instead of the site defaults. Clips are limited
        to {PIECE_SOUND_MAX_SECONDS} seconds. Check and checkmate keep their usual
        sounds and play over the top of yours, so a capture that delivers checkmate
        still sounds like checkmate.
      </p>

      {!allowed && (
        <p className={styles["field-hint"]} style={{ color: 'var(--gold-header)' }}>
          ✦ Custom piece sounds are a Silver Supporter perk. Support the site to unlock them.
        </p>
      )}

      {PIECE_SOUND_SLOTS.map(({ key, column, label, hint }) => {
        const current = pieceData[column];
        return (
          <div key={key} className={styles["sub-field"]}>
            <label>
              {label} sound
              <InfoTooltip text={hint} />
            </label>

            <div className={styles["piece-sound-row"]}>
              <input
                ref={(el) => { inputRefs.current[key] = el; }}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={handlePick(key, column)}
              />
              <button
                type="button"
                className={styles["piece-sound-btn"]}
                disabled={!allowed || busySlot === key}
                onClick={() => inputRefs.current[key]?.click()}
              >
                {busySlot === key ? 'Uploading…' : current ? 'Replace' : 'Upload sound'}
              </button>

              {current && (
                <>
                  <button type="button" className={styles["piece-sound-btn"]} onClick={() => playPreview(current)}>
                    ▶ Preview
                  </button>
                  <button
                    type="button"
                    className={styles["piece-sound-btn"]}
                    onClick={() => { updatePieceData({ [column]: '' }); setSlotError(key, ''); }}
                  >
                    Remove
                  </button>
                </>
              )}

              <span className={styles["piece-sound-status"]}>
                {current ? 'Custom sound set' : 'Using the default sound'}
              </span>
            </div>

            {errors[key] && <p className={styles["field-hint"]}>{errors[key]}</p>}
          </div>
        );
      })}

      {cropPrompt && (
        <ValidationWarningModal
          title="⏱️ That clip is too long"
          description={`Piece sounds can be at most ${PIECE_SOUND_MAX_SECONDS} seconds.`}
          warnings={[
            `Your file is ${cropPrompt.originalDuration.toFixed(2)} seconds long.`,
          ]}
          confirmNote={`Choosing "Trim and upload" keeps only the first ${PIECE_SOUND_MAX_SECONDS} seconds of the clip — the rest is discarded. Pick a different file instead if you'd rather trim it yourself.`}
          cancelText="Choose another file"
          confirmText="Trim and upload"
          onClose={() => {
            const { slot } = cropPrompt;
            setCropPrompt(null);
            inputRefs.current[slot]?.click();
          }}
          onConfirm={() => {
            const { file, slot, column } = cropPrompt;
            setCropPrompt(null);
            upload(slot, column, file, true);
          }}
        />
      )}
    </div>
  );
};

export default PieceSoundUploader;
