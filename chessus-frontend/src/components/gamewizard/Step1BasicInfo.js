import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import styles from "./gamewizard.module.scss";
import ToggleSwitch from "../common/ToggleSwitch";
import InfoTooltip from "../piecewizard/InfoTooltip";
import API_URL from "../../global/global";
import { PLATFORM_ACCOUNT_USERNAME } from "../../helpers/platform-account";
import { checkForLinks, checkOffensiveContent, checkProfessionalName } from "../../utils/contentModeration";
import LinkInsertButton from "../common/LinkInsertButton";
import EmojiPickerButton from "../common/EmojiPickerButton";
import BulletInsertButton, { handleBulletKeyDown } from "../common/BulletInsertButton";

const Step1BasicInfo = ({ gameData, updateGameData, currentUser, onApplyPreset }) => {
  const [contentWarnings, setContentWarnings] = useState({});
  const [nameReviewWarning, setNameReviewWarning] = useState(false);
  const descriptRef = useRef(null);

  /*
   * Presets: start from a game that already works.
   *
   * The list is GridGrove's own games, asked for by name - not a hand-written
   * list here. That is the whole point: the site's classic games ARE the
   * presets, so adding one to the GridGrove account puts it in this dropdown
   * without anybody remembering to update a second list that would otherwise
   * drift the first time a game was added or renamed.
   */
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}games?creatorUsername=${encodeURIComponent(PLATFORM_ACCOUNT_USERNAME)}&limit=100&sort=alphabetical`)
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.games || []);
        setPresets(list.filter(Boolean));
      })
      .catch(() => { /* the dropdown simply does not appear */ });
    return () => { cancelled = true; };
  }, []);

  const applyPreset = async (id) => {
    setPresetId(id);
    setPresetError(null);
    if (!id) return;
    setPresetBusy(true);
    try {
      const { data } = await axios.get(`${API_URL}games/${id}`);
      const row = data?.game || data;
      if (!row?.game_name) throw new Error('empty');
      /*
       * The name is deliberately NOT carried over. A preset is a starting
       * point, and a second game called "Chess" helps nobody - so the field is
       * left empty for the creator to fill, which is also what the Next button
       * is already checking for.
       */
      onApplyPreset({ ...row, game_name: '' });
    } catch (_) {
      setPresetError('Could not load that game just now. Try again in a moment.');
      setPresetId('');
    } finally {
      setPresetBusy(false);
    }
  };

  const handleChange = (field, value) => {
    updateGameData({ [field]: value });

    // Real-time content validation for text fields
    if (['game_name', 'descript', 'rules'].includes(field) && value) {
      const warnings = {};
      const offCheck = checkOffensiveContent(value);
      if (!offCheck.isClean) {
        warnings[field] = 'This text contains inappropriate language. Please revise before submitting.';
      } else {
        const linkCheck = checkForLinks(value);
        if (linkCheck.hasLinks) {
          const hasDisallowedLinks = linkCheck.links.some((link) => {
            if (/^https?:\/\//.test(link)) {
              return !/^https?:\/\/(?:www\.)?gridgrove\.gg(?:\/|$)/i.test(link);
            }
            return !/^(?:www\.)?gridgrove\.gg(?:\/|$)/i.test(link);
          });
          if (hasDisallowedLinks) {
            warnings[field] = 'Only gridgrove.gg links are supported. Please remove external links.';
          }
        }
      }
      setContentWarnings(prev => ({ ...prev, [field]: warnings[field] || null }));

      // Professional name check: warn that the game name will require moderator review
      if (field === 'game_name') {
        const profCheck = checkProfessionalName(value);
        setNameReviewWarning(!profCheck.isProfessional);
      }
    }
    if (field === 'game_name' && !value) {
      setNameReviewWarning(false);
    }
  };

  return (
    <div className={styles["step-container"]}>
      <h2>Basic Game Information</h2>
      <p className={styles["step-description"]}>
        Enter the basic details about your custom game type.
      </p>

      {presets.length > 0 && (
        <div className={styles["form-group"]}>
          <label className={styles["form-label"]}>
            Start from a preset
            <InfoTooltip text="Loads one of GridGrove's own games into every step of this wizard, for you to change however you like. Nothing is shared with the original - you get a copy to edit. The name is left blank for you to fill in. Leave this alone to start from scratch." />
          </label>
          <select
            className={styles["form-input"]}
            value={presetId}
            disabled={presetBusy}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Start from scratch</option>
            {presets.map((g) => (
              <option key={g.id} value={g.id}>
                {g.game_name} ({g.board_width}×{g.board_height})
              </option>
            ))}
          </select>
          <div className={styles["char-count"]}>
            {presetBusy
              ? 'Loading…'
              : 'Everything in the wizard is replaced by the preset, so pick one before you start editing.'}
          </div>
          {presetError && (
            <p className={styles["validation-error"]}>{presetError}</p>
          )}
        </div>
      )}

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Game Name <span className={styles["required"]}>*</span>
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.game_name}
          onChange={(e) => handleChange("game_name", e.target.value)}
          placeholder="Enter game name (3-100 characters)"
          maxLength={100}
        />
        <div className={styles["char-count"]}>
          {gameData.game_name.length} / 100 characters
        </div>
        {gameData.game_name && gameData.game_name.length < 3 && (
          <p className={styles["validation-error"]}>
            Game name must be at least 3 characters
          </p>
        )}
        {contentWarnings.game_name && (
          <p className={styles["validation-error"]}>
            {contentWarnings.game_name}
          </p>
        )}
        {nameReviewWarning && !contentWarnings.game_name && (
          <p className={styles["validation-warning"]} style={{ color: '#e67e22', fontSize: '0.875rem', marginTop: '4px' }}>
            This name contains terms that require moderator review. Your game will be hidden from public listings until it is approved.
          </p>
        )}
      </div>

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Description
        </label>
        <textarea
          ref={descriptRef}
          className={styles["form-textarea"]}
          value={gameData.descript}
          onChange={(e) => handleChange("descript", e.target.value)}
          onKeyDown={(e) => handleBulletKeyDown(e, gameData.descript, (val) => handleChange("descript", val))}
          placeholder="Describe your game (optional)"
          rows={6}
          maxLength={8000}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
          <EmojiPickerButton textareaRef={descriptRef} onChange={(val) => handleChange("descript", val)} />
          <BulletInsertButton textareaRef={descriptRef} value={gameData.descript} onChange={(val) => handleChange("descript", val)} />
          <LinkInsertButton textareaRef={descriptRef} onChange={(val) => handleChange("descript", val)} />
          <div className={styles["char-count"]} style={{ marginLeft: 'auto' }}>
            {gameData.descript.length} / 8000
          </div>
        </div>
        {contentWarnings.descript && (
          <p className={styles["validation-error"]}>
            {contentWarnings.descript}
          </p>
        )}
      </div>

      {/* Player count hidden - currently only 2-player games supported */}
      {/* <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Number of Players <span className={styles["required"]}>*</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', width: '100%', maxWidth: '400px' }}>
            <span style={{ minWidth: '15px', color: 'var(--text-light-gray)' }}>2</span>
            <input
              type="range"
              min="2"
              max="8"
              value={gameData.player_count || 2}
              onChange={(e) => handleChange("player_count", parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: '15px', color: 'var(--text-light-gray)' }}>8</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
            {gameData.player_count || 2}
          </div>
        </div>
        <p className={styles["field-hint"]}>
          Set the number of players who can participate in this game (2-8).
        </p>
      </div> */}

      <div className={styles["form-group"]}>
        <ToggleSwitch
          checked={!currentUser || !!gameData.is_anonymous_creator}
          onChange={(val) => handleChange("is_anonymous_creator", val)}
          disabled={!currentUser}
          label={
            <span>
              Create anonymously{' '}
              <InfoTooltip text={!currentUser ? "You are not logged in — your game will be created anonymously." : "When enabled, your username will not be shown publicly as the creator of this game."} />
            </span>
          }
        />
      </div>

      {/* A permission, not a rule - it lives here rather than with the rules
          steps, and outside the puzzles' rules fingerprint. */}
      <div className={styles["form-group"]}>
        <ToggleSwitch
          checked={!!currentUser && !!gameData.allow_community_puzzles}
          onChange={(val) => handleChange("allow_community_puzzles", val)}
          disabled={!currentUser}
          label={
            <span>
              Let other players build puzzles for this game{' '}
              <InfoTooltip text={!currentUser
                ? "Sign in to choose who can build puzzles for your game."
                : "When enabled, anyone can build puzzles for this game, up to their usual limit per game (3 for free accounts, uncapped for Silver Supporters). Your game appears in everyone's list on New Puzzle, marked as shared by you, and a Build a Puzzle button shows on its page. Puzzles are published under their builder's name. Turning this off stops new puzzles; ones already made stay. Without it, only you can build puzzles for your game."} />
            </span>
          }
        />
      </div>
    </div>
  );
};

export default Step1BasicInfo;
