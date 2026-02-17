import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true, // Expose to LAN
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                secure: false,
            },
            '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true,
            }
        },
    },
});
