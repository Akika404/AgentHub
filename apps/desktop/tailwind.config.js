/** @type {import('tailwindcss').Config} */

// Neutral ramp. Existing semantic grays map onto this scale 1:1 (same hex), so
// switching call sites from raw hex / aliases to `gray-*` is a visual no-op.
const gray = {
  50: '#f8f9fa', // lightest fill (skeletons, subtle zebra)
  100: '#f2f3f5', // = surface-hover
  150: '#eaecef',
  200: '#e4e6ea',
  300: '#dee0e3', // = surface-border
  400: '#c4c8cf', // disabled icon/text
  500: '#8f959e', // = text-muted
  600: '#646a73', // secondary text, one notch darker than muted
  900: '#1f2329' // = text-main
}

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      // Type scale (size only — no bundled line-height, so it's a drop-in for
      // the existing text-[Npx] utilities). 12px (sm) and 13px (base) are kept
      // distinct on purpose — they carry label-vs-body hierarchy.
      fontSize: {
        xs: '11px',
        sm: '12px',
        base: '13px',
        md: '14px',
        lg: '15px',
        xl: '16px',
        '2xl': '18px',
        '3xl': '20px',
        '4xl': '24px' // nav icons; the lone 26px auth-hero folds here (-2px, login only)
      },
      colors: {
        primary: '#3370ff',
        'primary-hover': '#2b5ee0',
        'primary-soft': '#e8f0ff', // primary tint fill (selected rows, soft buttons)
        'primary-softer': '#dbe6ff', // pressed/active tint
        background: '#f5f6f7',
        surface: '#ffffff',
        'surface-hover': gray[100],
        'surface-active': '#e8f0ff',
        'surface-border': gray[300],
        'text-main': gray[900],
        'text-muted': gray[500],
        gray,
        success: '#34c759',
        'success-soft': '#e8f6e8',
        'success-border': '#cdeccd',
        warning: '#f5b800', // pinned-message accent
        'warning-soft': '#fffbe6',
        'warning-soft-hover': '#fff5c2',
        'warning-border': '#f5e5a0',
        danger: '#ef4444', // = tailwind red-500 (the error color already in use)
        'danger-soft': '#fef2f2', // = red-50
        'danger-border': '#fecaca', // = red-200
        'danger-strong': '#dc2626', // = red-600 (banner/strong error text)
        accent: '#7b61ff', // violet avatar/brand accent
        'accent-soft': '#f0f0ff',
        'accent-border': '#e5e5ff'
      },
      // Radius scale.
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px'
      },
      // Soft, text-tinted elevation (rgba 31,35,41 not pure black) — sm for
      // resting cards, md for dropdowns, lg for the modal.
      boxShadow: {
        sm: '0 1px 2px rgba(31,35,41,0.04), 0 1px 1px rgba(31,35,41,0.03)',
        md: '0 2px 8px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)',
        lg: '0 8px 24px rgba(31,35,41,0.10), 0 2px 6px rgba(31,35,41,0.06)'
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.16,1,0.3,1)'
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
