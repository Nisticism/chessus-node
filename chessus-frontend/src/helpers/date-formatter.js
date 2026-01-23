/**
 * Formats a date string or Date object to the user's local time
 * @param {string|Date} date - The date to format (can be ISO string, date string, or Date object)
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeTime - Whether to include time (default: true)
 * @param {boolean} options.includeSeconds - Whether to include seconds (default: false)
 * @param {string} options.format - 'full', 'short', or 'relative' (default: 'full')
 * @returns {string} Formatted date string in user's local time
 */
export function formatDate(date, options = {}) {
  const {
    includeTime = true,
    includeSeconds = false,
    format = 'full'
  } = options;

  if (!date) return '';

  // Convert to Date object if it's a string
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Check if valid date
  if (isNaN(dateObj.getTime())) {
    console.warn('Invalid date provided to formatDate:', date);
    return 'Invalid Date';
  }

  if (format === 'relative') {
    return formatRelativeTime(dateObj);
  }

  if (format === 'short') {
    return dateObj.toLocaleDateString();
  }

  // Full format with time
  const dateOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };

  const timeOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds && { second: '2-digit' }),
    hour12: true
  };

  if (includeTime) {
    return dateObj.toLocaleString('en-US', { ...dateOptions, ...timeOptions });
  }

  return dateObj.toLocaleDateString('en-US', dateOptions);
}

/**
 * Formats a date as relative time (e.g., "2 hours ago", "3 days ago")
 * @param {Date} date - The date to format
 * @returns {string} Relative time string
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  } else if (diffHr < 24) {
    return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
  } else {
    return `${diffYears} year${diffYears !== 1 ? 's' : ''} ago`;
  }
}

/**
 * Legacy format matching the old formatDateFromString implementation
 * Converts to local time and formats as MM/DD/YYYY HH:MMam/pm
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string
 */
export function formatDateLegacy(date) {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  // Use local time methods to get user's timezone
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const year = dateObj.getFullYear();
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  
  const dayHalf = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12; // Convert to 12-hour format
  
  return `${month}/${day}/${year} ${hours}:${minutes}${dayHalf}`;
}

/**
 * Format date for display in tables (date only, no time)
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string
 */
export function formatDateOnly(date) {
  return formatDate(date, { includeTime: false });
}

/**
 * Format date with time for display
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date and time string
 */
export function formatDateTime(date) {
  return formatDate(date, { includeTime: true });
}

/**
 * Get current datetime in MySQL format (YYYY-MM-DD HH:MM:SS) using local timezone
 * This should be used when creating timestamps to send to the server
 * @returns {string} Current datetime in MySQL format (local time)
 */
export function getCurrentMySQLDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
