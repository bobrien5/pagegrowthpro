// Vercel Serverless Function — Creates a Stripe Checkout Session
// POST /api/create-checkout
// Body: { priceId, email, userId }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, email, userId } = req.body;

    if (!priceId || !email) {
      return res.status(400).json({ error: 'Missing priceId or email' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'https://pagegrowthpro.com'}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://pagegrowthpro.com'}/login?cancelled=true`,
      metadata: {
        userId: userId || '',
        email: email,
      },
      subscription_data: {
        trial_period_days: 7,
        metadata: { userId: userId || '', email },
      },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
