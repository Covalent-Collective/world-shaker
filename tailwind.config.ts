import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0A0A0F',
          1: '#14141C',
          2: '#1F1F2A',
          3: '#2A2A3A',
        },
        text: {
          DEFAULT: '#F4ECE2',
          2: 'rgba(244, 236, 226, 0.7)',
          3: 'rgba(244, 236, 226, 0.45)',
          4: 'rgba(244, 236, 226, 0.25)',
        },
        accent: {
          DEFAULT: '#9B85FF',
          deep: '#7B61FF',
          warm: '#FFB57B',
        },
        warn: '#FF8A6B',
        safe: '#84E58A',
      },
      fontFamily: {
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['var(--font-crimson)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [animate],
};

export default config;
