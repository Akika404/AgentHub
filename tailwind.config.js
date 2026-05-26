/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      },
      colors: {
        primary: '#3370ff',
        'primary-hover': '#2b5ee0',
        background: '#f5f6f7',
        surface: '#ffffff',
        'surface-hover': '#f2f3f5',
        'surface-active': '#e8f0ff',
        'surface-border': '#dee0e3',
        'text-main': '#1f2329',
        'text-muted': '#8f959e'
      },
      borderRadius: {
        xl: '8px',
        '2xl': '8px'
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,0.02)',
        tab: '0 1px 3px rgba(0,0,0,0.04)'
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', boxShadow: '0 0 0 0 rgba(52,199,89,0.7)' },
          '70%': { transform: 'scale(1)', boxShadow: '0 0 0 6px rgba(52,199,89,0)' },
          '100%': { transform: 'scale(0.8)', boxShadow: '0 0 0 0 rgba(52,199,89,0)' }
        }
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s infinite'
      }
    }
  },
  plugins: []
}
