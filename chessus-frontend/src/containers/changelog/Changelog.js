import React, { useState, useEffect } from "react";
import styles from "./changelog.module.scss";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";

const changelogData = [
  {
    date: "April 6, 2026",
    title: "AI Improvements & UI Fixes",
    items: [
      "Computer opponent now shows 'Computer is thinking...' indicator reliably during bot games",
      "Improved AI error recovery — bot will attempt a fallback move if the engine encounters an issue",
      "Play vs Computer option now appears at the top of the host game modal for easier access",
      "Admin dashboard toggles now respond immediately to clicks",
      "Computer clock now correctly tracks thinking time",
      "Computer clock now counts down in real-time while the AI is thinking",
      "Stronger AI with deeper search, quiescence search to avoid tactical blunders, and improved position evaluation",
      "AI now detects actual piece attack lines instead of using simple proximity checks",
      "Computer now properly continues after pawn promotion",
      "Promotion dialog now shows all starting piece types, not just currently alive pieces",
      "Computer games now appear in match history with a BOT badge (no ELO impact)",
      "Fixed rare page loading errors on slow connections — pages now show a reload prompt instead of crashing",
      "Messages and sound effects are now enabled by default for new accounts",
      "Added toggle to show or hide piece badges during live games",
      "Added simultaneous turns option in the game wizard for new game types",
      "Fixed checkmate detection bug where pawns could incorrectly capture forward instead of diagonally",
      "Match history board now shows your pieces at the bottom with correct notation orientation",
      "Bot opponent now shows as 'Computer (Easy/Medium/Hard)' in match history",
      "Premoves now work during computer games",
      "Computer now actively pushes promotable pieces toward promotion when the path is clear",
      "Correspondence clocks now show hours alongside days (e.g., '3d 14h')",
      "Captured pieces section now displays approximate material value with advantage indicator",
      "New 'Material Clock Penalty' option — players behind in material have their clock tick up to 3× faster",
    ],
  },
  {
    date: "April 5, 2026",
    title: "Changelog, Game Options & Bug Fixes",
    items: [
      "Added a public changelog page accessible from the info menu",
      "Admin dashboard now has a Settings tab to enable/disable site features like the changelog",
      "Ghost board review banner now appears above the board instead of inside it",
      "Fixed pawn capture highlighting bug — pawns no longer show red highlights on pieces directly in front",
      "Added option to show/hide board notation (rank and file labels) during live games",
      "Host game modal now has a collapsible 'Additional Options' section for cleaner layout",
    ],
  },
  {
    date: "April 3, 2026",
    title: "UI Polish & Engine Overhaul",
    items: [
      "Added piece shadow preference and improved board appearance options",
      "Password reset flow is now fully functional",
      "Trample and ghostwalk abilities have been overhauled with proper check detection and radius immunity",
      "Piece image library expanded to 3,200+ images with a paginated browser",
      "Added direct messaging, inbox, and in-game chat system",
    ],
  },
  {
    date: "April 2, 2026",
    title: "Burn Damage & Live Game Improvements",
    items: [
      "New burn damage system — pieces can deal damage over time after attacking",
      "Piece placement game mode (Othello-style) added",
      "Live game clock alignment and piece count tracker improvements",
      "Various live game UI fixes and polish",
    ],
  },
  {
    date: "April 1, 2026",
    title: "Community Redesign & Correspondence Play",
    items: [
      "Community hub redesigned with match navigation, leaderboard, and a rewritten welcome section",
      "Notifications page redesigned with themed cards and type-specific styling",
      "Correspondence game notifications and draw-before-first-move support",
      "Fixed castling info display, correspondence clock, game type links, and room cleanup in live games",
      "Email templates restored with proper UTF-8 emoji and symbol encoding",
    ],
  },
  {
    date: "March 31, 2026",
    title: "HP / AD System & Piece Stats",
    items: [
      "New HP, Attack Damage, and Regen system — pieces can take damage, heal, and regenerate over turns",
      "HP/AD overlays with badges, HP bars, damage/regen animations, and sound effects in live games",
      "Piece wizard and game wizard updated with HP/AD/Regen configuration controls",
      "Game detail page now shows piece stat breakdowns correctly",
    ],
  },
  {
    date: "March 30, 2026",
    title: "Admin Tools & Game Hosting",
    items: [
      "Admin portal expanded with delete/edit for pieces, games, forums, and news",
      "Private games section added to the play page with admin delete buttons",
      "Castling distance is now configurable per piece placement",
      "Challenge button now visible for all friends on profile pages",
      "Fixed directional hopping flag persistence and display on piece detail pages",
      "Home page stats now show correct totals instead of being capped at 20",
    ],
  },
];

const Changelog = () => {
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkEnabled = async () => {
      try {
        const res = await axios.get(`${API_URL}site-settings/changelog_enabled`);
        if (res.data.value === "false" || res.data.value === false) {
          setDisabled(true);
        }
      } catch {
        // If endpoint doesn't exist yet or errors, default to enabled
      } finally {
        setLoading(false);
      }
    };
    checkEnabled();
  }, []);

  if (loading) {
    return (
      <div className={styles["changelog-container"]}>
        <div className={styles["changelog-header"]}>
          <h1>Changelog</h1>
        </div>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className={styles["changelog-container"]}>
        <div className={styles["changelog-disabled"]}>
          <h2>Changelog Unavailable</h2>
          <p>The changelog is currently hidden. Check back later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["changelog-container"]}>
      <div className={styles["changelog-header"]}>
        <h1>Changelog</h1>
        <p className={styles["subtitle"]}>Recent updates and improvements to GridGrove</p>
      </div>

      {changelogData.map((entry, i) => (
        <div key={i} className={styles["changelog-entry"]}>
          <div className={styles["entry-date"]}>{entry.date}</div>
          <div className={styles["entry-title"]}>{entry.title}</div>
          <ul className={styles["entry-list"]}>
            {entry.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default Changelog;
