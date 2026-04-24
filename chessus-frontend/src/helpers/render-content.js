import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Regex that matches [display text](url) where url is either:
 *   - an absolute gridgrove.gg URL  (https://gridgrove.gg/... or https://www.gridgrove.gg/...)
 *   - a relative path               (starting with /)
 * Non-matching bracket/paren pairs are left as plain text.
 */
const LINK_RE = /\[([^\]]*)\]\(((?:https?:\/\/(?:www\.)?gridgrove\.gg|\/)[^)]*)\)/g;

/**
 * Renders user-authored text with support for [label](url) markdown links.
 *
 * Each newline produces a new <p> element. Links whose URL is a relative path
 * (/...) are rendered as React Router <Link>s so they do a client-side
 * navigation. Absolute gridgrove.gg links open in a new tab.
 *
 * @param {string} text - Raw stored text (may contain [label](url) patterns).
 * @returns {React.ReactNode[]|null}
 */
export function renderContent(text) {
  if (!text) return null;

  return text.split('\n').map((line, lineIdx) => {
    if (!line) {
      return <p key={lineIdx} style={{ margin: '0.25em 0' }} />;
    }

    const parts = [];
    let lastIndex = 0;
    LINK_RE.lastIndex = 0;
    let match;

    while ((match = LINK_RE.exec(line)) !== null) {
      // Text before this link
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      const label = match[1] || match[2]; // fall back to url if no display text
      const url = match[2];

      if (url.startsWith('/')) {
        parts.push(
          <Link key={`${lineIdx}-${match.index}`} to={url}>
            {label}
          </Link>
        );
      } else {
        parts.push(
          <a
            key={`${lineIdx}-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last link
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return <p key={lineIdx}>{parts}</p>;
  });
}
