import React, { useState } from "react";
import { useSelector } from "react-redux";
import styles from "./changelog.module.scss";

const changelogData = [
  {
    date: "April 20, 2026",
    title: "Range-Square Bonus, SVG Auto-Scan, Moderation Notifications & Admin Audit Log",
    items: [
      "Range Squares can now be configured with a per-square range bonus from +1 to +8 (default +1). Click any range square in Step 3 to set the value, and the bonus carries over when you use Fill Entire Row. The chosen bonus is applied in live games — pieces standing on a Range Square gain that many extra squares of movement, capture, and attack range — and the value is described on each game's detail page",
      "Custom Squares with Range behavior are now also capped at +1 to +8 (down from the previous max of +10) so they line up with plain Range Squares; backend validation re-clamps the value so a hand-crafted request can't bypass the cap",
      "Control Squares: the per-square 'Require Specific Piece Type' toggle now actually takes effect in live games — when enabled, only pieces marked 'Can Control Squares' in Step 4 can hold the square; when disabled, any piece can hold it. The configured turns / consecutive-turns / applies-to-player / piece-requirement settings now also appear on the game detail page so opponents can see them up front",
      "You'll now get a notification when a moderator approves or rejects one of your pieces (and the notification deep-links to the piece or your library so you can re-upload if needed)",
      "SVG piece images now get auto-moderated instead of always going to manual review: SVGs containing scripts, iframes, foreignObjects, inline event handlers, javascript: URLs, or XML entities are rejected outright (XSS protection); SVGs containing embedded raster images or external image references are queued for manual review; plain shape-only SVGs are auto-approved. This dramatically reduces the moderation queue for chess-piece SVG uploads",
      "Image upload size limit reduced from 5MB to 2MB for both piece images and profile pictures — pixel-art and SVG pieces never need more than that, and the lower cap keeps page loads snappy",
      "Server Stats Memory Stats endpoint now actually loads — a catch-all `/api/*` handler had been registered above it and was swallowing the request; the catch-all has been moved to the bottom of the route list so the real endpoint is reachable",
      "New Admin tab: 'Deleted Users' shows an audit log of every account deletion (self-delete or admin-initiated) including the deletion timestamp, previous username, original user ID, and who initiated the deletion",
      "Anonymous games now get cleaned up automatically — any anonymous game still in 'waiting' / 'active' / 'ready' state for more than 24 hours is closed (status='completed', end_time set) and any anonymous game older than 30 days is permanently deleted; this prevents abandoned anonymous matches from accumulating forever",
      "Leaderboard is now paginated (25 players per page) with previous/next and numbered page buttons, instead of trying to load every account in the database in a single request",
      "Fixed a crash on the Edit Account page when an admin/owner edited their own profile — submitting the form was throwing 'Cannot read properties of null (reading id)' because admin self-edits never populated the secondary user lookup; the form now falls back to the logged-in user's id in that case so admins can update their own bio, linked Chess.com / Lichess accounts, etc.",
      "Admins and owners can now spectate any game from the Admin Portal, even ones that have spectators disabled",
      "Backstop for completed games with a missing end_time: the cleanup job now also fills in end_time on any 'completed' game where it ended up NULL (using the game's start_time / created_at as the fallback), so the audit field is never blank on a finished match",
    ]
  },
  {
    date: "April 19, 2026",
    title: "Stalemate Fixes, Capture Win Persistence & Custom Square Combinations",
    items: [
      "You'll now get a notification whenever a game you're in ends — 'You won against ___' or 'You lost to ___' — and the notification links to your match history so you can review the game",
      "You'll also get a notification when another player joins a game you created (the notification links straight to the game)",
      "Admin endpoints are now exempt from the general API rate limit so the Server Stats panel and other admin tools can poll freely without getting blocked",
      "Server Stats panel now shows the actual server message (including 'Too many requests') when the endpoint returns something unexpected, instead of a vague 'JSON without expected fields' error",
      "You can now link your chess.com and lichess.org accounts from your Edit Account page, and a new 'Connected Accounts' card on your public profile shows the linked usernames as clickable links to those external profiles",
      "Bios, comments, forum posts, game descriptions, game rules, and piece descriptions now allow up to 3 links — but only to gridgrove.gg, chess.com, and lichess.org; other domains are still rejected to prevent spam",
      "Fixed a server-side bug that made it impossible to create or save certain pieces with the new 'Must Move If Able' option — the piece create endpoint was rejecting submissions with a database datetime error; the underlying column / value mismatch in the insert query is now corrected so all pieces save again",
      "Fixed bot games not ending when the bot won by stalemate — the game now correctly transitions to the game-over screen instead of leaving you stuck on the play page (the bot's id was failing the database winner check; the path is now sanitized and wrapped in error handling so the gameOver event always fires)",
      "Forum comments, replies, and edits now submit when you press Enter (Shift+Enter still inserts a newline)",
      "Game wizard piece placement (Step 4) now confirms the selected piece and places it when you press Enter — previously this only worked for the modal version, not the embedded panel",
      "Promoted pieces now inherit all per-game customizations from the original game type — the promoted piece picks up its checkmate/capture-loss flags, HP/AD, burn, trample, ghostwalk, attack radius, image override, and promotion-target settings exactly as they were configured in the game wizard, instead of falling back to the global piece defaults",
      "Server Stats admin tab now shows a clear error message when the endpoint isn't reachable (404, 401/403, network) so you can tell whether the backend needs a restart vs an authorization issue",
      "Old read notifications (30+ days) and very old unread notifications (90+ days) are now automatically cleaned up every 6 hours so the notifications list stays fast and responsive even for long-time players",
      "Fixed a promotion bug where the per-placement promotion override list was bypassing the 'limit promote-to-checkmate / capture-loss to original starting count' guard — players could end up promoting to a third king when they only started with two; the limit is now enforced for both the default promotion list and explicit override lists",
      "Forum create and edit pages have a fresh, modernized look with cleaner spacing, focus highlights, character counters, and a panel layout consistent with the rest of the site",
      "Forum post editing now includes a Cancel button so you can back out of an edit without saving (with a confirmation prompt if you have unsaved changes)",
      "Forum comment editing now includes a Cancel button, and clicking anywhere outside an open comment edit field will cancel the edit immediately — no need to first click inside the comment first",
      "Piece Wizard step 4 (Special Abilities) gained a 'Must Move If Able' option that forces a piece to move on its owner's turn whenever it has a legal move (great for the duck in Duck Chess); a sub-option 'Forced Move Uses an Action' lets you decide whether the forced move counts against actions per turn or is free",
      "These new must-move settings persist across piece creation, editing, and are shown on the piece detail page under Special Abilities",
      "Profile pictures and piece images that are exact duplicates of an existing upload are now reused from a single source instead of being stored twice — uploads are content-hashed within their folder, and old profile pictures are only deleted when no other user references them",
      "Fixed the admin Drafts tab not loading correctly: drafts now load reliably and pagination resets cleanly when switching between admin tabs (the bug was caused by a missing updated_at column on game types and stale state from the previously selected tab)",
      "Stalemate detection is now generalized to all pieces, not just kings — a player who has no legal moves on their turn (and isn't in check) will now correctly end the game even in games without a checkmate condition (e.g. a single pawn stuck behind an enemy pawn now ends the game)",
      "Stalemate outcome respects your win conditions: 'Stalemate Win' awards the win to the stalemated player, 'No Legal Moves' awards the win to the opponent, otherwise the game ends in a draw",
      "Fixed the 'Require all capture-flagged pieces to be captured' win condition not persisting when editing or saving a draft — the toggle now loads its previous value and survives create / edit / draft round trips",
      "Custom squares are no longer placeholders! When you place a custom square you can now toggle it to act as a Range, Promotion, and/or Control square simultaneously, with full per-square configuration",
      "Custom squares show their combined behaviors directly on the board — the indicator letter changes (e.g. R, RP, RPC) based on which behaviors are enabled",
      "Custom square combinations work in live games, on the game detail board preview, in fill-row, on edits, and in drafts",
      "The game detail page now describes each custom square and which behaviors it combines",
      "Fixed an overlap on small screens where the 'Show Details' toggle could collide with the 'Board Setup' heading on the game detail page",
      "Fixed a regression where opponent names linked to a profile page in match history rows for games against the computer — the bot opponent is no longer rendered as a clickable link",
      "Ranged attacks now count as legal moves when checking for stalemate, so a piece that can only attack at range is no longer treated as having no moves",
      "Stalemate detection now requires an explicit 'Stalemate Draw Rule' (default ON for both new and existing games) — if neither stalemate-win, no-legal-moves, nor stalemate-draw is enabled, the stuck player simply skips their turn and a notice is shown so the game keeps going",
      "Added an Email Notifications section to Preferences with a global on/off and per-type opt-out (friend requests, challenges, comments, replies, game threads, opponent moves, game chat) — opted-out types are excluded from both the email threshold and the email body",
      "Notification summary emails now include a one-click unsubscribe link at the bottom that disables future notification emails without requiring a login",
      "Notification summary emails now require more than 20 unread notifications (raised from 10) before being sent",
      "Added a Drafts tab to the admin portal showing all unfinished game drafts across users, with view-detail, open-in-wizard, and delete actions; existing Games tab now hides drafts",
      "Match history now shows both players as side-by-side cards — your card always appears first on the left; the result trophy icon is contained in the upper-left of the winner's card; a chess-piece icon (♔ or ♚) in the lower-right of each card shows which player color each person was",
      "Match history list view reverted to the original compact row layout; player 1 (white) is now always listed first followed by player 2 (black), and a small ♔/♚ icon appears inline next to each name to show player color",
      "Match history detail page (match review) always shows the player 1 card on the left and player 2 card on the right; the winner crown badge is now contained inside the top-left of the winning card, and a ♔/♚ color icon sits in the lower-right corner of each card",
    ]
  },
  {
    date: "April 18, 2026",
    title: "Promotion Overhaul, Match Review Polish & Piece Wizard Limits",
    items: [
      "Promotion target selection has moved out of the piece wizard and into the game wizard — when you place a piece that can promote, a new collapsible 'Promotion Options' section now appears in step 4 next to Combat Stats",
      "You can override the default promotion list per placement, with a paginated piece picker capped at the number of unique piece types on the board plus 8",
      "If your game uses the checkmate win condition, you can now allow a piece to promote into a checkmate piece (e.g. another king), with an optional 'cannot exceed the original starting count' guard that hides the option from the promotion modal once the player owns as many checkmate pieces as they started with",
      "The same allow/limit pair is available for win-on-capture pieces, regardless of win condition",
      "Mirroring a player's pieces in step 4 now copies these new promotion settings as well",
      "Game detail pages now describe each piece's promotion targets, including any allowance for checkmate or win-on-capture targets and any 'limit to original count' guards",
      "Sandbox now respects 'first move only' movement and capture restrictions — once a piece has moved, those moves are no longer offered, matching live-game behaviour",
      "Match review now has a true 'starting position' before the first move — using ⏮ jumps to the empty-history view, and arrow keys can step into and out of it",
      "When viewing the starting position, no row in the move history table is highlighted; pressing the right arrow then highlights the first move",
      "Grove theme background tuned to a subtly greener tint",
      "Pieces with more than 2 image variants can now actually use those extra images in real games — pick any image in the 'Choose Image' grid and it will be saved with the placement and shown everywhere (sandbox, home preview, live games, match review, promotions)",
      "Clicking Player 1 or Player 2 still resets the image to that player's default; only clicking inside the image grid creates an override",
      "When a game is saved, you'll now get a dismissible warning if you've assigned a dark image to Player 1 or a light image to Player 2",
      "Large card shadows (e.g. home preview board, feature cards, create-news panel, career listings) toned down for a cleaner, less dramatic look",
      "Step-by-step movement, capture, and ranged attack values are now capped at 8 to prevent extreme pieces from causing hover lag",
      "Custom square movement and attack are now limited to 50 squares each, with a live counter shown in the piece wizard",
      "Adding new custom squares is automatically blocked when step-by-step movement, capture, or ranged attack is set to 7 or higher (the step area already covers the entire grid), with a clear in-wizard message explaining why",
      "Updated piece wizard tooltips to document the new step-by-step and custom-square limits",
      "Piece detail pages now collapse the custom-square movement and attack lists by default when there are 10 or more squares, with a Show all / Hide toggle",
      "All dates and times across the site (last active, account creation, piece/game creation, forums, comments, news, careers, changelog, etc.) now display in your own local time, converted from a single UTC source of truth so relative ordering stays correct across users",
      "Removing the checkmate or capture win condition from a game now correctly clears any per-placement checkmate/capture flags so leftover icons no longer appear in the wizard or game detail page",
      "Sandbox now uses the same purple highlight as the piece detail page for first-move-only movement and capture squares",
      "Added Anti-Chess support: a new 'Lose-All-Pieces Win' condition lets a player win as soon as they have lost all of their pieces",
      "Added a 'Stalemate Win' condition — when enabled, a stalemated player (no legal moves and not in check) wins instead of the game being a draw",
      "Added a 'Forced Capture' gameplay rule — when enabled, if any of your pieces can capture, you must make a capturing move (any capture) on your turn",
      "All three new rules are explained on the game detail page and listed alongside existing win conditions on game library cards, match history, and live game over messages",
      "Customize Promotion Options now searches the full piece library — every piece is reachable via search and pagination, not just the first few past those already on the board",
      "Selected promotion targets now appear as a separate, always-visible chip list above the picker, with one-click removal — no more hunting through pages or search to see what you've picked",
      "Right-clicking a piece in step 4 now opens the piece selector instantly because it reuses the pieces already loaded by the placement editor instead of re-fetching them",
      "Game detail pages now render promotion-target piece names as proper links to the piece detail pages, even when those pieces aren't placed on the board",
      "Forced Capture rejections now name the exact piece, target, and capture type the server detected, so it's much easier to find the available capture (or report a false positive)",
      "Forced Capture now also recognizes ranged attacks and en passant as captures, so the rule no longer blocks valid en-passant moves or non-capturing moves when the only available capture was a ranged attack",
      "Fixed a Forced Capture false positive where extended-distance moves (like a pawn's first-move two-square advance) were treated as captures even in directions the piece can only move — not capture — through",
      "The threefold-repetition draw counter now resets when a piece takes damage but survives, so wearing down high-HP pieces no longer triggers an unintended draw",
      "Added a new home-page banner inviting players to share bugs and feedback on the forums, with a heads-up about frequent server restarts during this update period — admins can toggle it on/off and edit its text from the Site Settings tab",
      "Trimmed a large amount of console noise (Redux actions, reducers, services, hover and socket-connection logs) for a cleaner browser console",
    ]
  },
  {
    date: "April 17, 2026",
    title: "Theme Polish, Live Fixes & Better Browsing",
    items: [
      "Profile pages now open published games and pieces on their public detail pages, while drafts still jump straight into the editor",
      "Direct links to older game types on /play now load the correct game, and the game-type sidebar now supports pagination",
      "Blocked ranged attacks in live games no longer make the attacking piece appear to move before the server rejects the shot",
      "Piece detail pages now explain custom-square movement and attack patterns in plain text",
      "Clicking alternate piece images now previews that image on the piece board until you refresh or leave the page",
      "Footer section headings now link directly to Create, Play, Community, and Info",
      "Home page stats, hero buttons, and shared green/blue hover accents have been refined for a cleaner, more consistent theme across navigation and buttons",
      "Piece library cards in the grove theme now use the same darker border treatment as game library cards instead of the old blue-tinted outlines",
      "Forum Subject and Written By columns now stay left-aligned consistently across forum tables",
      "Dark panels such as profile, edit profile, and preferences sections now use softer shadows and lower-contrast borders for a cleaner look",
      "Dark cards, sections, filters, and other panel-style elements now use the same border treatment as the user profile across hubs, forums, streams, news, tutorial, and shared buttons",
    ]
  },
  {
    date: "April 16, 2026",
    title: "Game Wizard & Bug Fixes",
    items: [
      "Game sounds are now on by default for new users — no need to enable them manually",
      "Last move indicators in live games now show all moves made during a multi-action turn, not just the final move",
      "Vacated squares now use a dashed outline instead of a solid highlight, making it easier to distinguish where a piece moved from vs. where it landed",
      "Editing a published game now offers 'Copy as Draft' — creates a separate draft copy so the original game stays public and playable",
      "Game wizard header now shows 'Save as Draft' and 'Save and Exit' buttons at the top of every step for easier access",
      "Previous and Next buttons are now anchored to the bottom corners of the wizard for consistent navigation",
      "Simultaneous turns and Create anonymously options now use toggle switches with tooltips instead of checkboxes with inline text",
      "Game detail page now shows the board setup and stats above the description for a better first impression",
      "Fixed a bug where ranged units without 'fire over pieces' could appear to move through blocking pieces instead of being blocked",
      "The final checkmate move is now recorded and displayed in the match history",
      "Check (+) and checkmate (#) notation now appears on moves in the match history",
      "Correspondence games now appear in the ongoing games sections on /play and profile pages",
      "Ongoing games on /play are now split into 'Live Games' and 'Correspondence Games' sections",
      "Ongoing Games section on player profiles is now displayed above My Games for better visibility",
      "The /play page now shows the number of players currently online next to the connection indicator",
    ]
  },
  {
    date: "April 15, 2026",
    title: "Sound Effects, AI, Home Board & UI Overhaul",
    items: [
      "Home page board now features turn-based play — alternate between your pieces and the opponent's",
      "Turn indicator in the lower-left shows whose turn it is with a colored dot",
      "Hovering a piece on the home board now previews its available moves and captures with distinct colors",
      "Gold dots and orange borders indicate moves that are only available on the piece's first move",
      "Last-move highlights now use a subtle dashed outline (matching sandbox style) instead of permanent colors",
      "Clicking a different piece properly clears the previous piece's highlights",
      "First N moves restrictions are now respected on the home page board",
      "Home board panel border width now matches other panels on the page",
      "Fixed dragging pieces on the home page sometimes picking up the entire row as a chunk",
      "AI difficulty buttons in the host game modal now spread evenly across their row",
      "New distinct sound effect plays when a piece is hit but survives (HP/AD system)",
      "Sound playback length reduced to 0.6s for snappier feedback; move sounds play at 0.25s and check sounds at 0.4s for even snappier response",
      "Computer opponent now values piece exchanges more aggressively — trading a lower-value piece for a higher-value one is prioritized",
      "Sound effects now reliably play after switching back to the browser tab",
      "The last move of a game now plays its sound (capture, move, etc.) even when the game ends in checkmate",
      "Winning by capture now correctly plays the capture sound effect",
      "Check sound now plays on the first move of a multi-action turn when that move puts the opponent in check",
      "Fixed a bug where pieces with 'disable hopping for non-exact directional movement' could still hop through other pieces when calculating check and checkmate",
      "Fixed the first sound in a computer game sometimes playing at full length instead of being clipped",
      "Premoves in multi-action turn games no longer end your turn early — remaining actions are preserved",
      "King-type pieces can no longer be directly captured in multi-action games — checkmate is required",
      "Fixed 'You are in check' incorrectly showing for the moving player when they put the opponent in check mid-turn",
      "When you put the opponent in check mid-turn, a message now tells you to try to checkmate them before your turn ends",
      "Fixed the first computer move sound still sometimes playing at full length",
      "Restored the 'Ends game on checkmate' toggle in the piece placement modal of the game wizard",
      "Castling partners section now matches the width of Combat Stats and Additional Piece Settings sections",
      "Restored toggle switch styling to rounded pill shape in the game wizard",
      "Fixed pieces incorrectly showing capture-only squares as valid moves during regular turns in bot games",
      "Premoves can now target squares occupied by your own pieces — if the opponent captures your piece, your premove will recapture the attacker",
      "Premoves now correctly trigger promotion when a piece reaches a promotion square",
      "If only one promotion option is available, the piece auto-promotes without showing a modal",
      "When no valid promotion options exist, a message is shown instead of freezing the game",
      "Promotion no longer offers promotable, checkmate, or capture-loss pieces as options",
      "Premoves now play the check sound when the premove puts the opponent in check",
      "Improved connection resilience — the game automatically reconnects after server restarts or network interruptions",
      "Premoves can now target enemy checkmate pieces (they may move away before your premove executes)",
      "Offering a draw to the computer now automatically results in a draw",
      "New 'Premove Clock Cost' option in Additional Options — optionally deducts 0.1 seconds per premove instead of being free",
      "Additional Options in the host game modal now use toggle switches with helpful descriptions for each setting",
      "Toggle switch styling restored to rounded pill shape across the entire site",
      "Green theme header and footer gradients are slightly more green again while staying lighter than original",
      "Reduced duplicate API calls — site settings now load once on startup instead of per-component",
      "Game lobby lists now managed centrally for better performance",
      "Host game modal dropdowns and Play As buttons restyled for a cleaner, more consistent look",
      "Dropdown option backgrounds are now dark for better readability",
      "Additional Options panel now overlays the modal instead of expanding it",
      "Notification links for new user registrations now correctly open their profile page",
      "Change password now works properly on the Edit Profile page — enter your current and new password to update",
      "New 'Update Password' button lets you change just your password without updating other settings",
      "Password requirements are now shown as a live checklist while typing your new password",
      "New site logo and favicon — updated across browser tabs, navbar, and PWA icons",
      "Dark-themed browsers now see a lighter favicon for better visibility",
      "Navbar logo is now slightly larger with a subtle warm glow on hover",
      "Win on promotion now triggers correctly even when no valid promotion pieces exist",
      "Promotion square highlights are now a lighter, more visible purple",
      "Match history board now fits within the screen on mobile devices",
      "Match history no longer shows 'won by game completed' — all win conditions now display properly",
      "Game Details and Game Settings sections in match history are now collapsible (collapsed by default)",
      "Lichess users can now edit their profile without adding an email address",
      "New 'Show Details' toggle on the game details page — switch between a clean board view and one with all overlays (badges, dots, special squares, etc.)",
      "Fixed mobile drag-and-drop showing a duplicate ghost piece instead of lifting the original in live games",
      "Mobile touch drag-and-drop now works on all boards — home page, sandbox, piece wizard preview, game wizard piece placement, and special square placement steps",
      "Admin and owner image uploads are now auto-approved — no more 'Under Review' for your own pieces",
      "New 'Moderation' tab in the admin dashboard to review, approve, or reject flagged piece images",
      "Admins and owners can now approve pieces directly from the piece details page when images are under review",
      "Piece images that fail to load now show a matching chess piece from the built-in library as a fallback instead of blank/broken images",
      "Editing a piece's images no longer breaks pieces in active games — old image files are preserved for compatibility",
    ],
  },
  {
    date: "April 14, 2026",
    title: "Lichess Login, Spectator Fixes, Theme Cleanup & Sound Improvements",
    items: [
      "You can now sign in or register with your Lichess account",
      "Lichess login button appears on both the Login and Register pages",
      "Spectators now see both players' actual names on the chess clocks instead of '(You)'",
      "Spectators no longer see a green highlight border on the clocks",
      "The active turn indicator now correctly highlights the current player's clock for spectators",
      "Spectators can no longer click on pieces or set premoves",
      "Spectator list now properly displays when others are watching a game",
      "You can now skip steps freely in the game and piece creation wizards",
      "Clicking Create/Save with missing required fields now shows a clear prompt listing what still needs to be filled in",
      "New check sound effect for a more distinct alert",
      "Sound effects now play longer (0.8s) for better clarity",
      "Fixed a rare issue where capture sounds could be skipped during rapid play",
      "Pieces with separate attack patterns (like pawns) can now properly premove their attack squares",
      "Sound effects are now enabled by default for new visitors",
      "In-game options panel now uses a collapsible arrow instead of an X button",
      "Sound playback length reduced to 0.7s for snappier feedback",
      "Admin portal links no longer show underlines",
      "Long-pressing pieces on the home page no longer triggers the browser image menu on mobile",
      "Touch drag on mobile now shows check error messages and plays illegal move sounds, matching desktop behavior",
      "Touch drag now properly handles multi-tile piece grab offset on mobile",
      "Clicking a 'new user joined' notification now leads to that user's profile page",
      "Footer top border now matches the header bottom border color for visual consistency",
      "Green theme header and footer gradients are now more gray and slightly lighter",
      "Standard buttons no longer use gradients — flat, muted backgrounds with theme-aware borders",
      "Removed high-contrast gradients from game mode tabs, fill-row switches, and progress bars",
      "Replaced hardcoded hex colors across 10+ files with reusable CSS theme variables",
      "Special square colors (range, promotion, control, custom) are now centralized as CSS custom properties",
      "Role badges (Owner, Admin) now use shared CSS variables for consistent styling",
      "Player list avatar, rating, and link colors now use theme variables instead of hardcoded values",
      "Admin dashboard empty-state text colors replaced with theme variables",
      "Game rules now show stalemate as a draw condition when checkmate is enabled",
      "Game rules now show an insufficient material draw condition when both sides have checkmatable pieces",
      "Win conditions section now names the specific piece that must be checkmated",
      "Game rules automatically refresh when returning from editing a game type",
      "Insufficient material draw now triggers in live games when only checkmatable pieces remain",
    ],
  },
  {
    date: "April 13, 2026",
    title: "Library UX, New Abilities, Upvotes & Profile Improvements",
    items: [
      "New piece ability: Die on Capture — a piece is destroyed after it captures an enemy piece",
      "New piece ability: Attack Radius — when capturing, the piece damages all enemies within a radius of the landing square (up to 4)",
      "Attack Radius is mutually exclusive with Trample Radius — you can set one but not both",
      "Checkmate-immune pieces (e.g. kings) are immune to Attack Radius splash damage",
      "Attack Radius splash zones are highlighted when hovering a piece with the ability in game detail, live game, and game wizard",
      "Both new abilities are available in the Piece Wizard under Special Abilities with tooltips",
      "Game detail page now displays Die on Capture and Attack Radius in the Special Rules section",
      "New win condition: Win on Promotion — when enabled, a player instantly wins when their promotable piece reaches a promotion square",
      "Win on Promotion works with bot games as well",
      "Fixed image moderation model failing to load on startup",
      "Game library now displays all win conditions including No Legal Moves and Win on Promotion",
      "New filter options for No Legal Moves and Win on Promotion in the game library",
      "Upvote system: upvote your favorite games in the library and on game detail pages",
      "New 'Most Upvoted' sort option in the game library",
      "Range squares now grant a +1 bonus to all movement, capture, and attack ranges for pieces standing on them (previously visual-only)",
      "Range square bonus applies to directional, step, ratio, and additional scenario movements",
      "Match history now shows all win reasons including promotion, piece count, move limit, repetition, and agreement",
      "Upvote button moved to upper-right corner of game cards and game detail header for easier access",
      "Game cards now feature a play button that takes you directly to the play screen with that game selected",
      "Create New Game and Create New Piece buttons now appear in the header row next to the page title",
      "On smaller screens, the create button moves to its own centered row below the header",
      "My Games and My Pieces filter buttons replaced with options in the Sort By dropdown",
      "Show Pieces As toggle moved into the filter controls area on the Piece Library page",
      "My Games and My Pieces sections on profiles are now collapsible with a toggle arrow",
      "Match History section on profiles is now collapsible and no longer has extra top margin",
      "Long-pressing piece images on mobile no longer triggers the browser context menu",
      "Touch-action fixes applied to boards across home, sandbox, game wizard, match view, and game type view",
      "Emoji picker now lazy-loads emojis for faster opening and smoother scrolling",
      "Emoji category headers removed from the picker grid for a cleaner layout",
      "Admin and Owner roles can now properly edit other users' profiles",
      "Admin and Owner roles can now properly edit forum posts they didn't create",
      "Every forum post page now has a 'Back to Forums' arrow link at the top",
      "Game links in the Game Forums table no longer show underlines and have proper hover styling",
      "Create New Game and Create New Piece buttons are now anchored to the upper right with the title centered",
      "Match History section on profiles now uses the same panel styling as Ongoing Games",
      "Fixed piece drag and drop on the home page boards that stopped working on desktop",
      "Admins can now only moderate content from regular users; Owners can moderate all content including admin content",
      "Profile Bio section now uses the same card styling as other profile sections",
      "Profile card sections have tighter padding for a more compact layout",
      "My Games, My Pieces, and Match History sections are now collapsed by default on profiles",
      "Reduced spacing in friends list and ongoing games sections on profiles",
      "Create button padding and game/piece library title margins adjusted for a cleaner header",
      "Filter controls on Game Library and Piece Library pages now fit content width on larger screens",
      "Accent text color is slightly lighter across both green and blue themes for better readability",
      "Visual refresh: reduced border-radius, removed color transition animations, and dimmed overly bright borders across the site",
      "Reduced gradient contrast across all panels and cards for a more muted look",
      "More muted hover borders across the site — less aggressive accent color on hover",
      "Navigation header is now shorter (7vh) with a subtle reverse gradient (darker at bottom)",
      "Green theme header is now darker than the page background",
      "Line under the header is now dark gray instead of the theme color",
      "Home page buttons have reduced border-radius and more muted borders",
    ]
  },
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
  const { changelogEnabled, loaded } = useSelector((state) => state.siteSettings);
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(changelogData.length / ENTRIES_PER_PAGE);
  const pageEntries = changelogData.slice(page * ENTRIES_PER_PAGE, (page + 1) * ENTRIES_PER_PAGE);

  if (!loaded) {
    return (
      <div className={styles["changelog-container"]}>
        <div className={styles["changelog-header"]}>
          <h1>Changelog</h1>
        </div>
      </div>
    );
  }

  if (!changelogEnabled) {
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
