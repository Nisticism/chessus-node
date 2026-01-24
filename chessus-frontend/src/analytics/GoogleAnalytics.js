import ReactGA from 'react-ga4';

// Initialize Google Analytics
export const initGA = () => {
  const measurementId = process.env.REACT_APP_GA_MEASUREMENT_ID;
  
  if (measurementId && measurementId !== 'YOUR_GA_MEASUREMENT_ID') {
    ReactGA.initialize(measurementId, {
      gaOptions: {
        // Optional: Add custom options here
        siteSpeedSampleRate: 100,
      },
      gtagOptions: {
        // Optional: Add custom gtag options
      },
    });
    console.log('Google Analytics initialized');
  } else {
    console.log('Google Analytics not initialized - no measurement ID provided');
  }
};

// Track page views
export const trackPageView = (path, title) => {
  if (process.env.REACT_APP_GA_MEASUREMENT_ID && process.env.REACT_APP_GA_MEASUREMENT_ID !== 'YOUR_GA_MEASUREMENT_ID') {
    ReactGA.send({ 
      hitType: "pageview", 
      page: path,
      title: title || document.title
    });
  }
};

// Track custom events
export const trackEvent = (category, action, label = '', value = 0) => {
  if (process.env.REACT_APP_GA_MEASUREMENT_ID && process.env.REACT_APP_GA_MEASUREMENT_ID !== 'YOUR_GA_MEASUREMENT_ID') {
    ReactGA.event({
      category: category,
      action: action,
      label: label,
      value: value,
    });
  }
};

// Track user interactions
export const trackUserInteraction = (action, label) => {
  trackEvent('User Interaction', action, label);
};

// Track game creation
export const trackGameCreation = (gameType) => {
  trackEvent('Game', 'Create', gameType);
};

// Track piece creation
export const trackPieceCreation = (pieceName) => {
  trackEvent('Piece', 'Create', pieceName);
};

// Track game play
export const trackGamePlay = (gameType) => {
  trackEvent('Game', 'Play', gameType);
};

// Track user registration
export const trackRegistration = (method = 'email') => {
  trackEvent('User', 'Register', method);
};

// Track user login
export const trackLogin = (method = 'email') => {
  trackEvent('User', 'Login', method);
};

// Track user logout
export const trackLogout = () => {
  trackEvent('User', 'Logout');
};

// Track forum activity
export const trackForumActivity = (action, forumName = '') => {
  trackEvent('Forum', action, forumName);
};

// Track donations
export const trackDonation = (amount = 0) => {
  trackEvent('Donation', 'Click', 'Donate Button', amount);
};

// Track social media clicks
export const trackSocialClick = (platform) => {
  trackEvent('Social Media', 'Click', platform);
};

// Track errors
export const trackError = (errorMessage, errorLocation) => {
  trackEvent('Error', errorMessage, errorLocation);
};

// Track search
export const trackSearch = (searchTerm, resultCount = 0) => {
  trackEvent('Search', 'Query', searchTerm, resultCount);
};

// Track profile views
export const trackProfileView = (username) => {
  trackEvent('Profile', 'View', username);
};

export default {
  initGA,
  trackPageView,
  trackEvent,
  trackUserInteraction,
  trackGameCreation,
  trackPieceCreation,
  trackGamePlay,
  trackRegistration,
  trackLogin,
  trackLogout,
  trackForumActivity,
  trackDonation,
  trackSocialClick,
  trackError,
  trackSearch,
  trackProfileView,
};
