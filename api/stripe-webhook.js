// Vercel Serverless Function — Stripe Webhook Handler
// POST /api/stripe-webhook
// Handles: checkout.session.completed, customer.subscription.updated/deleted

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xhyhrigvkdusfxpajjki.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

// Disable body parsing for raw webhook body
module.exports.config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }
    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook parse error:', err.message);
    return res.status(400).json({ error: 'Invalid webhook' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_email || session.metadata?.email;
        const userId = session.metadata?.userId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId) {
          await supabase.from('user_settings').upsert({
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'active',
            subscription_plan: session.metadata?.plan || 'starter',
          }, { onConflict: 'user_id' });
        }

        console.log(`Checkout completed for ${email}, subscription: ${subscriptionId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data } = await supabase
          .from('user_settings')
          .update({ subscription_status: sub.status })
          .eq('stripe_subscription_id', sub.id);
        console.log(`Subscription ${sub.id} updated: ${sub.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase
          .from('user_settings')
          .update({ subscription_status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id);
        console.log(`Subscription ${sub.id} cancelled`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
