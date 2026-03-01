import { type ReactElement } from 'react';
import {
  SiAmazon,
  SiApple,
  SiPatreon,
  SiRoblox,
  SiSiemens,
  SiStripe,
  SiTmobile,
  SiVisa,
} from 'react-icons/si';
import './CompanyMarquee.css';

const CitadelMark = () => (
  <svg viewBox="0 0 32 30" fill="currentColor" className="marquee-svg">
    <rect x="2" y="0" width="7" height="12" />
    <rect x="12.5" y="0" width="7" height="12" />
    <rect x="23" y="0" width="7" height="12" />
    <rect x="0" y="14" width="32" height="3" />
    <rect x="5" y="19" width="9" height="3" />
    <rect x="18" y="19" width="9" height="3" />
    <rect x="0" y="24" width="32" height="3" />
  </svg>
);

const OptiverMark = () => (
  <svg viewBox="0 0 130 28" fill="currentColor" className="marquee-svg marquee-svg--wide">
    <text
      x="0"
      y="23"
      fontSize="25"
      fontWeight="400"
      fontFamily="'Figtree', sans-serif"
      letterSpacing="-0.03em"
    >
      Optiver
    </text>
    <path d="M108,26 L117,4 L126,26 L121,26 L117,15 L113,26 Z" />
  </svg>
);

const CapitalOneMark = () => (
  <svg viewBox="0 0 52 26" fill="currentColor" className="marquee-svg marquee-svg--wide">
    <path d="M50,1 C38,-1 14,5 1,20 L0,22 C12,10 36,2 50,5 Z" />
    <line x1="22" y1="13" x2="19" y2="26" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const FedReserveMark = () => (
  <svg viewBox="0 0 28 28" fill="currentColor" className="marquee-svg">
    <circle cx="14" cy="14" r="13" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <circle cx="14" cy="14" r="10.5" stroke="currentColor" strokeWidth="0.75" fill="none" />
    <text x="14" y="12.5" fontSize="4.5" fontWeight="700" fontFamily="'Libre Baskerville', serif" textAnchor="middle">
      FEDERAL
    </text>
    <text x="14" y="18" fontSize="4.5" fontWeight="700" fontFamily="'Libre Baskerville', serif" textAnchor="middle">
      RESERVE
    </text>
    <line x1="6" y1="20" x2="22" y2="20" stroke="currentColor" strokeWidth="0.6" />
    <text x="14" y="25" fontSize="3.5" fontWeight="700" fontFamily="'Libre Baskerville', serif" textAnchor="middle">
      SYSTEM
    </text>
  </svg>
);

const StateFarmMark = () => (
  <svg viewBox="0 0 30 28" fill="none" stroke="currentColor" className="marquee-svg">
    <ellipse cx="15" cy="8" rx="8" ry="6" strokeWidth="2.2" />
    <ellipse cx="9" cy="19" rx="8" ry="6" strokeWidth="2.2" />
    <ellipse cx="21" cy="19" rx="8" ry="6" strokeWidth="2.2" />
  </svg>
);

interface Company {
  name: string;
  logo: ReactElement;
}

const companies: Company[] = [
  { name: 'Optiver', logo: <OptiverMark /> },
  { name: 'Citadel', logo: <CitadelMark /> },
  { name: 'Capital One', logo: <CapitalOneMark /> },
  { name: 'Roblox', logo: <SiRoblox /> },
  { name: 'Amazon', logo: <SiAmazon /> },
  { name: 'Apple', logo: <SiApple /> },
  { name: 'Scale AI', logo: <span className="marquee-wordmark">SCALE AI</span> },
  { name: 'IBM', logo: <span className="marquee-wordmark marquee-wordmark--serif">IBM</span> },
  { name: 'T-Mobile', logo: <SiTmobile /> },
  { name: 'Whatnot', logo: <span className="marquee-wordmark">WHATNOT</span> },
  { name: 'Stripe', logo: <SiStripe /> },
  { name: 'State Farm', logo: <StateFarmMark /> },
  { name: 'Siemens', logo: <SiSiemens /> },
  { name: 'Federal Reserve', logo: <FedReserveMark /> },
  { name: 'Patreon', logo: <SiPatreon /> },
  { name: 'Visa', logo: <SiVisa /> },
];

export default function CompanyMarquee() {
  const doubled = [...companies, ...companies];

  return (
    <section className="marquee-section">
      <h2 className="marquee-heading">They Believe In Us, So Can You</h2>
      <div className="marquee-track">
        <div className="marquee-inner">
          {doubled.map((c, i) => (
            <span key={`${c.name}-${i}`} className="marquee-logo" aria-label={c.name}>
              {c.logo}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
