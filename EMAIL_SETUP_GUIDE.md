# Email Setup Guide - SendGrid

This guide will help you set up SendGrid for sending transactional emails (welcome emails and donation receipts).

## 🚀 Quick Start

### 1. Create SendGrid Account

1. Go to [SendGrid.com](https://sendgrid.com/)
2. Click **"Start for Free"**
3. Complete the registration process
4. Verify your email address

### 2. Get Your API Key

1. Log into your SendGrid dashboard
2. Go to **Settings** → **API Keys**
3. Click **"Create API Key"**
4. Name it (e.g., "Squarestrat Production")
5. Choose **"Full Access"** or at minimum **"Mail Send"** permissions
6. Click **"Create & View"**
7. **IMPORTANT**: Copy the API key immediately (you can only see it once!)

### 3. Verify Sender Email

Before you can send emails, you need to verify your sender email address:

#### Option A: Single Sender Verification (Quick - Recommended for Testing)
1. Go to **Settings** → **Sender Authentication**
2. Click **"Verify a Single Sender"**
3. Fill in your information:
   - **From Name**: Squarestrat
   - **From Email**: noreply@yourdomain.com (or any email you control)
   - **Reply To**: Same as above or support email
   - **Company Address**: Your address
4. Click **"Create"**
5. Check your email and click the verification link
6. Once verified, you can send up to 100 emails/day

#### Option B: Domain Authentication (Better for Production)
1. Go to **Settings** → **Sender Authentication**
2. Click **"Authenticate Your Domain"**
3. Select your DNS host
4. Follow the instructions to add DNS records
5. Wait for DNS propagation (can take up to 48 hours)
6. Once verified, you can send with any email address from your domain

### 4. Configure Environment Variables

Add these to your backend `.env` file:

```env
# SendGrid Email Configuration
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

**Important**: 
- Replace `SG.xxx...` with your actual API key from step 2
- Replace `noreply@yourdomain.com` with the email you verified in step 3
- **Never commit your `.env` file to git!**

### 5. Test Email Sending

Restart your backend server to load the new environment variables:

```bash
# Stop the server (Ctrl+C)
# Start it again
npm start
```

Now test by:
1. **Registration**: Create a new test account - you should receive a welcome email
2. **Donation**: Make a test donation (use Stripe test cards) - you should receive a thank you email

## 📧 Email Templates Included

### Welcome Email
- Sent automatically when a user registers
- Modern design with blue gradient theme matching your site
- Includes quick links to play, create games, and join forums
- Responsive design for mobile devices

### Donation Thank You Email
- Sent automatically after successful donation
- Shows donation amount
- Explains how the donation helps the platform
- Includes receipt information

## 🎨 Email Design Features

Both email templates include:
- ♔ Squarestrat branding with logo
- 🎨 Blue gradient header matching site theme (#08234d, #1565c0)
- 📱 Fully responsive (mobile-friendly)
- 🔗 Quick action buttons
- 📊 Professional layout with proper spacing
- 🌐 Footer with links to website sections

## 🆓 Free Tier Limits

SendGrid's free tier includes:
- ✅ **100 emails per day** (forever free)
- ✅ All core features
- ✅ Email analytics
- ✅ 2,000 contacts

This is perfect for getting started! If you need more:
- **Essentials Plan**: $19.95/mo - 50,000 emails/month
- **Pro Plan**: $89.95/mo - 100,000 emails/month

## 🔧 Customization

### Changing Email Content

Edit `server/email-service.js` to customize:
- Email templates (HTML/CSS)
- Email subject lines
- Button text and links
- Footer content

### Adding New Email Types

Add new functions to `server/email-service.js`:

```javascript
const sendCustomEmail = async (email, username, data) => {
  const content = `
    <h2 class="title">Your Custom Title</h2>
    <p class="message">Your custom content...</p>
  `;
  
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Your Subject',
    html: getEmailTemplate(content),
  };
  
  await sgMail.send(msg);
};

module.exports = {
  sendWelcomeEmail,
  sendDonationEmail,
  sendCustomEmail, // Export new function
};
```

## 🐛 Troubleshooting

### "SendGrid not configured" message
- Check that `SENDGRID_API_KEY` is in your `.env` file
- Restart your backend server after adding environment variables

### Emails not being received
1. Check spam/junk folder
2. Verify sender email in SendGrid dashboard
3. Check SendGrid activity feed for delivery status:
   - Go to **Activity** in SendGrid dashboard
   - Look for your email and check status
4. Ensure email address is valid

### "Forbidden" or 403 errors
- Your API key might not have correct permissions
- Create a new API key with "Mail Send" permission

### Domain authentication failing
- DNS records can take 24-48 hours to propagate
- Use Single Sender Verification while waiting

## 📊 Monitoring

Monitor email delivery in SendGrid:
1. Go to **Activity** in your dashboard
2. View delivery status, opens, and clicks
3. Check for bounces or spam reports

## 🔒 Security Best Practices

1. **Never expose your API key**:
   - Keep it in `.env` file only
   - Add `.env` to `.gitignore`
   - Never commit to version control

2. **Use environment-specific keys**:
   - Development: One API key
   - Production: Different API key

3. **Rotate keys periodically**:
   - Create new key
   - Update `.env`
   - Delete old key from SendGrid

4. **Monitor for abuse**:
   - Check SendGrid activity regularly
   - Set up alerts for unusual activity

## 📈 Going to Production

When you're ready to go live:

1. **Domain Authentication**: Complete domain authentication (not just single sender)
2. **Warm up your domain**: Gradually increase email volume
3. **Monitor reputation**: Check SendGrid reputation score
4. **Update email content**: Ensure footer links point to production URLs
5. **Test thoroughly**: Send test emails to multiple providers (Gmail, Outlook, Yahoo)
6. **Set up alerts**: Configure SendGrid alerts for bounces/spam

## 💡 Tips

- Start with Single Sender Verification for quick testing
- The free tier (100 emails/day) is great for small sites
- Use the Activity feed to debug delivery issues
- Keep email templates simple and focused
- Test emails on multiple devices and email clients
- Monitor your sender reputation in SendGrid dashboard

## 🆘 Need Help?

- [SendGrid Documentation](https://docs.sendgrid.com/)
- [SendGrid Support](https://support.sendgrid.com/)
- [Email Templates Guide](https://docs.sendgrid.com/ui/sending-email/how-to-send-email-with-dynamic-transactional-templates)

---

**Ready to send emails!** 🎉 Follow the quick start steps above and you'll be sending beautiful, branded emails in minutes.
