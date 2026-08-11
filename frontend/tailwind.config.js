/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        void:      '#06080f',
        panel:     '#0e1220',
        panelLight:'#161b2c',
        edge:      '#1e263d',
        cyan:      '#00cbd6',
        blue:      '#1b75ff',
        emerald:   '#00c676',
        crimson:   '#ff5252',
        ink:       '#8b92a8',
        bright:    '#f1f3f9',
      },
      backgroundImage: {
        'grid-pattern':
          'linear-gradient(rgba(30,38,61,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(30,38,61,0.2) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
}
