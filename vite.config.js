import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './', // Ensure relative paths for static deployment
  plugins: [vue()],
  build: {
    copyPublicDir: true, // Enable copying of public/ directory
    lib: {
      entry: path.resolve(__dirname, 'src/sdk.js'),
      name: 'PhoneSDK',
      fileName: (format) => `phone-sdk.${format}.js`
    },
    rollupOptions: {
      // Ensure we bundle everything since we want a standalone SDK
      // If we wanted to share dependencies, we would list them here.
      // But for "direct use", standalone is better.
      external: [],
      output: {
        // Global variables for externalized deps go here
        globals: {}
      }
    }
  },
  define: {
    'process.env': {} // Fix for some internals
  }
})
