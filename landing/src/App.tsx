import Antigravity from './components/Antigravity';
import Aurora from './components/Aurora';
import { Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import ApiDocs from './components/ApiDocs';
import Demo from './components/Demo';
import StripeReturn from './components/StripeReturn';

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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/docs" element={<ApiDocs />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/demo/stripe-success" element={<StripeReturn />} />
          <Route path="/demo/stripe-cancel" element={<StripeReturn />} />
        </Routes>
      </main>
    </div>
  );
}
