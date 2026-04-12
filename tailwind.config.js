/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fef3e2',
          100: '#fde1b3',
          200: '#fbce82',
          300: '#f9ba50',
          400: '#f8ac2d',
          500: '#f79e0a',
          600: '#e08d08',
          700: '#c47a06',
          800: '#a86804',
          900: '#7d4d02',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
