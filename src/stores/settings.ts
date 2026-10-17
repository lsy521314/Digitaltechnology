import { defineStore } from 'pinia'

export type AppTheme = 'dark' | 'light'
export type RenderQuality = 'low' | 'medium' | 'high'

function readPreference(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) ?? fallback
}

function readPresentationMode() {
  return readPreference('zhiyu-presentation-mode', 'false') === 'true'
}

function detectDefaultQuality(): RenderQuality {
  if (typeof navigator === 'undefined') return 'high'
  const cores = navigator.hardwareConcurrency ?? 8
  const dpr = window.devicePixelRatio ?? 1
  if (cores <= 4 && dpr < 1.5) return 'medium'
  return 'high'
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showLabels: true,
    reducedMotion: false,
    soundEnabled: false,
    theme: (readPresentationMode() ? 'dark' : readPreference('zhiyu-theme', 'dark')) as AppTheme,
    presentationMode: readPresentationMode(),
    renderQuality: readPreference('zhiyu-render-quality', detectDefaultQuality()) as RenderQuality,
  }),
  actions: {
    toggleLabels() { this.showLabels = !this.showLabels },
    toggleMotion() { this.reducedMotion = !this.reducedMotion },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      if (typeof window !== 'undefined') window.localStorage.setItem('zhiyu-theme', this.theme)
    },
    setRenderQuality(quality: RenderQuality) {
      this.renderQuality = quality
      if (typeof window !== 'undefined') window.localStorage.setItem('zhiyu-render-quality', quality)
    },
    cycleRenderQuality() {
      const order: RenderQuality[] = ['high', 'medium', 'low']
      const next = order[(order.indexOf(this.renderQuality) + 1) % order.length] ?? 'high'
      this.setRenderQuality(next)
      return next
    },
    togglePresentationMode() {
      this.presentationMode = !this.presentationMode
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('zhiyu-presentation-mode', String(this.presentationMode))
        if (this.presentationMode) {
          this.theme = 'dark'
        } else {
          this.theme = readPreference('zhiyu-theme', 'dark') as AppTheme
        }
      }
    },
  },
})