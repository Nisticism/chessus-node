import React, { useState } from "react";
import styles from "./gamewizard.module.scss";
import NumberInput from "../common/NumberInput";
import ToggleSwitch from "../common/ToggleSwitch";
import InfoTooltip from "../piecewizard/InfoTooltip";
import { checkForLinks, checkOffensiveContent, checkProfessionalName } from "../../utils/contentModeration";
import LinkInsertButton from "../common/LinkInsertButton";

const Step1BasicInfo = ({ gameData, updateGameData, currentUser }) => {
  const [contentWarnings, setContentWarnings] = useState({});
  const [nameReviewWarning, setNameReviewWarning] = useState(false);

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

      <div className={styles["form-group"]}>
        <label className={styles["form-label"]}>
          Game Name <span className={styles["required"]}>*</span>
        </label>
        <input
          type="text"
          className={styles["form-input"]}
          value={gameData.game_name}
          onChange={(e) => handleChange("game_name", e.target.value)}
          placeholder="Enter game name (3-50 characters)"
          maxLength={50}
        />
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
          className={styles["form-textarea"]}
          value={gameData.descript}
          onChange={(e) => handleChange("descript", e.target.value)}
          placeholder="Describe your game (optional)"
          rows={6}
          maxLength={8000}
        />
        <div className={styles["char-count"]}>
          {gameData.descript.length} / 8000 characters
        </div>
        <div style={{ marginTop: '6px' }}>
          <LinkInsertButton onInsert={(text) => handleChange("descript", gameData.descript + text)} />
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
        <label className={styles["form-label"]}>
          Actions Per Turn <InfoTooltip text="How many moves or actions each player can make during a single turn. In standard chess this is 1. Increase for games where players can move multiple pieces per turn. Maximum of 8 actions per turn." />
        </label>
        <NumberInput
          value={gameData.actions_per_turn || 1}
          onChange={(val) => handleChange("actions_per_turn", Math.min(8, Math.max(1, val)))}
          options={{ min: 1, max: 8, placeholder: "1", className: styles["form-input-small"] }}
        />
      </div>

      <div className={styles["form-group"]}>
        <ToggleSwitch
          checked={!!gameData.simultaneous_turns}
          onChange={(val) => handleChange("simultaneous_turns", val)}
          disabled={gameData.actions_per_turn > 1}
          label={
            <span>
              Simultaneous turns{' '}
              <InfoTooltip text="Both players submit their moves secretly, then both moves are revealed and executed at the same time. Incompatible with multiple actions per turn. ⚠ Experimental: Some mechanics (multi-action turns, piece placement) are not compatible." />
            </span>
          }
        />
        {gameData.actions_per_turn > 1 && gameData.simultaneous_turns && (
          <p className={styles["validation-error"]}>
            Simultaneous turns requires exactly 1 action per turn.
          </p>
        )}
      </div>

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
    </div>
  );
};

export default Step1BasicInfo;
