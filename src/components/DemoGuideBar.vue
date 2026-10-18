<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { evaluateChallenge } from '../engine/challengeEngine'
import { demoTour, type DemoStage, type DemoStageKey } from '../data/demoScript'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'

const route = useRoute()
const router = useRouter()
const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const scenario = computed(() => scenarioStore.current)
const resultAtFinalEvent = computed(() => Boolean(simulationStore.result?.events.length
  && simulationStore.cursor >= simulationStore.result.events.length - 1))
const resultPlaybackComplete = computed(() => simulationStore.status === 'completed'
  || simulationStore.status === 'paused' && resultAtFinalEvent.value)
const challengeResult = computed(() => evaluateChallenge(
  scenario.value,
  simulationStore.result,
  simulationStore.resultFingerprint,
  resultPlaybackComplete.value,
))

const activeKey = computed<DemoStageKey>(() => {
  if (route.name === 'home' || !['lab', 'compare', 'analysis'].includes(String(route.name))) return 'home'
  if (route.name === 'lab') {
    if (scenario.value.id !== 'lateral' || !simulationStore.result) return 'lab-initial'
    if (simulationStore.simulationStale) return 'lab-reverify'
    if (simulationStore.result.attackSearchResult?.objectiveReached) return 'lab-configure'
    return 'lab-challenge'
  }
  if (route.name === 'compare') return 'compare'
  return 'analysis'
})

const stage = computed<DemoStage>(() => {
  const base = demoTour[activeKey.value]
  if (activeKey.value !== 'lab-challenge') return base
  if (challengeResult.value.success) return { ...base, title: '挑战通过 · 查看方案对比', message: '三项条件已通过。关键数据受到保护，预设正常业务路径仍可用。', action: '进入方案对比' }
  if (challengeResult.value.valid) return { ...base, message: '查看未通过的条件，调整策略后重新验证。', action: '查看挑战条件' }
  return { ...base, action: '验证安全挑战' }
})

const progress = computed(() => {
  const order: DemoStageKey[] = ['home', 'lab-initial', 'lab-configure', 'lab-reverify', 'lab-challenge', 'compare', 'analysis']
  return `${Math.round(((order.indexOf(activeKey.value) + 1) / order.length) * 100)}%`
})
const directRoute = computed(() => activeKey.value === 'home' ? '/lab' : activeKey.value === 'lab-challenge' && challengeResult.value.success ? '/compare' : null)
const actionButtonLabel = computed(() => {
  if (activeKey.value === 'lab-initial') return '运行原始方案'
  if (activeKey.value === 'lab-reverify') return '重新验证'
  if (activeKey.value === 'lab-configure') return '定位数据库控制项'
  if (activeKey.value === 'lab-challenge' && challengeResult.value.success) return '进入方案对比'
  if (activeKey.value === 'lab-challenge') return '验证安全挑战'
  if (activeKey.value === 'compare') return simulationStore.lastComparison ? '查看实验分析' : '运行对照实验'
  if (activeKey.value === 'analysis') return '返回核心实验'
  return '进入核心实验'
})

function enterCoreLab() {
  if (scenario.value.id !== 'lateral') {
    scenarioStore.selectScenario('lateral')
    simulationStore.reset()
  }
  router.push('/lab')
}

function performAction() {
  if (activeKey.value === 'home' || activeKey.value === 'lab-initial') {
    if (activeKey.value === 'home') enterCoreLab()
    else simulationStore.start()
    return
  }
  if (activeKey.value === 'lab-reverify') {
    simulationStore.start()
    return
  }
  if (activeKey.value === 'lab-configure') {
    window.dispatchEvent(new CustomEvent('zhiyu-demo:open-database'))
    return
  }
  if (activeKey.value === 'lab-challenge') {
    if (challengeResult.value.success) router.push('/compare')
    else window.dispatchEvent(new CustomEvent('zhiyu-demo:verify-challenge'))
    return
  }
  if (activeKey.value === 'compare') {
    if (simulationStore.lastComparison) router.push('/analysis')
    else window.dispatchEvent(new CustomEvent('zhiyu-demo:run-comparison'))
    return
  }
  enterCoreLab()
}
</script>

<template>
  <aside class="demo-guide-bar" role="region" aria-label="比赛演示引导">
    <div class="demo-guide-progress"><i :style="{ width: progress }"></i></div>
    <div class="demo-guide-body">
      <div class="demo-guide-index"><i>{{ stage.number }}</i><span>演示路径</span></div>
      <div class="demo-guide-copy"><div class="demo-guide-kicker">核心实验 · 现场讲解</div><h4>{{ stage.title }}</h4><p>{{ stage.message }}</p></div>
      <div class="demo-guide-controls">
        <button v-if="directRoute" class="demo-ctrl-next" @click="performAction">{{ actionButtonLabel }} <span>→</span></button>
        <button v-else-if="activeKey !== 'analysis'" class="demo-ctrl-next" @click="performAction">{{ actionButtonLabel }} <span>→</span></button>
        <RouterLink v-else to="/lab" class="demo-ctrl-link">重新开始 <span>↗</span></RouterLink>
      </div>
    </div>
  </aside>
</template>
