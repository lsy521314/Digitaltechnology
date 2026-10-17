<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { demoTour } from '../data/demoScript'
import { useSettingsStore } from '../stores/settings'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()

const index = ref(0)
const playing = ref(true)
const elapsed = ref(0)

const total = demoTour.length
let ticker: number | undefined

function stepFromRoute(): number {
  const q = route.fullPath
  let fallback = 0
  for (let i = 0; i < total; i += 1) {
    const step = demoTour[i]
    if (q === step.path || q.startsWith(`${step.path}?`)) return i
    if (step.path.startsWith(q)) fallback = i
  }
  return fallback
}

const active = computed(() => demoTour[index.value] ?? demoTour[0])
const progress = computed(() => (elapsed.value / (active.value.seconds ?? 16)) * 100)

function go(stepIndex: number) {
  const nextIndex = (stepIndex + total) % total
  index.value = nextIndex
  elapsed.value = 0
  const step = demoTour[nextIndex]
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (route.fullPath !== step.path) router.push(step.path)
}

function nextStep() { go(index.value + 1) }
function prevStep() { go(index.value - 1) }
function togglePlay() { playing.value = !playing.value }
function endDemo() { settings.togglePresentationMode() }

onMounted(() => {
  index.value = stepFromRoute()
  ticker = window.setInterval(() => {
    if (!playing.value) return
    elapsed.value += 1
    if (elapsed.value >= (active.value.seconds ?? 16)) {
      elapsed.value = 0
      nextStep()
    }
  }, 1000)
})
onBeforeUnmount(() => {
  if (ticker !== undefined) window.clearInterval(ticker)
})
watch(
  () => route.fullPath,
  () => {
    index.value = stepFromRoute()
    elapsed.value = 0
  },
)
</script>

<template>
  <aside class="demo-guide-bar" role="region" aria-label="演示讲稿">
    <div class="demo-guide-progress"><i :style="{ width: `${progress}%` }"></i></div>
    <div class="demo-guide-body">
      <div class="demo-guide-index"><i>{{ String(index + 1).padStart(2, '0') }}</i><span>/ {{ String(total).padStart(2, '0') }}</span></div>
      <div class="demo-guide-copy">
        <div class="demo-guide-kicker">{{ active.kicker }}</div>
        <h4>{{ active.title }}</h4>
        <p>{{ active.script }}</p>
      </div>
      <div class="demo-guide-action"><small>操作提示</small><span>{{ active.action }}</span></div>
      <div class="demo-guide-controls">
        <button class="demo-ctrl-play" :title="playing ? '暂停自动播放' : '继续自动播放'" :aria-pressed="playing" @click="togglePlay">{{ playing ? '❚❚' : '▶' }}</button>
        <button class="demo-ctrl" title="上一步" @click="prevStep">‹</button>
        <button class="demo-ctrl" title="下一步" @click="nextStep">›</button>
        <button class="demo-ctrl-exit" title="退出演示" @click="endDemo">退出 ✕</button>
      </div>
    </div>
  </aside>
</template>