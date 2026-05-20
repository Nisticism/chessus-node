import React from "react";

/**
 * Modal that lists every reason why a game type is not compatible with the
 * Fairy-Stockfish bot, plus a recommended fix for each reason.
 *
 * Props:
 *   - open: boolean
 *   - onClose: () => void
 *   - reasons: array of { category, sourceName, field, message, fix } or strings
 *   - gameName: string (display title)
 *   - onPlayAnyway: optional () => void. When provided, shows a "Play anyway"
 *     button at the bottom of the modal that lets the user use the engine even
 *     though some rules are incompatible (engine will approximate / ignore them).
 */
export default function FairyStockfishIncompatModal({ open, onClose, reasons, gameName, onPlayAnyway }) {
  if (!open) return null;
  const normalized = Array.isArray(reasons) ? reasons : [];
  // Group by category for readability
  const groups = { game: [], piece: [], placement: [], other: [] };
  for (const r of normalized) {
    if (typeof r === 'string') { groups.other.push({ message: r }); continue; }
    const key = groups[r.category] ? r.category : 'other';
    groups[key].push(r);
  }
  const groupLabel = {
    game: 'Game-Type Settings',
    piece: 'Piece Rules',
    placement: 'Per-Placement Overrides',
    other: 'Other',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.55)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f2330', color: '#eaeaea',
          border: '1px solid #3a4055', borderRadius: 8,
          maxWidth: 720, width: '100%', maxHeight: '85vh',
          overflowY: 'auto', padding: '18px 22px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>
            Fairy Stockfish incompatibilities{gameName ? ` - ${gameName}` : ''}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid #555', color: '#eee',
              borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <p style={{ fontSize: 13, color: '#b8b8c8', marginTop: 0 }}>
          The Fairy Stockfish computer player is only available for game types whose rules can be
          translated into a classical-chess-engine variant. The items below explain exactly which
          settings are blocking it, and how to change them.
        </p>

        {normalized.length === 0 && (
          <p style={{ color: '#7bd88f' }}>No incompatibilities found.</p>
        )}

        {['game', 'piece', 'placement', 'other'].map(g => groups[g].length === 0 ? null : (
          <div key={g} style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14, color: '#9fb8e6' }}>
              {groupLabel[g]}
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {groups[g].map((r, i) => (
                <li key={i} style={{ marginBottom: 8, fontSize: 13, lineHeight: 1.5 }}>
                  {r.sourceName && (
                    <span style={{ color: '#cfd6ea', fontWeight: 600 }}>{r.sourceName}: </span>
                  )}
                  <span>{r.message}</span>
                  {r.field && (
                    <span style={{ color: '#7d8aa6', fontSize: 11, marginLeft: 6 }}>
                      ({r.field})
                    </span>
                  )}
                  {r.fix && (
                    <div style={{ color: '#9be8a8', fontSize: 12, marginTop: 2 }}>
                      Fix: {r.fix}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {typeof onPlayAnyway === 'function' && normalized.length > 0 && (
          <div style={{
            marginTop: 18, paddingTop: 14,
            borderTop: '1px solid #3a4055',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ fontSize: 12, color: '#b8b8c8' }}>
              You can still use the engine if you accept that some rules will be approximated
              or ignored. The bot may make moves that would normally be illegal in this game type,
              and any wins, losses, or special abilities tied to incompatible rules may not be
              recognised by the engine.
            </div>
            <button
              type="button"
              onClick={onPlayAnyway}
              style={{
                alignSelf: 'flex-start',
                background: '#5a4a1a',
                color: '#ffe8a0',
                border: '1px solid #8a6a2a',
                borderRadius: 4,
                padding: '6px 14px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Play anyway (ignore incompatible rules)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
