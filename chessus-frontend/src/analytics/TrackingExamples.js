// Example usage of Google Analytics tracking functions
// Import this in any component where you want to track events

import {
  trackEvent,
  trackUserInteraction,
  trackGamePlay,
  trackForumActivity,
  trackSocialClick,
  trackError,
  trackSearch,
  trackProfileView
} from './GoogleAnalytics';

// ============================================
// BASIC EVENT TRACKING
// ============================================

// Track any custom event
trackEvent('Category', 'Action', 'Label', value);
// Example: trackEvent('Video', 'Play', 'Tutorial Video', 120);

// Track user interactions (clicks, hovers, etc.)
trackUserInteraction('Button Click', 'Download Game');
trackUserInteraction('Link Click', 'Terms of Service');

// ============================================
// GAME-SPECIFIC TRACKING
// ============================================

// Track when a game is played
const handlePlayGame = (gameType) => {
  trackGamePlay(gameType);
  // Start game logic...
};

// Track game sharing
const handleShareGame = (gameId) => {
  trackEvent('Game', 'Share', `Game ID: ${gameId}`);
  // Sharing logic...
};

// Track game favoriting
const handleFavoriteGame = (gameId) => {
  trackEvent('Game', 'Favorite', `Game ID: ${gameId}`);
  // Favorite logic...
};

// ============================================
// FORUM TRACKING
// ============================================

// Track forum activities
const handleForumPost = (forumName) => {
  trackForumActivity('Create Post', forumName);
  // Post creation logic...
};

const handleForumReply = (forumName) => {
  trackForumActivity('Reply', forumName);
  // Reply logic...
};

const handleForumView = (forumName) => {
  trackForumActivity('View', forumName);
  // View logic...
};

// ============================================
// SOCIAL MEDIA TRACKING
// ============================================

// Track social media clicks
const handleSocialClick = (platform) => {
  trackSocialClick(platform);
  // Example: Opens link in new window
  window.open(socialLinks[platform], '_blank');
};

// Usage in JSX:
// <button onClick={() => handleSocialClick('Discord')}>Join Discord</button>
// <button onClick={() => handleSocialClick('Twitter')}>Follow on Twitter</button>
// <button onClick={() => handleSocialClick('Reddit')}>Join Reddit</button>

// ============================================
// SEARCH TRACKING
// ============================================

// Track search queries
const handleSearch = (query, results) => {
  trackSearch(query, results.length);
  // Display results...
};

// Example usage:
// const results = searchGames(query);
// trackSearch(query, results.length);

// ============================================
// PROFILE TRACKING
// ============================================

// Track profile views
const handleProfileView = (username) => {
  trackProfileView(username);
  // Load profile...
};

// ============================================
// ERROR TRACKING
// ============================================

// Track errors for debugging
const handleApiCall = async () => {
  try {
    const response = await api.fetchData();
    return response;
  } catch (error) {
    trackError(error.message, 'API Call - fetchData');
    console.error(error);
    // Show error to user...
  }
};

// Track form validation errors
const handleFormSubmit = (formData) => {
  if (!validateForm(formData)) {
    trackError('Form Validation Failed', 'Game Creation Form');
    return;
  }
  // Submit form...
};

// ============================================
// ADVANCED: TIMING EVENTS
// ============================================

// Track how long actions take
const trackTiming = (category, variable, time) => {
  trackEvent(category, 'Timing', variable, time);
};

// Example: Track game loading time
const startTime = Date.now();
// ... load game ...
const loadTime = Date.now() - startTime;
trackTiming('Game', 'Load Time', loadTime);

// ============================================
// ADVANCED: CUSTOM DIMENSIONS
// ============================================

// Track user preferences
const handleThemeChange = (theme) => {
  trackEvent('User Preference', 'Theme Change', theme);
  // Change theme...
};

const handleLanguageChange = (language) => {
  trackEvent('User Preference', 'Language Change', language);
  // Change language...
};

// ============================================
// E-COMMERCE TRACKING (for future use)
// ============================================

// If you implement purchases/subscriptions
const trackPurchase = (productName, value, currency = 'USD') => {
  trackEvent('E-commerce', 'Purchase', productName, value);
  // Could be enhanced with GA4's built-in e-commerce events
};

// ============================================
// COMPONENT EXAMPLE
// ============================================

// Full example component with tracking
import React from 'react';
import { trackUserInteraction, trackEvent } from '../analytics/GoogleAnalytics';

const ExampleComponent = () => {
  const handleButtonClick = () => {
    trackUserInteraction('Feature Button', 'Clicked');
    // Button action...
  };

  const handleDownload = (fileName) => {
    trackEvent('Download', 'File', fileName);
    // Download logic...
  };

  return (
    <div>
      <button onClick={handleButtonClick}>
        Click Me
      </button>
      <button onClick={() => handleDownload('game-rules.pdf')}>
        Download Rules
      </button>
    </div>
  );
};

export default ExampleComponent;

// ============================================
// REACT HOOK EXAMPLE
// ============================================

// Custom hook for tracking page time
import { useEffect, useRef } from 'react';
import { trackEvent } from '../analytics/GoogleAnalytics';

export const usePageTimeTracking = (pageName) => {
  const startTime = useRef(Date.now());

  useEffect(() => {
    return () => {
      const timeSpent = Math.round((Date.now() - startTime.current) / 1000);
      trackEvent('Page Time', 'Time Spent', pageName, timeSpent);
    };
  }, [pageName]);
};

// Usage in component:
// usePageTimeTracking('Game Creation Wizard');

// ============================================
// BEST PRACTICES
// ============================================

/*
1. Be Specific: Use clear, descriptive labels
   ❌ trackEvent('Button', 'Click', 'Button1')
   ✅ trackEvent('Navigation', 'Click', 'Create Game Button')

2. Be Consistent: Use the same naming conventions
   ✅ All categories capitalized: 'Game', 'User', 'Forum'
   ✅ All actions past tense: 'Created', 'Clicked', 'Viewed'

3. Don't Over-Track: Only track meaningful interactions
   ❌ Track every mousemove
   ✅ Track important user actions

4. Test First: Always test in development before deploying
   - Check browser console for GA initialization
   - Verify events in GA4 Realtime view
   - Use GA Debug mode if needed

5. Privacy First: Don't track PII
   ❌ trackEvent('User', 'Email', user.email)
   ✅ trackEvent('User', 'Email Verified', 'Success')

6. Document: Keep track of what events you're tracking
   - Create a tracking plan document
   - List all events, categories, and actions
   - Share with your team
*/
