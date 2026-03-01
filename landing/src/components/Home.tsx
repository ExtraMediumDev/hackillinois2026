import CompanyMarquee from './CompanyMarquee';
import DecryptedText from './DecryptedText';
import PaymentFlowDemo from './PaymentFlowDemo';
import { FiBookOpen, FiPlay } from 'react-icons/fi';
import { Link } from 'react-router-dom';

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
                    Where The Card Meets The Chain
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

            <section className="carousel-section stat-section">
                <h2 className="carousel-title">The Barrier to Entry</h2>
                <div className="stat-wrap">
                    <p className="stat-number">49%</p>
                    <p className="stat-copy">
                        of people cite <strong>lack of understanding of how crypto works</strong> as the biggest barrier to entry.
                    </p>
                </div>
            </section>

            <section className="demo-section">
                <div className="demo-player-wrap">
                    <PaymentFlowDemo />
                </div>
            </section>

            <CompanyMarquee />
        </>
    );
}
