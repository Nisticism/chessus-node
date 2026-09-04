import React from "react";
import StandardButton from "../standardbutton/StandardButton";

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle = {
  background: "#1e2a3a",
  border: "1px solid rgba(255, 200, 50, 0.4)",
  borderRadius: "10px",
  padding: "24px 28px",
  maxWidth: "440px",
  textAlign: "center",
};

const titleStyle = {
  color: "#ffc832",
  margin: "0 0 12px",
  fontSize: "1.2rem",
};

const descStyle = {
  color: "#c0d0e0",
  fontSize: "0.9rem",
  lineHeight: 1.5,
  margin: "0 0 20px",
};

const listStyle = {
  textAlign: "left",
  listStyle: "none",
  padding: 0,
  margin: "0 0 20px",
};

const listItemStyle = {
  padding: "6px 0",
  color: "#e0e0e0",
  fontSize: "0.9rem",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
};

/**
 * Warning modal.
 *
 * By default it just reports problems with an OK button. Pass `onConfirm` to
 * turn it into a two-choice prompt (e.g. "your clip is too long - re-upload, or
 * proceed and we'll trim it"), with `confirmText` / `cancelText` for the labels.
 */
const ValidationWarningModal = ({
  warnings, onClose, title, description, nonDismissible,
  onConfirm, confirmText = "Proceed", cancelText = "Cancel", confirmNote,
}) => {
  if (!warnings || warnings.length === 0) return null;

  // When `nonDismissible` is set, suppress overlay-click and OK-button dismiss.
  // The caller is expected to clear the modal only when the underlying problem
  // is fixed (e.g. user edits the offending field). Used by the initial-state
  // validator so a player can't bypass a pre-decided starting position.
  const handleOverlayClick = nonDismissible ? undefined : onClose;
  const showOk = !nonDismissible;

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>{title || "⚠️ Please Fix the Following"}</h3>
        <p style={descStyle}>{description || "The following fields need attention before saving:"}</p>
        <ul style={listStyle}>
          {warnings.map((warning, i) => (
            <li key={i} style={listItemStyle}>
              <span style={{ color: "#ff6b6b", marginRight: "8px", fontWeight: "bold" }}>•</span>
              {warning}
            </li>
          ))}
        </ul>
        {confirmNote && (
          <p style={{ ...descStyle, fontSize: "0.82rem", marginBottom: "16px", color: "#9ab0c4" }}>
            {confirmNote}
          </p>
        )}
        {showOk && (
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
            {onConfirm ? (
              <>
                <StandardButton buttonText={cancelText} onClick={onClose} />
                <StandardButton buttonText={confirmText} onClick={onConfirm} />
              </>
            ) : (
              <StandardButton buttonText="OK" onClick={onClose} />
            )}
          </div>
        )}
        {nonDismissible && (
          <p style={{ ...descStyle, fontSize: "0.78rem", marginTop: "10px", marginBottom: 0, color: "#9ab0c4", fontStyle: "italic" }}>
            Adjust the game so the starting position is not already decided, then save again.
          </p>
        )}
      </div>
    </div>
  );
};

export default ValidationWarningModal;
