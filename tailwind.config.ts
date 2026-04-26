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
          gold: '#C9A961',
          ember: '#FF8A4C',
        },
        stage: {
          curtain: '#1A0F14',
          spot: '#FFD9A8',
          floor: '#1A1B26',
        },
        warn: '#FF8A6B',
        safe: '#84E58A',
      },
      fontFamily: {
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['var(--font-crimson)', 'var(--font-noto-serif-kr)', 'Georgia', 'serif'],
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(4px,-14px,0)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.025)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        spotlightFade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '0.9' },
        },
        irisOpen: {
          '0%': { 'clip-path': 'circle(0% at 50% 50%)' },
          '100%': { 'clip-path': 'circle(140% at 50% 50%)' },
        },
        curtainRiseTop: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-100%)' },
        },
        curtainRiseBottom: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100%)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bubblePop: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '60%': { opacity: '1', transform: 'translateY(0) scale(1.01)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        emberRise: {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '0' },
          '15%': { opacity: '0.45' },
          '100%': { transform: 'translateY(-60vh) scale(0.6)', opacity: '0' },
        },
      },
      animation: {
        drift: 'drift 9s ease-in-out infinite',
        'drift-slow': 'drift 14s ease-in-out infinite',
        breathe: 'breathe 4.4s ease-in-out infinite',
        shimmer: 'shimmer 2.8s ease-in-out infinite',
        'spotlight-fade': 'spotlightFade 1.6s ease-out both',
        'iris-open': 'irisOpen 1.1s cubic-bezier(0.65, 0, 0.35, 1) both',
        'curtain-top': 'curtainRiseTop 1.4s cubic-bezier(0.85, 0, 0.15, 1) both',
        'curtain-bottom': 'curtainRiseBottom 1.4s cubic-bezier(0.85, 0, 0.15, 1) both',
        'fade-up': 'fadeUp 0.7s ease-out both',
        'bubble-pop': 'bubblePop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'ember-rise': 'emberRise 14s linear infinite',
        'ember-rise-2': 'emberRise 18s linear infinite',
        'ember-rise-3': 'emberRise 11s linear infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
