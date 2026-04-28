import React, { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";

// Resolves /profile/id/:userId to the user's CURRENT username and redirects
// to /profile/{username}. This lets stored links (notifications, mentions)
// keep working even if the user changes their username later.
const ProfileById = () => {
  const { userId } = useParams();
  const [state, setState] = useState({ status: "loading", username: null });

  useEffect(() => {
    let cancelled = false;
    const id = parseInt(userId, 10);
    if (!Number.isFinite(id)) {
      setState({ status: "notfound", username: null });
      return;
    }
    axios
      .get(`${API_URL}users/search-by-id?id=${id}`)
      .then((res) => {
        if (cancelled) return;
        const u = res.data?.user;
        if (u && u.username) {
          setState({ status: "found", username: u.username });
        } else {
          setState({ status: "notfound", username: null });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "notfound", username: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state.status === "loading") {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-dim, #888)" }}>
        Loading profile…
      </div>
    );
  }
  if (state.status === "found" && state.username) {
    return <Navigate to={`/profile/${encodeURIComponent(state.username)}`} replace />;
  }
  return (
    <div style={{ padding: "60px 20px", textAlign: "center" }}>
      <h2>Player not found</h2>
      <p style={{ color: "var(--text-dim, #888)" }}>
        The user this link points to no longer exists.
      </p>
    </div>
  );
};

export default ProfileById;
