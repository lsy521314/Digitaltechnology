<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'

const router = useRouter()
const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const coreScenario = computed(() => scenarios.find((scenario) => scenario.id === 'lateral') ?? scenarios[0]!)
const extensionScenarios = computed(() => scenarios.filter((scenario) => scenario.id !== coreScenario.value.id))
const extensionSummaries: Record<string, string> = {
  firewall: '观察边界访问规则如何判断外部请求。',
  segmentation: '比较网络分区对传播范围与业务路径的影响。',
  'supply-chain': '沿教学场景观察软件来源风险如何传递。',
  ransomware: '验证文件服务防护与业务连续性约束。',
  'industrial-ics': '观察工控教学网络中的区域隔离策略。',
}

function enterScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  router.push('/lab')
}
</script>

<template>
  <div class="home-page home-final">
    <section class="home-final-hero">
      <div class="home-final-copy">
        <span class="home-final-kicker">网络安全交互验证平台</span>
        <h1>智御网络</h1>
        <h2>三维网络安全策略交互验证平台</h2>
        <p>在企业网络沙盘中验证安全策略如何保护关键数据，同时保持必要业务可用。</p>
        <div class="home-final-actions">
          <button class="button-primary" @click="enterScenario(coreScenario.id)">进入核心实验 <span class="arrow">→</span></button>
          <RouterLink to="/about" class="button-quiet">了解平台 <span>↗</span></RouterLink>
        </div>
        <div class="home-final-proof"><span><i></i>三维路径观察</span><span><i></i>攻击状态推演</span><span><i></i>策略 A/B 验证</span></div>
      </div>
      <div class="home-final-visual">
        <NetworkScene :scenario="coreScenario" :show-labels="true" :compact-labels="true" :model-scale="1.22" :minimal-ui="true" :editable="false" />
        <div class="home-visual-caption"><span><i></i>企业网络 · 核心实验预览</span><b>交互式数字沙盘</b></div>
      </div>
    </section>

    <section class="home-core-feature" aria-labelledby="home-core-title">
      <div class="home-core-index"><span>核心实验</span><strong>01</strong><i>ATTACK STATE</i></div>
      <div class="home-core-content">
        <h2 id="home-core-title">{{ coreScenario.name }}</h2>
        <p>从已受影响的办公终端出发，验证安全策略能否阻止关键数据访问。</p>
        <div class="home-core-capabilities"><span>三维网络路径</span><span>攻击状态推演</span><span>策略 A/B 验证</span></div>
      </div>
      <div class="home-core-action"><small>核心实验 · 深度状态推演</small><button class="button-primary" @click="enterScenario(coreScenario.id)">开始核心实验 <span class="arrow">→</span></button></div>
    </section>

    <section class="home-extensions" aria-labelledby="home-extensions-title">
      <div class="home-extensions-heading"><div><span>扩展实验</span><h2 id="home-extensions-title">更多实验</h2></div><small>扩展场景采用各自的教学规则模型</small></div>
      <div class="home-extension-grid">
        <article v-for="scenario in extensionScenarios" :key="scenario.id" class="home-extension-card">
          <div class="home-extension-meta"><span>{{ scenario.difficulty }}</span><small>{{ scenario.duration }}</small></div>
          <h3>{{ scenario.name }}</h3>
          <p>{{ extensionSummaries[scenario.id] ?? scenario.description }}</p>
          <button @click="enterScenario(scenario.id)">进入实验 <span>→</span></button>
        </article>
      </div>
      <p class="home-final-note">所有场景均为教学型抽象仿真，不连接真实网络或执行攻击行为。</p>
    </section>
  </div>
</template>
