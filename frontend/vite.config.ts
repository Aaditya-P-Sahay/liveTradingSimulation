import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002', // FIXED: Changed from 3001 to 3002
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3002', // FIXED: Changed from 3001 to 3002
        changeOrigin: true,
        ws: true,
      }
    }
  },
  preview: {
    port: 5174,
    host: true
  }
})