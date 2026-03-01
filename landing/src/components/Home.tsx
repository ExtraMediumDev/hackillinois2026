import Carousel, { type CarouselItem } from './Carousel';
import CompanyMarquee from './CompanyMarquee';
import DecryptedText from './DecryptedText';
import PaymentFlowDemo from './PaymentFlowDemo';
import ScrollReveal from './ScrollReveal';
import { FiCreditCard, FiDollarSign, FiShield, FiZap, FiBookOpen, FiPlay } from 'react-icons/fi';
import { Link } from 'react-router-dom';

const pillars: CarouselItem[] = [
    {
        id: 1,
        title: 'Instant Fiat Onramp',
        description: 'Accept cards with Stripe and mint USDC liquidity without forcing users to touch wallets.',
        icon: <FiCreditCard className="carousel-icon" />,
    },
    {
        id: 2,
        title: 'Wallet Abstraction',
        description: 'Provision burner wallets and route SOL operations through secure backend orchestration.',
        icon: <FiShield className="carousel-icon" />,
    },
    {
        id: 3,
        title: 'Programmable Swaps',
        description: 'Convert between SOL and USDC to match product flows and user payout requirements in real time.',
        icon: <FiZap className="carousel-icon" />,
    },
    {
        id: 4,
        title: 'Payout Rails',
        description: 'Exit back through Stripe checkout and payouts for a smooth crypto-to-fiat settlement cycle.',
        icon: <FiDollarSign className="carousel-icon" />,
    },
];

export default function Home() {
    return (
        <>
            <section className="hero">
                <p className="eyebrow">HackIllinois 2026</p>
                <h1>
                    <DecryptedText
                        text="Splice API"
                        animateOn="view"
                        sequential
                        speed={70}
                        className="headline"
                        encryptedClassName="headline encrypted"
                    />
                </h1>
                <p className="subhead">
                    The payments layer for web3 games. Card in, crypto out, no wallets required.
                </p>

                <div className="hero-actions" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <Link to="/docs" className="primary-btn">
                        <FiBookOpen style={{ marginRight: '0.5rem' }} />
                        View API Documentation
                    </Link>
                    <Link to="/demo" className="primary-btn primary-btn--accent">
                        <FiPlay style={{ marginRight: '0.5rem' }} />
                        Try Live Demo
                    </Link>
                </div>
            </section>

            <section className="demo-section">
                <div className="demo-player-wrap">
                    <PaymentFlowDemo />
                </div>
            </section>

            <section className="carousel-section">
                <h2 className="carousel-title">Platform Capabilities</h2>
                <div className="carousel-wrap">
                    <Carousel items={pillars} baseWidth={560} autoplay autoplayDelay={2600} pauseOnHover loop />
                </div>
            </section>

            <CompanyMarquee />
        </>
    );
}
