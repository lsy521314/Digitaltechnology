import { defineStore } from 'pinia'

export type AppTheme = 'dark' | 'light'

function readPreference(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) ?? fallback
}

function readPresentationMode() {
  return readPreference('zhiyu-presentation-mode', 'false') === 'true'
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showLabels: true,
    reducedMotion: false,
    soundEnabled: false,
    theme: (readPresentationMode() ? 'dark' : readPreference('zhiyu-theme', 'dark')) as AppTheme,
    presentationMode: readPresentationMode(),
  }),
  actions: {
    toggleLabels() { this.showLabels = !this.showLabels },
    toggleMotion() { this.reducedMotion = !this.reducedMotion },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      if (typeof window !== 'undefined') window.localStorage.setItem('zhiyu-theme', this.theme)
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
