/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: '#0a0a0f',
        panel: '#12121a',
        'panel-border': '#1a1a2e',
        'ghost-100': '#e2e8f0',
        'ghost-200': '#cbd5e1',
        'ghost-300': '#94a3b8',
        'ghost-400': '#64748b',
        'ghost-500': '#475569',
        'neon-cyan': '#00f5ff',
        'neon-magenta': '#ff00ff',
        'neon-green': '#00ff88',
        danger: '#ff4444',
      },
      fontFamily: {
        display: ['Courier New', 'monospace'],
        mono: ['Consolas', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
