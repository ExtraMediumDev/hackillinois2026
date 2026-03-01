import './PaymentFlowDemo.css';

const steps = [
  { label: 'Stripe', sub: 'Card Payment' },
  { label: 'USDC', sub: 'Stablecoin' },
  { label: 'Burner Wallet', sub: 'Solana' },
  { label: 'USDC', sub: 'Settlement' },
  { label: 'Stripe', sub: 'Payout' },
];

export default function PaymentFlowDemo() {
  return (
    <div className="rail">
      {steps.map((step, i) => (
        <div key={`step-${i}`} className="rail-segment">
          <div
            className="rail-node"
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="rail-node-label">{step.label}</span>
            <span className="rail-node-sub">{step.sub}</span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="rail-track"
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="rail-line rail-line--top" />
              <span className="rail-line rail-line--bot" />
              <span className="rail-tie" />
              <span className="rail-tie" />
              <span className="rail-tie" />
              <div className="rail-spark" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
