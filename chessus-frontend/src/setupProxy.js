/**
 * CRA dev-server middleware.
 *
 * Fairy-Stockfish ships a pthreads-enabled WebAssembly build that imports
 * memory with shared=1, so loading the engine fails with a LinkError unless
 * we serve the page with a shared WebAssembly.Memory available. That in turn
 * requires the page to be cross-origin isolated.
 *
 *   COOP same-origin    -> isolates the browsing-context group
 *   COEP credentialless -> requires isolation without forcing every third-
 *                          party resource (Google fonts, GA, uploaded images,
 *                          etc.) to opt in via CORP headers. require-corp
 *                          would break those silently; credentialless just
 *                          fetches them without credentials.
 *
 * NOTE: Google sign-in popups open with COOP=same-origin in the opener and
 * Google's domain in the popup, so postMessage between them is blocked. The
 * @react-oauth/google library uses Google Identity Services which prefers the
 * FedCM / iframe flow when popups are isolated, so the impact is limited; if
 * sign-in regresses, swap COEP to require-corp + add CORP headers on uploads
 * (already cross-origin) and any other static assets.
 *
 * Production: the reverse proxy / static host serving the React build MUST
 * send the same two headers. Without them, Fairy Stockfish will fail to load
 * in prod with the same LinkError.
 */
module.exports = function setupMiddlewares(app) {
  // eslint-disable-next-line no-console
  console.log('[setupProxy] Registering COOP/COEP headers for cross-origin isolation (required by Fairy Stockfish WASM)');
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
};
