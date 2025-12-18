import { type Express, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../lib/logger';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';

const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const isProduction = process.env.NODE_ENV === 'production';

// Store processed event IDs to prevent replay attacks (in-memory for now)
// In production with multiple instances, use Redis or similar
const processedEvents = new Set<string>();
const MAX_PROCESSED_EVENTS = 1000;

// Clean up old events every hour
setInterval(() => {
  if (processedEvents.size > MAX_PROCESSED_EVENTS) {
    const excess = processedEvents.size - MAX_PROCESSED_EVENTS;
    logger.info(`Cleaning up ${excess} old webhook event IDs`);
    // Remove oldest events (Set maintains insertion order)
    const iterator = processedEvents.values();
    for (let i = 0; i < excess; i++) {
      const value = iterator.next().value;
      if (value) {
        processedEvents.delete(value);
      }
    }
  }
}, 60 * 60 * 1000); // Every hour

// Only initialize Stripe if API key is provided
let stripe: Stripe | null = null;
if (stripeKey) {
  stripe = new Stripe(stripeKey, {
    apiVersion: '2025-10-29.clover',
  });
  logger.info('✓ Stripe initialized', {
    hasWebhookSecret: !!webhookSecret,
  });

  // Validate webhook secret format in production
  if (isProduction && webhookSecret) {
    if (!webhookSecret.startsWith('whsec_')) {
      logger.error('⚠️  STRIPE_WEBHOOK_SECRET appears invalid (should start with whsec_)');
    }
  }

  if (isProduction && !webhookSecret) {
    logger.error('⚠️  STRIPE_WEBHOOK_SECRET not set in production!');
    logger.error('   Webhook signature verification will fail!');
  }
} else {
  if (isProduction) {
    logger.error('⚠️  STRIPE_SECRET_KEY not set in production!');
  } else {
    logger.warn('⚠️  Stripe not configured. Webhook endpoints will not work.');
    logger.warn('   Set STRIPE_SECRET_KEY in Replit Secrets to enable Stripe.');
  }
}

export function registerWebhookRoutes(app: Express) {
  // Stripe webhook endpoint
  // IMPORTANT: This must be registered BEFORE body parsing middleware
  app.post('/api/webhooks/stripe', async (req: Request, res: Response) => {
    // Check if Stripe is configured
    if (!stripe) {
      logger.error('Stripe webhook: Stripe not initialized');
      return res.status(503).send('Stripe not configured');
    }

    const sig = req.headers['stripe-signature'];

    if (!sig) {
      logger.warn('Stripe webhook: Missing signature');
      return res.status(400).send('Missing stripe-signature header');
    }

    if (!webhookSecret) {
      logger.error('Stripe webhook: STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(
        req.rawBody as Buffer,
        sig,
        webhookSecret
      );
    } catch (err) {
      const error = err as Error;
      logger.error('Stripe webhook: Signature verification failed', {
        error: error.message,
      });
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    // Check event timestamp to prevent replay attacks
    // Stripe webhooks should be processed within 5 minutes
    const eventAge = Date.now() / 1000 - event.created;
    if (eventAge > 300) { // 5 minutes
      logger.warn('Stripe webhook: Event too old (potential replay attack)', {
        eventId: event.id,
        eventAge,
        created: event.created,
      });
      return res.status(400).send('Event too old');
    }

    // Check for duplicate events (idempotency)
    if (processedEvents.has(event.id)) {
      logger.info('Stripe webhook: Duplicate event ignored', {
        eventId: event.id,
        type: event.type,
      });
      return res.json({ received: true, duplicate: true });
    }

    // Mark event as processed
    processedEvents.add(event.id);

    logger.info('Stripe webhook received', {
      type: event.type,
      id: event.id,
      created: event.created,
      eventAge: Math.round(eventAge),
    });

    try {
      // Handle the event
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          await handlePaymentSucceeded(paymentIntent);
          break;
        }

        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          await handlePaymentFailed(paymentIntent);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionChange(subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionCanceled(subscription);
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoicePaid(invoice);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoiceFailed(invoice);
          break;
        }

        default:
          logger.debug('Stripe webhook: Unhandled event type', {
            type: event.type,
          });
      }

      res.json({ received: true });
    } catch (error) {
      logger.error('Stripe webhook: Error processing event', {
        type: event.type,
        id: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).send('Webhook handler failed');
    }
  });
}

// Webhook handlers

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  logger.info('Payment succeeded', {
    id: paymentIntent.id,
    amount: paymentIntent.amount,
    customer: paymentIntent.customer,
  });

  // Skip database operations if Supabase not configured
  if (!isSupabaseConfigured) {
    logger.warn('Payment succeeded but Supabase not configured - skipping database update');
    return;
  }

  // Update payment record in database
  const { error } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'paid',
    })
    .eq('stripe_customer_id', paymentIntent.customer as string);

  if (error) {
    logger.error('Failed to update payment status', { error: error.message });
    throw error;
  }
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  logger.warn('Payment failed', {
    id: paymentIntent.id,
    customer: paymentIntent.customer,
    error: paymentIntent.last_payment_error?.message,
  });

  if (!isSupabaseConfigured) {
    logger.warn('Payment failed but Supabase not configured - skipping database update');
    return;
  }

  const { error } = await supabaseAdmin
    .from('payments')
    .update({
      status: 'failed',
    })
    .eq('stripe_customer_id', paymentIntent.customer as string);

  if (error) {
    logger.error('Failed to update payment status', { error: error.message });
  }
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  logger.info('Subscription updated', {
    id: subscription.id,
    customer: subscription.customer,
    status: subscription.status,
  });

  if (!isSupabaseConfigured) {
    logger.warn('Subscription updated but Supabase not configured - skipping database update');
    return;
  }

  // TODO: Implement subscription status update when customer mapping is set up
  // Requires mapping Stripe customer_id to Supabase user_id
  logger.debug('Subscription update logged, database integration pending');
}

async function handleSubscriptionCanceled(subscription: Stripe.Subscription) {
  logger.info('Subscription canceled', {
    id: subscription.id,
    customer: subscription.customer,
  });

  if (!isSupabaseConfigured) {
    logger.warn('Subscription canceled but Supabase not configured - skipping database update');
    return;
  }

  // TODO: Implement subscription cancellation when customer mapping is set up
  // Mark user as inactive, revoke access, etc.
  logger.debug('Subscription cancellation logged, database integration pending');
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  logger.info('Invoice paid', {
    id: invoice.id,
    customer: invoice.customer,
    amount: invoice.amount_paid,
  });

  if (!isSupabaseConfigured) {
    logger.warn('Invoice paid but Supabase not configured - skipping database insert');
    return;
  }

  const { error } = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: '', // TODO: Map customer ID to user ID
      stripe_customer_id: invoice.customer as string,
      invoice_id: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'paid',
    });

  if (error) {
    logger.error('Failed to create payment record', { error: error.message });
  }
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  logger.warn('Invoice payment failed', {
    id: invoice.id,
    customer: invoice.customer,
    amount: invoice.amount_due,
  });

  // TODO: Notify user of failed payment
  // Send email, create task, etc.
}
