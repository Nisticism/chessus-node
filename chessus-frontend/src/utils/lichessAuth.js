/**
 * Lichess OAuth2 PKCE utilities
 */

const LICHESS_AUTH_URL = "https://lichess.org/oauth";

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function getLichessRedirectUri() {
  return `${window.location.origin}/auth/lichess/callback`;
}

export async function startLichessOAuth() {
  const clientId = process.env.REACT_APP_LICHESS_CLIENT_ID;
  if (!clientId) {
    throw new Error("Lichess OAuth is not configured");
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = getLichessRedirectUri();

  // Store verifier in sessionStorage for the callback
  sessionStorage.setItem("lichess_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    scope: "",
  });

  window.location.href = `${LICHESS_AUTH_URL}?${params.toString()}`;
}
