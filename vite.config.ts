import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/three/')) return 'three'
          if (id.includes('/echarts/') || id.includes('/zrender/')) return 'charts'
          if (id.includes('/element-plus/') || id.includes('/@element-plus/')) return 'element-plus'
          if (id.includes('/vue/') || id.includes('/@vue/') || id.includes('/pinia/') || id.includes('/vue-router/')) return 'framework'
        },
      },
    },
  },
})
