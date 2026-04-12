import React, { useState, useEffect } from "react";
import styles from "./changelog.module.scss";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";

const changelogData = [
  {
    date: "April 11, 2026",
    title: "Multi-Action Turns, Move Confirmation Preview & Toggle Improvements",
    items: [
      "Actions per turn now works — games with multiple actions per turn let you move or place pieces multiple times before your turn ends",
      "Correspondence move confirmation now shows your move on the board before you confirm, and reverts if you cancel",
      "Confirm/cancel move buttons no longer overflow the sidebar — text stays on one line while buttons wrap to fit",
      "Host Game modal toggle switches now properly display inline with their labels",
      "In checkmate-only games with multiple actions per turn, you can no longer capture the checkmate piece directly — it must be checkmated",
      "Mid-turn checkmate detection: if checkmate is detected before all actions are used, a message is shown and the player must complete their remaining actions",
      "Game detail page and tooltips now explain how checkmate works in multi-action games",
      "Fixed checkmate icon alignment on the game detail board",
      "Fixed multi-action correspondence games allowing unlimited moves before confirming — confirmation now happens per action",
      "Match review page now shows the computer difficulty level and no longer links to a profile for computer players",
    ]
  },
  {
    date: "April 10, 2026",
    title: "Sandbox Rules, Turn Confirmation & UI Polish",
    items: [
      "Added content moderation — offensive usernames are now blocked during registration and profile edits (Scunthorpe-safe: innocent words like 'Scunthorpe' won't be rejected)",
      "Game names, descriptions, rules, and piece descriptions are now checked for inappropriate language with real-time warnings",
      "Links and URLs are no longer allowed in game or piece descriptions",
      "Forum posts and comments are checked for offensive language before posting",
      "Maximum actions per turn is now capped at 8",
      "Uploaded piece images and profile pictures are now automatically scanned for inappropriate content",
      "Images that need manual review are queued — you'll see an 'Under Review' badge until approved",
      "Creating pieces and games now requires being logged in",
      "Fixed multi-tile pieces allowing sizes larger than 4×4",
      "Fixed games against the computer getting stuck when a player runs out of time",
      "Fixed match history not showing the computer opponent or difficulty level in some games",
      "Fixed ongoing games list not displaying the computer opponent's name correctly",
      "The site owner now receives notifications for every new game, new piece, and new user registration",
      "Updated YouTube channel link",
      "Correspondence games now have a turn confirmation step — review your move before submitting, with a toggle in game options",
      "Game options menu can now be collapsed with a hamburger button to save screen space",
      "Computer player names are no longer clickable links",
      "Sandbox now has a Game Rules section below Game Types for configuring win conditions, draw rules, and gameplay mechanics (more settings coming soon)",
      "Sandbox sidebars now paginate long lists for better performance",
      "Sandbox board is now larger on desktop screens",
      "Host Game modal: 'Play vs Computer' and 'Rated Game' are now toggle switches instead of checkboxes",
      "Host Game modal: rated games are automatically disabled when playing against the computer",
      "Host Game modal: removed redundant description text for cleaner layout",
      "Maximum board size is now enforced at 48×48 on both frontend and backend",
      "Scrollbars across the site now match the current theme",
      "Sandbox sections on mobile are now a consistent 250px height with vertical scrolling",
      "Host Game modal: labels are now left-aligned with better spacing",
      "Scrollbars are now slightly darker and wider for better visibility",
      "Sandbox piece library on mobile is now taller for easier browsing",
      "Sandbox piece library and game types now show pagination info at the top of the list",
      "Sandbox piece library on desktop is now capped at 400px with scrolling",
    ]
  },
  {
    date: "April 8, 2026",
    title: "License & Housekeeping",
    items: [
      "Added a license for public repository — source is viewable for educational purposes only",
      "Fixed garbled characters appearing in various pages and emails",
    ]
  },
  {
    date: "April 7, 2026",
    title: "Custom Square Movement & Attack in Piece Wizard",
    items: [
      "Fixed dates showing as one day ahead — all dates now correctly display in your local timezone",
      "New feature: Click squares on a grid to define custom movement and attack patterns for your pieces",
      "Custom square selection available in both Step 2 (Movement) and Step 3 (Attack) of the piece wizard",
      "Click or drag to paint multiple squares at once — click again to remove",
      "Custom squares work alongside existing directional, ratio, and step-by-step movement",
      "'Attacks like movement' automatically copies custom movement squares to attack",
      "Custom movement squares shown in teal, custom attack squares in warm orange on the preview board",
      "Custom square legend entries added to the board preview",
      "Full game engine support — custom squares work in live games, sandbox, piece detail, game detail, and AI matches",
      "Interactive preview boards: click any highlighted square to watch the piece move there, then the board smoothly re-centers",
      "Move animation works in piece wizard steps 2 & 3, edit piece wizard, and piece detail page",
      "Drag-to-move support: click and drag the piece to a highlighted square for a more natural feel",
      "Piece now pauses briefly on the destination square before the board re-centers",
      "Movement & Attack preview now shows on Step 1 of piece creation, not just when editing",
      "Custom square selector grid is now larger and easier to use",
      "Fixed custom square movement not working in sandbox when placing pieces from the library",
      "Smoother board re-center animation — fixed jerkiness on short and long moves",
      "Board now shows phantom edge squares during re-center animation for an infinite board illusion",
      "Changelog page now paginates after 5 entries to keep the page manageable",
    ]
  },
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
      "Improved piece value estimation — now simulates center-of-board coverage for more accurate values (pawn ≈ 1, bishop ≈ 3, rook ≈ 5, queen ≈ 9)",
      "New 'Material Clock Penalty' option — players behind in material have their clock tick up to 3× faster",
      "New 'Material Clock Handicap' option — players behind in material have their clock tick slower, giving more time to catch up",
      "Fixed clock multiplier display showing on both players — now only appears on the affected player's clock",
      "Fixed rare server crash when a game times out during material clock calculations",
      "Clock now shows tenths of a second when under 1 minute for precise time tracking",
      "Clock multiplier now disappears when material difference is negligible",
      "Clock multiplier now updates immediately after a capture instead of waiting for next tick",
      "Improved piece value estimation for promotable pieces — pawns now valued closer to 1.0",
      "Premoves now work reliably in computer games, even when the bot responds quickly",
      "Computer opponent now detects and tries to prevent checkmate threats from the player",
      "Fixed critical checkmate detection bug — Player 2 pawns' special moves (like 2-square advance) now work correctly in all directions",
      "You can now choose to play as White, Black, or Random when starting a computer game",
      "Computer games now restore properly when refreshing the page mid-game",
      "Clock penalty/handicap now visually ticks faster or slower in real-time, not just after moves",
      "Computer no longer shuffles the same piece back and forth — prefers developing new pieces",
      "Computer plays stronger openings — favors advancing center pawns two squares and developing pieces",
      "Computer better protects high-value pieces from low-value attackers",
      "In-game chat is now private between players by default — spectators cannot see messages unless both players enable the public chat toggle",
      "Chat visibility preference (public/private for spectators) is now saved to your account and remembered for future games",
      "New 'Allow spectators to view chat' toggle in Preferences under Messaging & Chat",
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

const ENTRIES_PER_PAGE = 5;

const Changelog = () => {
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(changelogData.length / ENTRIES_PER_PAGE);
  const pageEntries = changelogData.slice(page * ENTRIES_PER_PAGE, (page + 1) * ENTRIES_PER_PAGE);

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

      {pageEntries.map((entry, i) => (
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

      {totalPages > 1 && (
        <div className={styles["pagination"]}>
          <button
            className={styles["page-btn"]}
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            ← Newer
          </button>
          <span className={styles["page-info"]}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className={styles["page-btn"]}
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
};

export default Changelog;
