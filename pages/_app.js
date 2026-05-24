import { useEffect } from 'react';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('mika-theme')) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  return <Component {...pageProps} />;
}
