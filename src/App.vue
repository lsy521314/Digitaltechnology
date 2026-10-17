<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useScenarioStore } from './stores/scenario'
import { useSettingsStore } from './stores/settings'
import DemoGuideBar from './components/DemoGuideBar.vue'

const route = useRoute()
const scenarioStore = useScenarioStore()
const settingsStore = useSettingsStore()
const isLab = computed(() => route.name === 'lab')
const navItems = [
  { name: 'home', label: '总览', path: '/' },
  { name: 'lab', label: '实验室', path: '/lab' },
  { name: 'compare', label: '方案对比', path: '/compare' },
  { name: 'learn', label: '学习中心', path: '/learn' },
  { name: 'about', label: '作品介绍', path: '/about' },
]

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme
}

watch(() => settingsStore.theme, applyTheme)
onMounted(() => {
  scenarioStore.hydrate()
  applyTheme(settingsStore.theme)
})
</script>

<template>
  <div class="app-shell" :class="{ 'lab-shell': isLab, 'presentation-mode': settingsStore.presentationMode }">
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="智御网络首页">
        <span class="brand-mark"><span></span><span></span><span></span></span>
        <span class="brand-copy"><strong>智御网络</strong></span>
      </RouterLink>
      <nav class="main-nav">
        <RouterLink v-for="item in navItems" :key="item.name" :to="item.path" :class="{ active: route.name === item.name }">{{ item.label }}</RouterLink>
      </nav>
      <div class="topbar-meta">
        <span v-if="!settingsStore.presentationMode" class="system-state"><i></i>教学仿真</span>
        <button v-if="!settingsStore.presentationMode" class="topbar-toggle" :aria-label="settingsStore.theme === 'dark' ? '切换浅色模式' : '切换深色模式'" :title="settingsStore.theme === 'dark' ? '切换浅色模式' : '切换深色模式'" @click="settingsStore.toggleTheme()">
          <svg v-if="settingsStore.theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.2A8.6 8.6 0 0 1 8.8 3.8 8.7 8.7 0 1 0 20.2 15.2Z"/></svg>
        </button>
        <button class="topbar-demo-toggle" :class="{ active: settingsStore.presentationMode }" :aria-pressed="settingsStore.presentationMode" @click="settingsStore.togglePresentationMode()">{{ settingsStore.presentationMode ? '退出演示' : '演示模式' }}</button>
      </div>
    </header>
    <main class="page-wrap" :class="{ 'page-wrap-lab': isLab }">
      <RouterView />
    </main>
    <DemoGuideBar v-if="settingsStore.presentationMode" />
  </div>
</template>
