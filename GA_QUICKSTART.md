# Google Analytics Quick Start

## 🚀 Get Your Tracking ID

1. Go to https://analytics.google.com/
2. Create a GA4 property
3. Add a Web data stream
4. Copy your Measurement ID (looks like `G-XXXXXXXXXX`)

## 📝 Update Environment Variables

Open these files and replace `YOUR_GA_MEASUREMENT_ID`:

```bash
# Development
chessus-frontend/.env

# Production  
chessus-frontend/.env.production
```

Replace:
```env
REACT_APP_GA_MEASUREMENT_ID=YOUR_GA_MEASUREMENT_ID
```

With:
```env
REACT_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

## ✅ Test It Works

1. Start your app: `npm start`
2. Open browser console (F12)
3. Look for: `Google Analytics initialized`
4. Navigate between pages
5. Check GA4 Realtime view to see your activity

## 📊 What's Being Tracked

✅ Every page view  
✅ User registration & login  
✅ Game & piece creation  
✅ Donation button clicks  
✅ User interactions

## 📖 Full Documentation

See [GOOGLE_ANALYTICS_SETUP.md](./GOOGLE_ANALYTICS_SETUP.md) for complete details.
