import React, { useState } from "react";
import axios from "axios";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";

/*
 * The admin scan's warning that a game's starting position is already
 * decided - and, for the game's creator, one chance to have it checked again.
 *
 * Saving the game in the editor re-checks it anyway; this is for a problem fixed
 * some other way (a piece edited, a rule the check has since learned), or to
 * confirm a fix. Once per flag: the server refuses a second go until the admin
 * scan flags the game again.
 *
 * Its own component because GameTypeView is at the size where one more branch
 * gives false rules-of-hooks errors.
 */
const StartingPositionWarning = ({ game, isCreator, onUpdated }) => {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState(null);

  if (!game?.initial_state_warning) return note ? <p style={{ color: '#8fd9a8', margin: '12px 0' }}>{note}</p> : null;

  const canRecheck = isCreator && !game.initial_state_rescan_used;

  const recheck = async () => {
    setChecking(true);
    setNote(null);
    try {
      const res = await axios.post(`${API_URL}games/${game.id}/initial-state/rescan`, {}, { headers: authHeader() });
      const { decided, initial_state_warning: warning } = res.data || {};
      onUpdated({ initial_state_warning: warning || null, initial_state_rescan_used: 1 });
      setNote(decided
        ? 'Checked again: the starting position still has a problem (above). Fix it in the editor - saving the game checks it again.'
        : 'Checked again: the starting position is fine now, and new games can be started.');
    } catch (err) {
      setNote(err.response?.data?.message || 'The check could not be run. Please try again later.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        background: 'rgba(255, 80, 80, 0.12)',
        border: '1px solid rgba(255, 120, 120, 0.5)',
        borderRadius: '8px',
        padding: '12px 16px',
        margin: '12px 0',
        color: '#ffd2d2',
        fontSize: '0.9rem',
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: '#ff8484' }}>⚠️ Starting Position Issue:</strong>{' '}
      {game.initial_state_warning}{' '}
      <strong>New games cannot be started on it until this is fixed.</strong>{' '}
      The game's creator should edit the game to resolve it. Games already in progress
      are unaffected, and the Sandbox will still load this position, which is a useful
      place to work out a fix.
      {isCreator && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={recheck}
            disabled={!canRecheck || checking}
            title={canRecheck
              ? 'Run the starting-position check on this game now. You can do this once while it is flagged; saving the game in the editor also checks it.'
              : 'Already checked again. Saving the game in the editor checks it once more.'}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid rgba(255, 160, 160, 0.6)',
              background: canRecheck ? 'rgba(255, 120, 120, 0.2)' : 'transparent',
              color: 'inherit',
              cursor: canRecheck && !checking ? 'pointer' : 'default',
              opacity: canRecheck ? 1 : 0.6,
              fontWeight: 600,
            }}
          >
            {checking ? 'Checking…' : canRecheck ? 'Check again' : 'Already checked again'}
          </button>
          {note && <span>{note}</span>}
        </div>
      )}
    </div>
  );
};

export default StartingPositionWarning;
