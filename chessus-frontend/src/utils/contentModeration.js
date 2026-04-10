/**
 * Content moderation utilities for client-side validation.
 * Mirrors server/content-moderation.js for instant user feedback.
 */

// Word-boundary-aware offensive patterns (Scunthorpe-safe)
const OFFENSIVE_PATTERNS = [
  /\bn[i1]gg(?:er|a|az|uh|ah?)s?\b/i,
  /\bf[a@]gg?[o0]ts?\b/i,
  /\bk[i1]ke[sz]?\b/i,
  /\bch[i1]nks?\b/i,
  /\bsp[i1]cs?\b/i,
  /\bw[e3]tb[a@]cks?\b/i,
  /\bg[o0]{2}ks?\b/i,
  /\bcr[a@]ck[e3]rs?\b/i,
  /\btr[a@]nn(?:y|ie)s?\b/i,
  /\br[e3]t[a@]rds?\b/i,
  /\bc[u*]nts?\b/i,
  /\bf+[u*]+c+k+(?:e[rd]|ing|face|head|wad|wit)?s?\b/i,
  /\bs+h+[i1*]+t+(?:e[rd]|ing|head|face|stain)?s?\b/i,
  /\bb[i1]tch(?:e[sz]|ing|ass)?\b/i,
  /\ba[s$][s$]h[o0]le[sz]?\b/i,
  /\bd[i1]cks?(?:head|face|wad)?\b/i,
  /\bcock(?:sucker|head|face)?s?\b/i,
  /\btw[a@]ts?\b/i,
  /\bwh[o0]re[sz]?\b/i,
  /\bsl[u*]ts?\b/i,
  /\bp[e3]n[i1]s(?:es)?\b/i,
  /\bv[a@]g[i1]na[sz]?\b/i,
  /\bp[u*]ss(?:y|ies|ie)\b/i,
  /\bj[i1]zz\b/i,
  /\bc[u*]m(?:shot|dump|bucket)?\b/i,
  /\bk[i1]ll\s*y[o0]urself\b/i,
  /\bkys\b/i,
  /\bn[a@]z[i1]s?\b/i,
  /\bh[e3][i1]l\s*h[i1]tl[e3]r\b/i,
  /\bwh[i1]te\s*(?:power|supremac)\b/i,
  /\bs[i1]eg\s*h[e3][i1]l\b/i,
];

const USERNAME_OFFENSIVE_SUBSTRINGS = [
  'nigger', 'nigga', 'faggot', 'faggit', 'f4gg0t',
  'nazi', 'hitler', 'heil',
  'rape', 'rapist',
];

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;
const BARE_DOMAIN_PATTERN = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|net|org|io|co|dev|gg|me|tv|cc|xyz|info|biz|us|uk|ca|au|de|fr|ru|cn|jp|app|site|online|store|shop|tech|live|pro|club|link|click|win|top|work|space|fun|website|stream|download|review|party|trade|bid|date|racing|science|faith|accountant|cricket|loan|zip|mov|nexus)\b/gi;

export function checkOffensiveContent(text) {
  if (!text || typeof text !== 'string') return { isClean: true, matches: [] };
  const matches = [];
  for (const pattern of OFFENSIVE_PATTERNS) {
    const match = text.match(pattern);
    if (match) matches.push(match[0]);
  }
  return { isClean: matches.length === 0, matches: [...new Set(matches)] };
}

export function checkUsername(username) {
  if (!username || typeof username !== 'string') return { isClean: true, matches: [] };
  const lower = username.toLowerCase();
  const matches = [];
  const contentCheck = checkOffensiveContent(username);
  matches.push(...contentCheck.matches);
  for (const term of USERNAME_OFFENSIVE_SUBSTRINGS) {
    if (lower.includes(term)) matches.push(term);
  }
  return { isClean: matches.length === 0, matches: [...new Set(matches)] };
}

export function checkForLinks(text) {
  if (!text || typeof text !== 'string') return { hasLinks: false, links: [] };
  const links = [];
  const urlMatches = text.match(URL_PATTERN);
  if (urlMatches) links.push(...urlMatches);
  const domainMatches = text.match(BARE_DOMAIN_PATTERN);
  if (domainMatches) links.push(...domainMatches);
  return { hasLinks: links.length > 0, links: [...new Set(links)] };
}

export function validateContent(text, options = {}) {
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
  return { isValid: errors.length === 0, errors };
}
