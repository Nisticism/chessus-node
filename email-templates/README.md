# Email Templates

This folder contains standalone HTML previews of the email templates used by GRIDGROVE.

## Files

- **welcome-email.html** - Sent when a new user registers
- **donation-email.html** - Sent after a successful donation
- **contact-email.html** - Sent to fosterhans@gmail.com when someone submits the contact form

## How to Use

### Preview in Browser
Simply open any `.html` file in your web browser to see how the email looks.

### Test Email Quality
You can use these files to test email rendering:

1. **Litmus** - [litmus.com](https://litmus.com) - Email testing across clients
2. **Email on Acid** - [emailonacid.com](https://www.emailonacid.com)
3. **AWS SES Send Test** - Copy HTML and send test email through AWS console

### AWS SES Email Quality Check

To verify email quality with AWS SES:

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/)
2. Navigate to **Configuration** â†’ **Email templates**
3. Click **Create template**
4. Paste the HTML from these files
5. Use the **Preview** feature to see how it renders
6. Send test emails to check deliverability

### Mobile Testing

These templates are responsive and should work well on:
- Desktop email clients (Outlook, Thunderbird, Apple Mail)
- Webmail (Gmail, Yahoo, Outlook.com)
- Mobile devices (iOS Mail, Gmail app, Outlook mobile)

## Customization

The actual emails sent by the application use variables that are replaced at runtime:

- `${username}` - User's name
- `${amount}` - Donation amount
- `${name}`, `${email}`, `${subject}`, `${message}` - Contact form data
- `${process.env.CLIENT_URL}` - Site URL (GRIDGROVE.com or localhost:3000)

The static HTML files in this folder show example data for preview purposes.

## Color Scheme

Matches the GRIDGROVE brand:
- Primary Blue: `#1565c0`
- Dark Blue: `#0d47a1`
- Light Blue: `#64b5f6`
- Dark Background: `#08234d`, `#0a1929`

## Notes

- All templates use inline CSS for maximum email client compatibility
- Responsive design with mobile breakpoints at 600px
- Dark theme to match the GRIDGROVE website aesthetic
- Accessible with proper color contrast ratios
