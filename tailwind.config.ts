import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#071014",
        leaf: "#129ec0",
        mint: "#dff8ff",
        coral: "#d96750",
        amber: "#f5b84b",
        paper: "#f5fbfd"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(7, 16, 20, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
