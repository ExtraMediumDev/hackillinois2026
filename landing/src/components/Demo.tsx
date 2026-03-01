import { useState, useCallback, useEffect, useRef } from 'react';
import DecryptedText from './DecryptedText';
import { FiArrowLeft, FiUser, FiCreditCard, FiDollarSign, FiCopy, FiCheck, FiRefreshCw, FiExternalLink } from 'react-icons/fi';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

interface WalletData {
    wallet_id: string;
    public_key: string;
    sol_balance?: number;
    usdc_balance?: number;
    on_chain_usdc?: number;
    simulated_usdc?: number;
}

interface WithdrawResult {
    status?: string;
    wallet_id?: string;
    amount_usdc?: number;
    remaining_balance?: number;
    confirmation_id?: string;
    settlement_mode?: string;
}

const WALLET_STORAGE_KEY = 'splice_demo_wallet_id';

export default function Demo() {
    const [wallet, setWallet] = useState<WalletData | null>(null);
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);
    const depositWatchTimerRef = useRef<number | null>(null);

    const authHeaders: Record<string, string> = {
        'X-API-Key': API_KEY,
    };

    const jsonHeaders: Record<string, string> = {
        ...authHeaders,
        'Content-Type': 'application/json',
    };

    const ensureApiKey = useCallback((): boolean => {
        if (API_KEY) return true;
        setError('Missing VITE_API_KEY. Set it in landing/.env.local to call protected API routes.');
        return false;
    }, []);

    const fetchWalletById = useCallback(async (walletId: string): Promise<WalletData | null> => {
        const res = await fetch(`${API_BASE}/v1/wallets/${walletId}`, { headers: authHeaders });
        if (!res.ok) return null;
        const data = await res.json();
        return {
            wallet_id: data.wallet_id,
            public_key: data.public_key,
            sol_balance: data.sol_balance,
            usdc_balance: data.usdc_balance,
            on_chain_usdc: data.on_chain_usdc,
            simulated_usdc: data.simulated_usdc,
        };
    }, []);

    const stopDepositWatch = useCallback(() => {
        if (depositWatchTimerRef.current) {
            window.clearInterval(depositWatchTimerRef.current);
            depositWatchTimerRef.current = null;
        }
    }, []);

    const startDepositWatch = useCallback((walletId: string, baselineUsdc: number) => {
        stopDepositWatch();
        const deadline = Date.now() + 2 * 60 * 1000;
        let inFlight = false;
        depositWatchTimerRef.current = window.setInterval(async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const latest = await fetchWalletById(walletId);
                if (!latest) return;
                setWallet(prev => prev?.wallet_id === walletId ? { ...prev, ...latest } : prev);
                const currentUsdc = latest.usdc_balance ?? 0;
                if (currentUsdc > baselineUsdc + 0.000001 || Date.now() > deadline) {
                    stopDepositWatch();
                }
            } finally {
                inFlight = false;
            }
        }, 3000);
    }, [fetchWalletById, stopDepositWatch]);

    useEffect(() => {
        if (!API_KEY) return;
        const savedWalletId = window.localStorage.getItem(WALLET_STORAGE_KEY);
        if (!savedWalletId) return;

        void (async () => {
            try {
                const restored = await fetchWalletById(savedWalletId);
                if (!restored) {
                    window.localStorage.removeItem(WALLET_STORAGE_KEY);
                    return;
                }
                setWallet(restored);
            } catch {
                // Ignore silent restore failures; user can always create a new wallet.
            }
        })();
    }, [fetchWalletById]);

    useEffect(() => {
        return () => {
            stopDepositWatch();
        };
    }, [stopDepositWatch]);

    const createWallet = useCallback(async () => {
        if (!ensureApiKey()) return;
        setLoading('create');
        setError(null);
        setWithdrawResult(null);
        try {
            const res = await fetch(`${API_BASE}/v1/wallets`, {
                method: 'POST',
                headers: jsonHeaders,
                body: '{}',
            });
            if (!res.ok) throw new Error(`Failed to create wallet (${res.status})`);
            const data = await res.json();
            setWallet({ wallet_id: data.wallet_id, public_key: data.public_key });
            window.localStorage.setItem(WALLET_STORAGE_KEY, data.wallet_id);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to create wallet');
        } finally {
            setLoading(null);
        }
    }, [ensureApiKey]);

    const refreshBalance = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!wallet) return;
        setLoading('refresh');
        setError(null);
        try {
            const latest = await fetchWalletById(wallet.wallet_id);
            if (!latest) throw new Error('Failed to fetch updated balance');
            setWallet(prev => prev ? { ...prev, ...latest } : null);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to refresh balance');
        } finally {
            setLoading(null);
        }
    }, [wallet, ensureApiKey, fetchWalletById]);

    const fundWallet = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!wallet) return;
        stopDepositWatch();
        setLoading('fund');
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/v1/wallets/${wallet.wallet_id}/deposit`, {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                    success_url: `${window.location.origin}/demo/stripe-success`,
                    cancel_url: `${window.location.origin}/demo/stripe-cancel`,
                    amount_usd: 0.50,
                }),
            });
            if (!res.ok) throw new Error(`Failed to create deposit session (${res.status})`);
            const data = await res.json();
            if (data.url) {
                window.open(data.url, '_blank');
                startDepositWatch(wallet.wallet_id, wallet.usdc_balance ?? 0);
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start funding');
        } finally {
            setLoading(null);
        }
    }, [wallet, ensureApiKey, startDepositWatch, stopDepositWatch]);

    const withdraw = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!wallet) return;
        setLoading('cashout');
        setError(null);
        setWithdrawResult(null);
        try {
            const res = await fetch(`${API_BASE}/v1/wallets/${wallet.wallet_id}/withdraw`, {
                method: 'POST',
                headers: jsonHeaders,
                body: '{}',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || `Withdraw failed (${res.status})`);
            }
            const body = await res.json().catch(() => ({}));
            setWithdrawResult(body);
            await refreshBalance();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Withdraw failed');
        } finally {
            setLoading(null);
        }
    }, [wallet, refreshBalance, ensureApiKey]);

    const copyId = useCallback(() => {
        if (!wallet) return;
        navigator.clipboard.writeText(wallet.wallet_id);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [wallet]);

    return (
        <div className="demo-page">
            {/* Header */}
            <div className="demo-top-bar">
                <Link to="/" className="primary-btn" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                    <FiArrowLeft style={{ marginRight: '0.4rem' }} />
                    Back to Home
                </Link>
            </div>

            <div className="demo-hero">
                <h1 style={{ margin: 0 }}>
                    <DecryptedText
                        text="Live Demo"
                        animateOn="view"
                        sequential
                        speed={70}
                        className="headline"
                        encryptedClassName="headline encrypted"
                    />
                </h1>
                <p className="demo-subtitle">
                    A single API for fiat-to-fiat movement that abstracts away every protocol and wallet layer.
                </p>
            </div>

            {/* Error banner */}
            {error && (
                <div className="demo-error">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="demo-error-close">&times;</button>
                </div>
            )}

            {/* Main content */}
            <div className="demo-split">
                {/* Left: API Steps */}
                <div className="demo-steps">
                    {/* Step 1 – Create Wallet */}
                    <div className={`demo-card ${wallet ? 'demo-card--done' : ''}`}>
                        <div className="demo-card-number">1</div>
                        <div className="demo-card-content">
                            <h3 className="demo-card-title">
                                <FiUser style={{ marginRight: '0.5rem' }} />
                                Create Wallet
                            </h3>
                            <p className="demo-card-desc">
                                Generate a new burner wallet on Solana devnet. No seed phrases, no extensions.
                            </p>

                            {!wallet ? (
                                <button className="demo-action-btn" onClick={createWallet} disabled={loading === 'create'}>
                                    {loading === 'create' ? (
                                        <><FiRefreshCw className="spin" /> Creating...</>
                                    ) : (
                                        'Create My Wallet'
                                    )}
                                </button>
                            ) : (
                                <div className="demo-player-info">
                                    <div className="demo-info-row">
                                        <span className="demo-info-label">Wallet ID</span>
                                        <span className="demo-info-value">
                                            <code>{wallet.wallet_id.slice(0, 8)}...{wallet.wallet_id.slice(-4)}</code>
                                            <button onClick={copyId} className="demo-copy-btn" title="Copy full ID">
                                                {copied ? <FiCheck /> : <FiCopy />}
                                            </button>
                                        </span>
                                    </div>
                                    <div className="demo-info-row">
                                        <span className="demo-info-label">Public Key</span>
                                        <span className="demo-info-value">
                                            <code>{wallet.public_key.slice(0, 6)}...{wallet.public_key.slice(-4)}</code>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Step 2 – Fund Wallet */}
                    <div className={`demo-card ${!wallet ? 'demo-card--locked' : ''}`}>
                        <div className="demo-card-number">2</div>
                        <div className="demo-card-content">
                            <h3 className="demo-card-title">
                                <FiCreditCard style={{ marginRight: '0.5rem' }} />
                                Fund Wallet
                            </h3>
                            <p className="demo-card-desc">
                                Use Stripe test checkout to add funds to your Solana-based demo wallet.
                            </p>

                            {wallet && (
                                <div className="demo-balance-row">
                                    <div className="demo-balance-item">
                                        <span className="demo-balance-label">USDC</span>
                                        <span className="demo-balance-value">{wallet.usdc_balance?.toFixed(2) ?? '—'}</span>
                                    </div>
                                    <button onClick={refreshBalance} className="demo-refresh-btn" disabled={loading === 'refresh'} title="Refresh balances">
                                        <FiRefreshCw className={loading === 'refresh' ? 'spin' : ''} />
                                    </button>
                                </div>
                            )}

                            <button
                                className="demo-action-btn"
                                onClick={fundWallet}
                                disabled={!wallet || loading === 'fund'}
                            >
                                {loading === 'fund' ? (
                                    <><FiRefreshCw className="spin" /> Opening Stripe...</>
                                ) : (
                                    'Fund with $0.50'
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Step 3 – Withdraw */}
                    <div className={`demo-card ${!wallet ? 'demo-card--locked' : ''}`}>
                        <div className="demo-card-number">3</div>
                        <div className="demo-card-content">
                            <h3 className="demo-card-title">
                                <FiDollarSign style={{ marginRight: '0.5rem' }} />
                                Withdraw
                            </h3>
                            <p className="demo-card-desc">
                                Withdraw your USDC balance. In production this settles to your bank account via Stripe Connect.
                            </p>

                            {withdrawResult?.status === 'settled' && (
                                <div className="demo-success">
                                    <span>
                                        Withdrew {withdrawResult.amount_usdc} USDC.
                                        Remaining balance: {withdrawResult.remaining_balance?.toFixed(2) ?? '0.00'}.
                                    </span>
                                </div>
                            )}

                            <button
                                className="demo-action-btn demo-action-btn--cashout"
                                onClick={withdraw}
                                disabled={!wallet || loading === 'cashout'}
                            >
                                {loading === 'cashout' ? (
                                    <><FiRefreshCw className="spin" /> Processing...</>
                                ) : (
                                    'Withdraw'
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="demo-divider">
                    <div className="demo-divider-line" />
                    <span className="demo-divider-text">or</span>
                    <div className="demo-divider-line" />
                </div>

                {/* Right: Penguin Knockout CTA */}
                <div className="demo-game-cta">
                    <div className="demo-game-cta-inner">
                        <h3 className="demo-game-cta-title">See Splice in Action</h3>
                        <p className="demo-game-cta-desc">
                            Experience the full payment flow inside a live multiplayer game built on our API.
                        </p>
                        <a
                            href="https://penguin-knockout.vercel.app"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="demo-action-btn demo-action-btn--game"
                        >
                            Demo Through Penguin Knockout
                            <FiExternalLink style={{ marginLeft: '0.5rem' }} />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
