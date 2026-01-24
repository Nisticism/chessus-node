# Email Setup Guide - AWS SES

This guide will help you set up AWS Simple Email Service (SES) for sending transactional emails from your application.

## Why AWS SES?

- **Cost-effective**: 62,000 free emails per month when hosted on EC2
- **Reliable**: High deliverability rates
- **Scalable**: Handles from testing to production volumes
- **Integrated**: Works seamlessly with other AWS services

## Quick Setup

### 1. Verify Your Email Address

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Navigate to **Configuration** → **Verified identities**
3. Click **Create identity**
4. Select **Email address**
5. Enter: `noreply@squarestrat.com`
6. Click **Create identity**
7. Check your email and click the verification link

### 2. Request Production Access (Optional but Recommended)

By default, SES is in sandbox mode (can only send to verified emails).

1. In SES Console, go to **Account dashboard**
2. Click **Request production access**
3. Fill out the form:
   - **Mail Type**: Transactional
   - **Website URL**: https://squarestrat.com
   - **Use case**: User registration, donation confirmations, contact form
   - **Compliance**: Explain you only send to users who register/donate
4. Submit and wait for approval (usually 24 hours)

### 3. Create IAM User for SES

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** → **Create user**
3. User name: `squarestrat-ses-user`
4. Click **Next**
5. Select **Attach policies directly**
6. Search and select: `AmazonSESFullAccess`
7. Click **Next** → **Create user**
8. Click on the created user
9. Go to **Security credentials** tab
10. Click **Create access key**
11. Select **Application running outside AWS**
12. Click **Next** → **Create access key**
13. **Copy the Access Key ID and Secret Access Key** (you won't see the secret again!)

### 4. Add to Environment Variables

Add these to your backend `.env` file:

```bash
# AWS SES Email Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_SES_FROM_EMAIL=noreply@squarestrat.com
```

### 5. Install Dependencies

```bash
npm install @aws-sdk/client-ses
```

### 6. Restart Your Server

```bash
# Development
npm run dev

# Production (if using PM2)
pm2 restart all
```

## Email Types Sent

Your application sends three types of emails:

1. **Welcome Email**: Sent when a user registers
2. **Donation Thank You**: Sent after successful donation
3. **Contact Form**: Forwards contact form submissions to fosterhans@gmail.com

## Testing

### In Sandbox Mode

You can only send emails to verified addresses:

1. Verify your personal email in SES (same process as step 1)
2. Register with that email
3. Check if you receive the welcome email

### In Production Mode

After approval, you can send to any email address.

## Troubleshooting

### "Email address is not verified"

- Make sure you verified `noreply@squarestrat.com` in SES
- Check the verification email (might be in spam)
- Wait a few minutes after verification

### "User not authorized to perform: ses:SendEmail"

- Check that IAM user has `AmazonSESFullAccess` policy
- Verify AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct
- Ensure keys are for the correct AWS account/region

### "Daily sending quota exceeded"

- In sandbox mode: 200 emails/day limit
- Request production access to increase limits
- Check [SES sending limits](https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html)

### Emails going to spam

- Verify your domain (not just email) for better deliverability
- Set up SPF, DKIM, and DMARC records
- See [AWS SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)

## Security Best Practices

1. **Never commit AWS credentials** to git (already in .gitignore)
2. **Use IAM user with minimal permissions** (only SES, not full AWS access)
3. **Rotate access keys** every 90 days
4. **Enable MFA** on your AWS account
5. **Monitor usage** in SES console

## Cost Estimates

- **EC2 hosted**: First 62,000 emails/month FREE
- **After free tier**: $0.10 per 1,000 emails
- **Example**: 100,000 emails/month = ~$3.80/month

## Graceful Degradation

The email system is designed to never break your application:

- If AWS credentials are missing, emails are skipped with console logs
- Registration and donations still work without emails
- Errors are logged but don't crash the server

## Production Deployment

1. Copy your local `.env` values to production server
2. Make sure `AWS_REGION` matches where you set up SES (usually `us-east-1`)
3. Ensure `AWS_SES_FROM_EMAIL` is verified in SES
4. Restart your application

## Links

- [AWS SES Console](https://console.aws.amazon.com/ses/)
- [IAM Console](https://console.aws.amazon.com/iam/)
- [SES Documentation](https://docs.aws.amazon.com/ses/)
- [Pricing](https://aws.amazon.com/ses/pricing/)
