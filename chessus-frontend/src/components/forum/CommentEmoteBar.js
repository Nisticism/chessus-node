import React, { useState, useRef, useCallback } from 'react';
import styles from './commentEmoteBar.module.scss';

const EMOTES = [
  { type: 'thumbsup',   emoji: '👍' },
  { type: 'thumbsdown', emoji: '👎' },
  { type: 'heart',      emoji: '❤️' },
  { type: 'question',   emoji: '❓' },
  { type: 'laugh',      emoji: '😂' },
  { type: 'sad',        emoji: '😢' },
  { type: 'exclaim',    emoji: '❗' },
];

/**
 * Groups raw emote records into { emote_type -> [{ user_id, username }] }
 */
function groupEmotes(emotes) {
  const groups = {};
  (emotes || []).forEach(e => {
    if (!groups[e.emote_type]) groups[e.emote_type] = [];
    groups[e.emote_type].push({ user_id: e.user_id, username: e.username });
  });
  return groups;
}

/**
 * CommentEmoteBar
 *
 * Props:
 *   emotes       - array of { emote_type, user_id, username }
 *   currentUserId - number | null
 *   onEmote      - (emoteType) => void  — called when user picks an emote
 *   isHovered    - bool — controls picker visibility (driven by parent hover state)
 */
const CommentEmoteBar = ({ emotes, currentUserId, onEmote, isHovered }) => {
  const [tooltip, setTooltip] = useState(null); // { type, rect }
  const tooltipTimeout = useRef(null);

  const grouped = groupEmotes(emotes);

  const handlePickerClick = useCallback((e, type) => {
    e.stopPropagation();
    if (!currentUserId) return;
    onEmote(type);
  }, [currentUserId, onEmote]);

  const handleExistingEmoteClick = useCallback((e, type) => {
    e.stopPropagation();
    if (!currentUserId) return;
    onEmote(type);
  }, [currentUserId, onEmote]);

  const showTooltip = (type, e) => {
    clearTimeout(tooltipTimeout.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ type, rect });
  };

  const hideTooltip = () => {
    tooltipTimeout.current = setTimeout(() => setTooltip(null), 120);
  };

  const keepTooltip = () => {
    clearTimeout(tooltipTimeout.current);
  };

  const activeEmoteTypes = EMOTES.filter(em => grouped[em.type]);

  return (
    <div className={styles['emote-bar']}>
      {/* Existing emotes — always visible when present */}
      {activeEmoteTypes.length > 0 && (
        <div className={styles['emote-existing']}>
          {activeEmoteTypes.map(em => {
            const users = grouped[em.type];
            const isMine = currentUserId && users.some(u => u.user_id === currentUserId);
            return (
              <span
                key={em.type}
                className={`${styles['emote-chip']} ${isMine ? styles['emote-chip-mine'] : ''}`}
                onClick={(e) => handleExistingEmoteClick(e, em.type)}
                onMouseEnter={(e) => showTooltip(em.type, e)}
                onMouseLeave={hideTooltip}
                title={users.map(u => u.username).join(', ')}
              >
                {em.emoji} <span className={styles['emote-count']}>{users.length}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Emote picker — shown when the parent comment is hovered */}
      <div className={`${styles['emote-picker']} ${isHovered ? styles['emote-picker-visible'] : ''}`}>
        {EMOTES.map(em => (
          <span
            key={em.type}
            className={styles['emote-picker-btn']}
            onClick={(e) => handlePickerClick(e, em.type)}
            title={em.type}
          >
            {em.emoji}
          </span>
        ))}
      </div>

      {/* Tooltip showing who reacted */}
      {tooltip && grouped[tooltip.type] && (
        <div
          className={styles['emote-tooltip']}
          onMouseEnter={keepTooltip}
          onMouseLeave={hideTooltip}
        >
          {grouped[tooltip.type].map(u => (
            <div key={u.user_id} className={styles['emote-tooltip-user']}>{u.username}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommentEmoteBar;
