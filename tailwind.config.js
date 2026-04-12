/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fef6f0',
          100: '#fde6d3',
          200: '#fbd0ad',
          300: '#f8b282',
          400: '#f59356',
          500: '#f37023',
          600: '#d45c14',
          700: '#b04a0e',
          800: '#8c3b0b',
          900: '#5e2707',
        },
        accent: {
          50:  '#fdf0f0',
          100: '#fbd7d8',
          200: '#f6acae',
          300: '#ee777a',
          400: '#e14347',
          500: '#cc1a1e',
          600: '#9c090e',
          700: '#7d080b',
          800: '#5e0608',
          900: '#3e0405',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
