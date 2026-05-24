/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          50:  '#f0ede6',
          100: '#d9d4c9',
          200: '#b8b0a0',
          300: '#968b77',
          400: '#746654',
          500: '#524131',
          600: '#302010',
          700: '#1a1208',
          800: '#100c04',
          900: '#090806',
        },
        void: {
          DEFAULT: '#07090f',
          50: '#0d1117',
          100: '#111827',
          200: '#1a2130',
          300: '#212d40',
          400: '#2a3b52',
        },
        gold: {
          DEFAULT: '#c9a84c',
          50:  '#fdf8ec',
          100: '#f9edc4',
          200: '#f0d47e',
          300: '#e5ba44',
          400: '#c9a84c',
          500: '#a8882a',
          600: '#866b17',
          700: '#5e4c0e',
          800: '#3a2f09',
          900: '#1c1605',
        },
        ember: {
          DEFAULT: '#f59e0b',
          dim: '#d97706',
        },
        teal: {
          signal: '#0dd3c5',
          dim: '#0aa898',
        },
        crimson: {
          DEFAULT: '#ef4444',
          dim: '#b91c1c',
        },
        surface: '#0d1117',
        panel: 'rgba(13, 17, 23, 0.85)',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        ui:      ['"Syne"', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
      },
      backgroundImage: {
        'grid-fine': `linear-gradient(rgba(201,168,76,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,0.04) 1px, transparent 1px)`,
        'grain': `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
      },
      backgroundSize: {
        'grid-fine': '24px 24px',
      },
      boxShadow: {
        'gold-glow': '0 0 20px rgba(201,168,76,0.15), 0 0 60px rgba(201,168,76,0.05)',
        'teal-glow': '0 0 20px rgba(13,211,197,0.2), 0 0 60px rgba(13,211,197,0.06)',
        'panel': '0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
        'inner-gold': 'inset 0 1px 0 rgba(201,168,76,0.15)',
      },
      animation: {
        'pulse-gold': 'pulse-gold 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'scan': 'scan 3s linear infinite',
        'flicker': 'flicker 4s linear infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        'pulse-gold': {
          '0%,100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        'scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'flicker': {
          '0%,100%': { opacity: 1 },
          '92%': { opacity: 1 },
          '93%': { opacity: 0.8 },
          '94%': { opacity: 1 },
          '96%': { opacity: 0.9 },
          '97%': { opacity: 1 },
        },
        'float': {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};
