<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import ChartPanel from '../components/charts/ChartPanel.vue'
import { formatTimestamp } from '../engine/simulationEngine'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useSettingsStore } from '../stores/settings'
import type { SimulationEvent, SimulationResult } from '../types/simulation'
import { openReportWindow, describeEvents, buildMeta } from '../utils/reportExport'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const settingsStore = useSettingsStore()
const showAllEvents = ref(false)
const result = computed(() => {
  if (simulationStore.simulationStale || simulationStore.comparisonStale) return null
  return simulationStore.lastComparison?.resultB ?? simulationStore.result
})
const scenario = computed(() => simulationStore.lastComparison?.scenario ?? scenarioStore.current)
const metrics = computed(() => result.value?.metrics)
const comparison = computed(() => simulationStore.lastComparison)
const attackStateMode = computed(() => scenario.value.simulationMode === 'ATTACK_STATE')
const affectedCount = computed(() => attackStateMode.value ? metrics.value?.controlledEndpoints ?? 0 : metrics.value?.affectedNodes ?? 0)
const affectedCountLabel = computed(() => attackStateMode.value ? '可达受控端点' : '受影响节点')
const protectedAssetId = computed(() => scenario.value.challenge?.protectedNodeId ?? scenario.value.nodes.find((node) => node.isCritical)?.id ?? '')
const protectedAssetAffected = computed(() => Boolean(result.value?.metrics.criticalObjectiveReached ?? result.value?.compromisedNodeIds.includes(protectedAssetId.value)))
const assetOutcomeLabel = (reached: boolean, current?: SimulationResult | null) => attackStateMode.value
  ? current?.metrics.attackSearchComplete === false && !reached
    ? '搜索未完整，暂不能判定'
    : reached
      ? '关键数据目标可达'
      : current?.events.some((event) => event.attackTechniqueId === 'database-access'
        && event.attackTransitionResult === 'BLOCKED'
        && event.reason.includes('数据访问控制'))
        ? '关键数据目标已保护'
        : '数据目标未访问'
  : reached ? '受到影响' : '安全'
const assetOutcomeTone = (reached: boolean, current?: SimulationResult | null) => attackStateMode.value && current?.metrics.attackSearchComplete === false && !reached
  ? 'outcome-unknown' : reached ? 'outcome-risk' : 'outcome-safe'
const protectedAssetName = computed(() => nodeName(protectedAssetId.value))
const displayNodeName = (name: string) => ({
  Internet: '互联网', 'Edge Gateway': '边界网关', Firewall: '防火墙', 'Core Switch': '核心交换机',
  'DMZ Switch': 'DMZ交换机', 'Public Web Server': '公网Web服务器', 'Mail Server': '邮件服务器',
  'Office Switch': '办公交换机', 'Office-PC-01': '办公终端 01', 'Office-PC-02': '办公终端 02',
  'Office-PC-03': '办公终端 03', 'Office-PC-04': '办公终端 04', 'Server Switch': '服务器交换机',
  'Application Server': '应用服务器', 'File Server': '文件服务器', 'Customer Database': '客户数据库',
  'Finance Database': '财务数据库', 'Perimeter Firewall': '边界防火墙', 'Edge Firewall': '边界防火墙',
  'Office Endpoint': '办公终端',
} as Record<string, string>)[name] ?? name
const nodeName = (id: string) => {
  const name = scenario.value.nodes.find((node) => node.id === id)?.name
  return name ? displayNodeName(name) : id
}
const displayText = (text: string) => scenario.value.nodes
  .map((node) => node.name)
  .sort((a, b) => b.length - a.length)
  .reduce((result, name) => result.replaceAll(name, displayNodeName(name)), text)
  .replaceAll('Office', '办公区')
  .replaceAll('Database', '数据区')
  .replaceAll('Office → Database', '办公区 → 数据区')
  .replaceAll('Office→Database', '办公区→数据区')
  .replaceAll('Office 用户访问', '办公区用户访问')
  .replaceAll('Database 区域', '数据区')
  .replaceAll('USER', '普通用户级')
  .replaceAll('ADMIN', '管理员级')
const chartTheme = computed(() => settingsStore.theme === 'light'
  ? { text: '#52636d', muted: '#72838d', split: 'rgba(51, 78, 92, .14)', tooltip: '#ffffff', tooltipBorder: '#c8d5da', tooltipText: '#243640', chartBg: '#ffffff' }
  : { text: '#c3d0d4', muted: '#91a3ad', split: 'rgba(141,174,192,.14)', tooltip: '#0d1c29', tooltipBorder: '#284557', tooltipText: '#e3eef2', chartBg: '#0c1722' })
const keyEvents = computed(() => selectKeyEvents(result.value?.events ?? []))

function serviceLabel(service: string) {
  return ({ WEB: 'Web 服务', DATABASE: '数据库服务', FILE: '文件服务', MAIL: '邮件服务', INTERNAL: '内部通信', ANY: '任意服务' } as Record<string, string>)[service] ?? service
}
function eventResultLabel(event: SimulationEvent) {
  if (event.attackEffect === 'DATA_ACCESS_GRANTED') return '数据目标已访问'
  if (event.attackEffect === 'PRIVILEGE_ESCALATED') return '权限状态变化'
  if (event.attackTechniqueId) return event.result === 'block' ? '教学行为阻断' : '状态转移'
  return event.result === 'block' ? '通信拒绝' : event.result === 'compromise' ? '受影响' : event.result === 'allow' ? '允许' : event.result === 'info' ? '信息' : '初始状态'
}

function attackKeyBlockLabel(current?: SimulationResult | null) {
  const transition = current?.attackSearchResult?.closestBlockedWitness?.at(-1)
  if (!transition || transition.result !== 'BLOCKED') {
    return current?.attackSearchResult?.searchComplete === false ? '搜索未完整，暂不能判定' : '未记录到关键阻断点'
  }
  const failedCheck = transition.preconditionChecks.find((item) => !item.passed
    && (item.id === 'security-controls' || item.id === 'communication'))
  return `${transition.techniqueName} · ${nodeName(transition.targetNodeId)}：${displayText(failedCheck?.reason ?? transition.reason)}`
}

function selectKeyEvents(items: SimulationEvent[]) {
  const selected: SimulationEvent[] = []
  const seenSeeds = new Set<string>()
  const seenCompromises = new Set<string>()
  const seenRules = new Set<string>()
  const seenProtectionBlocks = new Set<string>()
  const seenIsolationBlocks = new Set<string>()
  const seenIsolationEvents = new Set<string>()
  const seenCriticalChanges = new Set<string>()
  const seenAttackActions = new Set<string>()
  for (const event of items) {
    if (event.phase === 'initial' && event.type === 'seed' && !seenSeeds.has(event.targetId)) {
      seenSeeds.add(event.targetId); selected.push(event); continue
    }
    if (event.result === 'compromise' && event.stateAfter === 'compromised' && event.stateBefore !== 'compromised' && !seenCompromises.has(event.targetId)) {
      seenCompromises.add(event.targetId); selected.push(event); continue
    }
    if (event.attackTechniqueId) {
      const key = `${event.attackTechniqueId}:${event.sourceId}:${event.targetId}:${event.attackTransitionResult ?? event.result}:${event.attackObjective ?? event.matchedRuleId ?? event.preconditionChecks?.find((item) => !item.passed)?.id ?? ''}`
      if (!seenAttackActions.has(key)) { seenAttackActions.add(key); selected.push(event) }
      continue
    }
    if (event.eventLayer === 'ATTACK' && event.message.includes('状态空间搜索完成')) { selected.push(event); continue }
    if (event.result === 'block' && event.matchedRuleId && !seenRules.has(event.matchedRuleId)) {
      seenRules.add(event.matchedRuleId); selected.push(event); continue
    }
    if (event.result === 'block' && event.reason.includes('终端防护已启用') && !seenProtectionBlocks.has(event.targetId)) {
      seenProtectionBlocks.add(event.targetId); selected.push(event); continue
    }
    if (event.result === 'block' && event.reason.includes('隔离状态不可达') && !seenIsolationBlocks.has(event.blockedAt ?? event.targetId)) {
      seenIsolationBlocks.add(event.blockedAt ?? event.targetId); selected.push(event); continue
    }
    if (event.type === 'isolate' && !seenIsolationEvents.has(event.targetId)) {
      seenIsolationEvents.add(event.targetId); selected.push(event); continue
    }
    const target = scenario.value.nodes.find((node) => node.id === event.targetId)
    if (target?.isCritical && event.stateBefore !== event.stateAfter && !seenCriticalChanges.has(event.targetId)) {
      seenCriticalChanges.add(event.targetId); selected.push(event)
    }
  }
  return selected
}

const impactedOption = computed<EChartsOption>(() => {
  const snapshots = result.value?.snapshots ?? []
  return {
    grid: { left: 12, right: 12, top: 18, bottom: 18, containLabel: true },
    xAxis: { type: 'category', data: snapshots.map((_, index) => formatTimestamp(index)), boundaryGap: false, axisLabel: { color: chartTheme.value.muted, fontSize: 12, interval: Math.max(0, Math.ceil(snapshots.length / 7) - 1) }, axisLine: { lineStyle: { color: chartTheme.value.split } }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: Math.max(3, metrics.value?.totalNodes ?? 3), axisLabel: { color: chartTheme.value.muted, fontSize: 12 }, splitLine: { lineStyle: { color: chartTheme.value.split } } },
    series: [{ type: 'line', smooth: 0.32, symbol: 'circle', symbolSize: 6, data: snapshots.map((item) => item.compromisedNodeIds.length), lineStyle: { color: '#e78471', width: 2.5 }, itemStyle: { color: '#e78471', borderColor: '#142735', borderWidth: 2 }, areaStyle: { color: 'rgba(231,132,113,.16)' } }],
    tooltip: { trigger: 'axis', backgroundColor: chartTheme.value.tooltip, borderColor: chartTheme.value.tooltipBorder, textStyle: { color: chartTheme.value.tooltipText, fontSize: 13 }, formatter: (items: unknown) => { const item = (items as { data: number; name: string }[])[0]; return item.name + ' · ' + item.data + ' 个' + affectedCountLabel.value } },
  }
})

const comparisonSummary = computed(() => {
  if (!comparison.value) return null
  const a = comparison.value.resultA
  const b = comparison.value.resultB
  const assetId = comparison.value.scenario.challenge?.protectedNodeId ?? comparison.value.scenario.nodes.find((node) => node.isCritical)?.id ?? ''
  return {
    assetName: nodeName(assetId),
    assetA: a.metrics.criticalObjectiveReached ?? a.compromisedNodeIds.includes(assetId),
    assetB: b.metrics.criticalObjectiveReached ?? b.compromisedNodeIds.includes(assetId),
    businessA: a.metrics.businessReachability,
    businessB: b.metrics.businessReachability,
    affectedA: attackStateMode.value ? a.metrics.controlledEndpoints ?? 0 : a.metrics.affectedNodes,
    affectedB: attackStateMode.value ? b.metrics.controlledEndpoints ?? 0 : b.metrics.affectedNodes,
    stepsA: a.metrics.representativeChainLength ?? a.metrics.propagationSteps,
    stepsB: b.metrics.representativeChainLength ?? b.metrics.propagationSteps,
    resultA: a,
    resultB: b,
  }
})

const stateDistributionOption = computed<EChartsOption>(() => {
  const values = Object.values(result.value?.finalStatuses ?? {})
  const count = (status: string) => values.filter((value) => value === status).length
  return {
    color: ['#49b99f', '#e2786e', '#d9aa58', '#738398', '#62c997'],
    tooltip: { trigger: 'item', backgroundColor: chartTheme.value.tooltip, borderColor: chartTheme.value.tooltipBorder, textStyle: { color: chartTheme.value.tooltipText, fontSize: 13 } },
    legend: { orient: 'vertical', right: 4, top: 'middle', itemWidth: 10, itemHeight: 10, textStyle: { color: chartTheme.value.text, fontSize: 13 } },
    series: [{ type: 'pie', radius: ['48%', '72%'], center: ['35%', '52%'], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: chartTheme.value.chartBg, borderWidth: 3 }, data: [
      { name: '正常', value: count('normal') }, { name: '受影响', value: count('compromised') }, { name: '风险提示', value: count('warning') }, { name: '隔离', value: count('isolated') }, { name: '已防护', value: count('protected') },
    ].filter((item) => item.value > 0) }],
  }
})

const zoneHeatOption = computed<EChartsOption>(() => {
  const nodes = scenario.value.nodes
  const statuses = result.value?.finalStatuses ?? {}
  const zoneLabel = { Office: '办公区', Server: '服务器区', Database: '数据区', DMZ: 'DMZ', Internet: '外部网络', Control: '控制中心', Field: '现场设备区', Historian: '历史数据区' } as Record<string, string>
  const counts = new Map<string, { total: number; affected: number }>()
  for (const node of nodes) {
    const entry = counts.get(node.zone) ?? { total: 0, affected: 0 }
    entry.total += 1
    if (statuses[node.id] === 'compromised') entry.affected += 1
    counts.set(node.zone, entry)
  }
  const data = [...counts.entries()].map(([zone, entry]) => ({
    zone: zoneLabel[zone] ?? zone,
    total: entry.total,
    affected: entry.affected,
    ratio: entry.total ? Math.round((entry.affected / entry.total) * 100) : 0,
  })).sort((a, b) => b.ratio - a.ratio)
  return {
    grid: { left: 12, right: 96, top: 20, bottom: 18, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: chartTheme.value.tooltip, borderColor: chartTheme.value.tooltipBorder, textStyle: { color: chartTheme.value.tooltipText, fontSize: 13 }, formatter: (params: unknown) => {
      const items = params as { name: string; dataIndex: number; value: number }[]
      const item = items[0]
      const zone = data[item.dataIndex]
      return `${item.name}<br/>受影响 ${zone.affected} / ${zone.total} 个节点 · ${item.value}%`
    } },
    xAxis: { type: 'value', max: 100, axisLabel: { color: chartTheme.value.muted, fontSize: 12, formatter: '{value}%' }, splitLine: { lineStyle: { color: chartTheme.value.split } } },
    yAxis: { type: 'category', data: data.map((item) => item.zone), axisLabel: { color: chartTheme.value.muted, fontSize: 12 }, axisLine: { lineStyle: { color: chartTheme.value.split } }, axisTick: { show: false } },
    series: [{ type: 'bar', barWidth: 15, data: data.map((item) => ({
      value: item.ratio,
      itemStyle: { borderRadius: [0, 5, 5, 0], color: item.ratio > 0 ? `rgba(226, 104, 93, ${Math.min(0.95, 0.5 + item.ratio / 220)})` : 'rgba(111,200,168,.72)' },
    })),
      label: { show: true, position: 'right', distance: 8, color: chartTheme.value.muted, fontSize: 12, formatter: (params: unknown) => {
        const p = params as { dataIndex: number }
        const zone = data[p.dataIndex]
        return zone.affected > 0 ? `${zone.affected} / ${zone.total}` : '无' }
      },
    }],
  }
})

const summary = computed(() => {
  const current = result.value
  const currentMetrics = metrics.value
  if (!current || !currentMetrics) return ''
  const lastBlock = [...current.events].reverse().find((event) => event.result === 'block')
  const businessText = '必要业务路径 ' + currentMetrics.businessPathsReachable + ' / ' + currentMetrics.businessPathsTotal + ' 可达（' + currentMetrics.businessReachability + '%）'
  if (comparison.value) {
    const aAffected = Boolean(comparison.value.resultA.metrics.criticalObjectiveReached ?? comparison.value.resultA.compromisedNodeIds.includes(protectedAssetId.value))
    const bAffected = Boolean(comparison.value.resultB.metrics.criticalObjectiveReached ?? comparison.value.resultB.compromisedNodeIds.includes(protectedAssetId.value))
    const controlledLabel = attackStateMode.value ? '可达受控端点' : '受影响节点'
    const controlledCount = attackStateMode.value ? comparison.value.resultB.metrics.controlledEndpoints ?? 0 : comparison.value.resultB.metrics.affectedNodes
    return '对照结果显示，' + protectedAssetName.value + '在方案 A 中' + assetOutcomeLabel(aAffected, comparison.value.resultA) + '，在方案 B 中' + assetOutcomeLabel(bAffected, comparison.value.resultB) + '。方案 B ' + controlledLabel + '为 ' + controlledCount + ' 个，' + (attackStateMode.value ? `代表链 ${comparison.value.resultB.metrics.representativeChainLength ?? 0} 步、管理员权限端点 ${comparison.value.resultB.metrics.adminControlledEndpoints ?? 0} 个、搜索${comparison.value.resultB.metrics.attackSearchComplete === false ? '未完整' : '完整'}` : `网络通信拒绝 ${comparison.value.resultB.metrics.networkCommunicationRefusals} 次、教学传播阻止 ${comparison.value.resultB.metrics.teachingPropagationBlocks} 次`) + '；' + businessText + '。'
  }
  const explanation = lastBlock
    ? (attackStateMode.value
      ? (lastBlock.eventLayer === 'NETWORK' ? '最近一次网络通信拒绝：' : '最近一次教学行为阻断：')
      : (lastBlock.eventLayer === 'NETWORK' ? '最近一次网络通信拒绝：' : '最近一次教学传播阻止：'))
      + lastBlock.reason + (lastBlock.matchedRuleName ? ' 匹配规则“' + lastBlock.matchedRuleName + '”。' : '')
    : attackStateMode.value ? '本轮没有发生网络通信拒绝或教学行为阻断。' : '本轮没有发生网络通信拒绝或教学传播阻止。'
  return attackStateMode.value
    ? `本次“${scenario.value.name}”的代表链包含 ${currentMetrics.representativeChainLength ?? 0} 个教学状态变化；状态搜索${currentMetrics.attackSearchComplete === false ? '未完整，关键数据目标暂不能判定' : '已完整'}，搜索范围内可达 ${currentMetrics.controlledEndpoints ?? 0} 个受控端点，其中 ${currentMetrics.adminControlledEndpoints ?? 0} 个为管理员权限；${protectedAssetName.value}${assetOutcomeLabel(protectedAssetAffected.value, current)}；${businessText}。可达端点和权限来自状态搜索，事件过程只呈现一条确定性代表链。${explanation}`
    : '本次“' + scenario.value.name + '”计算出 ' + currentMetrics.affectedNodes + ' 个受影响节点、' + currentMetrics.propagationSteps + ' 个教学传播状态变化；网络通信拒绝 ' + currentMetrics.networkCommunicationRefusals + ' 次、教学传播阻止 ' + currentMetrics.teachingPropagationBlocks + ' 次。' + protectedAssetName.value + (protectedAssetAffected.value ? '受到影响' : '保持安全') + '；' + businessText + '。' + explanation
})

const timestamp = computed(() => result.value
  ? new Date(result.value.generatedAt).toLocaleString('zh-CN', { hour12: false })
  : '')

function exportReport() {
  const current = result.value
  const currentMetrics = metrics.value
  if (!current || !currentMetrics) return
  const sections = [
    { title: '关键结论', lines: [
      summary.value,
      comparisonSummary.value
        ? `对照结论：${protectedAssetName.value} 在方案 A ${assetOutcomeLabel(comparisonSummary.value.assetA, comparisonSummary.value.resultA)}，在方案 B ${assetOutcomeLabel(comparisonSummary.value.assetB, comparisonSummary.value.resultB)}；业务可达率 ${comparisonSummary.value.businessA}% → ${comparisonSummary.value.businessB}%，${affectedCountLabel.value} ${comparisonSummary.value.affectedA} → ${comparisonSummary.value.affectedB}，${attackStateMode.value ? '代表链长度' : '传播步骤'} ${comparisonSummary.value.stepsA} → ${comparisonSummary.value.stepsB}。`
        : '',
    ] },
    { title: '核心指标', lines: [
      `${affectedCountLabel.value}：${affectedCount.value} / ${currentMetrics.totalNodes}（${attackStateMode.value ? '受控端点比例' : '影响比例'} ${currentMetrics.affectedRatio}%）`,
      `业务可达率：${currentMetrics.businessPathsReachable} / ${currentMetrics.businessPathsTotal} 可达（${currentMetrics.businessReachability}%）`,
      `${attackStateMode.value ? '代表链长度' : '传播步骤'}：${currentMetrics.representativeChainLength ?? currentMetrics.propagationSteps} 步`,
      ...(attackStateMode.value ? [`可达管理员权限端点：${currentMetrics.adminControlledEndpoints ?? 0} 个`, `状态搜索：${currentMetrics.attackSearchComplete === false ? '未完整，目标暂不能判定' : '完整'}`] : []),
      ...(attackStateMode.value
        ? [`关键阻断点：${attackKeyBlockLabel(current)}`]
        : [`网络通信拒绝：${currentMetrics.networkCommunicationRefusals} 次 · 教学传播阻止：${currentMetrics.teachingPropagationBlocks} 次`, `传播事件阻断占比：${currentMetrics.blockedPropagationRatio}%`]),
      `${attackStateMode.value ? '关键数据目标' : '关键资产'} ${protectedAssetName.value}：${assetOutcomeLabel(protectedAssetAffected.value, current)}`,
    ] },
    { title: '关键事件记录', lines: describeEvents(current.events, nodeName, displayText) },
    { title: '业务路径状态', lines: (current.businessPathResults ?? []).map((path) => `· ${displayText(path.label)} —— ${path.allowed ? '可达' : '阻断'}；${path.service}（${displayText(path.reason)}）`) },
  ]
  openReportWindow({
    title: '实验分析报告',
    subtitle: `场景「${scenario.value.name}」单次仿真结果`,
    meta: buildMeta(scenario.value, current.generatedAt),
    sections,
  })
}
</script>

<template>
  <div class="content-page analysis-page">
    <div class="page-heading"><div><h1>实验分析 <span class="heading-subtitle">从真实事件看防御效果</span></h1></div><div v-if="result" class="analysis-heading-meta"><span class="analysis-run-state"><i></i>本地仿真结果</span><span>{{ timestamp }}</span><button class="export-report-button" @click="exportReport">导出报告 <span>⤓</span></button></div></div>

    <section v-if="!result" class="analysis-empty panel-surface">
      <span class="overview-icon" aria-hidden="true">◈</span>
      <h2>{{ simulationStore.simulationStale || simulationStore.comparisonStale ? '结果已过期' : '暂无实验结果' }}</h2>
      <p>{{ simulationStore.simulationStale || simulationStore.comparisonStale ? '配置已变更，旧结果不会作为当前分析显示。请重新运行实验或 A/B 对照。' : '先运行一次实验或 A/B 对照，分析页就会展示真实事件、节点状态和业务可达结果。' }}</p>
      <div class="analysis-empty-actions">
        <RouterLink to="/lab" class="button-primary button-small">进入三维实验室 <span aria-hidden="true">↗</span></RouterLink>
        <RouterLink to="/compare" class="analysis-empty-secondary">运行 A/B 对照 <span aria-hidden="true">→</span></RouterLink>
      </div>
    </section>

    <template v-else-if="metrics">
      <section class="analysis-conclusion panel-surface" :class="{ 'attackstate-analysis': attackStateMode }">
        <div class="analysis-asset-outcome" :class="assetOutcomeTone(protectedAssetAffected, result)"><span>{{ attackStateMode ? '关键数据目标结果' : '关键资产结果' }}</span><strong>{{ protectedAssetName }}</strong><b>{{ assetOutcomeLabel(protectedAssetAffected, result) }}</b></div>
        <div v-if="!attackStateMode" class="analysis-conclusion-stat"><span>{{ affectedCountLabel }}</span><strong>{{ affectedCount }} <small>/ {{ metrics.totalNodes }}</small></strong></div>
        <div class="analysis-conclusion-stat"><span>业务可达率</span><strong>{{ metrics.businessReachability }}<small>%</small></strong></div>
        <div class="analysis-conclusion-stat"><span>{{ attackStateMode ? '代表链长度' : '传播步骤' }}</span><strong>{{ attackStateMode ? metrics.representativeChainLength ?? 0 : metrics.propagationSteps }}</strong></div>
        <div v-if="attackStateMode" class="analysis-conclusion-stat"><span>代表链状态</span><strong>{{ metrics.attackSearchComplete === false ? '未完整' : '完整' }}</strong></div>
        <RouterLink to="/lab" class="overview-open-link">重新运行 →</RouterLink>
      </section>

      <div class="analysis-chart-grid">
        <section class="analysis-chart-card panel-surface"><div class="card-heading"><h2>{{ attackStateMode ? '代表链上受控端点变化' : '受影响节点变化' }}</h2><span class="chart-card-badge">{{ attackStateMode ? '按代表链事件步骤' : '按事件步骤' }}</span></div><ChartPanel :option="impactedOption" height="236px" /></section>
        <section class="analysis-chart-card panel-surface"><div class="card-heading"><h2>{{ attackStateMode ? '代表状态节点分布' : '最终节点状态' }}</h2><span class="chart-card-badge">共 {{ metrics.totalNodes }} 个节点</span></div><div class="distribution-chart"><ChartPanel :option="stateDistributionOption" height="192px" /><div class="distribution-center"><strong>{{ metrics.totalNodes }}</strong><small>节点</small></div></div></section>
        <section class="analysis-chart-card analysis-ab-conclusion panel-surface"><div class="card-heading"><h2>{{ comparison ? 'A / B 核心结论' : '本轮结果要点' }}</h2><span class="chart-card-badge">真实计算</span></div>
          <template v-if="comparisonSummary"><div class="analysis-ab-asset" :class="assetOutcomeTone(comparisonSummary.assetB, comparisonSummary.resultB)"><span>{{ comparisonSummary.assetName }}</span><strong>{{ assetOutcomeLabel(comparisonSummary.assetA, comparisonSummary.resultA) }} <i>→</i> {{ assetOutcomeLabel(comparisonSummary.assetB, comparisonSummary.resultB) }}</strong><small>方案 A → 方案 B</small></div><div class="analysis-ab-facts"><div><span>业务可达率</span><strong>{{ comparisonSummary.businessA }}% <i>→</i> {{ comparisonSummary.businessB }}%</strong></div><div><span>{{ affectedCountLabel }}</span><strong>{{ comparisonSummary.affectedA }} <i>→</i> {{ comparisonSummary.affectedB }}</strong></div><div><span>{{ attackStateMode ? '代表链长度' : '传播步骤' }}</span><strong>{{ comparisonSummary.stepsA }} <i>→</i> {{ comparisonSummary.stepsB }}</strong></div></div><RouterLink to="/compare">查看完整方案对比 →</RouterLink></template>
          <template v-else><div class="analysis-ab-asset" :class="assetOutcomeTone(protectedAssetAffected, result)"><span>{{ protectedAssetName }}</span><strong>{{ assetOutcomeLabel(protectedAssetAffected, result) }}</strong><small>当前仿真结果</small></div><div class="analysis-ab-facts"><div><span>业务可达率</span><strong>{{ metrics.businessReachability }}%</strong></div><div><span>{{ affectedCountLabel }}</span><strong>{{ affectedCount }} / {{ metrics.totalNodes }}</strong></div><div><span>{{ attackStateMode ? '关键阻断点' : '传播事件阻断占比' }}</span><strong>{{ attackStateMode ? attackKeyBlockLabel(result) : `${metrics.blockedPropagationRatio}%` }}</strong></div></div></template>
        </section>
      </div>

        <section v-if="!attackStateMode" class="analysis-chart-card analysis-zone-heat panel-surface"><div class="card-heading"><h2>区域影响热力</h2><span class="chart-card-badge">按受影响比例排序</span></div><ChartPanel :option="zoneHeatOption" height="228px" /><div class="zone-heat-legend"><span>条形颜色越深表示该区域受影响比例越高</span></div></section>

      <details class="analysis-business-details"><summary>查看预设业务路径 · {{ metrics.businessPathsReachable }} / {{ metrics.businessPathsTotal }} 可达</summary><div class="analysis-business-list"><div v-for="path in result.businessPathResults" :key="path.id" class="analysis-business-row"><i :class="path.allowed ? 'business-pass' : 'business-fail'"></i><div><strong>{{ displayText(path.label) }}</strong><small>{{ serviceLabel(path.service) }} · {{ path.route.map(nodeName).join(' → ') || '无可用路径' }}</small><em>{{ displayText(path.reason) }}</em></div><b>{{ path.allowed ? '可达' : '阻断' }}</b></div></div></details>

      <section class="analysis-events panel-surface">
        <div class="card-heading"><div><h2>关键事件记录</h2><span class="analysis-events-count">{{ showAllEvents ? result.events.length : keyEvents.length }} / {{ result.events.length }} 条</span></div><button class="analysis-events-toggle" @click="showAllEvents = !showAllEvents">{{ showAllEvents ? '仅看关键事件' : '查看全部事件' }}</button></div>
        <div v-if="!result.events.length" class="empty-log">本次仿真没有产生事件。</div>
        <div v-else class="analysis-event-list">
          <article v-for="event in (showAllEvents ? result.events : keyEvents)" :key="event.id" class="analysis-event-row">
            <span class="analysis-event-step">{{ formatTimestamp(event.stepIndex) }}</span><i :class="'event-state-' + event.result"></i>
            <div class="analysis-event-copy"><strong>{{ nodeName(event.sourceId) }} → {{ nodeName(event.targetId) }} · {{ serviceLabel(event.service) }}</strong><p>{{ displayText(event.message) }}</p><small>路径：{{ event.route.map(nodeName).join(' → ') || '无网络路径（本地状态变化）' }}</small><small>原因：{{ displayText(event.reason) }}<template v-if="event.matchedRuleName"> · 匹配规则：{{ event.matchedRuleName }}</template><template v-if="event.blockedAt"> · 阻断位置：{{ displayText(event.blockedAt) }}</template></small></div>
            <span class="analysis-event-result">{{ eventResultLabel(event) }}</span>
          </article>
        </div>
      </section>

      <section class="analysis-summary panel-surface"><div class="summary-title"><h2>实验结论</h2></div><p>{{ summary }}</p><div class="summary-bottom"><span>由本次仿真指标与事件生成</span><RouterLink to="/compare">进入方案对比 →</RouterLink></div></section>
      <div class="page-bottom-link"><span>业务可达率表示本场景预设必要业务路径的可达比例，不代表企业 SLA。</span></div>
    </template>
  </div>
</template>

<style scoped>
.analysis-empty {
  width: min(100%, 820px);
  min-height: 250px;
  margin: 0 auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.analysis-empty .overview-icon { margin-bottom: 13px; }
.analysis-empty h2 { margin: 0; color: var(--text-primary); font-size: 22px; }
.analysis-empty p { max-width: 560px; margin: 10px 0 19px; color: var(--text-secondary); font-size: 14px; line-height: 1.65; }
.analysis-empty-actions { display: flex; align-items: center; justify-content: center; gap: 20px; }
.analysis-empty-actions .button-primary { min-height: 40px; display: inline-flex; align-items: center; gap: 7px; }
.analysis-empty-secondary { color: var(--accent); font-size: 14px; font-weight: 600; text-decoration: none; }
.analysis-empty-secondary:hover { color: var(--text-primary); }
.analysis-zone-heat { grid-column: 1 / -1; }
.analysis-zone-heat .card-heading { margin-bottom: 6px; }
.zone-heat-legend { padding: 0 14px 11px; color: var(--text-muted); font-size: 13px; }
.zone-heat-legend span { display: inline-flex; align-items: center; gap: 7px; }
.zone-heat-legend span::before { content: ''; width: 16px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, rgba(111,200,168,.72), rgba(226,104,93,.95)); }
@media (max-width: 640px) {
  .analysis-empty { min-height: 220px; padding: 24px 18px; }
  .analysis-empty h2 { font-size: 20px; }
  .analysis-empty-actions { flex-wrap: wrap; gap: 13px; }
}
</style>
