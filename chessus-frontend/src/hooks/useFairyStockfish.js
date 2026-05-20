import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useFairyStockfish
 *
 * Manages the lifecycle of a single Fairy-Stockfish Web Worker. The engine
 * runs in the browser, so server RAM is unaffected. The hook exposes:
 *
 *   startEngine(variantIni, variantName) -> Promise<void>
 *   getBestMove(fen, moveHistoryUci, movetime) -> Promise<string>  // UCI move
 *   stopEngine() -> void
 *   engineReady: boolean
 *   engineError: string | null
 */
export default function useFairyStockfish() {
  const workerRef = useRef(null);
  const pendingBestMove = useRef(null);
  const readyResolveRef = useRef(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState(null);
  // Latest info-line snapshot: { depth, seldepth, score, nps, pv } during search.
  const [searchInfo, setSearchInfo] = useState(null);
  const searchInfoRef = useRef(null);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(
      new URL('../workers/fairyStockfishWorker.js', import.meta.url)
    );
    worker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.type === 'ready') {
        setEngineReady(true);
        setEngineError(null);
        if (readyResolveRef.current) {
          readyResolveRef.current.resolve();
          readyResolveRef.current = null;
        }
      } else if (msg.type === 'bestmove') {
        if (pendingBestMove.current) {
          pendingBestMove.current.resolve(msg.move);
          pendingBestMove.current = null;
        }
      } else if (msg.type === 'info') {
        // Throttle React renders: only update state when depth changes.
        const prev = searchInfoRef.current;
        if (!prev || prev.depth !== msg.depth) {
          searchInfoRef.current = msg;
          setSearchInfo(msg);
        } else {
          searchInfoRef.current = msg;
        }
      } else if (msg.type === 'error') {
        setEngineError(msg.message || 'Unknown engine error');
        if (readyResolveRef.current) {
          readyResolveRef.current.reject(new Error(msg.message));
          readyResolveRef.current = null;
        }
        if (pendingBestMove.current) {
          pendingBestMove.current.reject(new Error(msg.message));
          pendingBestMove.current = null;
        }
      }
    });
    workerRef.current = worker;
    return worker;
  }, []);

  const startEngine = useCallback((variantIni, variantName, options = {}) => {
    const w = ensureWorker();
    return new Promise((resolve, reject) => {
      readyResolveRef.current = { resolve, reject };
      w.postMessage({
        type: 'init',
        variantIni,
        variantName,
        skillLevel: options.skillLevel,
      });
    });
  }, [ensureWorker]);

  // searchOptions: { movetime?, depth?, skillLevel?, threads?, hash?, gameKey?,
  //                  wtime?, btime?, winc?, binc?, movestogo?, side? }
  const getBestMove = useCallback((fen, moveHistoryUci, searchOptions) => {
    const w = ensureWorker();
    // Reset info snapshot at the start of each search so consumers see a clean
    // depth=0 → climbing trace per move instead of stale data from the last one.
    searchInfoRef.current = null;
    setSearchInfo(null);
    return new Promise((resolve, reject) => {
      pendingBestMove.current = { resolve, reject };
      // Back-compat: previous callers passed a numeric movetime as the 3rd arg.
      const opts = (searchOptions && typeof searchOptions === 'object')
        ? searchOptions
        : { movetime: searchOptions };
      w.postMessage({
        type: 'bestmove',
        fen,
        moveHistoryUci,
        movetime: opts.movetime,
        depth: opts.depth,
        skillLevel: opts.skillLevel,
        threads: opts.threads,
        hash: opts.hash,
        gameKey: opts.gameKey,
        wtime: opts.wtime,
        btime: opts.btime,
        winc: opts.winc,
        binc: opts.binc,
        movestogo: opts.movestogo,
        side: opts.side,
      });
    });
  }, [ensureWorker]);

  const stopEngine = useCallback(() => {
    if (!workerRef.current) return;
    try { workerRef.current.postMessage({ type: 'terminate' }); } catch (_) {}
    try { workerRef.current.terminate(); } catch (_) {}
    workerRef.current = null;
    setEngineReady(false);
    setEngineError(null);
  }, []);

  // Auto-cleanup on unmount.
  useEffect(() => {
    return () => stopEngine();
  }, [stopEngine]);

  return { startEngine, getBestMove, stopEngine, engineReady, engineError, searchInfo };
}
