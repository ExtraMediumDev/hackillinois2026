import { Player } from '@remotion/player';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const flow = ['Stripe', 'USDC', 'Burner Wallet (SOL)', 'USDC', 'Stripe Checkout'];

const PaymentFlowScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, rgba(8,11,27,0.95) 0%, rgba(10,8,24,0.95) 100%)',
        color: '#eef2ff',
        fontFamily: 'Figtree, sans-serif',
        borderRadius: 16,
        padding: '20px 24px',
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      <div style={{ fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#aeb6ff', marginBottom: 16 }}>
        Payment Rail Demo
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
        {flow.map((step, index) => {
          const appear = spring({
            frame: frame - index * 15,
            fps,
            config: { damping: 14, stiffness: 120, mass: 0.8 },
          });

          const glow = interpolate(
            frame,
            [index * 25, index * 25 + 16, index * 25 + 35],
            [0.2, 1, 0.35],
            {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.2, 0.7, 0, 1),
            },
          );

          const isLast = index === flow.length - 1;

          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 1.2 : 1 }}>
              <div
                style={{
                  transform: `scale(${0.88 + appear * 0.12})`,
                  opacity: 0.4 + appear * 0.6,
                  borderRadius: 999,
                  border: `1px solid rgba(142,228,255,${0.3 + glow * 0.4})`,
                  background: `radial-gradient(circle at top, rgba(106,92,255,${0.18 + glow * 0.35}) 0%, rgba(12,16,42,0.8) 70%)`,
                  padding: '10px 12px',
                  minWidth: isLast ? 190 : 120,
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: 13,
                  boxShadow: `0 0 ${8 + glow * 14}px rgba(106,92,255,${0.15 + glow * 0.35})`,
                }}
              >
                {step}
              </div>
              {!isLast ? (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    margin: '0 8px',
                    background: `linear-gradient(90deg, rgba(142,228,255,${0.2 + glow * 0.7}) 0%, rgba(168,85,247,${0.2 + glow * 0.4}) 100%)`,
                    opacity: 0.5 + glow * 0.5,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default function PaymentFlowDemo() {
  return (
    <Player
      component={PaymentFlowScene}
      durationInFrames={180}
      compositionWidth={1280}
      compositionHeight={360}
      fps={30}
      controls={false}
      loop
      autoPlay
      style={{ width: '100%', borderRadius: 16, overflow: 'hidden' }}
    />
  );
}
