<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import ChartPanel from '../components/charts/ChartPanel.vue'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { hasComparisonBaseline, runComparison as executeComparison } from '../engine/comparisonEngine'
import { simulationFingerprint } from '../engine/simulationFingerprint'
import { useScenarioStore } from '../stores/scenario'
import { useSettingsStore } from '../stores/settings'
import { useSimulationStore } from '../stores/simulation'
import type { Scenario } from '../types/scenario'
import type { SimulationResult } from '../types/simulation'
import { openReportWindow, describeEvents, buildMeta } from '../utils/reportExport'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const settingsStore = useSettingsStore()
const activeVariant = ref<'A' | 'B'>('B')
const saved = simulationStore.lastComparison
const savedMatches = saved?.scenario.id === scenarioStore.current.id
  && simulationFingerprint(saved.scenario) === simulationFingerprint(scenarioStore.current)
const resultA = ref<SimulationResult | null>(savedMatches ? saved.resultA : null)
const resultB = ref<SimulationResult | null>(savedMatches ? saved.resultB : null)
const scenarioA = ref<Scenario | null>(savedMatches ? saved.scenarioA : null)
const scenarioB = ref<Scenario | null>(savedMatches ? saved.scenarioB : null)
const isRunning = ref(false)
const scenario = computed(() => scenarioStore.current)
const hasBaseline = computed(() => hasComparisonBaseline(scenario.value))
watch(() => simulationFingerprint(scenarioStore.current), (key) => {
  if (simulationStore.comparisonFingerprint === key) return
  resultA.value = null
  resultB.value = null
  scenarioA.value = null
  scenarioB.value = null
})
const activeResult = computed(() => activeVariant.value === 'A' ? resultA.value : resultB.value)
const activeScenario = computed(() => activeVariant.value === 'A' ? scenarioA.value : scenarioB.value)
const primaryAssetId = computed(() => scenario.value.challenge?.protectedNodeId ?? scenario.value.nodes.find((node) => node.isCritical)?.id ?? '')
const primaryAssetName = computed(() => {
  const name = scenario.value.nodes.find((node) => node.id === primaryAssetId.value)?.name
  return ({ 'Customer Database': '客户数据库', 'Finance Database': '财务数据库', 'Application Server': '应用服务器' } as Record<string, string>)[name ?? ''] ?? name ?? '关键资产'
})
const assetAffectedA = computed(() => Boolean(resultA.value?.metrics.criticalObjectiveReached ?? resultA.value?.compromisedNodeIds.includes(primaryAssetId.value)))
const assetAffectedB = computed(() => Boolean(resultB.value?.metrics.criticalObjectiveReached ?? resultB.value?.compromisedNodeIds.includes(primaryAssetId.value)))
const attackStateMode = computed(() => scenario.value.simulationMode === 'ATTACK_STATE')
const objectiveReachedA = computed(() => assetAffectedA.value)
const objectiveReachedB = computed(() => assetAffectedB.value)
const objectiveDisplayA = computed(() => resultA.value ? objectiveLabel(objectiveReachedA.value, resultA.value) : '—')
const objectiveDisplayB = computed(() => resultB.value ? objectiveLabel(objectiveReachedB.value, resultB.value) : '—')
const objectiveToneB = computed(() => resultB.value?.metrics.attackSearchComplete === false ? 'asset-unknown' : objectiveReachedB.value ? 'asset-is-risk' : 'asset-is-safe')
const objectiveLabel = (reached: boolean, result?: SimulationResult | null) => {
  if (!attackStateMode.value) return reached ? '受到影响' : '安全'
  if (result && result.metrics.attackSearchComplete === false) return '暂不能判定'
  return reached ? '数据目标可达' : '数据目标已保护'
}
const representativeChainLabel = (result: SimulationResult | null, blocked = false) => {
  const chain = blocked
    ? result?.attackSearchResult?.closestBlockedWitness
    : result?.attackSearchResult?.objectiveWitnessChain
  if (!chain?.length) return blocked ? '未记录到明确阻断候选。' : '未生成目标见证链。'
  return chain.map((transition) => transition.techniqueName + ' · ' + nodeName(transition.sourceNodeId) + ' → ' + nodeName(transition.targetNodeId)).join('；')
}
const keyBlockLabel = (result: SimulationResult | null) => {
  const block = result?.attackSearchResult?.closestBlockedWitness?.at(-1)
  if (!block || block.result !== 'BLOCKED') return result?.metrics.attackSearchComplete === false ? '搜索未完整，暂不能判定' : '无关键阻断点'
  const check = block.preconditionChecks.find((item) => !item.passed && (item.id === 'security-controls' || item.id === 'communication'))
  const reason = (check?.reason ?? block.reason).replace(/[。.!！]+$/u, '')
  return `${block.techniqueName} · ${nodeName(block.sourceNodeId)} → ${nodeName(block.targetNodeId)}：${reason}`
}
const comparisonMetrics = computed(() => {
  if (attackStateMode.value) return [
    { label: '代表攻击链', a: resultA.value?.metrics.representativeChainLength, b: resultB.value?.metrics.representativeChainLength, unit: '步', note: '目标可达时显示到达目标的代表链长度' },
    { label: '可控制设备', a: resultA.value?.metrics.controlledEndpoints, b: resultB.value?.metrics.controlledEndpoints, unit: '台', note: '至少存在一种可达状态控制该设备' },
    { label: '管理员权限设备', a: resultA.value?.metrics.adminControlledEndpoints, b: resultB.value?.metrics.adminControlledEndpoints, unit: '台', note: '本次搜索中存在管理员权限状态的设备' },
    { label: '搜索完整性', a: resultA.value ? resultA.value.metrics.attackSearchComplete === false ? '未完整' : '完整' : undefined, b: resultB.value ? resultB.value.metrics.attackSearchComplete === false ? '未完整' : '完整' : undefined, unit: '', note: '搜索达到上限时不能据此确认目标安全' },
  ]
  const metrics = [
    { label: '受影响节点', a: resultA.value?.metrics.affectedNodes, b: resultB.value?.metrics.affectedNodes, unit: '个', note: resultA.value && resultB.value ? `影响比例 ${resultA.value.metrics.affectedRatio}% → ${resultB.value.metrics.affectedRatio}%` : '占场景节点总数的比例' },
    { label: '传播步骤', a: resultA.value?.metrics.propagationSteps, b: resultB.value?.metrics.propagationSteps, unit: '步', note: '成功传播事件数' },
    { label: '网络通信拒绝', a: resultA.value?.metrics.networkCommunicationRefusals, b: resultB.value?.metrics.networkCommunicationRefusals, unit: '次', note: 'Network Layer 中由 Firewall、路由或隔离导致的通信拒绝' },
    { label: '传播事件阻断占比', a: resultA.value?.metrics.blockedPropagationRatio, b: resultB.value?.metrics.blockedPropagationRatio, unit: '%', note: '被终端防护阻止的传播尝试占全部传播尝试的比例' },
  ]
  return metrics
})
const comparisonInsight = computed(() => {
  const a = resultA.value?.metrics
  const b = resultB.value?.metrics
  if (!a || !b) return '运行对照实验后，将根据两次引擎计算的事件和指标生成结果解释。'
  const assetA = objectiveLabel(objectiveReachedA.value, resultA.value)
  const assetB = objectiveLabel(objectiveReachedB.value, resultB.value)
  const business = `方案 B 保持 ${b.businessPathsReachable} / ${b.businessPathsTotal} 条预设必要业务路径可达（${b.businessReachability}%）`
  if (attackStateMode.value) {
    const assetChange = assetA === assetB ? `关键数据目标在两方案中均为“${assetB}”` : `关键数据目标由“${assetA}”变为“${assetB}”`
    const businessA = `${a.businessPathsReachable} / ${a.businessPathsTotal} 条预设必要业务路径可达（${a.businessReachability}%）`
    const businessB = `${b.businessPathsReachable} / ${b.businessPathsTotal} 条预设必要业务路径可达（${b.businessReachability}%）`
    const block = keyBlockLabel(resultB.value)
    return `${assetChange}。正常业务可达率 ${a.businessReachability}% → ${b.businessReachability}%；方案 A ${businessA}，方案 B ${businessB}。${block !== '无关键阻断点' ? `关键阻断：${block}。` : ''}`
  }
  const assetChange = assetA === assetB ? `${primaryAssetName.value}在两方案中均${assetB}` : `${primaryAssetName.value}由“${assetA}”变为“${assetB}”`
  const activity = attackStateMode.value
    ? `代表链长度 ${a.representativeChainLength ?? 0} → ${b.representativeChainLength ?? 0} 步`
    : `传播步骤 ${a.propagationSteps} → ${b.propagationSteps}`
  const endpointLabel = attackStateMode.value ? '可达受控端点' : '受影响节点'
  const countA = attackStateMode.value ? a.controlledEndpoints ?? 0 : a.affectedNodes
  const countB = attackStateMode.value ? b.controlledEndpoints ?? 0 : b.affectedNodes
  return `${assetChange}。${endpointLabel} ${countA} → ${countB} 个，${activity}；${business}。`
})

function runComparison() {
  if (!hasBaseline.value) return
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

function onDemoRunComparison() {
  runComparison()
}

onMounted(() => window.addEventListener('zhiyu-demo:run-comparison', onDemoRunComparison))
onBeforeUnmount(() => window.removeEventListener('zhiyu-demo:run-comparison', onDemoRunComparison))

function selectScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  resultA.value = null
  resultB.value = null
  scenarioA.value = null
  scenarioB.value = null
}

const chartTheme = computed(() => settingsStore.theme === 'light'
  ? { text: '#52636d', muted: '#72838d', split: 'rgba(51, 78, 92, .14)', tooltip: '#ffffff', tooltipBorder: '#c8d5da', tooltipText: '#243640', chartBg: '#ffffff' }
  : { text: '#c3d0d4', muted: '#91a3ad', split: 'rgba(141,174,192,.14)', tooltip: '#0d1c29', tooltipBorder: '#284557', tooltipText: '#e3eef2', chartBg: '#0c1722' })
const radarOption = computed<EChartsOption>(() => {
  const a = resultA.value?.metrics
  const b = resultB.value?.metrics
  if (!a || !b) return {}
  const dims = ['关键数据目标', '业务可达率', attackStateMode.value ? '行为尝试阻断占比' : '传播尝试阻断占比', '影响范围控制', '网络通信拒绝']
  const score = (m: SimulationResult['metrics'], assetSafe: boolean) => [
    assetSafe ? 100 : 0,
    m.businessReachability,
    m.blockedPropagationRatio,
    100 - m.affectedRatio,
    Math.min(100, m.networkCommunicationRefusals * 14),
  ]
  return {
    color: ['#8fa8b5', '#6fc8a8'],
    tooltip: { trigger: 'item', backgroundColor: chartTheme.value.tooltip, borderColor: chartTheme.value.tooltipBorder, textStyle: { color: chartTheme.value.tooltipText, fontSize: 13 } },
    legend: { bottom: 0, itemWidth: 11, itemHeight: 11, textStyle: { color: chartTheme.value.text, fontSize: 13 }, data: ['方案 A', '方案 B'] },
    radar: {
      indicator: dims.map((name) => ({ name, max: 100 })),
      radius: '62%',
      center: ['50%', '48%'],
      splitLine: { lineStyle: { color: chartTheme.value.split } },
      splitArea: { areaStyle: { color: ['rgba(127,171,188,.03)', 'rgba(127,171,188,.06)'] } },
      axisName: { color: chartTheme.value.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: chartTheme.value.split } },
    },
    series: [{ type: 'radar', data: [
      { value: score(a, !assetAffectedA.value), name: '方案 A', areaStyle: { color: 'rgba(143,168,181,.16)' } },
      { value: score(b, !assetAffectedB.value), name: '方案 B', areaStyle: { color: 'rgba(111,200,168,.2)' } },
    ] }],
  }
})
const diffMatrix = computed(() => {
  const a = resultA.value
  const b = resultB.value
  if (!a || !b) return null
  const aSet = new Set(a.attackSearchResult ? Object.keys(a.attackSearchResult.reachableControlledEndpoints) : a.compromisedNodeIds)
  const bSet = new Set(b.attackSearchResult ? Object.keys(b.attackSearchResult.reachableControlledEndpoints) : b.compromisedNodeIds)
  const nameOf = (id: string) => {
    const name = scenario.value.nodes.find((node) => node.id === id)?.name
    return name ? ({
      'Customer Database': '客户数据库', 'Finance Database': '财务数据库', 'Application Server': '应用服务器',
      'Process File Server': '报表文件服务器', 'Historian Database': '历史数据库', 'SCADA Server': 'SCADA服务器',
      'Operator HMI': '操作员 HMI', 'PLC-01 Pump': '水泵 PLC-01', 'PLC-02 Line': '产线 PLC-02', 'RTU Gateway': '采集终端 RTU',
      'Office-PC-01': '办公终端 01', 'Office-PC-02': '办公终端 02', 'Office-PC-03': '办公终端 03',
    } as Record<string, string>)[name] ?? name : id
  }
  return {
    both: [...aSet].filter((id) => bSet.has(id)).map(nameOf),
    onlyA: [...aSet].filter((id) => !bSet.has(id)).map(nameOf),
    onlyB: [...bSet].filter((id) => !aSet.has(id)).map(nameOf),
    stepsA: a.attackSearchResult?.representativeChain.length ?? a.metrics.propagationSteps,
    stepsB: b.attackSearchResult?.representativeChain.length ?? b.metrics.propagationSteps,
    refusalsA: a.metrics.networkCommunicationRefusals, refusalsB: b.metrics.networkCommunicationRefusals,
    blocksA: a.metrics.teachingPropagationBlocks, blocksB: b.metrics.teachingPropagationBlocks,
  }
})

function exportReport() {
  const a = resultA.value
  const b = resultB.value
  if (!a || !b || !scenarioA.value) return
  const assetA = objectiveLabel(objectiveReachedA.value, a)
  const assetB = objectiveLabel(objectiveReachedB.value, b)
  const sections = [
    { title: '对照结论', lines: [
      comparisonInsight.value,
      `${primaryAssetName.value}：方案 A ${assetA} → 方案 B ${assetB}。`,
      `预设必要业务可达率：方案 A ${a.metrics.businessReachability}% → 方案 B ${b.metrics.businessReachability}%（${b.metrics.businessPathsReachable} / ${b.metrics.businessPathsTotal} 可达）`,
    ] },
    { title: '指标对比', lines: [
      `${attackStateMode.value ? '可达受控端点' : '受影响节点'}：${attackStateMode.value ? a.metrics.controlledEndpoints ?? 0 : a.metrics.affectedNodes} → ${attackStateMode.value ? b.metrics.controlledEndpoints ?? 0 : b.metrics.affectedNodes} 个（${attackStateMode.value ? '受控端点比例' : '影响比例'} ${a.metrics.affectedRatio}% → ${b.metrics.affectedRatio}%）`,
      ...(attackStateMode.value
        ? [
            `代表链长度：${a.metrics.representativeChainLength ?? 0} → ${b.metrics.representativeChainLength ?? 0} 步`,
            `可达管理员权限端点：${a.metrics.adminControlledEndpoints ?? 0} → ${b.metrics.adminControlledEndpoints ?? 0} 个`,
            `状态搜索完整性：${a.metrics.attackSearchComplete === false ? '未完整' : '完整'} → ${b.metrics.attackSearchComplete === false ? '未完整' : '完整'}`,
            `关键数据目标：${objectiveLabel(objectiveReachedA.value, a)} → ${objectiveLabel(objectiveReachedB.value, b)}`,
            `关键阻断点：方案 A ${keyBlockLabel(a)}；方案 B ${keyBlockLabel(b)}`,
          ]
        : [
            `传播步骤：${diffMatrix.value?.stepsA ?? 0} → ${diffMatrix.value?.stepsB ?? 0} 步`,
            `网络通信拒绝：${a.metrics.networkCommunicationRefusals} → ${b.metrics.networkCommunicationRefusals} 次`,
            `教学传播阻止：${a.metrics.teachingPropagationBlocks} → ${b.metrics.teachingPropagationBlocks} 次`,
            `传播事件阻断占比：${a.metrics.blockedPropagationRatio}% → ${b.metrics.blockedPropagationRatio}%`,
          ]),
    ] },
    { title: '方案差异矩阵', lines: [
      `两方案均受影响的节点（${diffMatrix.value?.both.length ?? 0}）：${diffMatrix.value?.both.join('、') || '无'}`,
      `仅方案 A 受影响的节点（${diffMatrix.value?.onlyA.length ?? 0}）：${diffMatrix.value?.onlyA.join('、') || '无'}`,
      `仅方案 B 受影响的节点（${diffMatrix.value?.onlyB.length ?? 0}）：${diffMatrix.value?.onlyB.join('、') || '无'}`,
    ] },
    { title: '方案 A 关键事件', lines: describeEvents(a.events, nodeName, (t) => t) },
    { title: '方案 B 关键事件', lines: describeEvents(b.events, nodeName, (t) => t) },
  ]
  openReportWindow({
    title: '防御策略对照报告',
    subtitle: `场景「${scenario.value.name}」同一初始条件下的 A / B 方案对照`,
    meta: buildMeta(scenario.value, b.generatedAt),
    sections,
  })
}

function nodeName(id: string): string {
  const name = scenario.value.nodes.find((node) => node.id === id)?.name
  return ({ 'Customer Database': '客户数据库', 'Finance Database': '财务数据库', 'Application Server': '应用服务器', 'Office-PC-01': '办公终端 01', 'Office-PC-02': '办公终端 02', 'Office-PC-03': '办公终端 03' } as Record<string, string>)[name ?? ''] ?? name ?? id
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
        <button v-if="resultA && resultB" class="export-report-button" @click="exportReport">导出报告 <span>⤓</span></button>
        <button class="button-primary button-small" :disabled="isRunning || !hasBaseline" @click="runComparison"><span>{{ isRunning ? '正在计算…' : '运行对照实验' }}</span><span class="arrow">↻</span></button>
      </div>
    </div>

    <div v-if="!hasBaseline" class="panel-surface" style="margin-bottom:12px;padding:14px;border-color:rgba(211,170,91,.3);color:#d8ba78">
      当前为自定义场景，尚无原始基线配置。为避免将同一配置伪装成 A/B 结果，对照运行已禁用。
    </div>
    <div v-if="simulationStore.comparisonStale" class="panel-surface" style="margin-bottom:12px;padding:14px;border-color:rgba(211,170,91,.3);color:#d8ba78">
      当前策略配置已变更，上次 A/B 结果已过期。请重新运行对照实验。
    </div>

    <div class="compare-method-line"><span><i class="comparison-key key-a"></i>方案 A · 原始配置</span><b>对照</b><span><i class="comparison-key key-b"></i>方案 B · 当前配置</span><small>共用同一拓扑与初始事件</small></div>

    <section v-if="!resultA || !resultB" class="comparison-empty-state panel-surface">
      <div class="comparison-empty-mark" aria-hidden="true"><span>A</span><i>→</i><span>B</span></div>
      <div class="comparison-empty-copy">
        <span>{{ hasBaseline ? '等待对照计算' : '暂不可对照' }}</span>
        <h2>{{ hasBaseline ? '尚未生成方案结果' : '当前场景暂无可用基线' }}</h2>
        <p>{{ hasBaseline ? '点击页面右上角“运行对照实验”。系统会在相同拓扑和初始状态下，分别计算原始配置与当前配置。' : '请切换到预置实验场景；自定义场景没有原始基线，因此不会生成伪造的 A/B 结果。' }}</p>
      </div>
    </section>

    <section v-else class="results-section compare-results-top">
      <div class="results-title"><div><h2>对照结果</h2></div><span class="results-condition">两次独立仿真计算</span></div>
      <div class="compare-highlight-grid">
        <article class="compare-highlight-card compare-asset-card" :class="objectiveToneB">
          <span>{{ attackStateMode ? '关键数据目标' : '关键资产' }} · {{ primaryAssetName }}</span>
          <div class="compare-transition"><strong>{{ objectiveDisplayA }}</strong><i>→</i><strong>{{ objectiveDisplayB }}</strong></div>
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

    <section v-if="attackStateMode && resultA && resultB" class="attack-witness-compare">
          <article class="panel-surface witness-card witness-card-a"><span>方案 A · 代表攻击链</span><p>{{ representativeChainLabel(resultA) }}</p><small>{{ resultA.attackSearchResult?.searchComplete ? '本次计算找到了通向关键数据目标的代表路径。' : '搜索未完整，暂不能确认目标是否可达。' }}</small></article>
          <article class="panel-surface witness-card witness-card-b"><span>方案 B · 关键阻断点</span><p>{{ representativeChainLabel(resultB, true) }}</p><strong>{{ keyBlockLabel(resultB) }}</strong><small>{{ resultB.attackSearchResult?.searchComplete ? '阻断原因来自本次计算中未满足的安全条件。' : '搜索未完整，暂不能确认目标是否可达。' }}</small></article>
    </section>

    <section v-if="resultA && resultB && diffMatrix && !attackStateMode" class="compare-deep-section">
      <div class="compare-deep-grid">
        <section class="panel-surface compare-radar-card">
          <div class="card-heading"><div><h2>防御效果雷达</h2><p>{{ attackStateMode ? '五维搜索结果比较：关键目标、业务可达、被阻断的行为尝试、影响范围与网络通信拒绝；不代表真实攻击概率。' : '五维评分（0-100）：关键资产、业务可达、传播阻断占比、影响范围与网络通信拒绝' }}</p></div></div>
          <ChartPanel :option="radarOption" height="300px" />
          <div class="radar-legend-note"><span><i class="key-a"></i>方案 A · 原始配置</span><span><i class="key-b"></i>方案 B · 当前配置</span></div>
        </section>
        <section class="panel-surface compare-diff-card">
          <div class="card-heading"><div><h2>方案差异矩阵</h2><p>{{ attackStateMode ? '可达受控端点集合与状态转移对比' : '受影响节点集合与传播活动对比' }}</p></div></div>
          <div class="diff-metric-bar">
            <div class="diff-metric-cell"><span>{{ attackStateMode ? '代表链长度' : '传播步骤' }}</span><b>{{ diffMatrix.stepsA }} <i>→</i> {{ diffMatrix.stepsB }}</b></div>
            <div class="diff-metric-cell"><span>网络通信拒绝</span><b>{{ diffMatrix.refusalsA }} <i>→</i> {{ diffMatrix.refusalsB }}</b></div>
            <div class="diff-metric-cell"><span>{{ attackStateMode ? '被阻断行为尝试' : '教学传播阻断' }}</span><b>{{ diffMatrix.blocksA }} <i>→</i> {{ diffMatrix.blocksB }}</b></div>
          </div>
          <div class="diff-sets">
            <div class="diff-set diff-both"><div class="diff-set-heading"><span>{{ attackStateMode ? '两方案均可控' : '两方案均受影响' }}</span><b>{{ diffMatrix.both.length }}</b></div><div class="diff-chips"><span v-for="name in diffMatrix.both" :key="name">{{ name }}</span><em v-if="!diffMatrix.both.length">无</em></div></div>
            <div class="diff-set diff-only-a"><div class="diff-set-heading"><span>{{ attackStateMode ? '仅方案 A 可控' : '仅方案 A 受影响' }}</span><b>{{ diffMatrix.onlyA.length }}</b></div><div class="diff-chips"><span v-for="name in diffMatrix.onlyA" :key="name">{{ name }}</span><em v-if="!diffMatrix.onlyA.length">无</em></div></div>
            <div class="diff-set diff-only-b"><div class="diff-set-heading"><span>{{ attackStateMode ? '仅方案 B 可控' : '仅方案 B 受影响' }}</span><b>{{ diffMatrix.onlyB.length }}</b></div><div class="diff-chips"><span v-for="name in diffMatrix.onlyB" :key="name">{{ name }}</span><em v-if="!diffMatrix.onlyB.length">无</em></div></div>
          </div>
          <small class="diff-note">{{ attackStateMode ? '差异来自两次状态搜索得到的可达受控端点集合；集合相同表示两方案得到相同端点控制结果。' : '差异来自两次仿真的真实受影响节点集合；集合相同说明两方案在该网络上产生一致的扩散结果。' }}</small>
        </section>
      </div>
    </section>

    <div v-if="resultA && resultB" class="compare-main-grid compare-main-grid-simple">
      <section class="compare-visual-card panel-surface">
        <div class="card-heading"><div><h2>{{ attackStateMode ? '代表链结果' : '三维传播结果' }}</h2><p>{{ activeVariant === 'A' ? '方案 A · 原始配置' : '方案 B · 当前安全策略' }}</p></div><div class="variant-toggle"><button :class="{ active: activeVariant === 'A' }" @click="activeVariant = 'A'">方案 A</button><button :class="{ active: activeVariant === 'B' }" @click="activeVariant = 'B'">方案 B</button></div></div>
        <div class="compare-scene-wrap">
          <NetworkScene v-if="activeScenario" :scenario="activeScenario" :statuses="activeResult?.finalStatuses" :events="activeResult?.events ?? []" :active-index="activeResult ? activeResult.events.length - 1 : -1" :selected-node-id="null" :show-labels="true" :compact-labels="true" :model-scale="1.1" :editable="false" />
          <div v-else class="compare-empty-scene">运行对照实验后查看策略结果</div>
        </div>
        <div class="variant-config-strip"><span>切换方案，查看各自计算出的最终状态</span><RouterLink to="/lab">前往实验室修改策略 →</RouterLink></div>
      </section>
    </div>

    <div v-if="resultA && resultB" class="page-bottom-link"><span>结果来自相同初始条件下的两次本地教学仿真。</span></div>
  </div>
</template>

<style scoped>
.comparison-empty-state {
  width: min(100%, 900px);
  min-height: 290px;
  margin: 34px auto 0;
  padding: 32px 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
}
.comparison-empty-mark { display: flex; align-items: center; gap: 10px; color: var(--text-muted); }
.comparison-empty-mark span { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 10px; color: var(--text-secondary); background: var(--panel-raised); font: 600 16px 'DM Mono', monospace; }
.comparison-empty-mark span:last-child { border-color: color-mix(in srgb, var(--success) 32%, var(--border)); color: var(--success); }
.comparison-empty-mark i { color: var(--accent); font-size: 18px; font-style: normal; }
.comparison-empty-copy { max-width: 510px; }
.comparison-empty-copy>span { color: var(--accent); font-size: 13px; font-weight: 600; }
.comparison-empty-copy h2 { margin: 6px 0 8px; color: var(--text-primary); font-size: 21px; }
.comparison-empty-copy p { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.65; }
.compare-deep-section { margin-top: 16px; }
.compare-deep-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.compare-radar-card, .compare-diff-card { min-width: 0; overflow: hidden; }
.compare-radar-card .card-heading p, .compare-diff-card .card-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }
.radar-legend-note { display: flex; align-items: center; justify-content: center; gap: 26px; padding: 4px 0 13px; color: var(--text-muted); font-size: 13px; }
.radar-legend-note span { display: flex; align-items: center; gap: 7px; }
.radar-legend-note i { width: 7px; height: 7px; border-radius: 50%; }
.diff-metric-bar { margin: 2px 14px 12px; padding: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-raised); }
.diff-metric-cell { display: flex; flex-direction: column; gap: 5px; }
.diff-metric-cell + .diff-metric-cell { padding-left: 10px; border-left: 1px solid var(--border); }
.diff-metric-cell span { color: var(--text-muted); font-size: 13px; }
.diff-metric-cell b { color: var(--text-primary); font-size: 13px; font-weight: 600; }
.diff-metric-cell i { color: var(--accent); font-style: normal; }
.diff-sets { margin: 0 14px; display: flex; flex-direction: column; gap: 9px; }
.diff-set { padding: 10px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-bg); }
.diff-set-heading { display: flex; align-items: center; justify-content: space-between; }
.diff-set-heading span { color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.diff-set-heading b { min-width: 24px; padding: 2px 7px; text-align: center; border-radius: 9px; font-size: 12px; }
.diff-both .diff-set-heading b { color: #e08a78; background: color-mix(in srgb, #e08a78 14%, transparent); }
.diff-only-a .diff-set-heading b { color: #8fa8b5; background: color-mix(in srgb, #8fa8b5 14%, transparent); }
.diff-only-b .diff-set-heading b { color: #6fc8a8; background: color-mix(in srgb, #6fc8a8 14%, transparent); }
.diff-chips { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.diff-chips span { padding: 4px 9px; border-radius: 5px; color: var(--text-secondary); background: var(--panel-raised); font-size: 13px; }
.diff-chips em { color: var(--text-muted); font-size: 13px; font-style: normal; }
.diff-note { display: block; margin: 11px 14px 0; color: var(--text-muted); font-size: 13px; line-height: 1.55; }
.attack-witness-compare { margin-top:14px; display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.witness-card { min-width:0; padding:16px 18px; border-radius:9px; }
.witness-card>span { color:var(--accent); font-size:15px; font-weight:650; }
.witness-card p { margin:10px 0; color:var(--text-primary); font-size:15px; line-height:1.7; }
.witness-card strong { display:block; padding:10px 12px; border-left:3px solid var(--success); color:var(--success); background:color-mix(in srgb,var(--success) 8%,transparent); font-size:14px; line-height:1.55; }
.witness-card small { color:var(--text-muted); font-size:13px; line-height:1.5; }
.witness-card-b strong + small { display:block; margin-top:8px; }
.asset-unknown .compare-transition strong { color:var(--warning); }
@media (max-width: 640px) {
  .comparison-empty-state { min-height: 250px; margin-top: 20px; padding: 25px 20px; flex-direction: column; gap: 16px; text-align: center; }
}
@media (max-width: 1050px) { .attack-witness-compare { grid-template-columns:1fr; } }
@media (max-width: 1050px) { .compare-deep-grid { grid-template-columns: 1fr; } }
</style>
