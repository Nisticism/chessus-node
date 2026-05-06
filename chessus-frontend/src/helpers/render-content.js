import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Regex that matches [display text](url) where url is either:
 *   - any https:// URL
 *   - a relative path (starting with /)
 * Non-matching bracket/paren pairs are left as plain text.
 */
const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)]*)\)/g;

/**
 * Renders user-authored text with support for [label](url) markdown links
 * and bullet point lines (lines starting with "• ").
 *
 * Each newline produces a new <p> element. Consecutive lines that begin with
 * "• " are grouped into a <ul> with <li> items. Links whose URL is a relative
 * path (/...) are rendered as React Router <Link>s. Absolute URLs open in a
 * new tab with rel="noopener noreferrer".
 *
 * @param {string} text - Raw stored text (may contain [label](url) patterns).
 * @returns {React.ReactNode[]|null}
 */
export function renderContent(text) {
  if (!text) return null;

  const rawLines = text.split('\n');

  // Group consecutive bullet lines into runs.
  // Each element is either { type: 'line', text, idx } or { type: 'bullet', items: [{text, idx}] }
  const groups = [];
  let bulletRun = null;

  rawLines.forEach((line, idx) => {
    if (line.startsWith('\u2022 ') || line === '\u2022') {
      if (!bulletRun) {
        bulletRun = { type: 'bullet', items: [] };
        groups.push(bulletRun);
      }
      bulletRun.items.push({ text: line.replace(/^\u2022\s?/, ''), idx });
    } else {
      bulletRun = null;
      groups.push({ type: 'line', text: line, idx });
    }
  });

  return groups.map((group, gi) => {
    if (group.type === 'bullet') {
      return (
        <ul key={`ul-${gi}`} style={{ margin: '0.25em 0 0.25em 1.4em', padding: 0 }}>
          {group.items.map((item) => (
            <li key={item.idx}>{renderLine(item.text, item.idx)}</li>
          ))}
        </ul>
      );
    }
    const { text: line, idx } = group;
    if (!line) return <p key={idx} style={{ margin: '0.25em 0', paddingLeft: '0.75em', textAlign: 'left' }} />;
    return <p key={idx} style={{ paddingLeft: '0.75em', textAlign: 'left' }}>{renderLine(line, idx)}</p>;
  });
}

/**
 * Render a single line of text, converting [label](url) patterns to links.
 */
function renderLine(line, lineIdx) {
  const parts = [];
  let lastIndex = 0;
  LINK_RE.lastIndex = 0;
  let match;

  while ((match = LINK_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const label = match[1] || match[2];
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

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}
