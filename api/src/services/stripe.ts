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
  // Crypto Onramp may be missing in SDK or not enabled on account
  const crypto = (stripe as unknown as { crypto?: { onrampSessions?: { create: (opts: unknown) => Promise<{ redirect_url: string }> } } }).crypto;
  if (!crypto?.onrampSessions) {
    return `https://dashboard.stripe.com/crypto-onramp/get-started`;
  }
  try {
    const session = await crypto.onrampSessions.create({
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
 * Creates an onboarding link for a Stripe Express Connect account.
 */
export async function createConnectOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return accountLink.url;
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
 * Transfers funds from the platform balance to a user's connected account.
 */
export async function createTransferToConnectedAccount(
  connectAccountId: string,
  amountCents: number,
  currency = 'usd'
): Promise<Stripe.Transfer> {
  const stripe = getStripe();
  return stripe.transfers.create({
    amount: amountCents,
    currency,
    destination: connectAccountId,
  });
}

/**
 * Creates a Stripe Checkout session for demo payments (card → we credit devnet USDC).
 * Store player_id in metadata so webhook can credit the correct burner wallet.
 */
export async function createCheckoutSession(params: {
  playerId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: params.amountCents,
          product_data: {
            name: 'Splice API - Add crypto using your debit card instantly',
            description:
              'Test only: use card 4242 4242 4242 4242, any future MM/YY, any 3-digit CVC, any fake name, and any test email to complete payment.',
            images: undefined,
          },
        },
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { player_id: params.playerId },
    client_reference_id: params.playerId,
    custom_text: {
      submit: {
        message:
          'Test mode only: use card 4242 4242 4242 4242, any future expiry, any 3-digit CVC, and fake customer details.',
      },
    },
  });
  return session.url!;
}

/**
 * Validates and constructs a Stripe webhook event from raw body + signature.
 */
export function constructWebhookEvent(rawBody: Buffer, sig: string): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
}
