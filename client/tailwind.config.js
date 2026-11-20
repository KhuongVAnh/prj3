/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F4F5F7',
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F8F9FB',
          muted: '#ECEFF3',
          video: '#181A20',
        },
        line: {
          subtle: '#E2E6EC',
          strong: '#CBD2DC',
        },
        ink: {
          primary: '#111318',
          secondary: '#525866',
          muted: '#7B8291',
        },
        accent: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          soft: '#EFF6FF',
          border: '#BFDBFE',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(17, 19, 24, 0.04), 0 10px 28px -8px rgba(17, 19, 24, 0.08)',
        dock: '0 4px 16px -2px rgba(17, 19, 24, 0.08), 0 1px 3px rgba(17, 19, 24, 0.05)',
        tile: '0 2px 8px -2px rgba(17, 19, 24, 0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.16s ease-out forwards',
        'scale-in': 'scaleIn 0.16s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(3px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
