# Payment Integration Setup Guide

## Overview
The donation page now supports both **Stripe** and **PayPal** payment methods with a thank you page after successful donations.

## Current Status
âœ… **Frontend UI Complete** - Payment buttons and thank you page implemented  
âš ï¸ **Demo Mode Active** - Currently redirects with success parameters for testing  
ðŸ”§ **Backend Required** - Needs server-side implementation for production

---

## Quick Test (Demo Mode)

The donation page currently works in **demo mode**:
1. Go to `/donate`
2. Select an amount ($5, $10, etc.) or enter custom amount
3. Click "Pay with Stripe" or "Pay with PayPal"
4. You'll see a thank you page with your donation amount
5. Google Analytics tracks the donation event

---

## Production Setup

### Step 1: Create Stripe Account

1. Go to https://stripe.com and sign up
2. Complete business verification
3. Get your API keys from https://dashboard.stripe.com/apikeys
   - **Publishable key** (starts with `pk_test_` or `pk_live_`)
   - **Secret key** (starts with `sk_test_` or `sk_live_`)

4. Add to `.env`:
   ```env
   REACT_APP_STRIPE_PUBLIC_KEY=pk_test_YOUR_KEY_HERE
   ```

5. Add secret key to your backend `.env`:
   ```env
   STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
   ```

### Step 2: Create PayPal Account

1. Go to https://developer.paypal.com/
2. Create an app in the dashboard
3. Get your **Client ID** from the app settings
4. Add to `.env`:
   ```env
   REACT_APP_PAYPAL_CLIENT_ID=YOUR_CLIENT_ID_HERE
   ```

### Step 3: Install Required Packages

```bash
cd chessus-frontend
npm install @stripe/stripe-js @stripe/react-stripe-js
npm install @paypal/react-paypal-js
```

### Step 4: Backend Implementation (Node.js/Express)

Create a new file: `server/payment-routes.js`

```javascript
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create Stripe Checkout Session
router.post('/create-stripe-checkout', async (req, res) => {
  try {
    const { amount } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'GRIDGROVE Donation',
              description: 'Support GRIDGROVE development',
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/donate?success=true&amount=${amount}&method=stripe`,
      cancel_url: `${process.env.FRONTEND_URL}/donate?canceled=true`,
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stripe Webhook (for payment confirmation)
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // TODO: Save donation to database, send thank you email, etc.
    console.log('Payment successful:', session);
  }

  res.json({ received: true });
});

module.exports = router;
```

Add to your `server/index.js`:
```javascript
const paymentRoutes = require('./payment-routes');
app.use('/api', paymentRoutes);
```

### Step 5: Update Frontend Stripe Integration

Replace the placeholder in `Donate.js`:

```javascript
const handleStripePayment = async () => {
  const amount = getAmount();
  if (!amount || amount <= 0) {
    alert("Please select or enter a valid donation amount");
    return;
  }

  setIsProcessing(true);
  
  try {
    // Create checkout session
    const response = await fetch('/api/create-stripe-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    
    if (!response.ok) {
      throw new Error('Failed to create checkout session');
    }
    
    const { sessionId } = await response.json();
    
    // Redirect to Stripe Checkout
    const stripe = await loadStripe(process.env.REACT_APP_STRIPE_PUBLIC_KEY);
    const { error } = await stripe.redirectToCheckout({ sessionId });
    
    if (error) {
      console.error('Stripe redirect error:', error);
      alert('Payment failed. Please try again.');
      setIsProcessing(false);
    }
  } catch (error) {
    console.error('Payment error:', error);
    alert('Payment failed. Please try again.');
    setIsProcessing(false);
  }
};
```

### Step 6: Update Frontend PayPal Integration

Install PayPal SDK in your `public/index.html`:
```html
<script src="https://www.paypal.com/sdk/js?client-id=YOUR_CLIENT_ID&currency=USD"></script>
```

Or use React PayPal library:

```javascript
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

// In your component:
<PayPalScriptProvider options={{ 
  "client-id": process.env.REACT_APP_PAYPAL_CLIENT_ID,
  currency: "USD"
}}>
  <PayPalButtons
    createOrder={(data, actions) => {
      return actions.order.create({
        purchase_units: [{
          amount: {
            value: getAmount().toString()
          }
        }]
      });
    }}
    onApprove={async (data, actions) => {
      const details = await actions.order.capture();
      window.location.href = `/donate?success=true&amount=${getAmount()}&method=paypal`;
    }}
  />
</PayPalScriptProvider>
```

---

## Environment Variables Summary

### Development (.env)
```env
REACT_APP_API_URL=http://localhost:3001
REACT_APP_ASSET_URL=http://localhost:3001
REACT_APP_GA_MEASUREMENT_ID=G-N7K0X3Z0VN
REACT_APP_STRIPE_PUBLIC_KEY=pk_test_YOUR_KEY
REACT_APP_PAYPAL_CLIENT_ID=YOUR_CLIENT_ID
```

### Production (.env.production)
```env
REACT_APP_API_URL=https://gridgrove.gg
REACT_APP_ASSET_URL=https://gridgrove.gg
REACT_APP_GA_MEASUREMENT_ID=G-N7K0X3Z0VN
REACT_APP_STRIPE_PUBLIC_KEY=pk_live_YOUR_LIVE_KEY
REACT_APP_PAYPAL_CLIENT_ID=YOUR_LIVE_CLIENT_ID
```

### Backend (.env)
```env
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
FRONTEND_URL=http://localhost:3000
```

---

## Testing

### Stripe Test Cards
Use these test card numbers in Stripe's test mode:
- **Success**: `4242 4242 4242 4242`
- **Declined**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0027 6000 3184`
- Any future expiry date (e.g., 12/34)
- Any 3-digit CVC

### PayPal Sandbox
1. Create sandbox accounts at https://developer.paypal.com/
2. Use sandbox credentials for testing
3. Switch to live credentials for production

---

## Security Best Practices

1. âœ… **Never expose secret keys in frontend code**
2. âœ… **Always validate amounts on the backend**
3. âœ… **Use HTTPS in production**
4. âœ… **Implement webhook signature verification**
5. âœ… **Log all transactions**
6. âœ… **Set up webhook endpoints in Stripe/PayPal dashboards**
7. âœ… **Store donation records in your database**
8. âœ… **Send confirmation emails to donors**

---

## Features Included

âœ… Amount selection (predefined + custom)  
âœ… Stripe payment button  
âœ… PayPal payment button  
âœ… Processing state indicator  
âœ… Thank you page after donation  
âœ… Return to donate or home buttons  
âœ… Google Analytics tracking  
âœ… Responsive design  
âœ… Security notice  

---

## Optional Enhancements

### 1. Recurring Donations
Add monthly/yearly subscription options using Stripe Subscriptions or PayPal Subscriptions.

### 2. Donation Tiers
Create donor tiers (Bronze, Silver, Gold) with special badges/perks.

### 3. Leaderboard
Show top donors (with permission) on a leaderboard page.

### 4. Email Receipts
Send automated thank you emails with tax receipt (if applicable).

### 5. Progress Bar
Show funding goals and progress toward milestones.

### 6. Custom Thank You
Personalized messages based on donation amount.

---

## Troubleshooting

### "Payment failed" error
- Check API keys are correct
- Verify backend endpoint is running
- Check browser console for detailed errors
- Ensure CORS is configured correctly

### Webhook not working
- Verify webhook URL in Stripe/PayPal dashboard
- Check webhook secret matches
- Test webhook using Stripe CLI: `stripe listen --forward-to localhost:3001/api/stripe-webhook`

### Amount not showing on thank you page
- Check URL parameters are being passed correctly
- Verify `useLocation` and `useEffect` are working
- Check browser console for errors

---

## Support

- **Stripe Documentation**: https://stripe.com/docs
- **PayPal Documentation**: https://developer.paypal.com/docs/
- **Stripe Test Cards**: https://stripe.com/docs/testing

---

**Status**: Ready for production with backend implementation  
**Last Updated**: January 23, 2026
