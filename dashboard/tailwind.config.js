/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                bluesky: {
                    50: '#e6f0ff',
                    100: '#cce0ff',
                    500: '#0085ff',
                    600: '#0062cc',
                    900: '#00254d',
                }
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        },
    },
}
