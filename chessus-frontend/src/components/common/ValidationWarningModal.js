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

const ValidationWarningModal = ({ warnings, onClose }) => {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>⚠️ Please Fix the Following</h3>
        <p style={descStyle}>The following fields need attention before saving:</p>
        <ul style={listStyle}>
          {warnings.map((warning, i) => (
            <li key={i} style={listItemStyle}>
              <span style={{ color: "#ff6b6b", marginRight: "8px", fontWeight: "bold" }}>•</span>
              {warning}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <StandardButton buttonText="OK" onClick={onClose} />
        </div>
      </div>
    </div>
  );
};

export default ValidationWarningModal;
