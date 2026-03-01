import { useState, useCallback, useEffect, useRef } from 'react';
import DecryptedText from './DecryptedText';
import { FiArrowLeft, FiUser, FiCreditCard, FiDollarSign, FiCopy, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

interface PlayerData {
    player_id: string;
    public_key: string;
    sol_balance?: number;
    usdc_balance?: number;
}

interface CashoutResult {
    status?: string;
    stripe_payout_id?: string;
    amount_transferred?: number;
    settlement_mode?: string;
    fiat_payout_status?: string;
    payout_destination_connect_account_id?: string;
}

const PLAYER_STORAGE_KEY = 'splice_demo_player_id';

export default function Demo() {
    const [player, setPlayer] = useState<PlayerData | null>(null);
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [cashoutResult, setCashoutResult] = useState<CashoutResult | null>(null);
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

    const fetchPlayerById = useCallback(async (playerId: string): Promise<PlayerData | null> => {
        const res = await fetch(`${API_BASE}/v1/players/${playerId}`, { headers: authHeaders });
        if (!res.ok) return null;
        const data = await res.json();
        return {
            player_id: data.player_id,
            public_key: data.public_key,
            sol_balance: data.sol_balance,
            usdc_balance: data.usdc_balance,
        };
    }, []);

    const stopDepositWatch = useCallback(() => {
        if (depositWatchTimerRef.current) {
            window.clearInterval(depositWatchTimerRef.current);
            depositWatchTimerRef.current = null;
        }
    }, []);

    const startDepositWatch = useCallback((playerId: string, baselineUsdc: number) => {
        stopDepositWatch();
        const deadline = Date.now() + 2 * 60 * 1000;
        let inFlight = false;
        depositWatchTimerRef.current = window.setInterval(async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const latest = await fetchPlayerById(playerId);
                if (!latest) return;
                setPlayer(prev => prev?.player_id === playerId ? { ...prev, ...latest } : prev);
                const currentUsdc = latest.usdc_balance ?? 0;
                if (currentUsdc > baselineUsdc + 0.000001 || Date.now() > deadline) {
                    stopDepositWatch();
                }
            } finally {
                inFlight = false;
            }
        }, 3000);
    }, [fetchPlayerById, stopDepositWatch]);

    useEffect(() => {
        if (!API_KEY) return;
        const savedPlayerId = window.localStorage.getItem(PLAYER_STORAGE_KEY);
        if (!savedPlayerId) return;

        void (async () => {
            try {
                const restored = await fetchPlayerById(savedPlayerId);
                if (!restored) {
                    window.localStorage.removeItem(PLAYER_STORAGE_KEY);
                    return;
                }
                setPlayer(restored);
            } catch {
                // Ignore silent restore failures; user can always create a new player.
            }
        })();
    }, [fetchPlayerById]);

    useEffect(() => {
        return () => {
            stopDepositWatch();
        };
    }, [stopDepositWatch]);

    const createPlayer = useCallback(async () => {
        if (!ensureApiKey()) return;
        setLoading('create');
        setError(null);
        setCashoutResult(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players`, {
                method: 'POST',
                headers: jsonHeaders,
                body: '{}',
            });
            if (!res.ok) throw new Error(`Failed to create player (${res.status})`);
            const data = await res.json();
            setPlayer({ player_id: data.player_id, public_key: data.public_key });
            window.localStorage.setItem(PLAYER_STORAGE_KEY, data.player_id);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to create player');
        } finally {
            setLoading(null);
        }
    }, [ensureApiKey]);

    const refreshBalance = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!player) return;
        setLoading('refresh');
        setError(null);
        try {
            const latest = await fetchPlayerById(player.player_id);
            if (!latest) throw new Error('Failed to fetch updated balance');
            setPlayer(prev => prev ? { ...prev, ...latest } : null);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to refresh balance');
        } finally {
            setLoading(null);
        }
    }, [player, ensureApiKey, fetchPlayerById]);

    const fundWallet = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!player) return;
        stopDepositWatch();
        setLoading('fund');
        setError(null);
        try {
            const successUrl = `${window.location.origin}/demo/stripe-success`;
            const cancelUrl = `${window.location.origin}/demo/stripe-cancel`;
            const res = await fetch(`${API_BASE}/v1/players/${player.player_id}/checkout-session`, {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                    success_url: successUrl,
                    cancel_url: cancelUrl,
                    amount_usd: 0.50,
                }),
            });
            if (!res.ok) throw new Error(`Failed to create checkout session (${res.status})`);
            const data = await res.json();
            if (data.url) {
                window.open(data.url, '_blank');
                startDepositWatch(player.player_id, player.usdc_balance ?? 0);
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start funding');
        } finally {
            setLoading(null);
        }
    }, [player, ensureApiKey, startDepositWatch, stopDepositWatch]);

    const cashOut = useCallback(async () => {
        if (!ensureApiKey()) return;
        if (!player) return;
        setLoading('cashout');
        setError(null);
        setCashoutResult(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players/${player.player_id}/cashout`, {
                method: 'POST',
                headers: jsonHeaders,
                body: '{}',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || `Cash out failed (${res.status})`);
            }
            const body = await res.json().catch(() => ({}));
            setCashoutResult(body);
            await refreshBalance();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Cash out failed');
        } finally {
            setLoading(null);
        }
    }, [player, refreshBalance, ensureApiKey]);

    const copyId = useCallback(() => {
        if (!player) return;
        navigator.clipboard.writeText(player.player_id);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [player]);

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
                    Create a player, fund your burner wallet, and cash out — all in one flow on the Solana network.
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
            <div className="demo-grid">
                {/* Step 1 – Create Player */}
                <div className={`demo-card ${player ? 'demo-card--done' : ''}`}>
                    <div className="demo-card-number">1</div>
                    <div className="demo-card-content">
                        <h3 className="demo-card-title">
                            <FiUser style={{ marginRight: '0.5rem' }} />
                            Create Player
                        </h3>
                        <p className="demo-card-desc">
                            Generate a new burner wallet on Solana devnet. No seed phrases, no extensions.
                        </p>

                        {!player ? (
                            <button className="demo-action-btn" onClick={createPlayer} disabled={loading === 'create'}>
                                {loading === 'create' ? (
                                    <><FiRefreshCw className="spin" /> Creating...</>
                                ) : (
                                    'Create My Player'
                                )}
                            </button>
                        ) : (
                            <div className="demo-player-info">
                                <div className="demo-info-row">
                                    <span className="demo-info-label">Player ID</span>
                                    <span className="demo-info-value">
                                        <code>{player.player_id.slice(0, 8)}...{player.player_id.slice(-4)}</code>
                                        <button onClick={copyId} className="demo-copy-btn" title="Copy full ID">
                                            {copied ? <FiCheck /> : <FiCopy />}
                                        </button>
                                    </span>
                                </div>
                                <div className="demo-info-row">
                                    <span className="demo-info-label">Wallet</span>
                                    <span className="demo-info-value">
                                        <code>{player.public_key.slice(0, 6)}...{player.public_key.slice(-4)}</code>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Step 2 – Fund Wallet */}
                <div className={`demo-card ${!player ? 'demo-card--locked' : ''}`}>
                    <div className="demo-card-number">2</div>
                    <div className="demo-card-content">
                        <h3 className="demo-card-title">
                            <FiCreditCard style={{ marginRight: '0.5rem' }} />
                            Fund Wallet
                        </h3>
                        <p className="demo-card-desc">
                            Use Stripe test checkout to add funds to your Solana-based demo wallet.
                        </p>

                        {player && (
                            <div className="demo-balance-row">
                                <div className="demo-balance-item">
                                    <span className="demo-balance-label">USDC</span>
                                    <span className="demo-balance-value">{player.usdc_balance?.toFixed(2) ?? '—'}</span>
                                </div>
                                <button onClick={refreshBalance} className="demo-refresh-btn" disabled={loading === 'refresh'} title="Refresh balances">
                                    <FiRefreshCw className={loading === 'refresh' ? 'spin' : ''} />
                                </button>
                            </div>
                        )}

                        <button
                            className="demo-action-btn"
                            onClick={fundWallet}
                            disabled={!player || loading === 'fund'}
                        >
                            {loading === 'fund' ? (
                                <><FiRefreshCw className="spin" /> Opening Stripe...</>
                            ) : (
                                'Fund with $0.50'
                            )}
                        </button>
                    </div>
                </div>

                {/* Step 3 – Cash Out */}
                <div className={`demo-card ${!player ? 'demo-card--locked' : ''}`}>
                    <div className="demo-card-number">3</div>
                    <div className="demo-card-content">
                        <h3 className="demo-card-title">
                            <FiDollarSign style={{ marginRight: '0.5rem' }} />
                            Cash Out
                        </h3>
                        <p className="demo-card-desc">
                            Convert your USDC balance back to real USD and receive it directly to your bank account via Stripe.
                        </p>

                        {cashoutResult?.status === 'success' && (
                            <div className="demo-success">
                                <span>
                                    You successfully withdrew to test account
                                    {' '}
                                    <code>{cashoutResult.payout_destination_connect_account_id ?? 'N/A'}</code>.
                                </span>
                            </div>
                        )}

                        <button
                            className="demo-action-btn demo-action-btn--cashout"
                            onClick={cashOut}
                            disabled={!player || loading === 'cashout'}
                        >
                            {loading === 'cashout' ? (
                                <><FiRefreshCw className="spin" /> Processing...</>
                            ) : (
                                'Cash Out to Bank'
                            )}
                        </button>
                    </div>
                </div>

                {/* Step 4 – Game (Coming Soon) */}
                <div className="demo-card demo-card--locked demo-card--game">
                    <div className="demo-card-number">4</div>
                    <div className="demo-card-content">
                        <h3 className="demo-card-title">
                            Play Game
                        </h3>
                        <p className="demo-card-desc">
                            Join a live multiplayer game using your funded wallet. Compete against other players and win USDC prizes.
                        </p>
                        <div className="demo-coming-soon">Coming Soon</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
