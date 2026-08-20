/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: '#000000',
          sidebar: '#141414',
          activityBar: '#181818',
          panel: '#000000',
          editorGroupHeader: '#111111',
          tabActive: '#000000',
          tabInactive: '#111111',
          tabHover: '#1a1a1a',
          border: '#222222',
          lineHighlight: '#1f1f1f',
          selection: '#333333',
          text: '#e1e1e1',
          textMuted: '#777777',
          textActive: '#ffffff',
          accent: '#e1e1e1',
          accentHover: '#ffffff',
          badge: '#e1e1e1',
          buttonSecondary: '#222222',
          buttonSecondaryHover: '#2a2a2a',
          danger: '#f44747',
          dangerHover: '#d13438',
          success: '#4ec9b0',
          warning: '#cca700',
        }
      },
      fontFamily: {
        mono: ['"Cascadia Code"', 'Consolas', '"Courier New"', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
