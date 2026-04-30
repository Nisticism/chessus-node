import React from "react";

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const modalStyle = {
  background: "#1e2a3a",
  border: "1px solid rgba(220, 80, 80, 0.5)",
  borderRadius: "10px",
  padding: "28px 32px",
  maxWidth: "420px",
  width: "90%",
  textAlign: "center",
};

const titleStyle = {
  color: "#ff6b6b",
  margin: "0 0 14px",
  fontSize: "1.2rem",
};

const messageStyle = {
  color: "#c0d0e0",
  fontSize: "0.92rem",
  lineHeight: 1.6,
  margin: "0 0 24px",
};

const buttonRowStyle = {
  display: "flex",
  gap: "12px",
  justifyContent: "center",
};

const cancelBtnStyle = {
  background: "transparent",
  color: "#c0d0e0",
  border: "2px solid rgba(192, 208, 224, 0.4)",
  borderRadius: "8px",
  padding: "10px 28px",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.5px",
  textTransform: "uppercase",
};

const deleteBtnStyle = {
  background: "#c0392b",
  color: "#fff",
  border: "2px solid #c0392b",
  borderRadius: "8px",
  padding: "10px 28px",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.5px",
  textTransform: "uppercase",
};

const ConfirmDeleteModal = ({ message, onConfirm, onCancel }) => {
  if (!onConfirm) return null;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>⚠️ Delete Account</h3>
        <p style={messageStyle}>
          {message || "Are you sure you want to delete this account? This action cannot be undone."}
        </p>
        <div style={buttonRowStyle}>
          <button style={cancelBtnStyle} onClick={onCancel}>Cancel</button>
          <button style={deleteBtnStyle} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
