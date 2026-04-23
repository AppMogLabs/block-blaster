import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./game/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // MegaETH brand palette
        "moon-white": "#ECE8E8",
        "full-moon": "#DFD9D9",
        "night-sky": "#19191A",
        peach: "#F5AF94",
        rose: "#F5949D",
        pink: "#FF8AA8",
        magenta: "#F786C6",
        mint: "#90D79F",
        jade: "#6DD0A9",
        sky: "#7EAAD4",
        cyan: "#70BAD2",
      },
      fontFamily: {
        sans: ['"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
        mono: ['"Wudoo Mono"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(247, 134, 198, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
