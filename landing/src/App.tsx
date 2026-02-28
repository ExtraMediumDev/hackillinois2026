import Antigravity from './components/Antigravity';
import Aurora from './components/Aurora';
import Carousel, { type CarouselItem } from './components/Carousel';
import DecryptedText from './components/DecryptedText';
import PaymentFlowDemo from './components/PaymentFlowDemo';
import ScrollReveal from './components/ScrollReveal';
import { FiCreditCard, FiDollarSign, FiShield, FiZap } from 'react-icons/fi';

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

export default function App() {
  return (
    <div className="page">
      <div className="aurora-layer">
        <Aurora colorStops={['#6a5cff', '#4de9a8', '#a855f7']} speed={0.8} blend={0.6} amplitude={1.2} />
      </div>

      <div className="cursor-layer" aria-hidden="true">
        <Antigravity particleSize={0.4} particleShape="sphere" color="#8ee4ff" ringRadius={8} magnetRadius={9} />
      </div>

      <main className="content">
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
            Build unforgettable game economies with a sleek API that connects card payments, Solana flows, and
            seamless payout rails for any crypto-native platform.
          </p>
        </section>

        <section className="demo-section">
          <ScrollReveal baseRotation={0} containerClassName="demo-reveal" textClassName="demo-reveal-text">
            Stripe to USDC to burner wallet and back to Stripe, fully streamlined.
          </ScrollReveal>
          <div className="demo-player-wrap">
            <PaymentFlowDemo />
          </div>
        </section>

        <section className="carousel-section">
          <h2 className="carousel-title">Platform Capabilities</h2>
          <div className="carousel-wrap">
            <Carousel items={pillars} baseWidth={420} autoplay autoplayDelay={2600} pauseOnHover loop />
          </div>
        </section>
      </main>
    </div>
  );
}
