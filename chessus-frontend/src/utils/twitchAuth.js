/**
 * Twitch OAuth2 Authorization Code utilities
 */

const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";

export function getTwitchRedirectUri() {
  return `${window.location.origin}/auth/twitch/callback`;
}

export function startTwitchOAuth() {
  const clientId = process.env.REACT_APP_TWITCH_CLIENT_ID;
  if (!clientId) {
    throw new Error("Twitch OAuth is not configured");
  }

  // Generate a random state value for CSRF protection
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  sessionStorage.setItem("twitch_oauth_state", state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getTwitchRedirectUri(),
    response_type: "code",
    scope: "user:read:email",
    state,
  });

  window.location.href = `${TWITCH_AUTH_URL}?${params.toString()}`;
}
