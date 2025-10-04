const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_xxx');
const fetch = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

exports.createCheckout = functions.https.onCall(async (data, context) => {
  const { orgId, sellerId, successUrl, cancelUrl } = data;
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'orgId required');

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  if (!orgSnap.exists) throw new functions.https.HttpsError('not-found', 'org not found');
  const org = orgSnap.data();

  const now = new Date();
  if (org.saleStart && org.saleEnd) {
    const start = new Date(org.saleStart);
    const end = new Date(org.saleEnd);
    if (now < start || now > end) {
      throw new functions.https.HttpsError('failed-precondition', 'Sale is not active');
    }
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price: process.env.STRIPE_PRICE_ID_POPCORN,
      quantity: 1
    }],
    mode: 'payment',
    success_url: successUrl || 'https://fundraiser.thepopcornboutique.com/success',
    cancel_url: cancelUrl || 'https://fundraiser.thepopcornboutique.com/cancel',
    payment_intent_data: {
      metadata: { orgId, sellerId }
    },
    metadata: { orgId, sellerId }
  });

  return { sessionId: session.id, url: session.url };
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const session = event.data.object;
      const metadata = session.metadata || {};
      const orgId = metadata.orgId || null;
      const sellerId = metadata.sellerId || null;
      const amountCents = session.amount_total || session.amount || 0;

      const orderRef = db.collection('orders').doc(session.id);
      await orderRef.set({
        id: session.id,
        orgId,
        sellerId,
        amountCents,
        currency: session.currency || 'usd',
        customerEmail: session.customer_details?.email || null,
        status: 'paid',
        stripeRaw: session,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        fulfilled: false
      });

      if (orgId && sellerId) {
        const sellerRef = db.collection('orgs').doc(orgId).collection('sellers').doc(sellerId);
        await sellerRef.update({ salesCents: admin.firestore.FieldValue.increment(amountCents) });
      }

      // Optional: notify your Shopify site for fulfillment (if configured)
      const orgSnap = await db.collection('orgs').doc(orgId).get();
      const websiteUrl = orgSnap.exists ? orgSnap.data()?.websiteUrl : null;
      if (websiteUrl) {
        try {
          await fetch(`${websiteUrl}/api/notify-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-popcorn-secret': process.env.FULFILL_SECRET || '' },
            body: JSON.stringify({ orderId: session.id, orgId, sellerId, amountCents, customerEmail: session.customer_details?.email || null })
          });
        } catch (err) {
          console.warn('Failed to notify website for fulfillment', err.message);
        }
      }
    }
  } catch (err) {
    console.error('Processing webhook failed:', err);
    return res.status(500).send('Server error');
  }

  res.json({ received: true });
});
