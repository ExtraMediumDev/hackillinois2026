import { useState, useCallback } from 'react';
import DecryptedText from './DecryptedText';
import { FiArrowLeft, FiUser, FiCreditCard, FiDollarSign, FiCopy, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { Link } from 'react-router-dom';

const API_BASE = 'http://localhost:3000';
// Set this to your API key from api/.env, or pass VITE_API_KEY at build time
const API_KEY = 'dev-api-key-change-in-production';

interface PlayerData {
    player_id: string;
    public_key: string;
    sol_balance?: number;
    usdc_balance?: number;
}

export default function Demo() {
    const [player, setPlayer] = useState<PlayerData | null>(null);
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const authHeaders: Record<string, string> = {
        'X-API-Key': API_KEY,
    };

    const jsonHeaders: Record<string, string> = {
        ...authHeaders,
        'Content-Type': 'application/json',
    };

    const createPlayer = useCallback(async () => {
        setLoading('create');
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players`, { method: 'POST', headers: authHeaders });
            if (!res.ok) throw new Error(`Failed to create player (${res.status})`);
            const data = await res.json();
            setPlayer({ player_id: data.player_id, public_key: data.public_key });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to create player');
        } finally {
            setLoading(null);
        }
    }, []);

    const refreshBalance = useCallback(async () => {
        if (!player) return;
        setLoading('refresh');
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players/${player.player_id}`, { headers: authHeaders });
            if (!res.ok) throw new Error(`Failed to fetch balance (${res.status})`);
            const data = await res.json();
            setPlayer(prev => prev ? { ...prev, sol_balance: data.sol_balance, usdc_balance: data.usdc_balance } : null);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to refresh balance');
        } finally {
            setLoading(null);
        }
    }, [player]);

    const fundWallet = useCallback(async () => {
        if (!player) return;
        setLoading('fund');
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players/${player.player_id}/checkout-session`, {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                    success_url: window.location.href + '?funded=true',
                    cancel_url: window.location.href,
                    amount_usd: 0.50,
                }),
            });
            if (!res.ok) throw new Error(`Failed to create checkout session (${res.status})`);
            const data = await res.json();
            if (data.url) window.open(data.url, '_blank');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start funding');
        } finally {
            setLoading(null);
        }
    }, [player]);

    const cashOut = useCallback(async () => {
        if (!player) return;
        setLoading('cashout');
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/v1/players/${player.player_id}/cashout`, {
                method: 'POST',
                headers: authHeaders,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error?.message || `Cash out failed (${res.status})`);
            }
            await refreshBalance();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Cash out failed');
        } finally {
            setLoading(null);
        }
    }, [player, refreshBalance]);

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
                    Create a player, fund your burner wallet, and cash out — all in one flow.
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
                            Pay with a test card via Stripe Checkout. USDC is credited to your burner wallet automatically.
                        </p>

                        {player && (
                            <div className="demo-balance-row">
                                <div className="demo-balance-item">
                                    <span className="demo-balance-label">USDC</span>
                                    <span className="demo-balance-value">{player.usdc_balance?.toFixed(2) ?? '—'}</span>
                                </div>
                                <div className="demo-balance-item">
                                    <span className="demo-balance-label">SOL</span>
                                    <span className="demo-balance-value">{player.sol_balance?.toFixed(4) ?? '—'}</span>
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
                            🎮 Play Game
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
