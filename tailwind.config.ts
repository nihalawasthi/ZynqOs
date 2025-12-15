import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      keyframes: {
        "slide-in-from-right": {
          from: { transform: "translateX(100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" }
        },
        "slide-out-to-right": {
          from: { transform: "translateX(0)", opacity: "1" },
          to: { transform: "translateX(100%)", opacity: "0" }
        },
        "progress-fill": {
          from: { width: "0%" },
          to: { width: "100%" }
        }
      },
      animation: {
        "slide-in": "slide-in-from-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-out": "slide-out-to-right 0.3s ease-in",
        "progress": "progress-fill 3s linear forwards"
      }
    }
  },
  plugins: []
} satisfies Config
