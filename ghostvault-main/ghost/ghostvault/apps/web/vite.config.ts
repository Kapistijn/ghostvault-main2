import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  server: {
    port: 3000,
    host: true,
    hmr: {
      overlay: true,
      // Improve WebSocket connection reliability
      clientPort: 3000,
      protocol: 'ws',
      host: 'localhost'
    },
    // Add timeout settings to prevent connection drops
    watch: {
      usePolling: false,
      interval: 1000
    }
  },
  optimizeDeps: {
    exclude: ['argon2-browser', '@oneidentity/zstd-js'],
    include: ['react', 'react-dom', 'react/jsx-runtime'],
    // Force pre-bundling for better performance
    force: true,
    // Optimize dependency pre-bundling
    esbuildOptions: {
      target: 'es2020',
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      }
    }
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
    // Optimize chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core library chunks
          if (id.includes('@noble/ciphers')) {
            return 'crypto-vendor';
          }
          // Split zstd-js into smaller chunks with lazy loading
          if (id.includes('@oneidentity/zstd-js')) {
            if (id.includes('asm')) {
              return 'zstd-asm';
            }
            if (id.includes('wasm')) {
              return 'zstd-wasm';
            }
            // Keep zstd-core separate for lazy loading
            return 'zstd-core';
          }
          if (id.includes('argon2-browser')) {
            if (id.includes('argon2.wasm')) {
              return 'argon2-wasm';
            }
            return 'argon2-core';
          }
          if (id.includes('jszip')) {
            return 'zip-vendor';
          }
          // UI chunks - lazy load these
          if (id.includes('/src/ui/DebugPanel')) {
            return 'debug';
          }
          if (id.includes('/src/ui/ConfigEditor')) {
            return 'config';
          }
          if (id.includes('/src/ui/EncryptPanel')) {
            return 'encrypt';
          }
          if (id.includes('/src/ui/DecryptPanel')) {
            return 'decrypt';
          }
          if (id.includes('/src/ui/GhostTrustedManager')) {
            return 'trusted';
          }
          // Core library
          if (id.includes('/src/core/')) {
            return 'core';
          }
          // React vendor - ensure single instance
          if (id.includes('react') || id.includes('react-dom')) {
            return 'react-vendor';
          }
        },
        // Optimize chunk file names for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      onwarn(warning, warn) {
        // Ignore WebAssembly warnings for argon2-browser
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.message.includes('argon2.wasm')) {
          return;
        }
        // Ignore WebAssembly warnings for zstd-js
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.message.includes('zstd')) {
          return;
        }
        warn(warning);
      }
    },
    chunkSizeWarningLimit: 3000, // Increased to accommodate zstd-core
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log'],
        // Enable additional optimizations
        ecma: 2020,
        passes: 2,
        // Enable dead code elimination
        dead_code: true,
        // Enable property mangling
        properties: false,
        // Enable function inlining
        inline: 2,
        // Enable reduce functions
        reduce_funcs: true,
        // Enable reduce variables
        reduce_vars: true,
        // Enable collapse variables
        collapse_vars: true,
        // Enable condition optimization
        conditionals: true,
        // Enable comparisons
        comparisons: true,
        // Enable evaluate
        evaluate: true,
        // Enable booleans
        booleans: true,
        // Enable loops
        loops: true,
        // Enable unused
        unused: true,
        // Enable hoist functions
        hoist_funs: true,
        // Enable hoist variables
        hoist_vars: true,
        // Enable if return
        if_return: true,
        // Enable join vars
        join_vars: true,
        // Enable side effects
        side_effects: true
      },
      mangle: {
        safari10: true,
        // Enable property mangling for production
        properties: {
          regex: /^_/
        }
      },
      format: {
        comments: false
      }
    },
    reportCompressedSize: false
  },
  cacheDir: '../ghostvault_temp/vite_cache'
});
