import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // Use credentialless instead of require-corp to allow fetching from Wasmer CDN
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    fs: {
      // Allow serving files from node_modules for Wasmer SDK
      allow: ['..'],
    },
  },
  optimizeDeps: {
    // Exclude wasmer-sdk from pre-bundling as it has WASM files
    exclude: ['@wasmer/sdk'],
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  resolve: {
    alias: {
      '@': '/src',
      'react': path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom')
    }
  }
})
