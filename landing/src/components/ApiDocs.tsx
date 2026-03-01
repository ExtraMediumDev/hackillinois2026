import { useState } from 'react';
import { FiArrowLeft, FiChevronDown, FiChevronUp, FiCopy, FiCheck } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import DecryptedText from './DecryptedText';
import AnimatedList from './AnimatedList';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

type HttpMethod = 'GET' | 'POST';

interface EndpointParam {
    name: string;
    type: string;
    required?: boolean;
    description: string;
}

interface EndpointDef {
    method: HttpMethod;
    path: string;
    summary: string;
    description: string;
    auth: boolean;
    idempotent?: boolean;
    params?: EndpointParam[];
    body?: EndpointParam[];
    query?: EndpointParam[];
    responseExample: string;
    curl: string;
}

const endpoints: EndpointDef[] = [
    {
        method: 'GET',
        path: '/health',
        summary: 'Health check',
        description: 'Returns API status and version. No authentication required.',
        auth: false,
        responseExample: `{ "status": "ok", "version": "1.0.0" }`,
        curl: `curl ${API_BASE}/health`,
    },
    {
        method: 'POST',
        path: '/v1/wallets',
        summary: 'Create wallet',
        description: 'Generates a new Solana burner wallet with an encrypted keypair stored in Upstash Redis.',
        auth: true,
        responseExample: `{
  "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
  "public_key": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
}`,
        curl: `curl -X POST ${API_BASE}/v1/wallets \\
  -H "X-API-Key: $API_KEY"`,
    },
    {
        method: 'GET',
        path: '/v1/wallets/:id',
        summary: 'Get wallet balance',
        description: 'Returns live SOL and USDC balances from on-chain and simulated sources.',
        auth: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID (UUID)' }],
        responseExample: `{
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "sol_balance": 0.001,
  "usdc_balance": 5.00,
  "on_chain_usdc": 0.00,
  "simulated_usdc": 5.00
}`,
        curl: `curl ${API_BASE}/v1/wallets/$WALLET_ID \\
  -H "X-API-Key: $API_KEY"`,
    },
    {
        method: 'POST',
        path: '/v1/wallets/:id/deposit',
        summary: 'Fund wallet via Stripe Checkout',
        description: 'Creates a Stripe Checkout session. On payment success, the webhook credits devnet USDC to this wallet.',
        auth: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID' }],
        body: [
            { name: 'amount_usd', type: 'number', description: 'Amount in USD (default $0.50, min $0.50)' },
            { name: 'success_url', type: 'string', description: 'Redirect URL on success (pair with cancel_url)' },
            { name: 'cancel_url', type: 'string', description: 'Redirect URL on cancel (pair with success_url)' },
            { name: 'redirect_url', type: 'string', description: 'Alternative: single URL; ?status=success or ?status=cancelled appended' },
        ],
        responseExample: `{ "url": "https://checkout.stripe.com/...", "amount_usd": 0.5 }`,
        curl: `curl -X POST ${API_BASE}/v1/wallets/$WALLET_ID/deposit \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount_usd": 0.5}'`,
    },
    {
        method: 'POST',
        path: '/v1/wallets/:id/transfer',
        summary: 'Credit or debit balance',
        description: 'Positive amount_usdc credits the wallet, negative debits it. Balance floors at 0. Requires Idempotency-Key header.',
        auth: true,
        idempotent: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID' }],
        body: [
            { name: 'amount_usdc', type: 'string', required: true, description: 'Amount to credit (+) or debit (-)' },
            { name: 'note', type: 'string', description: 'Freeform tracking note' },
        ],
        responseExample: `{
  "wallet_id": "550e8400-...",
  "before_balance": 5.00,
  "after_balance": 7.00,
  "amount_usdc": 2.00,
  "note": "prize winnings"
}`,
        curl: `curl -X POST ${API_BASE}/v1/wallets/$WALLET_ID/transfer \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"amount_usdc": "2.00", "note": "prize winnings"}'`,
    },
    {
        method: 'POST',
        path: '/v1/wallets/:id/withdraw',
        summary: 'Withdraw from balance',
        description: 'Withdraws from the wallet\'s simulated balance. Omit amount_usdc to withdraw the full balance.',
        auth: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID' }],
        body: [
            { name: 'amount_usdc', type: 'number', description: 'Amount to withdraw (omit for full balance)' },
        ],
        responseExample: `{
  "status": "settled",
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "amount_usdc": 3.00,
  "remaining_balance": 2.00,
  "confirmation_id": "withdraw_550e8400_1709312345678",
  "settlement_mode": "simulated"
}`,
        curl: `curl -X POST ${API_BASE}/v1/wallets/$WALLET_ID/withdraw \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount_usdc": 3.00}'`,
    },
    {
        method: 'GET',
        path: '/v1/wallets/:id/transactions',
        summary: 'On-chain transaction history',
        description: 'Returns Solana transaction signatures and block times for this wallet.',
        auth: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID' }],
        query: [{ name: 'limit', type: 'string', description: 'Max results (default 20, max 100)' }],
        responseExample: `{
  "wallet_id": "550e8400-...",
  "public_key": "7xKXtg...",
  "transactions": [
    { "signature": "5xT3...", "blockTime": 1709312345 }
  ]
}`,
        curl: `curl "${API_BASE}/v1/wallets/$WALLET_ID/transactions?limit=10" \\
  -H "X-API-Key: $API_KEY"`,
    },
    {
        method: 'POST',
        path: '/v1/wallets/:id/connect',
        summary: 'Stripe Connect onboarding',
        description: 'Creates or reuses a Stripe Express Connect account and returns an onboarding link for fiat payouts.',
        auth: true,
        params: [{ name: 'id', type: 'string', required: true, description: 'Wallet ID' }],
        responseExample: `{ "url": "https://connect.stripe.com/..." }`,
        curl: `curl -X POST ${API_BASE}/v1/wallets/$WALLET_ID/connect \\
  -H "X-API-Key: $API_KEY"`,
    },
    {
        method: 'POST',
        path: '/v1/wallets/cleanup-inactive',
        summary: 'Cleanup inactive wallets',
        description: 'Scans inactive wallets past the grace period with zero balances and optionally deletes them.',
        auth: true,
        body: [
            { name: 'dry_run', type: 'boolean', description: 'Preview only, don\'t delete (default true)' },
            { name: 'grace_hours', type: 'number', description: 'Hours before eligible (default 168)' },
        ],
        responseExample: `{
  "dry_run": true,
  "grace_hours": 168,
  "scanned": 12,
  "eligible_count": 2,
  "deleted_count": 0,
  "eligible_wallet_ids": ["abc-123", "def-456"],
  "skipped": [{ "wallet_id": "ghi-789", "reason": "non-zero balance" }]
}`,
        curl: `curl -X POST ${API_BASE}/v1/wallets/cleanup-inactive \\
  -H "X-API-Key: $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"dry_run": true, "grace_hours": 168}'`,
    },
    {
        method: 'POST',
        path: '/v1/webhooks/stripe',
        summary: 'Stripe webhook handler',
        description: 'Validates Stripe signature and handles checkout.session.completed (credits USDC), crypto_onramp_session.fulfillment.succeeded, and account.updated events.',
        auth: false,
        responseExample: `{ "received": true }`,
        curl: `# Configured in Stripe Dashboard → Webhooks
# Authenticated via stripe-signature header`,
    },
];

const METHOD_COLORS: Record<HttpMethod, string> = {
    GET: '#4de9a8',
    POST: '#6a5cff',
};

function MethodBadge({ method }: { method: HttpMethod }) {
    return (
        <span className="docs-method-badge" style={{ background: `${METHOD_COLORS[method]}22`, color: METHOD_COLORS[method], borderColor: `${METHOD_COLORS[method]}44` }}>
            {method}
        </span>
    );
}

function EndpointDetail({ endpoint }: { endpoint: EndpointDef }) {
    const [copiedCurl, setCopiedCurl] = useState(false);

    const copyCurl = () => {
        navigator.clipboard.writeText(endpoint.curl);
        setCopiedCurl(true);
        setTimeout(() => setCopiedCurl(false), 2000);
    };

    return (
        <motion.div
            className="docs-endpoint-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
        >
            <p className="docs-endpoint-desc">{endpoint.description}</p>

            <div className="docs-endpoint-meta">
                {endpoint.auth && <span className="docs-tag docs-tag--auth">X-API-Key</span>}
                {endpoint.idempotent && <span className="docs-tag docs-tag--idempotent">Idempotency-Key</span>}
            </div>

            {endpoint.params && (
                <div className="docs-param-section">
                    <h4 className="docs-param-title">Path Parameters</h4>
                    {endpoint.params.map(p => (
                        <div key={p.name} className="docs-param-row">
                            <code className="docs-param-name">{p.name}</code>
                            <span className="docs-param-type">{p.type}</span>
                            {p.required && <span className="docs-param-required">required</span>}
                            <span className="docs-param-desc">{p.description}</span>
                        </div>
                    ))}
                </div>
            )}

            {endpoint.body && (
                <div className="docs-param-section">
                    <h4 className="docs-param-title">Body</h4>
                    {endpoint.body.map(p => (
                        <div key={p.name} className="docs-param-row">
                            <code className="docs-param-name">{p.name}</code>
                            <span className="docs-param-type">{p.type}</span>
                            {p.required && <span className="docs-param-required">required</span>}
                            <span className="docs-param-desc">{p.description}</span>
                        </div>
                    ))}
                </div>
            )}

            {endpoint.query && (
                <div className="docs-param-section">
                    <h4 className="docs-param-title">Query</h4>
                    {endpoint.query.map(p => (
                        <div key={p.name} className="docs-param-row">
                            <code className="docs-param-name">{p.name}</code>
                            <span className="docs-param-type">{p.type}</span>
                            <span className="docs-param-desc">{p.description}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="docs-param-section">
                <h4 className="docs-param-title">Response</h4>
                <pre className="docs-code-block">{endpoint.responseExample}</pre>
            </div>

            <div className="docs-param-section">
                <div className="docs-curl-header">
                    <h4 className="docs-param-title">cURL</h4>
                    <button className="docs-copy-btn" onClick={copyCurl} title="Copy cURL">
                        {copiedCurl ? <FiCheck size={14} /> : <FiCopy size={14} />}
                    </button>
                </div>
                <pre className="docs-code-block">{endpoint.curl}</pre>
            </div>
        </motion.div>
    );
}

export default function ApiDocs() {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const toggle = (index: number) => {
        setExpandedIndex(prev => (prev === index ? null : index));
    };

    const listItems = endpoints.map((ep, i) => (
        <div key={i} className="docs-endpoint-row" onClick={() => toggle(i)}>
            <div className="docs-endpoint-summary">
                <MethodBadge method={ep.method} />
                <code className="docs-endpoint-path">{ep.path}</code>
                <span className="docs-endpoint-label">{ep.summary}</span>
                <span className="docs-expand-icon">
                    {expandedIndex === i ? <FiChevronUp /> : <FiChevronDown />}
                </span>
            </div>
            <AnimatePresence>
                {expandedIndex === i && <EndpointDetail endpoint={ep} />}
            </AnimatePresence>
        </div>
    ));

    return (
        <div className="api-docs-container">
            <div className="docs-header">
                <div className="docs-top-bar">
                    <Link to="/" className="primary-btn docs-back-btn">
                        <FiArrowLeft style={{ marginRight: '0.5rem' }} />
                        Back to Home
                    </Link>
                </div>

                <h1 className="docs-title">
                    <DecryptedText
                        text="API Reference"
                        animateOn="view"
                        sequential
                        speed={70}
                        className="headline docs-headline"
                        encryptedClassName="headline encrypted docs-headline"
                    />
                </h1>
                <p className="docs-subtitle">
                    All endpoints require <code>X-API-Key</code> header unless noted. Base URL: <code>{API_BASE}</code>
                </p>
            </div>

            <AnimatedList
                items={listItems}
                showGradients={false}
                enableArrowNavigation={false}
                displayScrollbar={false}
            />
        </div>
    );
}
