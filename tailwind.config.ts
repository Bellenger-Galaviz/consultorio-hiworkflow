import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201b",
        leaf: "#2f6b4f",
        mint: "#dff3e8",
        coral: "#d96750",
        amber: "#f5b84b",
        paper: "#f7f5ef"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 32, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
