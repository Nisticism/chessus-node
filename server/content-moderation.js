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
];

// Additional patterns specifically for usernames (matched as substrings, not just whole words)
// These are terms that have no innocent use in a username context
const USERNAME_OFFENSIVE_SUBSTRINGS = [
  'nigger', 'nigga', 'faggot', 'faggit', 'f4gg0t',
  'nazi', 'hitler', 'heil',
  'rape', 'rapist',
];

// URL/link detection pattern
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;

// Common TLD check for bare domains (no protocol)
const BARE_DOMAIN_PATTERN = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|net|org|io|co|dev|gg|me|tv|cc|xyz|info|biz|us|uk|ca|au|de|fr|ru|cn|jp|app|site|online|store|shop|tech|live|pro|club|link|click|win|top|work|space|fun|website|stream|download|review|party|trade|bid|date|racing|science|faith|accountant|cricket|loan|zip|mov|nexus)\b/gi;

// Default allowed hosts for whitelist mode (gridgrove.gg only for general site content)
const DEFAULT_ALLOWED_HOSTS = ['gridgrove.gg'];
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
  return m[1].toLowerCase();
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
  
  // Check for URLs with protocol
  const urlMatches = text.match(URL_PATTERN);
  if (urlMatches) {
    links.push(...urlMatches);
  }
  
  // Check for bare domain names
  const domainMatches = text.match(BARE_DOMAIN_PATTERN);
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
    fieldName = 'Content'
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
  extractHost,
  isHostAllowed,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_MAX_LINKS
};
