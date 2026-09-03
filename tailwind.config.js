/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        concessions: {
          blue: "#0068d7",
          dark: "#003d78",
          light: "#5bdcff",
        },
      },
    },
  },
  plugins: [],
};
