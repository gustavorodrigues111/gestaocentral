/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cores das 3 áreas
        operacao:    "#d4a017",  // laranja — atividade ao vivo
        time:        "#3b82f6",  // azul — gestão de pessoas
        escritorio:  "#64748b",  // cinza — administrativo
      },
      fontFamily: {
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
        mono: ["'DM Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
