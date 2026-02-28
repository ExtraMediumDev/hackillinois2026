import Stripe from 'stripe';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

/**
 * Creates a Stripe Crypto Onramp session targeting a specific Solana wallet address.
 * Falls back to a generic onramp URL if the feature is not yet approved.
 */
export async function createOnrampSession(walletAddress: string): Promise<string> {
  const stripe = getStripe();
  try {
    // @ts-expect-error — crypto onramp is a newer Stripe API not yet in the types
    const session = await stripe.crypto.onrampSessions.create({
      transaction_details: {
        destination_currency: 'usdc',
        destination_network: 'solana',
        wallet_addresses: { solana: walletAddress },
      },
      customer_ip_address: '127.0.0.1', // replace with real IP in production
    });
    return (session as { redirect_url: string }).redirect_url;
  } catch (err: unknown) {
    const stripeErr = err as { type?: string };
    // If Crypto Onramp not yet approved, return dashboard link as fallback
    if (stripeErr?.type === 'StripeInvalidRequestError') {
      return `https://dashboard.stripe.com/crypto-onramp/get-started`;
    }
    throw err;
  }
}

/**
 * Creates a Stripe Express Connect account for a player (for payouts).
 */
export async function createConnectAccount(email?: string): Promise<string> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: 'express',
    capabilities: {
      transfers: { requested: true },
    },
    ...(email ? { email } : {}),
  });
  return account.id;
}

/**
 * Initiates an instant payout to a player's debit card via Stripe Connect.
 * Requires the player to have a connected bank/debit account.
 */
export async function initiateInstantPayout(
  connectAccountId: string,
  amountCents: number,
  currency = 'usd'
): Promise<Stripe.Payout> {
  const stripe = getStripe();
  return stripe.payouts.create(
    {
      amount: amountCents,
      currency,
      method: 'instant',
    },
    { stripeAccount: connectAccountId }
  );
}

/**
 * Validates and constructs a Stripe webhook event from raw body + signature.
 */
export function constructWebhookEvent(rawBody: Buffer, sig: string): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
}
