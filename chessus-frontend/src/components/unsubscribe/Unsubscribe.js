import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import axios from "axios";
import API_URL from "../../global/global";

// Public landing page hit from the "Unsubscribe" link in notification digest
// emails. The link itself carries an HMAC token so no login is required.
const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading"); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState("");

  useEffect(() => {
    const uid = searchParams.get("uid");
    const token = searchParams.get("token");
    if (!uid || !token) {
      setStatus("error");
      setMessage("Missing unsubscribe token. Please use the link from your most recent email.");
      return;
    }
    axios
      .get(`${API_URL}email/unsubscribe`, { params: { uid, token } })
      .then((res) => {
        setStatus("success");
        setMessage(res.data?.message || "You've been unsubscribed.");
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err?.response?.data?.message || "Failed to unsubscribe. The link may have expired.");
      });
  }, [searchParams]);

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: "32px", textAlign: "center" }}>
      <h1>Email Notifications</h1>
      {status === "loading" && <p>Processing your request…</p>}
      {status !== "loading" && (
        <>
          <p style={{ fontSize: 18, marginTop: 24 }}>{message}</p>
          <p style={{ marginTop: 32 }}>
            <Link to="/preferences" className="footer-link">
              Manage your email preferences
            </Link>
          </p>
        </>
      )}
    </div>
  );
};

export default Unsubscribe;
