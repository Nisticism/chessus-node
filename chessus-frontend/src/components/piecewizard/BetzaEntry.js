import React, { useMemo, useState } from "react";
import styles from "./piecewizard.module.scss";
import InfoTooltip from "./InfoTooltip";
import { parseBetza, betzaToPieceData, explainPart, describePart } from "../../helpers/betza";

const ABOUT = 'Betza notation is a short code for how a piece moves, used by chess-variant designers. '
  + 'Capital letters are moves: W one square orthogonally, F one square diagonally, N a knight jump, '
  + 'and R, B, Q, K for the rook, bishop, queen and king. Doubling a letter or adding a number repeats '
  + 'it in a line (WW is a rook; R4 a rook that goes up to 4 squares). Lower-case letters in front change '
  + 'the move: m move only, c capture only, f/b/l/r forward/back/left/right, i first move only, '
  + 'n lame (cannot jump), p cannon (must hop exactly one piece). '
  + 'Example: mfWcfFimfnD is a pawn. Filling in replaces the Movement and Attack steps, which you can then adjust.';

/*
 * Step 1: type a Betza code to fill in the Movement and Attack steps.
 *
 * Optional - for people who already think in Betza. The code is translated
 * letter by letter below it, anything the site cannot express is listed, and
 * a fill can be undone (it replaces the movement and attack settings).
 */
export default function BetzaEntry({ pieceData, updatePieceData }) {
  const [code, setCode] = useState('');
  const [undo, setUndo] = useState(null);       // the settings a fill replaced
  const [filled, setFilled] = useState(null);    // { code, warnings } after a fill

  const parsed = useMemo(() => parseBetza(code), [code]);
  const result = useMemo(() => (code.trim() && !parsed.error ? betzaToPieceData(code) : null), [code, parsed.error]);

  const fill = () => {
    if (!result?.updates) return;
    const before = {};
    for (const key of Object.keys(result.updates)) before[key] = pieceData[key];
    setUndo(before);
    updatePieceData(result.updates);
    setFilled({ code: code.trim(), warnings: result.warnings });
  };
  const revert = () => {
    if (undo) updatePieceData(undo);
    setUndo(null);
    setFilled(null);
  };

  return (
    <div className={styles["form-group"]}>
      <label className={styles["form-label"]} htmlFor="betza-code">
        Betza notation <span className={styles["field-hint-inline"]}>(optional)</span> <InfoTooltip text={ABOUT} />
      </label>
      <div className={styles["betza-row"]}>
        <input
          id="betza-code"
          type="text"
          className={`${styles["form-input"]} ${styles["betza-input"]}`}
          value={code}
          onChange={(e) => { setCode(e.target.value); setFilled(null); }}
          placeholder="e.g. N, QN, mfWcfFimfnD"
          maxLength={80}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles["betza-button"]}
          onClick={fill}
          disabled={!result?.updates}
        >
          Fill in movement & attack
        </button>
      </div>
      {parsed.error && code.trim() && <p className={styles["betza-error"]}>{parsed.error}</p>}

      {filled && (
        <p className={styles["betza-done"]}>
          Filled in from <code>{filled.code}</code> - check the result in the preview below and in the Movement and Attack steps.
          {undo && <> <button type="button" className={styles["betza-link"]} onClick={revert}>Undo</button></>}
        </p>
      )}
      {result?.warnings?.length > 0 && (
        <ul className={styles["betza-warnings"]}>
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {!parsed.error && parsed.parts.length > 0 && (
        <details className={styles["betza-details"]}>
          <summary>What this code means, letter by letter</summary>
          {parsed.parts.map((part, i) => (
            <div key={`${part.text}-${i}`} className={styles["betza-part"]}>
              <div className={styles["betza-part-head"]}>
                <code>{part.text}</code> <span>{describePart(part)}</span>
              </div>
              <table className={styles["betza-table"]}>
                <tbody>
                  {explainPart(part).map((row, j) => (
                    <tr key={`${row.symbol}-${j}`} className={row.supported ? '' : styles["betza-unsupported"]}>
                      <td><code>{row.symbol}</code></td>
                      <td>{row.meaning}{row.supported ? '' : ' (not supported here)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
