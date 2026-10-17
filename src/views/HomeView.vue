<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useSettingsStore } from '../stores/settings'

const router = useRouter()
const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const settingsStore = useSettingsStore()
const capabilities = [
  { icon: 'network', title: '三维实验', detail: '在企业网络沙盘中观察区域、设备与连接。' },
  { icon: 'shield', title: '策略验证', detail: '调整规则与防护，重新计算事件结果。' },
  { icon: 'compare', title: '方案对比', detail: '以相同初始条件验证策略差异。' },
]
const features = ['可干预', '可回放', '可解释', '可对比']
const summaries = [
  '观察初始失陷如何沿网络关系扩散，并验证隔离与防护。',
  '检查外部请求如何经过防火墙规则判断。',
  '比较网络分区对风险范围和必要业务的影响。',
]

function enterScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
}

function startDemo() {
  if (!settingsStore.presentationMode) settingsStore.togglePresentationMode()
  router.push('/')
}
</script>

<template>
  <div class="home-page home-reframed">
    <section class="hero-section">
      <div class="hero-copy">
        <h1>智御网络</h1>
        <p class="hero-subtitle">三维网络安全策略交互验证平台</p>
        <p class="hero-description">将抽象的网络安全策略转化为可观察、可干预、可验证的三维实验。</p>
        <div class="hero-actions">
          <RouterLink to="/lab" class="button-primary" @click="enterScenario('lateral')"><span>进入实验室</span><span class="arrow">→</span></RouterLink>
          <RouterLink to="/about" class="button-quiet">了解作品 <span>↗</span></RouterLink>
          <button class="button-quiet" @click="startDemo">一键演示 <span>▶</span></button>
          <a href="#scenarios" class="button-quiet">查看实验场景 <span>↓</span></a>
        </div>
        <p class="hero-note">基于教学型抽象仿真，无需连接真实网络。</p>
      </div>
      <div class="hero-visual-wrap">
        <div class="hero-scene-frame"><NetworkScene :scenario="scenarioStore.current" :show-labels="true" :compact-labels="true" :model-scale="1.22" :minimal-ui="true" :editable="false" /></div>
        <span class="hero-scene-label">企业网络场景</span>
      </div>
    </section>

    <section class="home-capabilities" aria-label="核心能力">
      <article v-for="item in capabilities" :key="item.title" class="home-capability">
        <span class="capability-icon">
          <svg v-if="item.icon === 'network'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 7.5 10.8 16M17 7.5 13.2 16M7 6h10"/></svg>
          <svg v-else-if="item.icon === 'shield'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 7.8-7 10-4.2-2.2-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12m0 0-3-3m3 3-3 3M20 18H8m0 0 3-3m-3 3 3 3"/></svg>
        </span>
        <div><h2>{{ item.title }}</h2><p>{{ item.detail }}</p></div>
      </article>
    </section>

    <section id="scenarios" class="home-scenarios">
      <div class="home-section-heading"><div><span>实验场景</span><h2>从一次安全事件开始</h2></div><span>共 {{ scenarios.length }} 个实验</span></div>
      <div class="scenario-grid">
        <article v-for="(scenario, index) in scenarios" :key="scenario.id" class="scenario-card" :class="`scenario-card-${index + 1}`">
          <div class="scenario-card-top"><span class="scenario-number">实验 {{ ['一', '二', '三'][index] }}</span><span class="scenario-level">{{ scenario.difficulty }}</span></div>
          <h3>{{ scenario.name }}</h3>
          <p>{{ summaries[index] ?? scenario.description }}</p>
          <div class="scenario-card-meta"><span>{{ scenario.duration }}</span></div>
          <RouterLink to="/lab" class="scenario-enter" @click="enterScenario(scenario.id)">进入实验 <span>→</span></RouterLink>
        </article>
      </div>
    </section>

    <section class="home-learn-band" aria-label="学习中心入口">
      <div class="home-learn-icon">⛨</div>
      <div class="home-learn-copy"><span class="section-kicker">LEARNING CENTER</span><h2>学习中心 · 知识卡片与随堂自测</h2><p>6 个知识模块、20 道题库 + 模拟考试，先建立核心概念，再进入三维实验实战验证。</p></div>
      <div class="home-learn-meta"><span><i></i>6 个模块</span><span><i></i>20 道题库</span></div>
      <RouterLink to="/learn" class="button-primary button-small">进入学习中心 <span class="arrow">→</span></RouterLink>
    </section>

    <section class="home-feature-band" aria-label="作品特点">
      <strong>让每一步策略选择，都能在网络场景中得到验证。</strong>
      <div><span v-for="feature in features" :key="feature">{{ feature }}</span></div>
    </section>
    <footer class="home-footer"><span>智御网络 · 教学型抽象网络安全仿真平台</span><span>不执行真实网络通信</span></footer>
  </div>
</template>
