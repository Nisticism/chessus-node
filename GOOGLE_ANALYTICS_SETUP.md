# Google Analytics Setup Guide

## Overview
Google Analytics 4 (GA4) has been integrated into the Chessus/GRIDGROVE application to track user behavior, page views, and key events.

## Setup Instructions

### 1. Create a Google Analytics 4 Property

1. Go to [Google Analytics](https://analytics.google.com/)
2. Click **Admin** (gear icon in bottom left)
3. In the **Property** column, click **Create Property**
4. Enter your property details:
   - Property name: "GRIDGROVE" (or your preferred name)
   - Reporting time zone: Select your timezone
   - Currency: Select your currency
5. Click **Next** and complete the business information
6. Click **Create** and accept the Terms of Service

### 2. Set Up a Data Stream

1. After creating the property, you'll be prompted to set up a data stream
2. Select **Web** as the platform
3. Enter your website details:
   - Website URL: `https://GRIDGROVE.com` (or your domain)
   - Stream name: "GRIDGROVE Web"
4. Click **Create stream**
5. **Copy your Measurement ID** - it looks like `G-XXXXXXXXXX`

### 3. Configure Environment Variables

Replace the placeholder in your `.env` files with your actual Measurement ID:

#### Development (.env):
```env
REACT_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

#### Production (.env.production):
```env
REACT_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

**Note:** The same Measurement ID can be used for both environments, or you can create separate properties for dev/prod.

### 4. Install Dependencies

Run the following command to install the Google Analytics library:

```bash
npm install
```

This will install `react-ga4` which has already been added to package.json.

### 5. Test the Integration

1. Start your development server:
   ```bash
   npm start
   ```

2. Open your browser's developer console (F12)
3. You should see: `Google Analytics initialized`
4. Navigate to different pages - each navigation will log a page view

5. To verify in Google Analytics:
   - Go to your GA4 property
   - Navigate to **Reports** > **Realtime**
   - You should see your activity in real-time

## What's Being Tracked

### Automatic Tracking
- âœ… **Page Views**: Every route change is automatically tracked
- âœ… **Page Titles**: Captured with each page view

### Event Tracking

#### User Authentication
- **User Registration**: Tracked when users successfully register
- **User Login**: Tracked when users successfully log in
- **User Logout**: Tracked when users log out

#### Content Creation
- **Game Creation**: Tracked when users create new custom games
  - Event includes game name as label
- **Game Updates**: Tracked when users edit existing games
- **Piece Creation**: Tracked when users create custom pieces
  - Event includes piece name as label
- **Piece Updates**: Tracked when users edit existing pieces

#### User Interactions
- **Donation Clicks**: Tracked when users click the donate button
  - Includes donation amount as value
- **Forum Activity**: Can track forum posts, replies, etc.
- **Profile Views**: Can track when profiles are viewed
- **Social Media Clicks**: Can track external social media links

#### Errors
- **Error Tracking**: Can log application errors with context

## Available Tracking Functions

All tracking functions are located in `src/analytics/GoogleAnalytics.js`:

```javascript
import { 
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
  trackProfileView
} from './analytics/GoogleAnalytics';
```

### Usage Examples

```javascript
// Track custom event
trackEvent('Category', 'Action', 'Label', value);

// Track user interaction
trackUserInteraction('Button Click', 'Submit Form');

// Track game play
trackGamePlay('Custom Chess Variant');

// Track forum post
trackForumActivity('Create Post', 'General Discussion');

// Track search
trackSearch('chess pieces', 5); // 5 results found

// Track error
trackError('API Error', 'Game Creation Failed');
```

## Privacy Considerations

1. **No Personal Data**: The implementation doesn't track personally identifiable information (PII)
2. **Username Tracking**: Usernames may be included in some events (game creation, piece creation) - ensure this complies with your privacy policy
3. **IP Anonymization**: Consider enabling IP anonymization in GA4 settings for enhanced privacy
4. **Cookie Consent**: Consider implementing a cookie consent banner if required by your jurisdiction (GDPR, CCPA)

## Adding More Tracking

To add tracking to additional components:

1. Import the tracking functions:
   ```javascript
   import { trackEvent, trackUserInteraction } from '../../analytics/GoogleAnalytics';
   ```

2. Call the function where appropriate:
   ```javascript
   const handleClick = () => {
     trackUserInteraction('Button Click', 'Feature Name');
     // ... rest of your code
   };
   ```

## Reports and Analysis

Once data starts flowing, you can access various reports in GA4:

### Key Reports to Check
1. **Realtime**: Monitor active users in real-time
2. **Engagement** > **Events**: See all tracked events
3. **Engagement** > **Pages and screens**: Most visited pages
4. **User** > **Demographics**: User location and demographics
5. **User** > **Tech**: Browsers, devices, operating systems

### Custom Reports
You can create custom reports and explorations in GA4 to analyze:
- User journeys through your app
- Conversion funnels (registration â†’ game creation â†’ game play)
- Popular game types and pieces
- Drop-off points in the creation wizards

## Troubleshooting

### Analytics Not Working?

1. **Check Console**: Look for "Google Analytics initialized" message
2. **Verify Measurement ID**: Ensure it's correctly formatted (G-XXXXXXXXXX)
3. **Check .env File**: Make sure the variable is named exactly `REACT_APP_GA_MEASUREMENT_ID`
4. **Restart Dev Server**: After changing .env files, restart your dev server
5. **Ad Blockers**: Disable ad blockers when testing
6. **Network Tab**: Check if requests to `google-analytics.com` are being blocked

### No Data in GA4?

- It can take 24-48 hours for initial data to appear in standard reports
- Use the Realtime view to verify immediate tracking
- Ensure you're looking at the correct property and date range

## Production Deployment

Before deploying to production:

1. âœ… Update `.env.production` with your GA4 Measurement ID
2. âœ… Test in production environment
3. âœ… Verify tracking in GA4 Realtime view
4. âœ… Set up custom alerts and reports
5. âœ… Review and update privacy policy
6. âœ… Implement cookie consent if required

## Additional Resources

- [Google Analytics 4 Documentation](https://support.google.com/analytics/answer/10089681)
- [react-ga4 GitHub](https://github.com/codler/react-ga4)
- [GA4 Event Measurement Guide](https://developers.google.com/analytics/devguides/collection/ga4/events)
- [GA4 Privacy Controls](https://support.google.com/analytics/answer/9019185)

## Support

For issues or questions about the GA integration:
1. Check the browser console for error messages
2. Verify your Measurement ID is correct
3. Ensure the react-ga4 package is installed
4. Check that the GoogleAnalytics.js file is properly imported

---

**Last Updated**: January 23, 2026
