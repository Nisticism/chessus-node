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
 * Returns { isValid: boolean, errors: string[] }
 */
function validateContent(text, options = {}) {
  const { allowLinks = false, maxLength = null, fieldName = 'Content' } = options;
  const errors = [];
  
  if (!text || typeof text !== 'string') return { isValid: true, errors: [] };
  
  if (maxLength && text.length > maxLength) {
    errors.push(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  
  const offensiveCheck = checkOffensiveContent(text);
  if (!offensiveCheck.isClean) {
    errors.push(`${fieldName} contains inappropriate language. Please revise and try again.`);
  }
  
  if (!allowLinks) {
    const linkCheck = checkForLinks(text);
    if (linkCheck.hasLinks) {
      errors.push(`${fieldName} cannot contain links or URLs. Please remove any links and try again.`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  checkOffensiveContent,
  checkUsername,
  checkForLinks,
  validateContent
};
