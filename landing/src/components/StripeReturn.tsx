import { useLocation } from 'react-router-dom';

export default function StripeReturn() {
  const location = useLocation();
  const isSuccess = location.pathname.endsWith('/stripe-success');

  return (
    <div className="stripe-return-page">
      <div className="stripe-return-card">
        <h1>{isSuccess ? 'Deposit Succeeded' : 'Deposit Canceled'}</h1>
        <p>
          {isSuccess
            ? 'Your Stripe checkout completed. You can close this tab now and continue in the original demo tab.'
            : 'Stripe checkout was canceled. You can close this tab and return to the original demo tab.'}
        </p>
        <div className="stripe-return-actions">
          <button className="primary-btn stripe-close-btn" onClick={() => window.close()}>
            Close This Tab
          </button>
        </div>
      </div>
    </div>
  );
}
