const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// Initialize AWS SES client
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

// Modern email template base (matches site's blue theme)
const getEmailTemplate = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Squarestrat</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background-color: #0a1929;
      color: #ffffff;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: linear-gradient(135deg, #08234d 0%, #0a1929 100%);
    }
    .header {
      background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%);
      padding: 40px 20px;
      text-align: center;
      border-radius: 8px 8px 0 0;
    }
    .logo {
      font-size: 36px;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .content {
      padding: 40px 30px;
      background-color: rgba(8, 35, 77, 0.8);
    }
    .title {
      font-size: 28px;
      font-weight: 600;
      color: #ffffff;
      margin: 0 0 20px 0;
      text-align: center;
    }
    .message {
      font-size: 16px;
      line-height: 1.6;
      color: #e0e0e0;
      margin: 20px 0;
    }
    .highlight-box {
      background: linear-gradient(135deg, rgba(21, 101, 192, 0.3) 0%, rgba(13, 71, 161, 0.3) 100%);
      border-left: 4px solid #1565c0;
      padding: 20px;
      margin: 25px 0;
      border-radius: 4px;
    }
    .highlight-text {
      font-size: 18px;
      font-weight: 600;
      color: #64b5f6;
      margin: 0;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%);
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 8px;
      box-shadow: 0 4px 12px rgba(21, 101, 192, 0.4);
      transition: all 0.3s ease;
    }
    .button:hover {
      box-shadow: 0 6px 16px rgba(21, 101, 192, 0.6);
      transform: translateY(-2px);
    }
    .button-center {
      text-align: center;
    }
    .footer {
      padding: 30px 20px;
      text-align: center;
      color: #90a4ae;
      font-size: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .footer-links {
      margin: 15px 0;
    }
    .footer-link {
      color: #64b5f6;
      text-decoration: none;
      margin: 0 10px;
    }
    .social-icons {
      margin: 20px 0;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(100, 181, 246, 0.5) 50%, transparent 100%);
      margin: 30px 0;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 30px 20px;
      }
      .title {
        font-size: 24px;
      }
      .logo {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">♔ Squarestrat</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <div class="divider"></div>
      <p>You're receiving this email because you have an account with Squarestrat.</p>
      <div class="footer-links">
        <a href="https://squarestrat.com" class="footer-link">Visit Website</a>
        <a href="https://squarestrat.com/forums" class="footer-link">Community Forums</a>
        <a href="https://squarestrat.com/play" class="footer-link">Play Games</a>
      </div>
      <p style="margin-top: 20px; color: #607d8b;">
        © ${new Date().getFullYear()} Squarestrat. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
`;

// Welcome email template
const getWelcomeEmailContent = (username) => `
  <h2 class="title">Welcome to Squarestrat! 🎉</h2>
  <p class="message">
    Hi <strong>${username}</strong>,
  </p>
  <p class="message">
    Thank you for joining Squarestrat, the ultimate platform for creating and playing custom chess variants! 
    We're thrilled to have you as part of our growing community of chess enthusiasts and creative strategists.
  </p>
  
  <div class="highlight-box">
    <p class="highlight-text">🎮 Your account is now active!</p>
  </div>

  <p class="message">
    Here's what you can do now:
  </p>
  <p class="message">
    ♟️ <strong>Play Games</strong> - Explore and play unique chess variants created by our community<br>
    🎨 <strong>Create Pieces</strong> - Design your own custom chess pieces with unique movement patterns<br>
    🏆 <strong>Create Games</strong> - Build entirely new chess variants with custom rules and win conditions<br>
    💬 <strong>Join Forums</strong> - Connect with other players, share strategies, and discuss game design<br>
    📊 <strong>Climb the Leaderboard</strong> - Compete with players worldwide and showcase your skills
  </p>

  <div class="button-center">
    <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/profile/${username}" class="button">View Your Profile</a>
    <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/play" class="button">Start Playing Now</a>
  </div>

  <div class="divider"></div>

  <p class="message" style="font-size: 14px; color: #90a4ae;">
    Need help getting started? Check out our <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/forums" style="color: #64b5f6;">community forums</a> 
    or explore featured games to see what's possible!
  </p>
`;

// Donation thank you email template
const getDonationEmailContent = (username, amount) => `
  <h2 class="title">Thank You for Your Generous Support! 💙</h2>
  <p class="message">
    Hi <strong>${username || 'Friend'}</strong>,
  </p>
  <p class="message">
    We are incredibly grateful for your donation to Squarestrat. Your generosity helps us keep the 
    platform running, develop new features, and maintain a vibrant community for chess variant enthusiasts worldwide.
  </p>
  
  <div class="highlight-box">
    <p class="highlight-text">✓ Donation Received: $${parseFloat(amount).toFixed(2)}</p>
  </div>

  <p class="message">
    Your contribution directly supports:
  </p>
  <p class="message">
    🚀 <strong>Platform Development</strong> - New features and improvements<br>
    🖥️ <strong>Server Costs</strong> - Keeping the site fast and reliable<br>
    👥 <strong>Community Growth</strong> - Tools and resources for our players<br>
    🎨 <strong>Content Creation</strong> - Tutorials, guides, and game showcases<br>
    🐛 <strong>Maintenance</strong> - Bug fixes and security updates
  </p>

  <p class="message">
    Your support means the world to us and helps ensure that Squarestrat remains free and accessible 
    to everyone who shares our passion for creative strategy games.
  </p>

  <div class="button-center">
    <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}" class="button">Visit Squarestrat</a>
  </div>

  <div class="divider"></div>

  <p class="message" style="font-size: 14px; color: #90a4ae;">
    This email serves as your donation receipt. For any questions or concerns, please don't hesitate to reach out 
    through our community forums.
  </p>
  
  <p class="message" style="text-align: center; font-size: 18px; margin-top: 30px;">
    <strong>Thank you for being an amazing supporter! 🎉</strong>
  </p>
`;

// Send welcome email on registration
const sendWelcomeEmail = async (email, username) => {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('ℹ️ AWS SES not configured. Skipping welcome email to:', email);
    console.log('   To enable emails, add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your .env file');
    return { success: false, message: 'AWS SES not configured' };
  }

  if (!process.env.AWS_SES_FROM_EMAIL) {
    console.warn('⚠️ AWS_SES_FROM_EMAIL not set, using default: noreply@squarestrat.com');
  }

  try {
    const params = {
      Source: process.env.AWS_SES_FROM_EMAIL || 'noreply@squarestrat.com',
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Subject: {
          Data: 'Welcome to Squarestrat! 🎉',
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: getEmailTemplate(getWelcomeEmailContent(username)),
            Charset: 'UTF-8',
          },
        },
      },
    };

    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    console.log(`✅ Welcome email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    return { success: false, error };
  }
};

// Send donation thank you email
const sendDonationEmail = async (email, username, amount) => {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('ℹ️ AWS SES not configured. Skipping donation email to:', email);
    console.log('   To enable emails, add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your .env file');
    return { success: false, message: 'AWS SES not configured' };
  }

  if (!process.env.AWS_SES_FROM_EMAIL) {
    console.warn('⚠️ AWS_SES_FROM_EMAIL not set, using default: noreply@squarestrat.com');
  }

  try {
    const params = {
      Source: process.env.AWS_SES_FROM_EMAIL || 'noreply@squarestrat.com',
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Subject: {
          Data: 'Thank You for Your Donation! 💙',
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: getEmailTemplate(getDonationEmailContent(username, amount)),
            Charset: 'UTF-8',
          },
        },
      },
    };

    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    console.log(`✅ Donation email sent to ${email} for $${amount}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending donation email:', error.message);
    return { success: false, error };
  }
};

// Send contact form message
const sendContactEmail = async (name, email, subject, message) => {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('ℹ️ AWS SES not configured. Would send contact email from:', email);
    return { success: false, message: 'AWS SES not configured' };
  }

  try {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1565c0;">New Contact Form Submission</h2>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>Subject:</strong> ${subject}</p>
        </div>
        <div style="background: #fff; padding: 20px; border-left: 4px solid #1565c0; margin: 20px 0;">
          <h3 style="margin-top: 0;">Message:</h3>
          <p style="white-space: pre-wrap;">${message}</p>
        </div>
        <p style="color: #666; font-size: 12px;">
          This email was sent from the Squarestrat contact form. Reply directly to respond to ${name}.
        </p>
      </div>
    `;

    const params = {
      Source: process.env.AWS_SES_FROM_EMAIL || 'noreply@squarestrat.com',
      Destination: {
        ToAddresses: ['fosterhans@gmail.com'],
      },
      Message: {
        Subject: {
          Data: `[Squarestrat Contact] ${subject}`,
          Charset: 'UTF-8',
        },
        Body: {
          Text: {
            Data: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
            Charset: 'UTF-8',
          },
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          },
        },
      },
      ReplyToAddresses: [email],
    };

    const command = new SendEmailCommand(params);
    await sesClient.send(command);
    console.log(`✅ Contact email sent from ${email} to fosterhans@gmail.com`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending contact email:', error.message);
    return { success: false, error };
  }
};

module.exports = {
  sendWelcomeEmail,
  sendDonationEmail,
  sendContactEmail,
};
