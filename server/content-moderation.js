/**
 * Content moderation utilities for username validation, profanity filtering,
 * and link detection. Uses word-boundary matching to avoid the Scunthorpe problem.
 */

// Offensive words matched with word boundaries to avoid false positives.
// Each entry is a regex pattern string (case-insensitive).
// Word boundaries (\b) ensure "Scunthorpe" won't match "c*nt", etc.
const OFFENSIVE_PATTERNS = [
  // Slurs and hate speech
  '\\bn[i1]gg(?:er|a|az|uh|ah?)s?\\b',
  '\\bf[a@]gg?[o0]ts?\\b',
  '\\bk[i1]ke[sz]?\\b',
  '\\bch[i1]nks?\\b',
  '\\bsp[i1]cs?\\b',
  '\\bw[e3]tb[a@]cks?\\b',
  '\\bg[o0]{2}ks?\\b',
  '\\bcr[a@]ck[e3]rs?\\b',
  '\\btr[a@]nn(?:y|ie)s?\\b',
  '\\br[e3]t[a@]rds?\\b',
  // Sexual/explicit
  '\\bc[u\\*]nts?\\b',
  '\\bf+[u\\*]+c+k+(?:e[rd]|ing|face|head|wad|wit)?s?\\b',
  '\\bs+h+[i1\\*]+t+(?:e[rd]|ing|head|face|stain)?s?\\b',
  '\\bb[i1]tch(?:e[sz]|ing|ass)?\\b',
  '\\ba[s\\$][s\\$]h[o0]le[sz]?\\b',
  '\\bd[i1]cks?(?:head|face|wad)?\\b',
  '\\bcock(?:sucker|head|face)?s?\\b',
  '\\btw[a@]ts?\\b',
  '\\bwh[o0]re[sz]?\\b',
  '\\bsl[u\\*]ts?\\b',
  '\\bp[e3]n[i1]s(?:es)?\\b',
  '\\bv[a@]g[i1]na[sz]?\\b',
  '\\bp[u\\*]ss(?:y|ies|ie)\\b',
  '\\bj[i1]zz\\b',
  '\\bc[u\\*]m(?:shot|dump|bucket)?\\b',
  // Violence/threats
  '\\bk[i1]ll\\s*y[o0]urself\\b',
  '\\bkys\\b',
  // Nazi/supremacist
  '\\bn[a@]z[i1]s?\\b',
  '\\bh[e3][i1]l\\s*h[i1]tl[e3]r\\b',
  '\\bwh[i1]te\\s*(?:power|supremac)\\b',
  '\\bs[i1]eg\\s*h[e3][i1]l\\b',
];

// Pre-compile all patterns for performance
const compiledOffensivePatterns = OFFENSIVE_PATTERNS.map(pattern => new RegExp(pattern, 'i'));

/**
 * Patterns for terms that are inappropriate in official game/piece names but may be
 * acceptable in forum posts, bios, and other free-form content.
 * Categories: sexual orientation, political figures/movements, drugs, sexual content,
 * violence/dark themes, and religious extremism.
 * Matching is word-boundary aware to avoid false positives.
 */
const PROFESSIONAL_NAME_PATTERNS = [
  // Sexual orientation / gender identity (not slurs, but not fitting for a game title)
  /\bgays?\b/i,
  /\blesbians?\b/i,
  /\bhomosexuals?\b/i,
  /\bbisexuals?\b/i,
  /\bpansexuals?\b/i,
  /\bqueers?\b/i,
  /\blgbtq?\+?\b/i,
  /\btransgenders?\b/i,
  /\btrans(?:sexual|gender|man|woman|girl|boy|femme|masc|nb)?\b/i,
  /\bnonbinary\b/i,
  /\basexuals?\b/i,
  /\bheterosexuals?\b/i,

  // Political figures / movements
  /\brepublicans?\b/i,
  /\bdemocrats?\b/i,
  /\bsocialists?\b/i,
  /\bcommunists?\b/i,
  /\bmarxists?\b/i,
  /\bfascists?\b/i,
  /\banarchists?\b/i,
  /\bliberals?\b/i,
  /\bconservatives?\b/i,
  /\bmaga\b/i,
  /\bantifa\b/i,
  /\btrump\b/i,
  /\bbiden\b/i,
  /\bobama\b/i,
  /\bkkk\b/i,
  /\bbolsheviks?\b/i,
  /\bnationalists?\b/i,

  // Drugs / narcotics
  /\bweed\b/i,
  /\bmarijuana\b/i,
  /\bcannabis\b/i,
  /\bcocaine\b/i,
  /\bheroin\b/i,
  /\bmeth(?:amphetamine)?\b/i,
  /\becstasy\b/i,
  /\bmdma\b/i,
  /\blsd\b/i,
  /\bshrooms\b/i,
  /\bfentanyl\b/i,
  /\bketamine\b/i,
  /\bpcp\b/i,
  /\bamphetamines?\b/i,
  /\bopioids?\b/i,
  /\bstoners?\b/i,
  /\bcrack\s+cocaine\b/i,

  // Sexual content (milder terms not covered by the strict offensive list)
  /\bsex(?:y|ual|ually)?\b/i,
  /\bporn(?:ography|ographic)?\b/i,
  /\berotica?\b/i,
  /\bfetish(?:es)?\b/i,
  /\bbdsm\b/i,
  /\borgasms?\b/i,
  /\bmasturbat(?:e|ing|ion)\b/i,
  /\bdildos?\b/i,
  /\bvibrators?\b/i,
  /\bnudes?\b/i,
  /\bnaked\b/i,
  /\bprostitut(?:e|es|ion)\b/i,
  /\bstrippers?\b/i,
  /\bhentai\b/i,
  /\bforeplay\b/i,
  /\bintercourse\b/i,
  /\bsexting\b/i,
  /\bescorts?\b/i,

  // Violence / dark themes not already in the strict offensive list
  /\bgenocide\b/i,
  /\btorture\b/i,
  /\bpedophil(?:e|es|ia|ic)\b/i,
  /\bincest\b/i,
  /\bnecrophilia\b/i,

  // Religious extremism
  /\bjihad\b/i,
  /\bterroris(?:t|ts|m)\b/i,
  /\bshari[a']?a\b/i,
  // Political figures - despots, Nazi leaders, and present-day politicians.
  // The Terms (section 10) keep political figures out of games and pieces.
  // Held for review rather than refused: some are ordinary words ("trump").
  // Hitler himself is refused outright - see checkBannedTerms.
  /\bstalin\b/i, /\bmussolini\b/i, /\bpol\s*pot\b/i, /\bmao\s*(?:zedong|tse)/i,
  /\bkim\s*jong/i, /\bidi\s*amin\b/i, /\bsaddam\b/i, /\b[gq]add?af+i\b/i,
  /\bhimmler\b/i, /\bgoebbels\b/i, /\bg(?:oe|ö|o)ring\b/i, /\bmengele\b/i, /\beichmann\b/i,
  /\bpinochet\b/i, /\blenin\b/i, /\btrotsky\b/i, /\bguevara\b/i,
  /\bputin\b/i, /\btrump\b/i, /\bbiden\b/i, /\bobama\b/i, /\bzelensk/i, /\bnetanyahu\b/i,
  /\bxi\s*jinping\b/i, /\berdo[gğ]an\b/i, /\bkhamenei\b/i, /\badolf\b/i,
  // Extremist movements
  /\b(?:third|3rd)\s*reich\b/i, /\bkkk\b/i, /\bku\s*klux/i, /\btaliban\b/i, /\bal[\s-]*qa[e']?da\b/i,
];

/*
 * Terms refused outright in game and piece names and descriptions, and in
 * usernames - no innocent use, and the reason section 10 of the Terms exists.
 *
 * Matched after normalising (see normaliseForEvasion) so the obvious dodges
 * fail: "Hitlar", "H1tl3r", "H.i.t.l.e.r", "h i t l e r", "hitlerr".
 */
const BANNED_TERM_PATTERNS = [
  { label: 'Hitler', re: /h+[iy]+t+l+[aeiouy]+r+/ },
  { label: 'swastika', re: /sw[ao]st[iy]ka|hakenkreuz/ },
  { label: 'Führer', re: /f+u+e?h+r+e+r+/ },
  { label: 'Sieg Heil', re: /siegheil/ },
];

/*
 * Lower-case, accents and look-alike characters to plain letters, and every
 * non-letter dropped - so spacing and punctuation cannot split a word the
 * filter is looking for.
 */
function normaliseForEvasion(text) {
  const map = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't' };
  return String(text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[01!|34@5$7]/g, (c) => map[c] || c)
    .replace(/[^a-z]/g, '');
}

/*
 * Does a set of board squares form a swastika - exactly, not merely contain
 * one? For custom movement / attack squares (offsets {row, col} from the
 * piece), which the Terms (section 10) forbid shaping into a hate symbol.
 *
 * "Exactly" is the point: a piece that covers a wide area contains every shape
 * there is, so only a pattern whose squares ARE a swastika - its centre
 * anywhere, optionally included, give or take two stray squares - counts. Upright or turned 45 degrees, either
 * direction, arms 2 or more long with hooks up to the arm's length. Arms of 1
 * are the eight squares round the piece, a king, so they do not count.
 *
 * @param {Array<{row:number,col:number}>} squares
 * @returns {boolean}
 */
function formsSwastika(squares) {
  if (!Array.isArray(squares) || squares.length < 12) return false;
  const cells = new Set(squares.map((s) => `${Number(s.col) || 0},${Number(s.row) || 0}`));
  const size = cells.size;
  const coords = [...cells].map((k) => k.split(',').map(Number));
  const axes = [
    [[1, 0], [0, 1], [-1, 0], [0, -1]],   // upright
    [[1, 1], [-1, 1], [-1, -1], [1, -1]], // turned 45 degrees
  ];
  // Candidate centres: the piece's own (0,0), every square, and - for a
  // pattern whose centre is an empty square, as on a board - the middle of
  // its bounding box and its rounded centroid (a stray square or two moves one
  // but seldom both).
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const mid = [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)];
  const mean = [Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)];
  const centres = [[0, 0], mid, mean, ...coords];
  for (const [cx, cy] of centres) {
    for (const dirs of axes) {
      for (const turn of [1, -1]) {
        for (let arm = 2; arm <= 7; arm++) {
          for (let hook = 1; hook <= arm; hook++) {
            // A shape of the wrong size cannot match - skip building it
            // (its centre and up to two strays aside).
            if (size < 4 * (arm + hook) || size > 4 * (arm + hook) + 3) continue;
            const shape = new Set();
            dirs.forEach(([dx, dy], i) => {
              // the hook turns the same way at every arm - that is the symbol
              const [hx, hy] = dirs[(i + turn + 4) % 4];
              for (let k = 1; k <= arm; k++) shape.add(`${cx + dx * k},${cy + dy * k}`);
              for (let j = 1; j <= hook; j++) shape.add(`${cx + dx * arm + hx * j},${cy + dy * arm + hy * j}`);
            });
            // Up to two stray squares still read as the symbol - adding one
            // should not be enough to get it past.
            const centreKey = `${cx},${cy}`;
            const expected = shape.size + (cells.has(centreKey) ? 1 : 0);
            if (size < expected || size > expected + 2) continue;
            if ([...shape].every((k) => cells.has(k))) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * A piece's custom movement and attack squares (as saved - JSON or arrays),
 * checked apart and together. Returns the warning for the creator, or null -
 * a warning, not a refusal: the creator is told and a moderator decides.
 */
function checkPiecePatterns(movementSquares, attackSquares) {
  const parse = (v) => {
    try {
      const out = typeof v === 'string' ? JSON.parse(v) : v;
      return Array.isArray(out) ? out : [];
    } catch (e) {
      return [];
    }
  };
  const move = parse(movementSquares);
  const attack = parse(attackSquares);
  if (formsSwastika(move) || formsSwastika(attack) || formsSwastika([...move, ...attack])) {
    return 'Saved - but this piece\'s custom squares look like a swastika. Movement and attack patterns '
      + 'shaped into hate symbols may be against the Terms and Conditions (section 10), and moderators can '
      + 'remove the piece. If that is not what you meant, consider changing the pattern.';
  }
  return null;
}

/**
 * A game's starting position (the wizard's pieces_string: an object keyed
 * "y,x", or an array, of placements with x / y and an owner), checked for the
 * same symbol - each player's pieces, and all of them together. Returns the
 * warning for the creator (never a refusal), or null.
 */
function checkBoardPatterns(piecesString) {
  let placed;
  try {
    placed = typeof piecesString === 'string' ? JSON.parse(piecesString || '{}') : (piecesString || {});
  } catch (e) {
    return null;
  }
  const list = (Array.isArray(placed) ? placed : Object.values(placed))
    .filter((p) => p && !p._occupied && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
  const squaresOf = (pieces) => pieces.map((p) => ({ col: Number(p.x), row: Number(p.y) }));
  const owners = new Map();
  for (const p of list) {
    const owner = p.player_id ?? p.player_number ?? p.team ?? 0;
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(p);
  }
  const groups = [list, ...owners.values()];
  if (groups.some((g) => formsSwastika(squaresOf(g)))) {
    return 'Saved - but the starting position looks like pieces arranged into a swastika. Arrangements '
      + 'shaped into hate symbols may be against the Terms and Conditions (section 10), and moderators can '
      + 'remove the game. If that is not what you meant, consider moving the pieces.';
  }
  return null;
}

/**
 * Terms refused outright (BANNED_TERM_PATTERNS), with evasions.
 * Returns { isClean: boolean, matches: string[] } - matches are labels.
 */
function checkBannedTerms(text) {
  if (!text || typeof text !== 'string') return { isClean: true, matches: [] };
  /*
   * Word by word, not the whole text run together: joined up, ordinary prose
   * matches ("which it lures" holds "hitlur"). Punctuation inside a word is
   * dropped ("H.i.t.l.e.r", "Hit-lar"), and a run of single letters is read as
   * one word ("h i t l e r").
   */
  const words = text.split(/\s+/).map(normaliseForEvasion).filter(Boolean);
  const candidates = [...words];
  let run = '';
  for (const w of [...words, '']) {
    if (w.length === 1) { run += w; continue; }
    if (run.length > 1) candidates.push(run);
    run = '';
  }
  const matches = BANNED_TERM_PATTERNS
    .filter(({ re }) => candidates.some((c) => re.test(c)))
    .map(({ label }) => label);
  return { isClean: matches.length === 0, matches };
}

// Additional patterns specifically for usernames (matched as substrings, not just whole words)
// These are terms that have no innocent use in a username context
const USERNAME_OFFENSIVE_SUBSTRINGS = [
  'nigger', 'nigga', 'faggot', 'faggit', 'f4gg0t',
  'nazi', 'hitler', 'heil',
  'rape', 'rapist',
];

// URL/link detection pattern — only matches URLs with explicit protocol or www. prefix.
// Bare-domain detection (no protocol) is handled separately by BARE_DOMAIN_PATTERN below
// to avoid false-positives on filenames like "script.bat" or "module.js".
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;

// Common TLD check for bare domains (no protocol)
const BARE_DOMAIN_PATTERN = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|net|org|io|co|dev|gg|me|tv|cc|xyz|info|biz|us|uk|ca|au|de|fr|ru|cn|jp|app|site|online|store|shop|tech|live|pro|club|link|click|win|top|work|space|fun|website|stream|download|review|party|trade|bid|date|racing|science|faith|accountant|cricket|loan|zip|mov|nexus)\b/gi;

// Default allowed hosts for whitelist mode
const DEFAULT_ALLOWED_HOSTS = ['gridgrove.gg', 'chess.com', 'lichess.org'];
// Default cap on number of allowed links per piece of content
const DEFAULT_MAX_LINKS = 3;

/**
 * Extract the host (lowercased, www. stripped) from a link string.
 * Accepts URLs with or without protocol, and bare domains.
 * Returns null if no host can be determined.
 */
function extractHost(linkText) {
  if (!linkText || typeof linkText !== 'string') return null;
  // Strip protocol if present, then take everything up to the first slash, space, or query/hash
  const m = linkText.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\s?#]+)/i);
  if (!m) return null;
  // Strip trailing punctuation that may have been captured from surrounding markup (e.g. ) from markdown)
  return m[1].replace(/[)\]>.,;:!?]+$/, '').toLowerCase();
}

/**
 * Returns true if the host matches one of the allowed hosts (exact match or subdomain).
 */
function isHostAllowed(host, allowedHosts) {
  if (!host) return false;
  return allowedHosts.some((h) => {
    const allowed = h.toLowerCase();
    return host === allowed || host.endsWith('.' + allowed);
  });
}

/**
 * Check text for offensive content using word-boundary-aware patterns.
 * Returns { isClean: boolean, matches: string[] }
 */
function checkOffensiveContent(text) {
  if (!text || typeof text !== 'string') return { isClean: true, matches: [] };
  
  const matches = [];
  for (const pattern of compiledOffensivePatterns) {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }
  
  return {
    isClean: matches.length === 0,
    matches: [...new Set(matches)] // deduplicate
  };
}

/**
 * Check if a username contains offensive content.
 * Stricter than general text — also checks substring matches
 * since usernames don't have natural word boundaries.
 */
function checkUsername(username) {
  if (!username || typeof username !== 'string') return { isClean: true, matches: [] };
  
  const lower = username.toLowerCase();
  const matches = [];
  
  // First check word-boundary patterns (handles l33tspeak variants)
  const contentCheck = checkOffensiveContent(username);
  matches.push(...contentCheck.matches);
  
  // Then check username-specific substring patterns
  for (const term of USERNAME_OFFENSIVE_SUBSTRINGS) {
    if (lower.includes(term)) {
      matches.push(term);
    }
  }

  // And the terms refused everywhere, with their evasions ("hitlar", "h1tler")
  matches.push(...checkBannedTerms(username).matches);
  
  return {
    isClean: matches.length === 0,
    matches: [...new Set(matches)]
  };
}

/**
 * Check text for URLs/links.
 * Returns { hasLinks: boolean, links: string[] }
 */
function checkForLinks(text) {
  if (!text || typeof text !== 'string') return { hasLinks: false, links: [] };

  const links = [];

  // First extract URLs from markdown-style links [label](url).
  // This is the canonical form produced by the link-insert button and avoids
  // the trailing-')' problem where URL_PATTERN captures the closing paren as
  // part of the URL, making extractHost() return "gridgrove.gg)" instead of
  // "gridgrove.gg" for bare-domain links like [test](https://gridgrove.gg).
  const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]*)\)/g;
  let mdMatch;
  while ((mdMatch = MARKDOWN_LINK_RE.exec(text)) !== null) {
    links.push(mdMatch[2]); // just the URL, no surrounding punctuation
  }

  // Remove already-parsed markdown links before scanning for plain URLs
  // so the same URL is not counted twice.
  const textWithoutMarkdown = text.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]*)\)/g, '');

  // Check for plain URLs with protocol (http:// or www.)
  const urlMatches = textWithoutMarkdown.match(URL_PATTERN);
  if (urlMatches) {
    links.push(...urlMatches);
  }

  // Check for bare domain names
  const domainMatches = textWithoutMarkdown.match(BARE_DOMAIN_PATTERN);
  if (domainMatches) {
    links.push(...domainMatches);
  }

  return {
    hasLinks: links.length > 0,
    links: [...new Set(links)]
  };
}

/**
 * Validate user-generated content (descriptions, bios, etc.)
 *
 * options.allowLinks:
 *   - false (default): No links/URLs/bare domains allowed at all.
 *   - true:            Any links allowed (legacy behavior).
 *   - 'whitelist':     Allow only links whose host matches options.allowedHosts (or DEFAULT_ALLOWED_HOSTS),
 *                      capped at options.maxLinks (default DEFAULT_MAX_LINKS).
 *
 * Returns { isValid: boolean, errors: string[] }
 */
function validateContent(text, options = {}) {
  const {
    allowLinks = false,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    maxLinks = DEFAULT_MAX_LINKS,
    maxLength = null,
    fieldName = 'Content',
    // Games and pieces: also refuse BANNED_TERM_PATTERNS (Terms, section 10)
    bannedTerms = false,
  } = options;
  const errors = [];

  if (!text || typeof text !== 'string') return { isValid: true, errors: [] };

  if (maxLength && text.length > maxLength) {
    errors.push(`${fieldName} must be ${maxLength} characters or fewer`);
  }

  const offensiveCheck = checkOffensiveContent(text);
  if (!offensiveCheck.isClean) {
    errors.push(`${fieldName} contains inappropriate language. Please revise and try again.`);
  }

  if (bannedTerms) {
    const banned = checkBannedTerms(text);
    if (!banned.isClean) {
      errors.push(`${fieldName} can't include "${banned.matches[0]}", however it is spelled. `
        + 'Political figures and extremist symbols are not allowed in games or pieces (Terms and Conditions, section 10).');
    }
  }

  if (allowLinks === false) {
    const linkCheck = checkForLinks(text);
    if (linkCheck.hasLinks) {
      errors.push(`${fieldName} cannot contain links or URLs. Please remove any links and try again.`);
    }
  } else if (allowLinks === 'whitelist') {
    const linkCheck = checkForLinks(text);
    if (linkCheck.links.length > maxLinks) {
      errors.push(`${fieldName} cannot contain more than ${maxLinks} link${maxLinks === 1 ? '' : 's'}.`);
    }
    const disallowed = linkCheck.links.filter((l) => !isHostAllowed(extractHost(l), allowedHosts));
    if (disallowed.length > 0) {
      errors.push(`${fieldName} can only contain links to: ${allowedHosts.join(', ')}.`);
    }
  }
  // allowLinks === true: no link restrictions

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check whether a proposed game or piece name is suitable for a professional context.
 * Uses PROFESSIONAL_NAME_PATTERNS, which covers sexual orientation terms, political
 * figures/movements, drug references, sexual content, and related categories.
 *
 * Returns { isProfessional: boolean, matches: string[] }
 */
function checkProfessionalName(text) {
  if (!text || typeof text !== 'string') return { isProfessional: true, matches: [] };

  const matches = [];
  for (const pattern of PROFESSIONAL_NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  return {
    isProfessional: matches.length === 0,
    matches: [...new Set(matches)]
  };
}

module.exports = {
  checkOffensiveContent,
  checkUsername,
  checkForLinks,
  validateContent,
  checkProfessionalName,
  checkBannedTerms,
  formsSwastika,
  checkPiecePatterns,
  checkBoardPatterns,
  extractHost,
  isHostAllowed,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_MAX_LINKS
};
