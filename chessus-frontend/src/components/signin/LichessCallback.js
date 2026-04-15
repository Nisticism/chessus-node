import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { lichessLogin } from "../../actions/auth";
import { trackLogin } from "../../analytics/GoogleAnalytics";
import { getLichessRedirectUri } from "../../utils/lichessAuth";

const LichessCallback = () => {
  const [searchParams] = useSearchParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const codeVerifier = sessionStorage.getItem("lichess_code_verifier");

    if (!code) {
      setError("No authorization code received from Lichess.");
      return;
    }

    if (!codeVerifier) {
      setError("OAuth session expired. Please try signing in again.");
      return;
    }

    // Clean up
    sessionStorage.removeItem("lichess_code_verifier");

    const redirectUri = getLichessRedirectUri();

    dispatch(lichessLogin(code, codeVerifier, redirectUri))
      .then((data) => {
        trackLogin('lichess');
        navigate(`/profile/${data.result.username}`);
      })
      .catch(() => {
        setError("Failed to sign in with Lichess. Please try again.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: "50px" }}>
        <div style={{ background: "var(--bg-dark)", padding: "30px", borderRadius: "10px", textAlign: "center", maxWidth: "400px" }}>
          <div className="alert alert-danger" role="alert">{error}</div>
          <a href="/login" style={{ color: "var(--accent-blue)" }}>Back to Login</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: "50px" }}>
      <div style={{ textAlign: "center" }}>
        <span className="spinner-border spinner-border-sm" style={{ marginRight: "10px" }}></span>
        Signing in with Lichess...
      </div>
    </div>
  );
};

export default LichessCallback;
