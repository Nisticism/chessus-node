import React from "react";

class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    if (error.name === "ChunkLoadError") {
      return { hasError: true };
    }
    throw error;
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40vh",
          gap: "16px",
          color: "#ccc",
          fontFamily: "inherit"
        }}>
          <p>A new version is available.</p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              border: "1px solid #555",
              background: "#2a2a3e",
              color: "#fff",
              cursor: "pointer"
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ChunkErrorBoundary;
