import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { twitchLogin } from "../../actions/auth";
import { trackLogin } from "../../analytics/GoogleAnalytics";
import { getTwitchRedirectUri } from "../../utils/twitchAuth";

const TwitchCallback = () => {
  const [searchParams] = useSearchParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const returnedState = searchParams.get("state");
    const storedState = sessionStorage.getItem("twitch_oauth_state");

    if (!code) {
      setError("No authorization code received from Twitch.");
      return;
    }

    if (!storedState || returnedState !== storedState) {
      setError("OAuth session invalid or expired. Please try signing in again.");
      return;
    }

    // Clean up the state token
    sessionStorage.removeItem("twitch_oauth_state");

    const redirectUri = getTwitchRedirectUri();

    dispatch(twitchLogin(code, redirectUri))
      .then((data) => {
        trackLogin("twitch");
        navigate(`/profile/${data.result.username}`);
      })
      .catch(() => {
        setError("Failed to sign in with Twitch. Please try again.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: "50px" }}>
        <div
          style={{
            background: "var(--bg-dark)",
            padding: "30px",
            borderRadius: "10px",
            textAlign: "center",
            maxWidth: "400px",
          }}
        >
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
          <a href="/login" style={{ color: "var(--accent-blue)" }}>
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginTop: "50px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <span
          className="spinner-border spinner-border-sm"
          style={{ marginRight: "10px" }}
        ></span>
        Signing in with Twitch...
      </div>
    </div>
  );
};

export default TwitchCallback;
