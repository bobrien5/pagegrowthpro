// Vercel Serverless Function — Sends welcome email via SendGrid
// POST /api/send-welcome
// Body: { email, name }

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async (req, res) => {
  const allowedOrigins = ['https://pagegrowthpro.com', 'https://www.pagegrowthpro.com', 'http://localhost:3001'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const firstName = (name || email.split('@')[0]).split(' ')[0];

    await sgMail.send({
      to: email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'hello@vacationpro.co', // TODO: update to support@pagegrowthpro.com once verified in SendGrid
        name: 'PageGrowthPro',
      },
      subject: `Welcome to PageGrowthPro, ${firstName}!`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: 800; color: #1a1a2e;">
              <span style="color: #7C3AED;">Page</span>Growth<span style="color: #10B981;">Pro</span>
            </h1>
          </div>

          <h2 style="font-size: 24px; font-weight: 700; color: #1a1a2e; margin-bottom: 16px;">
            Welcome aboard, ${firstName}! 🚀
          </h2>

          <p style="font-size: 16px; color: #4a4a68; line-height: 1.6; margin-bottom: 24px;">
            You're all set to start growing your Facebook page with AI-powered insights. Here's how to get started:
          </p>

          <div style="background: #f8f7ff; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <p style="font-size: 14px; color: #4a4a68; margin: 0 0 12px;">
              <strong style="color: #7C3AED;">Step 1:</strong> Add at least 5 competitor Facebook pages
            </p>
            <p style="font-size: 14px; color: #4a4a68; margin: 0 0 12px;">
              <strong style="color: #7C3AED;">Step 2:</strong> Connect your own Facebook page
            </p>
            <p style="font-size: 14px; color: #4a4a68; margin: 0;">
              <strong style="color: #7C3AED;">Step 3:</strong> Generate AI-powered posts inspired by top performers
            </p>
          </div>

          <div style="text-align: center; margin-bottom: 32px;">
            <a href="https://pagegrowthpro.com/dashboard" style="display: inline-block; background: #7C3AED; color: white; font-weight: 600; font-size: 16px; padding: 14px 32px; border-radius: 8px; text-decoration: none;">
              Go to Dashboard →
            </a>
          </div>

          <p style="font-size: 14px; color: #8a8aa0; line-height: 1.6;">
            Your 7-day free trial has started. If you have any questions, reply to this email — we're here to help.
          </p>

          <hr style="border: none; border-top: 1px solid #e8e8f0; margin: 32px 0;">

          <p style="font-size: 12px; color: #b0b0c0; text-align: center;">
            PageGrowthPro · <a href="https://pagegrowthpro.com/privacy" style="color: #b0b0c0;">Privacy</a> · <a href="https://pagegrowthpro.com/terms" style="color: #b0b0c0;">Terms</a>
          </p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SendGrid error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
