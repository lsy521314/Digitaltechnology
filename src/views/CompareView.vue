<script setup lang="ts">
import { computed, ref } from 'vue'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { runComparison as executeComparison } from '../engine/comparisonEngine'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import type { Scenario } from '../types/scenario'
import type { SimulationResult } from '../types/simulation'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const activeVariant = ref<'A' | 'B'>('B')
const saved = simulationStore.lastComparison
const savedMatches = saved?.scenario.id === scenarioStore.current.id
  && JSON.stringify(saved.scenario) === JSON.stringify(scenarioStore.current)
const resultA = ref<SimulationResult | null>(savedMatches ? saved.resultA : null)
const resultB = ref<SimulationResult | null>(savedMatches ? saved.resultB : null)
const scenarioA = ref<Scenario | null>(savedMatches ? saved.scenarioA : null)
const scenarioB = ref<Scenario | null>(savedMatches ? saved.scenarioB : null)
const isRunning = ref(false)
const scenario = computed(() => scenarioStore.current)
const activeResult = computed(() => activeVariant.value === 'A' ? resultA.value : resultB.value)
const activeScenario = computed(() => activeVariant.value === 'A' ? scenarioA.value : scenarioB.value)
const primaryAssetId = computed(() => scenario.value.challenge?.protectedNodeId ?? scenario.value.nodes.find((node) => node.isCritical)?.id ?? '')
const primaryAssetName = computed(() => {
  const name = scenario.value.nodes.find((node) => node.id === primaryAssetId.value)?.name
  return ({ 'Customer Database': '客户数据库', 'Finance Database': '财务数据库', 'Application Server': '应用服务器' } as Record<string, string>)[name ?? ''] ?? name ?? '关键资产'
})
const assetAffectedA = computed(() => Boolean(resultA.value?.compromisedNodeIds.includes(primaryAssetId.value)))
const assetAffectedB = computed(() => Boolean(resultB.value?.compromisedNodeIds.includes(primaryAssetId.value)))
const comparisonMetrics = computed(() => [
  { label: '受影响节点', a: resultA.value?.metrics.affectedNodes, b: resultB.value?.metrics.affectedNodes, unit: '个', note: (resultA.value && resultB.value) ? `影响比例 ${resultA.value.metrics.affectedRatio}% → ${resultB.value.metrics.affectedRatio}%` : '占场景节点总数的比例' },
  { label: '传播步骤', a: resultA.value?.metrics.propagationSteps, b: resultB.value?.metrics.propagationSteps, unit: '步', note: '成功传播事件数' },
  { label: '被阻断传播尝试', a: resultA.value?.metrics.blockedEvents, b: resultB.value?.metrics.blockedEvents, unit: '次', note: '仿真记录中被安全策略、防护或隔离阻断的传播尝试' },
  { label: '传播事件阻断占比', a: resultA.value?.metrics.blockedPropagationRatio, b: resultB.value?.metrics.blockedPropagationRatio, unit: '%', note: '阻断传播事件占阻断与成功传播事件总数的比例' },
])
const comparisonInsight = computed(() => {
  const a = resultA.value?.metrics
  const b = resultB.value?.metrics
  if (!a || !b) return '运行对照实验后，将根据两次引擎计算的事件和指标生成结果解释。'
  const assetA = assetAffectedA.value ? '受到影响' : '安全'
  const assetB = assetAffectedB.value ? '受到影响' : '安全'
  const business = `方案 B 保持 ${b.businessPathsReachable} / ${b.businessPathsTotal} 条预设必要业务路径可达（${b.businessReachability}%）`
  const assetChange = assetA === assetB ? `${primaryAssetName.value}在两方案中均${assetB}` : `${primaryAssetName.value}由“${assetA}”变为“${assetB}”`
  return `${assetChange}。受影响节点 ${a.affectedNodes} → ${b.affectedNodes} 个，传播步骤 ${a.propagationSteps} → ${b.propagationSteps}；${business}。`
})

function runComparison() {
  isRunning.value = true
  try {
    const run = executeComparison(scenario.value)
    scenarioA.value = run.scenarioA
    scenarioB.value = run.scenarioB
    resultA.value = run.resultA
    resultB.value = run.resultB
    simulationStore.saveComparison(run.scenario, run.scenarioA, run.scenarioB, run.resultA, run.resultB)
    activeVariant.value = 'B'
  } finally {
    isRunning.value = false
  }
}

function selectScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  resultA.value = null
  resultB.value = null
  scenarioA.value = null
  scenarioB.value = null
}
</script>

<template>
  <div class="content-page compare-page">
    <div class="page-heading compare-heading">
      <div><h1>防御策略验证 <span class="heading-subtitle">同一初始条件下比较两种配置</span></h1></div>
      <div class="compare-heading-actions">
        <el-select :model-value="scenario.id" class="page-scenario-select" @change="selectScenario">
          <el-option v-for="item in scenarios" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <button class="button-primary button-small" :disabled="isRunning" @click="runComparison"><span>{{ isRunning ? '正在计算…' : '运行对照实验' }}</span><span class="arrow">↻</span></button>
      </div>
    </div>

    <div class="compare-method-line"><span><i class="comparison-key key-a"></i>方案 A · 原始配置</span><b>对照</b><span><i class="comparison-key key-b"></i>方案 B · 当前配置</span><small>共用同一拓扑与初始事件</small></div>

    <section class="results-section compare-results-top">
      <div class="results-title"><div><h2>对照结果</h2></div><span class="results-condition">两次独立仿真计算</span></div>
      <div class="compare-highlight-grid">
        <article class="compare-highlight-card compare-asset-card" :class="assetAffectedB ? 'asset-is-risk' : 'asset-is-safe'">
          <span>关键资产 · {{ primaryAssetName }}</span>
          <div class="compare-transition"><strong>{{ resultA ? (assetAffectedA ? '受影响' : '安全') : '—' }}</strong><i>→</i><strong>{{ resultB ? (assetAffectedB ? '受影响' : '安全') : '—' }}</strong></div>
          <small>方案 A 原始配置 <b>→</b> 方案 B 当前配置</small>
        </article>
        <article class="compare-highlight-card compare-business-card">
          <span>预设必要业务可达率</span>
          <div class="compare-transition"><strong>{{ resultA ? `${resultA.metrics.businessReachability}%` : '—' }}</strong><i>→</i><strong>{{ resultB ? `${resultB.metrics.businessReachability}%` : '—' }}</strong></div>
          <small>方案 A <b>→</b> 方案 B · 不是企业 SLA</small>
        </article>
      </div>
      <div class="compare-metric-grid">
        <article v-for="metric in comparisonMetrics" :key="metric.label" class="compare-metric-card panel-surface">
          <span>{{ metric.label }}</span>
          <div class="compare-metric-values"><b>{{ metric.a ?? '—' }}<small>{{ metric.unit }}</small></b><i>→</i><b>{{ metric.b ?? '—' }}<small>{{ metric.unit }}</small></b></div>
          <small>{{ metric.note }}</small>
        </article>
      </div>
      <div class="comparison-insight"><div><strong>本次结果</strong><p>{{ comparisonInsight }}</p></div><RouterLink to="/analysis">查看实验分析 →</RouterLink></div>
    </section>

    <div class="compare-main-grid compare-main-grid-simple">
      <section class="compare-visual-card panel-surface">
        <div class="card-heading"><div><h2>三维传播结果</h2><p>{{ activeVariant === 'A' ? '方案 A · 原始配置' : '方案 B · 当前防御配置' }}</p></div><div class="variant-toggle"><button :class="{ active: activeVariant === 'A' }" @click="activeVariant = 'A'">方案 A</button><button :class="{ active: activeVariant === 'B' }" @click="activeVariant = 'B'">方案 B</button></div></div>
        <div class="compare-scene-wrap">
          <NetworkScene v-if="activeScenario" :scenario="activeScenario" :statuses="activeResult?.finalStatuses" :events="activeResult?.events ?? []" :active-index="activeResult ? activeResult.events.length - 1 : -1" :selected-node-id="null" :show-labels="true" :compact-labels="true" :model-scale="1.1" :editable="false" />
          <div v-else class="compare-empty-scene">运行对照实验后查看策略结果</div>
        </div>
        <div class="variant-config-strip"><span>{{ scenario.nodes.length }} 个节点 · {{ scenario.edges.length }} 条连接 · {{ scenario.initialEvents.length }} 个初始事件</span><RouterLink to="/lab">前往实验室修改策略 →</RouterLink></div>
      </section>
    </div>

    <div class="page-bottom-link"><span>结果来自相同初始条件下的两次本地教学仿真。</span></div>
  </div>
</template>
