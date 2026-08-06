import { useEffect } from 'react';
import '../styles/globals.css';
import AdminSessionGate from '../components/layout/AdminSessionGate';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('mika-theme')) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  return (
    <>
      <Component {...pageProps} />
      {/* Renders only when this browser has no admin session. */}
      <AdminSessionGate />
    </>
  );
}
