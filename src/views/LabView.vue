<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { formatTimestamp } from '../engine/simulationEngine'
import { NETWORK_ZONES, SERVICE_TYPES, type NetworkZone, type RuleAction, type SecurityRule, type ServiceType } from '../types/network'
import type { SimulationEvent, SimulationResult } from '../types/simulation'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useSettingsStore } from '../stores/settings'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const settingsStore = useSettingsStore()
const scenario = computed(() => scenarioStore.current)
const selectedNode = computed(() => scenario.value.nodes.find((node) => node.id === scenarioStore.selectedNodeId) ?? null)
const statuses = computed(() => simulationStore.currentStatuses)
const currentEvent = computed(() => simulationStore.currentEvent)
const isStale = computed(() => Boolean(simulationStore.result && simulationStore.resultScenarioKey !== JSON.stringify(scenario.value)))
const rightTab = ref<'node' | 'policy' | 'event'>('event')
const eventMode = ref<'key' | 'all'>('key')
const showRuleForm = ref(false)
const showPolicyDrawer = ref(false)
const showUtilities = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const challengeResult = ref<SimulationResult | null>(null)
const challengeScenarioKey = ref('')
const challengeWasVerified = ref(false)
const challengePanelRef = ref<HTMLElement | null>(null)
const focusTopology = ref(false)
const leftDrawerOpen = ref(true)
const rightDrawerOpen = ref(false)
const presentationEventPanelOpen = ref(false)
const topologyFitRequest = ref(0)
let presentationEventPanelTimer: ReturnType<typeof setTimeout> | undefined
let compactViewportQuery: MediaQueryList | undefined
const ruleDraft = reactive({
  name: '办公区访问数据库限制',
  sourceZone: 'Office' as SecurityRule['sourceZone'],
  targetZone: 'Database' as SecurityRule['targetZone'],
  service: 'DATABASE' as ServiceType,
  action: 'DENY' as RuleAction,
})

const events = computed(() => simulationStore.result?.events ?? [])
const visibleEvents = computed(() => eventMode.value === 'all' ? events.value : selectKeyEvents(events.value))
const enabledRules = computed(() => scenario.value.rules.filter((rule) => rule.enabled))
const enabledDenyRules = computed(() => enabledRules.value.filter((rule) => rule.action === 'DENY'))
const enabledAllowRules = computed(() => enabledRules.value.filter((rule) => rule.action === 'ALLOW'))
const highlightedRule = computed(() => enabledDenyRules.value.find((rule) => rule.sourceZone === 'Office' && rule.targetZone === 'Database') ?? enabledDenyRules.value[0] ?? enabledRules.value[0] ?? null)
const challenge = computed(() => scenario.value.challenge)
const primaryAssetId = computed(() => challenge.value?.protectedNodeId ?? scenario.value.nodes.find((node) => node.isCritical)?.id ?? '')
const primaryAssetName = computed(() => nodeName(primaryAssetId.value))
const completedResult = computed(() => simulationStore.status === 'completed' && !isStale.value ? simulationStore.result : null)
const challengeIsCurrent = computed(() => Boolean(challengeResult.value && challengeScenarioKey.value === JSON.stringify(scenario.value)))
const challengeChecks = computed(() => {
  const item = challenge.value
  const result = challengeResult.value
  if (!item || !result || !challengeIsCurrent.value) return null
  const databaseProtected = !result.compromisedNodeIds.includes(item.protectedNodeId)
  const required = item.requiredBusinessPathIds.map((id) => result.businessPathResults.find((path) => path.id === id))
  const officeWeb = required[0]?.allowed ?? false
  const appDatabase = required[1]?.allowed ?? false
  return {
    databaseProtected,
    officeWeb,
    appDatabase,
    success: databaseProtected && officeWeb && appDatabase,
    passedCount: Number(databaseProtected) + Number(officeWeb) + Number(appDatabase),
  }
})
const decisionChain = computed(() => {
  const event = currentEvent.value
  if (!event) return []
  if (event.phase === 'initial' && event.type === 'seed') {
    return [{ label: '实验初始状态', value: '仿真开始前已受影响', state: 'neutral' }]
  }
  const reason = event.reason
  const hasRoute = event.routeEdgeIds.length > 0
  const serviceMismatch = reason.includes('路径不承载')
  const noTopologyPath = reason.includes('不存在可用路径')
  const ruleBlocked = event.result === 'block' && Boolean(event.matchedRuleId)
  const defaultAllowed = reason.includes('默认 ALLOW')
  const protectionBlocked = reason.includes('终端防护已启用')
  const isolationBlocked = reason.includes('隔离状态不可达')
  return [
    { label: '网络连接', value: hasRoute ? '路径已计算' : noTopologyPath ? '无可用路径' : isolationBlocked ? '路径因隔离中断' : '未形成路径', state: hasRoute ? 'pass' : 'fail' },
    { label: '服务类型', value: serviceMismatch ? '路径不承载此服务' : hasRoute ? '服务路径已计算' : '未形成服务路径', state: serviceMismatch ? 'fail' : hasRoute ? 'pass' : 'neutral' },
    { label: '安全规则', value: event.matchedRuleName ? `${ruleBlocked ? '拒绝' : '允许'} · ${event.matchedRuleName}` : defaultAllowed ? '未命中规则 · 默认允许' : '未进入规则匹配', state: ruleBlocked ? 'fail' : defaultAllowed || event.matchedRuleId ? 'pass' : 'neutral' },
    { label: '终端防护', value: protectionBlocked ? '已启用 · 阻断传播' : ruleBlocked ? '规则已先行阻断' : '未成为本次阻断原因', state: protectionBlocked ? 'fail' : 'neutral' },
  ]
})

function displayStatus(nodeId: string) {
  const node = scenario.value.nodes.find((item) => item.id === nodeId)
  return statuses.value?.[nodeId]
    ?? (node?.isolationEnabled || node?.status === 'isolated' ? 'isolated' : node?.protectionEnabled && node.status === 'normal' ? 'protected' : node?.status ?? 'normal')
}
function displayNodeName(name: string) {
  return ({
    Internet: '互联网', 'Edge Gateway': '边界网关', Firewall: '防火墙', 'Core Switch': '核心交换机',
    'DMZ Switch': 'DMZ交换机', 'Public Web Server': '公网Web服务器', 'Mail Server': '邮件服务器',
    'Office Switch': '办公交换机', 'Office-PC-01': '办公终端 01', 'Office-PC-02': '办公终端 02',
    'Office-PC-03': '办公终端 03', 'Office-PC-04': '办公终端 04', 'Server Switch': '服务器交换机',
    'Application Server': '应用服务器', 'File Server': '文件服务器', 'Customer Database': '客户数据库',
    'Finance Database': '财务数据库', 'Perimeter Firewall': '边界防火墙', 'Edge Firewall': '边界防火墙',
    'Office Endpoint': '办公终端',
  } as Record<string, string>)[name] ?? name
}
function nodeTypeLabel(type: string) {
  return ({ Internet: '外部网络', Gateway: '网关', Firewall: '防火墙', Router: '路由器', Switch: '交换机', Workstation: '终端', Server: '服务器', Database: '数据库' } as Record<string, string>)[type] ?? type
}
function nodeName(id: string) { const name = scenario.value.nodes.find((node) => node.id === id)?.name; return name ? displayNodeName(name) : id }
function displayText(text: string) {
  const nodeNames = scenario.value.nodes.map((node) => node.name).sort((a, b) => b.length - a.length)
  return nodeNames.reduce((result, name) => result.replaceAll(name, displayNodeName(name)), text)
    .replaceAll('Office', '办公区')
    .replaceAll('Database', '数据区')
    .replaceAll('Office → Database', '办公区 → 数据区')
    .replaceAll('Office→Database', '办公区→数据区')
    .replaceAll('Office 用户访问', '办公区用户访问')
    .replaceAll('Database 区域', '数据区')
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
  for (const event of items) {
    if (event.phase === 'initial' && event.type === 'seed' && !seenSeeds.has(event.targetId)) {
      seenSeeds.add(event.targetId); selected.push(event); continue
    }
    if (event.result === 'compromise' && event.stateAfter === 'compromised' && event.stateBefore !== 'compromised' && !seenCompromises.has(event.targetId)) {
      seenCompromises.add(event.targetId); selected.push(event); continue
    }
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
function eventLabel(event: SimulationEvent) {
  if (event.phase === 'initial' && event.type === 'seed') return '初始状态'
  if (event.result === 'block') return '已阻断'
  if (event.result === 'compromise') return '受影响'
  if (event.result === 'allow') return '允许'
  return '观察'
}
function chooseScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  challengeResult.value = null
  challengeWasVerified.value = false
}
function runSimulation() {
  challengeResult.value = null
  challengeWasVerified.value = false
  simulationStore.start()
}
function toggleProtection() {
  const node = selectedNode.value
  if (!node || !['Workstation', 'Server'].includes(node.type)) return
  scenarioStore.updateNode(node.id, { protectionEnabled: !node.protectionEnabled })
  ElMessage.success(node.protectionEnabled ? '已关闭终端防护' : '已启用教学仿真终端防护')
}
function toggleIsolation() {
  const node = selectedNode.value
  if (!node) return
  const next = !(node.isolationEnabled || node.status === 'isolated')
  scenarioStore.updateNode(node.id, { isolationEnabled: next })
  ElMessage.success(next ? '节点已隔离，后续通信和传播将受影响' : '已解除节点隔离')
}
function toggleCritical() {
  const node = selectedNode.value
  if (!node) return
  scenarioStore.updateNode(node.id, { isCritical: !node.isCritical })
}
function addRule() {
  const name = ruleDraft.name.trim()
  if (!name) return ElMessage.warning('请填写规则名称')
  scenarioStore.addRule({
    name,
    sourceZone: ruleDraft.sourceZone,
    targetZone: ruleDraft.targetZone,
    service: ruleDraft.service,
    action: ruleDraft.action,
  })
  showRuleForm.value = false
  ElMessage.success('安全策略已添加')
}
function seek(index: number) { simulationStore.seek(index) }
function eventTone(event: SimulationEvent) {
  return event.result === 'block' ? 'blocked' : event.result === 'compromise' ? 'risk' : event.result === 'info' ? 'info' : 'normal'
}
function zoneLabel(zone: string) { return ({ Internet: '外部网络', DMZ: 'DMZ', Office: '办公区', Server: '服务器区', Database: '数据区' } as Record<string, string>)[zone] ?? zone }
function stateLabel(status: string) { return ({ normal: '正常', warning: '风险提示', compromised: '受影响', isolated: '已隔离', protected: '已防护' } as Record<string, string>)[status] ?? status }
function onTimelineInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const selectedEvent = visibleEvents.value[value]
  if (selectedEvent) seek(events.value.indexOf(selectedEvent))
}
async function verifyChallenge() {
  if (!challenge.value) return
  simulationStore.reset()
  simulationStore.runToEnd()
  challengeResult.value = simulationStore.result
  challengeScenarioKey.value = JSON.stringify(scenario.value)
  challengeWasVerified.value = true
  await nextTick()
  if (challengePanelRef.value) challengePanelRef.value.scrollTop = challengePanelRef.value.scrollHeight
}
function managePolicy() { rightTab.value = 'policy'; showPolicyDrawer.value = true }
async function toggleTopologyFocus() {
  focusTopology.value = !focusTopology.value
  await nextTick()
  topologyFitRequest.value += 1
}
function resetTopologyView() { topologyFitRequest.value += 1 }
function toggleRightPanel() {
  if (settingsStore.presentationMode) {
    presentationEventPanelOpen.value = !presentationEventPanelOpen.value
    rightDrawerOpen.value = presentationEventPanelOpen.value
    if (presentationEventPanelTimer) clearTimeout(presentationEventPanelTimer)
    return
  }
  rightDrawerOpen.value = !rightDrawerOpen.value
}
function closePresentationEventPanel() {
  presentationEventPanelOpen.value = false
  rightDrawerOpen.value = false
  if (presentationEventPanelTimer) clearTimeout(presentationEventPanelTimer)
}
function onCompactViewportChange(event: Pick<MediaQueryListEvent, 'matches'>) {
  if (!event.matches) return
  leftDrawerOpen.value = false
  rightDrawerOpen.value = false
  presentationEventPanelOpen.value = false
}
function onMoveNode(id: string, position: { x: number; y: number; z: number }) {
  scenarioStore.moveNode(id, position)
}
function restoreDefaults() {
  scenarioStore.restoreDefaults()
  simulationStore.reset()
  challengeResult.value = null
  challengeWasVerified.value = false
  ElMessage.success('已恢复该实验的默认拓扑与策略')
}
function exportScenario() {
  const blob = new Blob([JSON.stringify(scenario.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${scenario.value.id}-scenario.json`
  link.click()
  URL.revokeObjectURL(url)
}
function importScenarioFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      scenarioStore.importScenario(JSON.parse(String(reader.result)))
      simulationStore.reset()
      challengeResult.value = null
      challengeWasVerified.value = false
      ElMessage.success('场景已导入并通过结构校验')
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '场景 JSON 无法导入')
    } finally {
      input.value = ''
    }
  }
  reader.onerror = () => ElMessage.error('读取场景文件失败')
  reader.readAsText(file)
}

watch(() => JSON.stringify(scenario.value), () => {
  if (challengeWasVerified.value) challengeWasVerified.value = false
})

watch(() => currentEvent.value?.id, () => {
  const event = currentEvent.value
  if (!settingsStore.presentationMode || focusTopology.value || !event) return
  const target = scenario.value.nodes.find((node) => node.id === event.targetId)
  const importantChange = target?.isCritical && event.result === 'compromise' && event.stateBefore !== event.stateAfter
  if (event.result !== 'block' && !importantChange) return
  rightTab.value = 'event'
  presentationEventPanelOpen.value = true
  rightDrawerOpen.value = true
  if (presentationEventPanelTimer) clearTimeout(presentationEventPanelTimer)
  presentationEventPanelTimer = setTimeout(closePresentationEventPanel, 5600)
})

watch(() => settingsStore.presentationMode, (enabled) => {
  if (!enabled) closePresentationEventPanel()
  else {
    focusTopology.value = false
    closePresentationEventPanel()
  }
})

onMounted(() => {
  compactViewportQuery = window.matchMedia('(max-width: 1450px)')
  if (compactViewportQuery.matches) onCompactViewportChange(compactViewportQuery)
  compactViewportQuery.addEventListener('change', onCompactViewportChange)
})

onBeforeUnmount(() => {
  if (presentationEventPanelTimer) clearTimeout(presentationEventPanelTimer)
  compactViewportQuery?.removeEventListener('change', onCompactViewportChange)
})
</script>

<template>
  <div class="lab-page strategy-lab">
    <div class="lab-heading">
      <div><h1>网络安全实验室 <span class="heading-subtitle">调整防御策略，观察结果如何变化</span></h1></div>
      <div class="lab-heading-actions">
        <el-select :model-value="scenario.id" class="page-scenario-select" @change="chooseScenario"><el-option v-for="item in scenarios" :key="item.id" :label="item.name" :value="item.id" /></el-select>
        <div v-if="!settingsStore.presentationMode" class="lab-more-actions">
          <button class="lab-utility-button" :aria-expanded="showUtilities" @click="showUtilities = !showUtilities">{{ showUtilities ? '收起' : '更多操作' }}</button>
          <div v-if="showUtilities" class="lab-utility-popover"><button @click="restoreDefaults(); showUtilities = false">恢复默认</button><button @click="exportScenario(); showUtilities = false">导出场景 JSON</button><button @click="importInput?.click(); showUtilities = false">导入场景 JSON</button></div>
          <input ref="importInput" class="hidden-file-input" type="file" accept="application/json,.json" @change="importScenarioFile" />
        </div>
      </div>
    </div>

    <div v-if="isStale" class="strategy-stale-banner"><span>↻</span><div><strong>安全策略已修改，请重新运行仿真以验证结果。</strong><small>当前场景状态已更新，画面保留上一轮结果直到你重新运行。</small></div><button @click="runSimulation">重新运行</button></div>

    <div class="lab-workspace strategy-workspace" :class="{ 'topology-focused': focusTopology, 'presentation-layout': settingsStore.presentationMode, 'presentation-right-hidden': settingsStore.presentationMode && !presentationEventPanelOpen, 'left-drawer-open': leftDrawerOpen, 'right-drawer-open': rightDrawerOpen }">
      <aside class="lab-left-panel panel-surface">
        <div class="lab-experiment-intro"><span>当前实验 · {{ scenario.difficulty }}</span><h2>{{ scenario.name }}</h2><details class="lab-experiment-details"><summary>实验说明</summary><p>{{ displayText(scenario.description) }}</p><ul><li v-for="objective in scenario.learningObjectives" :key="objective">{{ objective }}</li></ul></details></div>
        <div v-if="scenario.initialEvents.some(event => event.type === 'seed')" class="initial-condition"><span class="condition-icon">i</span><div><strong>实验初始条件</strong><p>{{ displayText(scenario.initialEvents.find(event => event.type === 'seed')?.message ?? '') }}</p></div></div>
        <section v-if="challenge" ref="challengePanelRef" class="challenge-panel challenge-panel-primary">
          <div class="challenge-heading-row"><span class="challenge-title-mark">◎</span><span class="challenge-live-tag">安全挑战</span></div>
          <h3>{{ displayText(challenge.title) }}</h3>
          <div class="challenge-brief-row"><span>初始状态</span><strong>办公终端 01 已受影响</strong></div>
          <div class="challenge-brief-row challenge-brief-goal"><span>安全目标</span><strong>保护 {{ nodeName(challenge.protectedNodeId) }}</strong></div>
          <div class="challenge-requirements"><strong>同时保持必要业务</strong><div><i>✓</i><span>办公区 → 公网 Web 服务</span><b>WEB</b></div><div><i>✓</i><span>应用服务器 → 客户数据库</span><b>DATABASE</b></div></div>
          <div class="challenge-actions"><button class="challenge-policy-link" @click="managePolicy">管理安全策略 <span>→</span></button><button class="button-primary challenge-run-button" :disabled="simulationStore.status === 'running'" @click="verifyChallenge">验证方案 <span class="arrow">↻</span></button></div>
          <template v-if="challengeWasVerified && challengeChecks">
            <div class="challenge-verdict" :class="challengeChecks.success ? 'passed' : 'failed'"><i>{{ challengeChecks.success ? '✓' : '!' }}</i><strong>{{ challengeChecks.success ? '挑战成功：安全与必要业务均满足。' : challengeChecks.databaseProtected ? '安全目标达到，但业务可用性不满足要求。' : '客户数据库仍受到影响，请调整策略。' }}</strong></div>
            <div class="challenge-check-list"><div><span>关键资产保护</span><b :class="{ pass: challengeChecks.databaseProtected }">{{ challengeChecks.databaseProtected ? '通过' : '失败' }}</b></div><div><span>正常 Web 业务</span><b :class="{ pass: challengeChecks.officeWeb }">{{ challengeChecks.officeWeb ? '通过' : '失败' }}</b></div><div><span>数据库必要业务</span><b :class="{ pass: challengeChecks.appDatabase }">{{ challengeChecks.appDatabase ? '通过' : '失败' }}</b></div></div>
            <div class="challenge-count">{{ challengeChecks.passedCount }} / 3 条件满足</div>
          </template>
          <div v-else class="challenge-hint">修改策略后验证；系统会从相同初始状态重新计算。</div>
        </section>
        <section v-else class="challenge-panel learning-objectives-panel"><h3>本实验学习目标</h3><ul><li v-for="objective in scenario.learningObjectives" :key="objective">{{ objective }}</li></ul><button class="challenge-policy-link" @click="managePolicy">管理安全策略 <span>→</span></button></section>
        <RouterLink class="lab-learning-link" to="/learn">查看相关知识提示 <span>→</span></RouterLink>
      </aside>

      <section class="lab-scene-panel panel-surface">
        <div class="lab-scene-toolbar"><div class="scene-toolbar-title"><strong>{{ scenario.shortName }}</strong><small>{{ simulationStore.status === 'running' ? '仿真运行中' : simulationStore.status === 'completed' ? '仿真已完成' : '教学型网络场景' }}</small></div><div class="scene-legend"><span><i class="legend-normal"></i>正常</span><span><i class="legend-risk"></i>受影响</span><span><i class="legend-protected"></i>防护</span><span><i class="legend-isolated"></i>隔离</span></div><div class="scene-toolbar-actions"><button class="scene-toolbar-button scene-drawer-button" @click="leftDrawerOpen = !leftDrawerOpen">{{ leftDrawerOpen ? '收起实验栏' : '实验控制' }}</button><button class="scene-toolbar-button scene-drawer-button" @click="toggleRightPanel">{{ rightDrawerOpen ? '收起侧栏' : '事件 / 策略' }}</button><button v-if="settingsStore.presentationMode && !focusTopology && !presentationEventPanelOpen" class="scene-toolbar-button" @click="toggleRightPanel">查看事件</button><button class="scene-toolbar-button" @click="resetTopologyView">重置视图</button><button class="scene-toolbar-button scene-focus-button" @click="toggleTopologyFocus">{{ focusTopology ? '退出聚焦' : '聚焦拓扑' }}</button></div></div>
        <div class="lab-scene-canvas"><NetworkScene :scenario="scenario" :statuses="statuses" :events="simulationStore.result?.events ?? []" :active-index="simulationStore.cursor" :selected-node-id="scenarioStore.selectedNodeId" :show-labels="true" :compact-labels="true" :model-scale="1.1" :fit-request="topologyFitRequest" :focus-mode="focusTopology" :editable="!settingsStore.presentationMode" @select-node="scenarioStore.selectNode" @move-node="onMoveNode" /><div v-if="!settingsStore.presentationMode" class="scene-hint">拖动旋转 · 滚轮缩放 · 点击设备查看信息</div><div v-if="!simulationStore.result" class="scene-empty-overlay"><span class="empty-orbit">⌁</span><strong>等待开始仿真</strong><small>事件路径将按当前拓扑与安全策略计算</small></div></div>
        <div class="scene-bottom-status"><span><i :class="'status-' + (simulationStore.status === 'running' ? 'running' : simulationStore.status)"></i>{{ simulationStore.status === 'running' ? '仿真运行中' : simulationStore.status === 'completed' ? '仿真已完成' : simulationStore.status === 'paused' ? '仿真已暂停' : '待运行' }}</span><span>当前设备：{{ selectedNode ? displayNodeName(selectedNode.name) : '点击设备查看信息' }}</span><span>教学型抽象仿真 · 不执行真实网络通信</span></div>
      </section>

      <aside class="lab-right-panel">
        <button v-if="settingsStore.presentationMode" class="presentation-event-close" aria-label="关闭事件详情" @click="closePresentationEventPanel">×</button>
        <div class="right-panel-tabs"><button :class="{ active: rightTab === 'event' }" @click="rightTab = 'event'">当前事件</button><button :class="{ active: rightTab === 'node' }" @click="rightTab = 'node'">节点信息</button><button :class="{ active: rightTab === 'policy' }" @click="rightTab = 'policy'">安全策略</button></div>

        <section v-if="rightTab === 'node'" class="node-inspector panel-surface">
          <div class="lab-panel-title"><div><h2>节点信息</h2></div><span v-if="selectedNode" class="node-status-pill" :class="'pill-' + displayStatus(selectedNode.id)">{{ stateLabel(displayStatus(selectedNode.id)) }}</span></div>
          <template v-if="selectedNode">
            <div class="node-identity"><span class="node-type-icon">{{ selectedNode.type === 'Database' ? '▤' : selectedNode.type === 'Server' ? '▣' : selectedNode.type === 'Firewall' ? '⛨' : selectedNode.type === 'Workstation' ? '▤' : '⌁' }}</span><div><strong>{{ displayNodeName(selectedNode.name) }}</strong><small>{{ nodeTypeLabel(selectedNode.type) }} · {{ zoneLabel(selectedNode.zone) }}</small></div></div>
            <div class="node-properties"><div><span>IP 地址</span><strong>{{ selectedNode.ip }}</strong></div><div><span>网络区域</span><strong>{{ zoneLabel(selectedNode.zone) }}</strong></div><div><span>关键资产</span><strong>{{ selectedNode.isCritical ? '是' : '否' }}</strong></div><div><span>提供服务</span><strong>{{ selectedNode.services?.join(' / ') || 'INTERNAL' }}</strong></div></div>
            <label class="node-edit-field"><span>节点名称</span><input :value="selectedNode.name" @change="scenarioStore.updateNode(selectedNode.id, { name: ($event.target as HTMLInputElement).value })" /></label>
            <label class="node-edit-field"><span>所属区域</span><select :value="selectedNode.zone" @change="scenarioStore.updateNode(selectedNode.id, { zone: ($event.target as HTMLSelectElement).value as NetworkZone })"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option></select></label>
            <div v-if="['Workstation', 'Server'].includes(selectedNode.type)" class="protection-card"><div><span class="protection-shield">⛨</span><span><strong>终端防护</strong><small>教学仿真参数，用于表示终端存在有效安全防护。</small></span></div><el-switch :model-value="selectedNode.protectionEnabled" @change="toggleProtection" /></div>
            <div class="critical-toggle"><span><strong>关键资产</strong><small>关键状态标识与统计口径</small></span><el-switch :model-value="selectedNode.isCritical" @change="toggleCritical" /></div>
            <div class="critical-toggle"><span><strong>节点隔离</strong><small>隔离后无法参与通信，也会影响业务可达性。</small></span><el-switch :model-value="Boolean(selectedNode.isolationEnabled || selectedNode.status === 'isolated')" @change="toggleIsolation" /></div>
            <div v-if="currentEvent && (currentEvent.sourceId === selectedNode.id || currentEvent.targetId === selectedNode.id)" class="node-related-event"><span class="section-kicker">当前关联事件 · {{ formatTimestamp(currentEvent.stepIndex) }}</span><strong>{{ displayText(currentEvent.message) }}</strong><p>{{ displayText(currentEvent.reason) }}</p><small v-if="currentEvent.matchedRuleName">匹配规则：{{ currentEvent.matchedRuleName }}</small></div>
          </template>
          <div v-else class="lab-empty-state"><strong>选择一个节点</strong><p>点击三维场景中的设备查看属性。</p></div>
        </section>

        <section v-else-if="rightTab === 'policy'" class="security-policy-summary panel-surface">
          <div class="lab-panel-title"><h2>安全策略</h2><span>{{ scenario.rules.length }} 条规则</span></div>
          <div class="policy-count-grid"><div><strong>{{ enabledRules.length }}</strong><span>当前启用</span></div><div><strong>{{ enabledDenyRules.length }}</strong><span>拒绝规则</span></div><div><strong>{{ enabledAllowRules.length }}</strong><span>允许规则</span></div></div>
          <div v-if="highlightedRule" class="policy-highlight"><span :class="highlightedRule.action === 'DENY' ? 'policy-action-deny' : 'policy-action-allow'">{{ highlightedRule.action === 'DENY' ? '拒绝' : '允许' }}</span><div><strong>{{ highlightedRule.name }}</strong><small>{{ zoneLabel(highlightedRule.sourceZone) }} → {{ zoneLabel(highlightedRule.targetZone) }} · {{ highlightedRule.service }}</small></div></div>
          <p class="policy-summary-note">策略修改后，需要重新运行实验才能验证效果。</p>
          <button class="policy-manage-button" @click="showPolicyDrawer = true">查看全部策略并管理 <span>→</span></button>
        </section>

        <section v-else class="event-inspector panel-surface">
          <div class="lab-panel-title"><div><h2>当前事件</h2></div><span v-if="currentEvent" class="event-time-pill">{{ formatTimestamp(currentEvent.stepIndex) }}</span></div>
          <template v-if="currentEvent">
            <div class="event-explanation-card" :class="'tone-' + eventTone(currentEvent)">
              <span class="event-explanation-result">{{ eventLabel(currentEvent) }}</span>
              <div class="event-explanation-grid">
                <section class="event-explanation-block"><span>发生了什么</span><strong>{{ nodeName(currentEvent.sourceId) }} <i>→</i> {{ nodeName(currentEvent.targetId) }}</strong><small>{{ currentEvent.phase === 'initial' && currentEvent.type === 'seed' ? '实验开始前已处于受影响状态' : `服务 ${currentEvent.service}` }}</small></section>
                <section class="event-explanation-block"><span>经过哪里</span><div class="event-route-chips"><template v-if="currentEvent.route.length"><template v-for="(nodeId, index) in currentEvent.route" :key="nodeId"><i v-if="index" class="route-chip-arrow">›</i><b>{{ nodeName(nodeId) }}</b></template></template><small v-else>没有可用路径</small></div></section>
                <section class="event-explanation-block"><span>为什么</span><strong v-if="currentEvent.matchedRuleName">{{ currentEvent.matchedRuleName }}</strong><small v-if="currentEvent.matchedRuleName">{{ currentEvent.result === 'block' ? '命中拒绝规则' : '命中允许规则' }} · {{ currentEvent.service }}</small><strong v-else>{{ displayText(currentEvent.reason) }}</strong><small v-if="currentEvent.blockedAt">判定位置：{{ displayText(currentEvent.blockedAt) }}</small></section>
                <section class="event-explanation-block event-outcome-block"><span>结果</span><strong>{{ currentEvent.result === 'block' ? '已阻断' : currentEvent.result === 'compromise' ? '目标节点受到影响' : currentEvent.result === 'allow' ? '允许访问' : currentEvent.phase === 'initial' ? '初始状态已载入' : '状态未变化' }}</strong><small v-if="currentEvent.stateBefore || currentEvent.stateAfter">{{ currentEvent.stateBefore ? stateLabel(currentEvent.stateBefore) : '—' }} → {{ currentEvent.stateAfter ? stateLabel(currentEvent.stateAfter) : '—' }}</small></section>
              </div>
              <div v-if="currentEvent.phase !== 'initial'" class="event-decision-chain"><span class="decision-chain-title">判定链</span><div v-for="item in decisionChain" :key="item.label" class="decision-chain-item" :class="'chain-' + item.state"><i>{{ item.state === 'pass' ? '✓' : item.state === 'fail' ? '×' : '·' }}</i><span>{{ item.label }}</span><b>{{ item.value }}</b></div></div>
              <p class="event-explanation-message">{{ displayText(currentEvent.reason) }}</p>
            </div>
          </template>
          <div v-else class="lab-empty-state"><strong>等待仿真事件</strong><p>开始仿真后，当前事件的真实路径与策略判断会显示在这里。</p></div>
          <button class="event-open-timeline" @click="eventMode = 'all'">在下方时间线查看事件过程 <span>↓</span></button>
        </section>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="showPolicyDrawer" class="policy-drawer-backdrop" @click.self="showPolicyDrawer = false">
        <section class="policy-drawer" role="dialog" aria-modal="true" aria-labelledby="policy-drawer-title">
          <header class="policy-drawer-header"><div><span>规则会参与下一轮仿真计算</span><h2 id="policy-drawer-title">安全策略管理</h2></div><button aria-label="关闭策略管理" @click="showPolicyDrawer = false">×</button></header>
          <div class="policy-drawer-counts"><span>启用 <b>{{ enabledRules.length }}</b></span><span>拒绝 <b>{{ enabledDenyRules.length }}</b></span><span>允许 <b>{{ enabledAllowRules.length }}</b></span></div>
          <p class="rule-priority-note">匹配范围更具体的规则优先；范围相同时拒绝优先。没有匹配规则时，服务路径可达即默认允许。</p>
          <button class="small-add-button" @click="showRuleForm = !showRuleForm">{{ showRuleForm ? '取消新增' : '+ 新增规则' }}</button>
          <div v-if="showRuleForm" class="rule-editor">
            <label>规则名称<input v-model="ruleDraft.name" maxlength="40" placeholder="输入规则名称" /></label>
            <div class="rule-editor-grid"><label>来源区域<select v-model="ruleDraft.sourceZone"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option><option value="ANY">任意</option></select></label><label>目标区域<select v-model="ruleDraft.targetZone"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option><option value="ANY">任意</option></select></label></div>
            <div class="rule-editor-grid"><label>服务<select v-model="ruleDraft.service"><option v-for="service in SERVICE_TYPES" :key="service" :value="service">{{ service }}</option></select></label><label>动作<select v-model="ruleDraft.action"><option value="ALLOW">允许</option><option value="DENY">拒绝</option></select></label></div>
            <button class="rule-save-button" @click="addRule">保存规则</button>
          </div>
          <div class="security-rule-list"><div v-for="rule in scenario.rules" :key="rule.id" class="security-rule-row"><span class="rule-action-pill" :class="rule.action.toLowerCase()">{{ rule.action === 'ALLOW' ? '允许' : '拒绝' }}</span><div class="security-rule-copy"><strong>{{ rule.name }}</strong><small>{{ zoneLabel(rule.sourceZone) }} → {{ zoneLabel(rule.targetZone) }} · {{ rule.service }}</small></div><el-switch :model-value="rule.enabled" size="small" :aria-label="'启用规则 ' + rule.name" @change="scenarioStore.updateRule(rule.id, { enabled: Boolean($event) })" /><button class="rule-delete-button" :aria-label="'删除规则 ' + rule.name" @click="scenarioStore.removeRule(rule.id)">删除</button></div><div v-if="!scenario.rules.length" class="rule-list-empty">当前没有规则，服务路径可达时按默认允许处理。</div></div>
          <footer class="policy-drawer-footer">策略变更不会改写已完成结果。关闭后重新运行实验以验证。</footer>
        </section>
      </div>
    </Teleport>

    <section v-if="completedResult" class="lab-completion-card panel-surface">
      <div class="completion-heading"><span class="completion-check">✓</span><div><h2>实验结果</h2></div><span class="completion-badge">本轮计算完成</span></div>
      <div class="completion-metrics">
        <div><span>受影响节点</span><strong>{{ completedResult.metrics.affectedNodes }} <small>/ {{ completedResult.metrics.totalNodes }}</small></strong></div>
        <div><span>传播步骤</span><strong>{{ completedResult.metrics.propagationSteps }}</strong></div>
        <div class="completion-asset" :class="completedResult.compromisedNodeIds.includes(primaryAssetId) ? 'asset-risk' : 'asset-safe'"><span>{{ primaryAssetName }}</span><strong>{{ completedResult.compromisedNodeIds.includes(primaryAssetId) ? '受到影响' : '安全' }}</strong></div>
        <div><span>业务可达率</span><strong>{{ completedResult.metrics.businessReachability }}<small>%</small></strong></div>
      </div>
      <div class="completion-actions"><span>结果来自当前场景的实际仿真计算。</span><div><RouterLink to="/compare">查看方案对比 →</RouterLink><button @click="managePolicy">重新配置策略</button><RouterLink to="/analysis">查看实验分析 →</RouterLink></div></div>
    </section>

    <section class="simulation-controls panel-surface" :class="{ 'simulation-controls-focus': focusTopology }">
      <div class="timeline-heading"><div><strong>仿真时间线</strong><small>{{ eventMode === 'key' ? '关键事件' : '全部事件' }} · {{ simulationStore.result ? `${visibleEvents.length} 个` : '运行后可回看事件状态' }}</small></div><div v-if="currentEvent" class="timeline-current-event"><b>{{ formatTimestamp(currentEvent.stepIndex) }}</b><span>{{ displayText(currentEvent.message) }}</span></div><span v-else class="timeline-current-event muted">尚未开始</span><button class="timeline-mode-button" @click="eventMode = eventMode === 'key' ? 'all' : 'key'">{{ eventMode === 'key' ? '查看全部事件' : '仅看关键事件' }}</button></div>
      <div class="timeline-rail"><input class="timeline-range" type="range" min="0" :max="Math.max(0, visibleEvents.length - 1)" :value="Math.max(0, visibleEvents.findIndex(event => events.indexOf(event) === simulationStore.cursor))" :disabled="!visibleEvents.length" aria-label="仿真事件时间线" @input="onTimelineInput" /><div class="timeline-markers"><button v-for="(event, index) in visibleEvents" :key="event.id" :class="['marker-' + eventTone(event), { active: events.indexOf(event) === simulationStore.cursor }]" :style="{ left: visibleEvents.length < 2 ? '0%' : `${index / (visibleEvents.length - 1) * 100}%` }" :title="`${formatTimestamp(event.stepIndex)} · ${event.message}`" @click="seek(events.indexOf(event))"></button></div></div>
      <div class="simulation-control-row"><div class="simulation-buttons"><button class="control-button primary" :disabled="simulationStore.status === 'running'" @click="runSimulation"><span>▶</span> 开始仿真</button><button class="control-button" :disabled="simulationStore.status !== 'running'" @click="simulationStore.pause()">Ⅱ 暂停</button><button class="control-button" :disabled="!simulationStore.result || simulationStore.status === 'running' || simulationStore.status === 'completed'" @click="simulationStore.resume()">▶ 继续</button><button v-if="!settingsStore.presentationMode" class="control-button" @click="simulationStore.step()">单步</button><button v-if="!settingsStore.presentationMode" class="control-button" @click="simulationStore.reset()">重置</button><button v-if="!settingsStore.presentationMode" class="control-button" @click="simulationStore.runToEnd()">运行到结束</button></div><div v-if="!settingsStore.presentationMode" class="simulation-speed"><span>速度</span><button v-for="speed in ([1, 2, 4] as const)" :key="speed" :class="{ active: simulationStore.speed === speed }" @click="simulationStore.setSpeed(speed)">×{{ speed }}</button></div></div>
      <div v-if="!settingsStore.presentationMode" class="lab-disclaimer">本系统采用教学型抽象网络安全仿真模型，用于展示网络拓扑、安全策略和事件传播关系，不等同于真实网络攻击或风险预测。</div>
    </section>
  </div>
</template>

<style scoped>
.strategy-lab { min-height: calc(100vh - 70px); padding-bottom: 24px; }
.lab-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:5px 0 13px; }
.lab-heading h1 { margin:7px 0 0; color:#dce8eb; font-size:23px; font-weight:600; }
.lab-heading-actions { display:flex; align-items:center; gap:12px; }
.challenge-actions .challenge-policy-link { min-width:0; padding:0 5px; white-space:nowrap; }
.challenge-actions .challenge-run-button { width:100%; min-width:0; margin:0; padding:0 6px; gap:5px; font-size:11px; white-space:nowrap; }
.page-scenario-select { width:240px; }
.lab-utility-button { padding:6px 8px; border:1px solid rgba(125,164,179,.15); border-radius:4px; color:#839aa3; background:rgba(39,66,80,.12); font-size:7px; white-space:nowrap; cursor:pointer; }.lab-utility-button:hover { color:#b2d5d5; border-color:rgba(107,187,186,.27); }.hidden-file-input { display:none; }
.lab-model-tag { display:flex; align-items:center; gap:7px; color:#87c8b4; font-size:9px; white-space:nowrap; }
.lab-model-tag i,.scene-live-dot { width:6px; height:6px; border-radius:50%; background:#66c5a7; box-shadow:0 0 9px #66c5a7; }
.strategy-stale-banner { min-height:48px; margin-bottom:12px; padding:7px 12px; display:flex; align-items:center; gap:10px; border:1px solid rgba(211,170,91,.24); border-radius:7px; background:rgba(121,88,35,.1); color:#d8ba78; }
.strategy-stale-banner>span { font-size:18px; }.strategy-stale-banner div { flex:1; display:flex; flex-direction:column; gap:3px; }.strategy-stale-banner strong { font-size:10px; font-weight:600; }.strategy-stale-banner small { color:#9d8c68; font-size:8px; }.strategy-stale-banner button { padding:7px 10px; border:1px solid rgba(211,170,91,.25); border-radius:5px; color:#e1c57e; background:rgba(180,139,62,.1); font-size:9px; cursor:pointer; }
.strategy-workspace { display:grid; grid-template-columns:236px minmax(420px,1fr) 305px; gap:10px; align-items:stretch; }
.lab-left-panel,.node-inspector,.security-policy-panel,.lab-scene-panel,.simulation-controls { border:1px solid rgba(129,165,183,.15); border-radius:8px; background:linear-gradient(145deg,rgba(17,33,46,.94),rgba(11,23,34,.97)); }
.lab-left-panel { min-height:610px; overflow:hidden; display:flex; flex-direction:column; }
.lab-panel-title { min-height:49px; padding:8px 11px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(141,174,191,.1); }
.section-kicker { color:#668c9a; font:7px 'DM Mono',monospace; letter-spacing:.1em; }.lab-panel-title h2 { margin:4px 0 0; color:#cbd9dd; font-size:11px; font-weight:600; }.lab-panel-count { color:#718997; font:7px 'DM Mono',monospace; }
.scenario-summary-card { padding:11px 12px 9px; border-bottom:1px solid rgba(141,174,191,.1); }.scenario-summary-card>strong { margin-top:7px; display:block; color:#c9d8dc; font-size:10px; }.scenario-summary-card p { margin:6px 0 8px; color:#7f949f; font-size:8px; line-height:1.55; }.scenario-summary-card>div { display:flex; gap:12px; color:#718995; font:7px 'DM Mono',monospace; }
.initial-condition { margin:8px 9px 1px; padding:8px; display:flex; gap:7px; border:1px solid rgba(221,128,106,.17); border-radius:6px; background:rgba(159,74,61,.07); }.condition-icon { width:14px; height:14px; flex:0 0 auto; display:grid; place-items:center; border:1px solid rgba(226,134,111,.35); border-radius:50%; color:#e69a82; font:8px 'DM Mono',monospace; }.initial-condition strong { color:#d9a18d; font-size:8px; }.initial-condition p { margin:3px 0 0; color:#9a847e; font-size:7px; line-height:1.45; }
.lab-tabs { margin-top:7px; padding:0 8px; display:flex; gap:2px; border-bottom:1px solid rgba(141,174,191,.1); }.lab-tabs button { min-height:32px; padding:0 7px; border:0; border-bottom:2px solid transparent; color:#7f949e; background:transparent; font-size:8px; cursor:pointer; }.lab-tabs button.active { border-bottom-color:#70c6c2; color:#a4d9d6; }.lab-tabs b { margin-left:3px; color:#769da7; font:7px 'DM Mono',monospace; }
.lab-event-pane,.lab-device-pane,.challenge-panel { min-height:0; max-height:440px; overflow:auto; }.event-filters { padding:7px 9px; display:flex; gap:4px; }.event-filters button { padding:4px 7px; border:1px solid transparent; border-radius:4px; color:#718691; background:transparent; font-size:7px; cursor:pointer; }.event-filters button.active { border-color:rgba(106,183,189,.2); color:#a4d5d4; background:rgba(76,149,157,.09); }
.lab-event-row { width:100%; padding:8px 9px; display:flex; align-items:flex-start; gap:6px; border:0; border-left:2px solid transparent; border-bottom:1px solid rgba(141,174,191,.07); color:inherit; text-align:left; background:transparent; cursor:pointer; }.lab-event-row:hover,.lab-event-row.selected { background:rgba(71,120,138,.09); }.lab-event-row.event-risk { border-left-color:rgba(226,113,103,.42); }.lab-event-row.event-blocked { border-left-color:rgba(91,197,155,.42); }.lab-event-step { padding-top:1px; color:#78929f; font:7px 'DM Mono',monospace; }.lab-event-row>i { width:6px; height:6px; margin-top:3px; flex:0 0 auto; border-radius:50%; background:#7cabb7; }.event-risk>i { background:#e87970; box-shadow:0 0 7px rgba(232,121,112,.55); }.event-blocked>i { background:#66c8a0; }.lab-event-row>div { min-width:0; flex:1; }.lab-event-row strong { display:block; overflow:hidden; color:#b9cbd0; font-size:7px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }.lab-event-row strong small { color:#61838f; }.lab-event-row p { margin:4px 0; color:#80939d; font-size:7px; line-height:1.45; }.lab-event-meta { display:block; color:#687e89; font:6px 'DM Mono',monospace; }.event-row-index { color:#526976; font:7px 'DM Mono',monospace; }
.lab-empty-state { min-height:130px; padding:18px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }.lab-empty-state>span { color:#6eaeb4; font-size:20px; }.lab-empty-state strong { margin-top:7px; color:#aebfc5; font-size:9px; }.lab-empty-state p { max-width:175px; margin:5px 0 0; color:#718590; font-size:7px; line-height:1.6; }
.lab-device-row { width:100%; min-height:39px; padding:5px 10px; display:flex; align-items:center; gap:7px; border:0; border-bottom:1px solid rgba(141,174,191,.06); color:inherit; text-align:left; background:transparent; cursor:pointer; }.lab-device-row:hover,.lab-device-row.selected { background:rgba(75,142,157,.11); }.device-state-dot { width:6px; height:6px; flex:0 0 auto; border-radius:50%; background:#58baca; }.device-state-dot.status-compromised { background:#e87870; }.device-state-dot.status-isolated { background:#75828e; }.device-state-dot.status-protected { background:#69c7a5; }.device-state-dot.status-warning { background:#e6ba62; }.lab-device-row>span { min-width:0; flex:1; }.lab-device-row strong,.lab-device-row small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.lab-device-row strong { color:#adbec4; font-size:8px; font-weight:500; }.lab-device-row small { margin-top:3px; color:#718691; font:6px 'DM Mono',monospace; }.lab-device-row em { color:#758b95; font-size:6px; font-style:normal; }.entity-section-heading { min-height:28px; padding:7px 12px 4px; display:flex; align-items:center; justify-content:space-between; color:#78909c; font-size:8px; }.entity-section-heading span { color:#617988; font:7px 'DM Mono',monospace; }.edge-section-heading { margin-top:3px; border-top:1px solid rgba(141,174,191,.09); }.edge-row { min-height:42px; padding:5px 11px; display:flex; align-items:center; gap:6px; border-bottom:1px solid rgba(141,174,191,.065); }.edge-row-copy { min-width:0; flex:1; }.edge-row-copy strong { display:block; overflow:hidden; color:#aebfc5; font-size:7px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }.edge-row-copy small { margin-top:3px; display:block; color:#6f8591; font:7px 'DM Mono',monospace; }
.challenge-panel { padding:16px 13px; }.challenge-title-mark { width:30px; height:30px; margin-bottom:10px; display:grid; place-items:center; border:1px solid rgba(106,191,188,.25); border-radius:9px; color:#8bd1ca; background:rgba(66,151,152,.1); font-size:17px; }.challenge-panel h3 { margin:5px 0 7px; color:#d4e2e4; font-size:13px; }.challenge-panel>p { margin:0; color:#879aa3; font-size:8px; line-height:1.65; }.challenge-goal { margin-top:13px; padding:10px; border:1px solid rgba(121,171,181,.13); border-radius:6px; background:rgba(43,84,99,.07); }.challenge-goal strong { color:#a9c7cb; font-size:8px; }.challenge-goal ul { margin:7px 0 0; padding-left:15px; color:#8298a2; font-size:7px; line-height:1.9; }.challenge-run-button { width:100%; min-height:33px; margin-top:12px; justify-content:center; font-size:9px; }.challenge-verdict { margin-top:10px; padding:8px; display:flex; align-items:center; gap:7px; border-radius:5px; }.challenge-verdict.passed { border:1px solid rgba(89,191,148,.23); color:#75c9a6; background:rgba(64,144,110,.1); }.challenge-verdict.failed { border:1px solid rgba(223,158,84,.2); color:#dbb772; background:rgba(166,119,52,.09); }.challenge-verdict i { width:16px; height:16px; flex:0 0 auto; display:grid; place-items:center; border:1px solid currentColor; border-radius:50%; font-style:normal; font-size:9px; }.challenge-verdict strong { font-size:7px; line-height:1.5; }.challenge-check-list { margin-top:8px; }.challenge-check-list>div { min-height:28px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(141,174,191,.07); color:#8ea1a9; font-size:7px; }.challenge-check-list b { color:#e09b80; font-size:7px; font-weight:500; }.challenge-check-list b.pass { color:#70c9a6; }.challenge-metrics { margin-top:8px; display:flex; justify-content:space-between; color:#778d98; font-size:6px; }.challenge-metrics b { color:#bad0d2; font:8px 'DM Mono',monospace; }.challenge-hint { margin-top:10px; color:#758b96; font-size:7px; line-height:1.6; }
.lab-scene-panel { min-width:0; min-height:610px; display:flex; flex-direction:column; overflow:hidden; }.lab-scene-toolbar { min-height:45px; padding:0 11px; display:flex; align-items:center; gap:13px; border-bottom:1px solid rgba(141,174,191,.1); }.lab-scene-toolbar>div:first-child { display:flex; align-items:center; gap:7px; }.lab-scene-toolbar strong { color:#c0d1d5; font-size:9px; }.lab-scene-toolbar small { color:#728994; font-size:7px; }.scene-legend { margin-left:auto; display:flex; gap:10px; }.scene-legend span { display:flex; align-items:center; gap:4px; color:#8499a1; font-size:7px; }.scene-legend i { width:5px; height:5px; border-radius:50%; }.legend-normal { background:#61bdce; }.legend-risk { background:#e87770; }.legend-protected { background:#68c79e; }.legend-isolated { background:#77838e; }.scene-reset-view { padding:5px 7px; border:1px solid rgba(125,164,179,.15); border-radius:4px; color:#8198a2; background:rgba(39,66,80,.12); font-size:7px; cursor:pointer; }.lab-scene-canvas { min-height:500px; flex:1; position:relative; background:radial-gradient(ellipse at 50% 43%,rgba(28,62,76,.38),rgba(10,20,30,.23) 65%); }.lab-scene-canvas :deep(.network-scene) { height:100%; min-height:500px; }.scene-hint { position:absolute; left:11px; bottom:10px; z-index:2; color:#718994; font-size:7px; pointer-events:none; }.scene-hint span { color:#83bfc1; }.scene-empty-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(180deg,rgba(9,19,29,.08),rgba(9,19,29,.24)); pointer-events:none; }.empty-orbit { width:48px; height:48px; display:grid; place-items:center; border:1px solid rgba(102,191,192,.22); border-radius:16px; color:#7ac3c4; background:rgba(44,109,119,.08); font-size:25px; }.scene-empty-overlay strong { margin-top:12px; color:#b5c9ce; font-size:10px; font-weight:500; }.scene-empty-overlay small { margin-top:5px; color:#718893; font-size:7px; }.scene-bottom-status { min-height:30px; padding:0 10px; display:flex; align-items:center; justify-content:space-between; gap:6px; border-top:1px solid rgba(141,174,191,.09); color:#768c96; font-size:7px; }.scene-bottom-status>span:first-child { display:flex; align-items:center; gap:5px; }.scene-bottom-status i { width:5px; height:5px; border-radius:50%; background:#6e9aa5; }.scene-bottom-status i.status-running { background:#66c8a3; box-shadow:0 0 7px #66c8a3; }.scene-bottom-status i.status-completed { background:#6bc5a3; }.scene-bottom-status i.status-paused { background:#d6b566; }
.lab-right-panel { display:flex; flex-direction:column; gap:9px; }.node-inspector,.security-policy-panel { overflow:hidden; }.node-identity { padding:11px; display:flex; align-items:center; gap:8px; }.node-type-icon { width:30px; height:30px; display:grid; place-items:center; border:1px solid rgba(110,178,190,.2); border-radius:8px; color:#8bcbd0; background:rgba(54,125,139,.1); font-size:15px; }.node-identity strong,.node-identity small { display:block; }.node-identity strong { color:#d0dfe1; font-size:9px; }.node-identity small { margin-top:4px; color:#728995; font-size:7px; }.node-properties { padding:0 11px 8px; }.node-properties>div { min-height:27px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(141,174,191,.07); }.node-properties span,.node-properties strong { color:#7d929c; font-size:7px; }.node-properties strong { color:#aebfc4; font:7px 'DM Mono',monospace; }.node-edit-field { min-height:37px; padding:5px 11px; display:flex; align-items:center; justify-content:space-between; gap:8px; color:#81959e; font-size:7px; }.node-edit-field input,.node-edit-field select,.rule-editor input,.rule-editor select { min-width:0; height:25px; padding:0 6px; border:1px solid rgba(125,165,179,.17); border-radius:4px; outline:none; color:#b9cbd0; background:#10212e; font-size:7px; }.node-edit-field input { width:155px; }.node-edit-field select { width:155px; }.protection-card,.critical-toggle { min-height:47px; padding:7px 10px; display:flex; align-items:center; justify-content:space-between; gap:7px; border-top:1px solid rgba(141,174,191,.08); }.protection-card>div { display:flex; align-items:center; gap:7px; }.protection-shield { color:#71c8a5; font-size:14px; }.protection-card strong,.protection-card small,.critical-toggle strong,.critical-toggle small { display:block; }.protection-card strong,.critical-toggle strong { color:#b7c9ce; font-size:7px; font-weight:500; }.protection-card small,.critical-toggle small { max-width:195px; margin-top:3px; color:#708691; font-size:6px; line-height:1.4; }.node-related-event { margin:8px 10px 10px; padding:8px; border:1px solid rgba(122,175,183,.14); border-radius:5px; background:rgba(59,111,121,.07); }.node-related-event>strong { margin-top:5px; display:block; color:#abc0c5; font-size:7px; line-height:1.5; }.node-related-event p,.node-related-event small { margin:4px 0 0; display:block; color:#7f969e; font-size:6px; line-height:1.5; }.node-status-pill { padding:3px 6px; border:1px solid rgba(97,174,189,.16); border-radius:10px; color:#74becb; font-size:6px; }.pill-compromised { color:#e37d72; border-color:rgba(224,113,103,.22); }.pill-isolated { color:#8c98a1; }.pill-protected { color:#71cba4; border-color:rgba(101,194,157,.23); }.pill-warning { color:#e4bf6d; }
.small-add-button { padding:5px 7px; border:1px solid rgba(107,183,188,.21); border-radius:4px; color:#8fcac8; background:rgba(76,149,157,.08); font-size:7px; cursor:pointer; }.rule-priority-note { margin:7px 10px; color:#788e98; font-size:6px; line-height:1.55; }.rule-editor { margin:0 9px 8px; padding:8px; display:flex; flex-direction:column; gap:6px; border:1px solid rgba(119,179,186,.16); border-radius:5px; background:rgba(14,32,43,.68); }.rule-editor label { display:flex; flex-direction:column; gap:3px; color:#81959e; font-size:6px; }.rule-editor input,.rule-editor select { width:100%; }.rule-editor-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }.rule-save-button { min-height:25px; border:1px solid rgba(99,193,175,.27); border-radius:4px; color:#a7dace; background:rgba(64,145,126,.11); font-size:7px; cursor:pointer; }.security-rule-list { max-height:220px; overflow:auto; }.security-rule-row { min-height:39px; padding:5px 8px; display:flex; align-items:center; gap:5px; border-top:1px solid rgba(141,174,191,.07); }.rule-action-pill { width:39px; padding:3px 0; flex:0 0 auto; border-radius:3px; color:#77cba7; background:rgba(73,157,122,.1); font:6px 'DM Mono',monospace; text-align:center; }.rule-action-pill.deny { color:#de9981; background:rgba(166,94,76,.1); }.security-rule-copy { min-width:0; flex:1; }.security-rule-copy strong,.security-rule-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.security-rule-copy strong { color:#aebfc4; font-size:6px; font-weight:500; }.security-rule-copy small { margin-top:3px; color:#6f8590; font:6px 'DM Mono',monospace; }.rule-delete-button { width:17px; height:17px; border:0; border-radius:4px; color:#8f7675; background:transparent; font-size:13px; cursor:pointer; }.rule-delete-button:hover { color:#ec9181; background:rgba(174,85,71,.11); }.rule-list-empty { padding:12px; color:#718793; font-size:7px; }.policy-footnote { padding:8px 10px; display:flex; gap:6px; border-top:1px solid rgba(141,174,191,.08); color:#82929a; font-size:6px; line-height:1.5; }.policy-footnote span { width:12px; height:12px; flex:0 0 auto; display:grid; place-items:center; border:1px solid rgba(205,170,96,.28); border-radius:50%; color:#d2b26e; }
.simulation-controls { margin-top:10px; padding:11px 12px 8px; }.timeline-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }.timeline-heading>div:first-child { display:flex; align-items:center; gap:8px; }.timeline-heading strong { color:#becfd3; font-size:9px; }.timeline-heading small { color:#718792; font-size:7px; }.timeline-current-event { min-width:0; max-width:56%; overflow:hidden; color:#8fa5ad; font-size:7px; text-overflow:ellipsis; white-space:nowrap; }.timeline-current-event b { margin-right:7px; color:#81c7c3; font:8px 'DM Mono',monospace; }.timeline-current-event.muted { color:#647a85; }.timeline-rail { height:23px; margin:8px 2px 4px; position:relative; display:flex; align-items:center; }.timeline-range { width:100%; height:3px; position:absolute; z-index:1; appearance:none; border-radius:3px; outline:none; background:linear-gradient(90deg,#367c83,#283a48); }.timeline-range::-webkit-slider-thumb { width:10px; height:10px; appearance:none; border:2px solid #b8e0d9; border-radius:50%; background:#48a99d; box-shadow:0 0 7px rgba(83,202,181,.55); cursor:pointer; }.timeline-markers { position:absolute; inset:0; pointer-events:none; }.timeline-markers button { width:7px; height:7px; padding:0; position:absolute; top:8px; z-index:2; transform:translateX(-50%); border:1px solid #10202c; border-radius:50%; background:#76aeba; pointer-events:auto; cursor:pointer; }.timeline-markers button.marker-risk { background:#e27c72; }.timeline-markers button.marker-blocked { background:#64c8a2; }.timeline-markers button.active { width:11px; height:11px; top:6px; outline:1px solid rgba(134,217,202,.48); }.simulation-control-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }.simulation-buttons { display:flex; flex-wrap:wrap; gap:5px; }.control-button { min-height:27px; padding:0 8px; border:1px solid rgba(122,161,177,.16); border-radius:4px; color:#91a5ad; background:rgba(36,59,72,.15); font-size:7px; cursor:pointer; }.control-button:hover:not(:disabled) { border-color:rgba(107,187,186,.3); color:#badbd9; }.control-button:disabled { opacity:.42; cursor:not-allowed; }.control-button.primary { border-color:rgba(98,191,171,.34); color:#abdfd2; background:rgba(63,145,125,.13); }.simulation-speed { display:flex; align-items:center; gap:3px; color:#708690; font-size:7px; }.simulation-speed button { padding:4px 5px; border:1px solid transparent; border-radius:3px; color:#7f949d; background:transparent; font:7px 'DM Mono',monospace; cursor:pointer; }.simulation-speed button.active { border-color:rgba(101,179,180,.19); color:#a6d5d1; background:rgba(71,147,150,.1); }.simulation-metrics-mini { display:flex; gap:10px; color:#748a94; font-size:6px; }.simulation-metrics-mini b { margin-left:3px; color:#bdcfd2; font:7px 'DM Mono',monospace; }.simulation-metrics-mini .metric-bad { color:#e38175; }.simulation-metrics-mini .metric-good { color:#70c8a4; }.lab-disclaimer { margin-top:7px; color:#627986; font-size:6px; line-height:1.5; text-align:right; }
.challenge-panel-primary { flex:1; padding:15px 12px; border-top:1px solid rgba(141,174,191,.08); background:radial-gradient(ellipse at 10% 0%,rgba(62,139,145,.11),transparent 55%); overflow:auto; }
.challenge-panel-primary { padding:10px 12px 9px; }.strategy-lab .scenario-summary-card p { max-height:4.4em; overflow:hidden; }.strategy-lab .initial-condition { margin-top:6px; padding:6px 8px; }.strategy-lab .initial-condition p { max-height:2.8em; overflow:hidden; }.challenge-panel-primary .challenge-title-mark { margin-bottom:7px; }.challenge-condition-block { margin:5px 0; padding:6px 8px; }.challenge-panel-primary .challenge-goal { margin-top:7px; padding:7px 8px; }.challenge-panel-primary .challenge-policy-link { min-height:27px; }.challenge-panel-primary .challenge-run-button { min-height:32px; }
.challenge-heading-row { display:flex; align-items:center; justify-content:space-between; }.challenge-live-tag { padding:4px 6px; border:1px solid rgba(101,194,163,.18); border-radius:10px; color:#7bc9aa; background:rgba(55,137,106,.08); font-size:7px; }
.challenge-panel-primary .challenge-title-mark { width:32px; height:32px; margin:0 0 11px; box-shadow:0 0 22px rgba(71,171,160,.1); }.challenge-panel-primary h3 { margin:6px 0 11px; font-size:14px; }
.challenge-condition-block { margin:7px 0; padding:8px; border-left:2px solid rgba(224,125,111,.52); background:rgba(149,67,56,.075); }.challenge-condition-block span,.challenge-condition-block strong { display:block; }.challenge-condition-block span { margin-bottom:4px; color:#b27d73; font-size:7px; letter-spacing:.04em; }.challenge-condition-block strong { color:#d8aaa0; font-size:8px; line-height:1.45; font-weight:500; }.challenge-condition-goal { border-left-color:rgba(103,197,163,.62); background:rgba(53,119,101,.08); }.challenge-condition-goal span { color:#78b79e; }.challenge-condition-goal strong { color:#a5d2c2; }
.challenge-panel-primary .challenge-goal { margin-top:9px; padding:9px; }.challenge-panel-primary .challenge-goal li { line-height:1.65; }.challenge-policy-link { width:100%; min-height:30px; margin-top:8px; display:flex; justify-content:space-between; align-items:center; padding:0 9px; border:1px solid rgba(112,178,188,.15); border-radius:5px; color:#94c3c8; background:rgba(50,111,127,.08); font-size:8px; cursor:pointer; }.challenge-policy-link:hover { border-color:rgba(112,208,198,.32); background:rgba(50,132,132,.14); }.challenge-policy-link span { font-size:12px; }.challenge-panel-primary .challenge-run-button { min-height:36px; margin-top:7px; }
.challenge-panel-primary .challenge-check-list { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }.challenge-panel-primary .challenge-check-list>div { min-height:45px; padding:5px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:4px; border:1px solid rgba(141,174,191,.08); border-radius:4px; background:rgba(17,34,45,.3); }.challenge-panel-primary .challenge-check-list>div span { min-height:18px; color:#82969d; font-size:7px; line-height:1.35; }.challenge-panel-primary .challenge-check-list b { font-size:8px; }
.learning-objectives-panel { padding:16px 13px; }.learning-objectives-panel h3 { margin:7px 0 10px; }.learning-objectives-panel ul { margin:0; padding-left:16px; color:#91a5ad; font-size:8px; line-height:1.8; }
.strategy-lab .section-kicker { font-size:8px; }.strategy-lab .lab-panel-title h2 { font-size:12px; }.strategy-lab .scenario-summary-card>strong { font-size:11px; }.strategy-lab .scenario-summary-card p { font-size:9px; }.strategy-lab .scenario-level { font-size:8px; }.strategy-lab .initial-condition strong { font-size:9px; }.strategy-lab .initial-condition p { font-size:8px; }.strategy-lab .challenge-panel-primary>p,.strategy-lab .challenge-panel-primary .challenge-goal li { font-size:8px; }.strategy-lab .challenge-condition-block span { font-size:8px; }.strategy-lab .challenge-condition-block strong { font-size:9px; }.strategy-lab .challenge-hint { font-size:8px; }.strategy-lab .challenge-check-list>div,.strategy-lab .challenge-check-list b { font-size:8px; }.strategy-lab .challenge-metrics { font-size:7px; }.strategy-lab .lab-heading-actions .lab-utility-button { font-size:8px; }.strategy-lab .scene-bottom-status { font-size:8px; }.strategy-lab .timeline-heading strong { font-size:10px; }.strategy-lab .timeline-heading small { font-size:8px; }.strategy-lab .control-button { font-size:8px; }.strategy-lab .simulation-speed { font-size:8px; }.strategy-lab .simulation-speed button { font-size:8px; }.strategy-lab .simulation-metrics-mini { font-size:7px; }.strategy-lab .simulation-metrics-mini b { font-size:8px; }.strategy-lab .lab-disclaimer { font-size:7px; }
.lab-right-panel { min-height:610px; display:flex; flex-direction:column; gap:0; overflow:hidden; border:1px solid rgba(129,165,183,.15); border-radius:8px; background:linear-gradient(145deg,rgba(17,33,46,.94),rgba(11,23,34,.97)); }.right-panel-tabs { min-height:45px; padding:0 10px; display:flex; gap:6px; border-bottom:1px solid rgba(141,174,191,.1); }.right-panel-tabs button { flex:1; position:relative; border:0; color:#8298a2; background:transparent; font-size:9px; cursor:pointer; }.right-panel-tabs button.active { color:#b4dfda; }.right-panel-tabs button.active::after { content:''; height:2px; position:absolute; right:0; bottom:-1px; left:0; background:#68c6be; }.right-panel-tabs small { margin-left:3px; color:#6f8c98; font:7px 'DM Mono',monospace; }
.lab-right-panel .node-inspector,.lab-right-panel .security-policy-panel,.lab-right-panel .event-inspector { min-height:0; flex:1; border:0; border-radius:0; background:transparent; overflow:auto; }.node-list-compact { max-height:210px; overflow:auto; border-top:1px solid rgba(141,174,191,.08); }.lab-right-panel .lab-device-row { min-height:33px; padding-left:11px; padding-right:9px; }.lab-right-panel .lab-device-row strong { font-size:7px; }.lab-right-panel .security-policy-panel { display:flex; flex-direction:column; }.lab-right-panel .security-rule-list { max-height:none; flex:1; }
.event-inspector { display:flex; flex-direction:column; }.event-time-pill { padding:4px 6px; border:1px solid rgba(107,188,184,.17); border-radius:4px; color:#8bc8c1; font:8px 'DM Mono',monospace; }.event-explanation-card { margin:10px; padding:10px; border:1px solid rgba(111,173,181,.16); border-radius:6px; background:rgba(41,89,101,.07); }.event-explanation-card.tone-risk { border-color:rgba(216,113,104,.2); background:rgba(121,54,50,.07); }.event-explanation-card.tone-blocked { border-color:rgba(87,190,148,.23); background:rgba(51,124,94,.08); }.event-explanation-result { padding:4px 6px; display:inline-flex; border:1px solid rgba(113,176,183,.17); border-radius:4px; color:#9abec1; font:7px 'DM Mono',monospace; }.tone-risk .event-explanation-result { color:#e29284; border-color:rgba(224,120,109,.2); }.tone-blocked .event-explanation-result { color:#7ad0a7; border-color:rgba(95,197,151,.24); }.event-explanation-card h3 { margin:9px 0; color:#d0e0e1; font-size:10px; font-weight:600; line-height:1.45; overflow-wrap:anywhere; }.event-explanation-card h3 i { padding:0 3px; color:#6faeb1; font-style:normal; }.event-explanation-service { display:flex; align-items:center; gap:7px; padding:7px 0; border-top:1px solid rgba(141,174,191,.08); border-bottom:1px solid rgba(141,174,191,.08); color:#728a96; font-size:7px; }.event-explanation-service b { margin-right:auto; color:#b8d4d3; font:8px 'DM Mono',monospace; }.event-explanation-service b:last-child { margin-right:0; color:#9ed3bd; }.tone-risk .event-explanation-service b:last-child { color:#e69082; }.tone-blocked .event-explanation-service b:last-child { color:#76d0a5; }.event-explanation-message { margin:8px 0; color:#91a6ac; font-size:8px; line-height:1.5; }
.event-detail-line { margin-top:7px; display:flex; flex-direction:column; gap:3px; }.event-detail-line span,.event-rule-match>span { color:#718b97; font-size:7px; }.event-detail-line strong,.event-rule-match strong { color:#b6c9cd; font-size:7px; line-height:1.5; font-weight:500; overflow-wrap:anywhere; }.event-rule-match { margin-top:8px; padding:7px; border:1px solid rgba(95,192,153,.16); border-radius:4px; background:rgba(50,124,92,.07); }.event-rule-match span,.event-rule-match strong,.event-rule-match small { display:block; }.event-rule-match strong { margin-top:3px; color:#9ecbb8; }.event-rule-match small { margin-top:4px; color:#7a9f91; font:7px 'DM Mono',monospace; }.event-history-heading { min-height:36px; padding:0 10px; display:flex; align-items:center; justify-content:space-between; border-top:1px solid rgba(141,174,191,.09); }.event-history-heading>strong { color:#b3c5cb; font-size:8px; }.event-mode-switch { display:flex; padding:2px; border:1px solid rgba(124,166,180,.12); border-radius:5px; background:rgba(12,25,36,.5); }.event-mode-switch button { padding:4px 6px; border:0; border-radius:3px; color:#718792; background:transparent; font-size:7px; cursor:pointer; }.event-mode-switch button.active { color:#a6d8d2; background:rgba(72,145,145,.16); }.event-mode-caption { padding:0 10px 6px; color:#6f8792; font-size:6px; }.lab-event-list { min-height:100px; flex:1; overflow:auto; }.lab-event-list .lab-event-row { padding-top:7px; padding-bottom:7px; }.event-list-empty { min-height:95px; }
.lab-completion-card { margin-top:10px; padding:12px 14px; border:1px solid rgba(103,187,164,.2); border-radius:8px; background:linear-gradient(105deg,rgba(25,69,64,.2),rgba(13,30,42,.96) 52%); }.completion-heading { display:flex; align-items:center; gap:9px; }.completion-check { width:25px; height:25px; display:grid; place-items:center; border:1px solid rgba(101,199,155,.24); border-radius:7px; color:#8bd2b3; background:rgba(55,145,104,.1); }.completion-heading h2 { margin:3px 0 0; color:#d0e0df; font-size:11px; }.completion-badge { margin-left:auto; padding:4px 7px; border:1px solid rgba(101,199,155,.18); border-radius:4px; color:#81c9a8; font-size:7px; }.completion-metrics { margin:11px 0; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); }.completion-metrics>div { min-height:42px; padding:2px 10px; display:flex; flex-direction:column; justify-content:center; gap:5px; border-left:1px solid rgba(141,174,191,.1); }.completion-metrics>div:first-child { border-left:0; padding-left:0; }.completion-metrics span { color:#7f959e; font-size:7px; }.completion-metrics strong { color:#d0dfdf; font:10px 'DM Mono',monospace; }.completion-metrics strong small { color:#728b96; font-size:7px; }.completion-asset strong { color:#79cba6; }.completion-asset.asset-risk strong { color:#e4897c; }.completion-asset span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.completion-actions { padding-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-top:1px solid rgba(141,174,191,.09); color:#728994; font-size:7px; }.completion-actions>div { display:flex; align-items:center; gap:13px; }.completion-actions a,.completion-actions button { border:0; color:#8bcac6; background:transparent; font-size:7px; text-decoration:none; white-space:nowrap; cursor:pointer; }.completion-actions a:hover,.completion-actions button:hover { color:#b1e1da; }
@media(max-width:1250px) { .strategy-workspace { grid-template-columns:210px minmax(390px,1fr) 275px; gap:8px; }.scene-legend { gap:6px; }.simulation-control-row { flex-wrap:wrap; }.simulation-metrics-mini { margin-left:auto; } }
@media(max-width:1000px) { .strategy-workspace { grid-template-columns:200px minmax(0,1fr); }.lab-right-panel { grid-column:1/-1; display:flex; min-height:450px; }.lab-scene-panel { min-height:520px; }.lab-left-panel { min-height:520px; }.lab-heading { align-items:flex-start; flex-direction:column; }.lab-heading-actions { width:100%; justify-content:space-between; } }

/* Fourth-round layout: experiment first, tools on demand */
.strategy-lab { width:100%; min-height:calc(100vh - 68px); margin:0 auto; padding:20px 0 32px; color:var(--text-primary); }
.lab-heading { margin:0 0 18px; align-items:center; }
.lab-heading h1 { margin:0; color:var(--text-primary); font-size:30px; font-weight:700; }
.heading-subtitle { margin-left:10px; color:var(--text-muted); font-size:15px; font-weight:500; }
.lab-heading-actions { gap:10px; }
.page-scenario-select { width:310px; }
.lab-utility-button { min-height:40px; padding:0 13px; border-color:var(--border); border-radius:7px; color:var(--text-secondary); background:var(--panel-bg); font-size:14px; }
.lab-more-actions { position:relative; }
.lab-utility-popover { width:190px; position:absolute; top:calc(100% + 7px); right:0; z-index:30; padding:6px; border:1px solid var(--border-strong); border-radius:8px; background:var(--panel-bg); box-shadow:0 12px 30px rgba(0,0,0,.2); }
.lab-utility-popover button { width:100%; padding:10px; border:0; border-radius:5px; color:var(--text-secondary); text-align:left; background:transparent; font-size:14px; cursor:pointer; }
.lab-utility-popover button:hover { color:var(--text-primary); background:var(--panel-raised); }
.strategy-stale-banner { min-height:54px; border-color:rgba(207,157,80,.28); color:var(--warning); font-size:14px; }
.strategy-stale-banner strong { font-size:14px; }.strategy-stale-banner small { font-size:12px; }.strategy-stale-banner button { font-size:13px; }
.strategy-workspace { grid-template-columns:224px minmax(0,1fr) 258px; gap:14px; align-items:stretch; }
.lab-left-panel,.node-inspector,.security-policy-panel,.lab-scene-panel,.simulation-controls,.security-policy-summary { border:1px solid var(--border); border-radius:10px; background:var(--panel-bg); }
.lab-left-panel { min-height:570px; padding-bottom:14px; overflow:auto; }
.lab-experiment-intro { padding:18px 18px 14px; border-bottom:1px solid var(--border); }
.lab-experiment-intro > span { color:var(--accent); font-size:13px; font-weight:650; }
.lab-experiment-intro h2 { margin:8px 0 7px; color:var(--text-primary); font-size:19px; line-height:1.4; }
.lab-experiment-intro p { margin:0; color:var(--text-muted); font-size:14px; line-height:1.6; }
.initial-condition { margin:13px 12px 8px; padding:12px; gap:10px; border-color:rgba(217,107,98,.2); border-radius:8px; background:color-mix(in srgb, var(--danger) 7%, var(--panel-bg)); }
.condition-icon { width:21px; height:21px; font-size:13px; }
.initial-condition strong { color:var(--text-primary); font-size:14px; }
.initial-condition p { color:var(--text-secondary); font-size:13px; line-height:1.55; }
.challenge-panel { max-height:none; margin:12px; padding:15px; overflow:visible; border:1px solid color-mix(in srgb, var(--accent) 23%, var(--border)); border-radius:9px; background:color-mix(in srgb, var(--accent) 5%, var(--panel-bg)); }
.challenge-heading-row { margin-bottom:9px; }
.challenge-live-tag { color:var(--accent); font-size:13px; font-weight:650; }
.challenge-panel h3 { margin:7px 0 13px; color:var(--text-primary); font-size:20px; line-height:1.35; }
.challenge-condition-block { margin-top:8px; padding:10px; border-radius:7px; background:color-mix(in srgb, var(--danger) 6%, var(--panel-bg)); }
.challenge-condition-block > span { font-size:12px; }.challenge-condition-block strong { color:var(--text-primary); font-size:14px; line-height:1.5; }
.challenge-condition-goal { background:color-mix(in srgb, var(--accent) 8%, var(--panel-bg)); }
.challenge-condition-goal strong { color:var(--accent); font-size:17px; }
.challenge-goal { margin-top:10px; padding:11px; border:1px solid var(--border); border-radius:7px; background:var(--panel-bg); }
.challenge-goal strong { color:var(--text-primary); font-size:14px; }.challenge-goal li { margin-top:5px; color:var(--text-secondary); font-size:13px; line-height:1.45; }
.challenge-policy-link { margin:11px 0 8px; color:var(--accent); font-size:14px; }
.challenge-run-button { width:100%; min-height:46px; font-size:16px; }
.challenge-hint { margin-top:10px; color:var(--text-muted); font-size:13px; line-height:1.55; }
.challenge-verdict { margin-top:12px; padding:10px; font-size:13px; }.challenge-verdict strong { font-size:13px; line-height:1.5; }
.challenge-check-list { gap:6px; }.challenge-check-list>div { padding:8px; }.challenge-check-list span,.challenge-check-list b { font-size:12px; }
.challenge-metrics { font-size:12px; }
.learning-objectives-panel ul { padding-left:18px; }.learning-objectives-panel li { margin-top:8px; color:var(--text-secondary); font-size:14px; line-height:1.5; }
.lab-learning-link { margin:auto 16px 0; padding:12px 0 0; border-top:1px solid var(--border); color:var(--text-muted); font-size:13px; }.lab-learning-link span { color:var(--accent); }
.lab-scene-panel { min-height:570px; overflow:hidden; display:grid; grid-template-rows:56px minmax(440px,1fr) 38px; }
.lab-scene-toolbar { min-height:56px; padding:0 16px; border-bottom:1px solid var(--border); }
.lab-scene-toolbar strong { color:#dbe8ea; font-size:16px; }.lab-scene-toolbar small { color:#91a7af; font-size:13px; }
.scene-legend { gap:12px; color:#c3d2d6; font-size:12px; }
.lab-scene-canvas { min-height:440px; }
.scene-hint { bottom:14px; left:16px; padding:7px 10px; border-radius:6px; color:#cadadd; background:rgba(5,16,25,.7); font-size:12px; }
.scene-empty-overlay { gap:11px; background:rgba(5,16,25,.3); }.scene-empty-overlay strong { font-size:18px; }.scene-empty-overlay small { font-size:14px; }
.scene-bottom-status { min-height:38px; padding:0 14px; color:#b6c9ce; font-size:12px; }
.lab-right-panel { min-height:570px; max-height:690px; border:1px solid var(--border); border-radius:10px; background:var(--panel-bg); }
.right-panel-tabs { min-height:54px; padding:0 8px; border-bottom:1px solid var(--border); }
.right-panel-tabs button { min-height:54px; padding:0 8px; color:var(--text-muted); font-size:14px; }
.right-panel-tabs button.active { color:var(--accent); border-bottom-color:var(--accent); }
.right-panel-tabs button small { display:none; }
.node-inspector,.security-policy-summary,.event-inspector { flex:1; min-height:0; overflow:auto; border:0; border-radius:0 0 10px 10px; background:transparent; }
.lab-panel-title { min-height:56px; padding:10px 16px; border-bottom:1px solid var(--border); }
.lab-panel-title h2 { color:var(--text-primary); font-size:17px; }
.node-status-pill,.event-time-pill { font-size:12px; }
.node-identity { padding:17px 15px; }.node-identity strong { color:var(--text-primary); font-size:16px; }.node-identity small { color:var(--text-muted); font-size:13px; }
.node-properties { padding:0 15px; }.node-properties>div { min-height:39px; }.node-properties span { color:var(--text-muted); font-size:13px; }.node-properties strong { color:var(--text-secondary); font-size:13px; }
.node-edit-field { margin:12px 15px; font-size:13px; }.node-edit-field input,.node-edit-field select { min-height:38px; padding:7px 9px; color:var(--text-primary); background:var(--panel-raised); border:1px solid var(--border); border-radius:6px; font-size:14px; }
.protection-card,.critical-toggle { margin:10px 12px; padding:12px; border-color:var(--border); border-radius:8px; background:var(--panel-raised); }.protection-card strong,.critical-toggle strong { color:var(--text-primary); font-size:14px; }.protection-card small,.critical-toggle small { color:var(--text-muted); font-size:12px; line-height:1.4; }
.node-related-event { margin:12px; padding:12px; border-color:var(--border); background:var(--panel-raised); }.node-related-event strong { font-size:13px; }.node-related-event p,.node-related-event small { color:var(--text-secondary); font-size:12px; }
.security-policy-summary .lab-panel-title > span { color:var(--text-muted); font-size:13px; }
.policy-count-grid { padding:18px 12px; display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
.policy-count-grid > div { display:flex; flex-direction:column; gap:6px; text-align:center; }
.policy-count-grid strong { color:var(--text-primary); font-size:24px; }.policy-count-grid span { color:var(--text-muted); font-size:12px; }
.policy-highlight { margin:0 12px; padding:13px; display:flex; align-items:flex-start; gap:10px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }
.policy-highlight > span { padding:4px 7px; border-radius:5px; font-size:12px; font-weight:700; }.policy-action-deny { color:var(--danger); background:color-mix(in srgb, var(--danger) 10%, transparent); }.policy-action-allow { color:var(--success); background:color-mix(in srgb, var(--success) 10%, transparent); }
.policy-highlight div { min-width:0; display:flex; flex-direction:column; gap:6px; }.policy-highlight strong { color:var(--text-primary); font-size:14px; line-height:1.4; }.policy-highlight small { color:var(--text-muted); font-size:12px; }
.policy-summary-note { margin:14px 14px; color:var(--text-muted); font-size:13px; line-height:1.5; }
.policy-manage-button { width:calc(100% - 28px); min-height:44px; margin:0 14px; display:flex; align-items:center; justify-content:space-between; padding:0 13px; border:1px solid var(--border); border-radius:7px; color:var(--accent); background:var(--panel-raised); font-size:14px; font-weight:650; cursor:pointer; }
.event-inspector .lab-panel-title { margin-bottom:8px; }
.event-explanation-card { margin:12px; padding:14px; border-radius:8px; background:var(--panel-raised); }
.event-explanation-result { padding:5px 8px; font-size:12px; }
.event-explanation-card h3 { margin:12px 0; color:var(--text-primary); font-size:16px; }
.event-explanation-service { font-size:12px; }.event-explanation-service b { font-size:13px; }
.event-explanation-message { color:var(--text-secondary); font-size:14px; line-height:1.55; }
.event-detail-line { margin-top:11px; gap:5px; }.event-detail-line span,.event-rule-match>span { color:var(--text-muted); font-size:12px; }.event-detail-line strong,.event-rule-match strong { color:var(--text-secondary); font-size:13px; line-height:1.55; }.event-rule-match { padding:10px; border-radius:7px; }.event-rule-match small { font-size:12px; line-height:1.5; }
.event-open-timeline { width:calc(100% - 28px); min-height:42px; margin:0 14px 14px; border:1px solid var(--border); border-radius:7px; color:var(--accent); background:var(--panel-raised); font-size:14px; cursor:pointer; }
.lab-empty-state { min-height:145px; padding:20px; }.lab-empty-state strong { color:var(--text-primary); font-size:16px; }.lab-empty-state p { color:var(--text-muted); font-size:14px; line-height:1.55; }
.lab-completion-card { margin-top:14px; padding:18px 20px; border-color:color-mix(in srgb, var(--success) 28%, var(--border)); border-radius:10px; background:color-mix(in srgb, var(--success) 5%, var(--panel-bg)); }
.completion-heading { gap:12px; }.completion-check { width:34px; height:34px; font-size:17px; }.completion-heading h2 { margin:0; color:var(--text-primary); font-size:20px; }.completion-badge { padding:6px 9px; font-size:12px; }
.completion-metrics { margin:16px 0 10px; grid-template-columns:repeat(4,minmax(0,1fr)); }
.completion-metrics>div { min-height:64px; padding:4px 18px; border-left-color:var(--border); }.completion-metrics>div:first-child { padding-left:0; }
.completion-metrics span { color:var(--text-muted); font-size:14px; }.completion-metrics strong { color:var(--text-primary); font:700 27px 'Microsoft YaHei',sans-serif; }.completion-metrics strong small { color:var(--text-muted); font-size:16px; }.completion-asset strong { color:var(--success); font-size:21px; }.completion-asset.asset-risk strong { color:var(--danger); }
.result-details-toggle { margin:0 0 10px; padding:0; border:0; color:var(--accent); background:transparent; font-size:13px; cursor:pointer; }
.completion-details { display:flex; gap:20px; padding:9px 0 12px; color:var(--text-muted); font-size:13px; }.completion-details b { margin-left:5px; color:var(--text-primary); }
.completion-actions { padding-top:12px; color:var(--text-muted); font-size:13px; }.completion-actions>div { gap:18px; }.completion-actions a,.completion-actions button { color:var(--accent); font-size:14px; }
.simulation-controls { margin-top:14px; padding:15px 18px; border-radius:10px; }
.timeline-heading { min-height:35px; display:flex; align-items:center; gap:16px; }.timeline-heading > div:first-child { display:flex; align-items:baseline; gap:12px; }.timeline-heading strong { color:var(--text-primary); font-size:18px; }.timeline-heading small { color:var(--text-muted); font-size:13px; }
.timeline-current-event { max-width:40%; margin-left:auto; display:flex; gap:9px; color:var(--text-secondary); font-size:13px; }.timeline-current-event b { color:var(--accent); font-size:13px; }.timeline-current-event span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.timeline-current-event.muted { color:var(--text-muted); }
.timeline-mode-button { min-height:36px; padding:0 11px; border:1px solid var(--border); border-radius:6px; color:var(--text-secondary); background:var(--panel-raised); font-size:13px; cursor:pointer; }
.timeline-rail { height:28px; margin:14px 8px 12px; }.timeline-range { top:12px; height:4px; }.timeline-markers { top:0; height:26px; }.timeline-markers button { width:13px; height:13px; top:6px; border:2px solid var(--panel-bg); }
.simulation-control-row { min-height:48px; gap:14px; }.simulation-buttons { gap:8px; }.control-button { min-height:40px; padding:0 13px; border-radius:7px; border-color:var(--border); color:var(--text-secondary); background:var(--panel-raised); font-size:14px; }.control-button.primary { color:#092b2d; border-color:var(--accent); background:#83d2cd; font-size:15px; }
.simulation-speed { gap:6px; color:var(--text-muted); font-size:13px; }.simulation-speed button { min-width:38px; min-height:34px; border-radius:5px; color:var(--text-secondary); font-size:13px; }.simulation-speed button.active { color:var(--text-primary); border-color:var(--accent); }
.lab-disclaimer { margin-top:11px; color:var(--text-muted); font-size:12px; line-height:1.5; }
.policy-drawer-backdrop { position:fixed; inset:0; z-index:150; display:flex; justify-content:flex-end; background:rgba(1,9,15,.55); backdrop-filter:blur(3px); }
.policy-drawer { width:min(560px,92vw); height:100%; padding:22px; display:flex; flex-direction:column; overflow:auto; border-left:1px solid var(--border-strong); color:var(--text-primary); background:var(--panel-bg); box-shadow:-18px 0 48px rgba(0,0,0,.24); }
.policy-drawer-header { display:flex; align-items:center; justify-content:space-between; gap:20px; padding-bottom:18px; border-bottom:1px solid var(--border); }.policy-drawer-header span { color:var(--text-muted); font-size:13px; }.policy-drawer-header h2 { margin:7px 0 0; color:var(--text-primary); font-size:24px; }.policy-drawer-header button { width:40px; height:40px; border:1px solid var(--border); border-radius:8px; color:var(--text-secondary); background:var(--panel-raised); font-size:24px; cursor:pointer; }
.policy-drawer-counts { display:flex; gap:12px; padding:16px 0; }.policy-drawer-counts span { flex:1; padding:12px; display:flex; justify-content:space-between; border:1px solid var(--border); border-radius:7px; color:var(--text-muted); font-size:13px; }.policy-drawer-counts b { color:var(--text-primary); font-size:18px; }
.rule-priority-note { margin:0 0 14px; color:var(--text-muted); font-size:13px; line-height:1.55; }.small-add-button { min-height:40px; padding:0 12px; border-color:var(--border); border-radius:7px; color:var(--accent); background:var(--panel-raised); font-size:14px; }
.rule-editor { margin:12px 0; padding:14px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }.rule-editor label { color:var(--text-secondary); font-size:13px; }.rule-editor input,.rule-editor select { min-height:38px; color:var(--text-primary); border:1px solid var(--border); border-radius:6px; background:var(--panel-bg); font-size:14px; }.rule-editor-grid { gap:10px; }.rule-save-button { min-height:40px; border-radius:6px; color:#092b2d; background:#83d2cd; font-size:14px; }
.security-rule-list { margin-top:12px; overflow:visible; }.security-rule-row { min-height:68px; padding:10px 4px; grid-template-columns:48px minmax(0,1fr) auto 52px; gap:10px; border-bottom:1px solid var(--border); }.rule-action-pill { width:48px; padding:5px; text-align:center; font-size:12px; }.security-rule-copy strong { color:var(--text-primary); font-size:14px; }.security-rule-copy small { color:var(--text-muted); font-size:12px; }.rule-delete-button { width:48px; min-height:32px; color:var(--danger); border:1px solid var(--border); border-radius:5px; background:transparent; font-size:12px; }
.policy-drawer-footer { margin-top:auto; padding-top:14px; color:var(--text-muted); font-size:13px; }
:global(html[data-theme='light']) .strategy-lab .lab-left-panel,
:global(html[data-theme='light']) .strategy-lab .node-inspector,
:global(html[data-theme='light']) .strategy-lab .security-policy-summary,
:global(html[data-theme='light']) .strategy-lab .lab-right-panel,
:global(html[data-theme='light']) .strategy-lab .simulation-controls,
:global(html[data-theme='light']) .strategy-lab .lab-completion-card { color:var(--text-primary); border-color:var(--border); background:#fff; }
:global(html[data-theme='light']) .strategy-lab .lab-scene-panel { border-color:#294654; background:#0a1721; }
:global(html[data-theme='light']) .strategy-lab .lab-scene-toolbar strong { color:#dbe8ea; }
:global(html[data-theme='light']) .strategy-lab .lab-scene-toolbar small,
:global(html[data-theme='light']) .strategy-lab .scene-bottom-status { color:#a8bdc4; }
:global(html[data-theme='light']) .strategy-lab .lab-scene-toolbar { border-color:#294654; }
:global(html[data-theme='light']) .strategy-lab .lab-panel-title { border-color:var(--border); }
:global(html[data-theme='light']) .strategy-lab .lab-experiment-intro h2,
:global(html[data-theme='light']) .strategy-lab .lab-panel-title h2,
:global(html[data-theme='light']) .strategy-lab .node-identity strong,
:global(html[data-theme='light']) .strategy-lab .completion-heading h2 { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .lab-experiment-intro p,
:global(html[data-theme='light']) .strategy-lab .initial-condition p,
:global(html[data-theme='light']) .strategy-lab .challenge-hint,
:global(html[data-theme='light']) .strategy-lab .node-properties span,
:global(html[data-theme='light']) .strategy-lab .node-properties strong { color:var(--text-secondary); }
:global(html[data-theme='light']) .strategy-lab .initial-condition { background:#fff4f1; }
:global(html[data-theme='light']) .strategy-lab .challenge-panel { border-color:#cfe5e2; background:#f6fbfa; }
:global(html[data-theme='light']) .strategy-lab .challenge-condition-block { background:#fff0ed; }
:global(html[data-theme='light']) .strategy-lab .challenge-condition-goal { background:#e8f6f4; }
:global(html[data-theme='light']) .strategy-lab .challenge-condition-block strong,
:global(html[data-theme='light']) .strategy-lab .challenge-goal strong { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .challenge-goal,
:global(html[data-theme='light']) .strategy-lab .protection-card,
:global(html[data-theme='light']) .strategy-lab .critical-toggle,
:global(html[data-theme='light']) .strategy-lab .node-related-event,
:global(html[data-theme='light']) .strategy-lab .policy-highlight,
:global(html[data-theme='light']) .strategy-lab .policy-manage-button { border-color:var(--border); background:#f5f8f9; }
:global(html[data-theme='light']) .strategy-lab .challenge-goal li,
:global(html[data-theme='light']) .strategy-lab .protection-card small,
:global(html[data-theme='light']) .strategy-lab .critical-toggle small { color:var(--text-secondary); }
:global(html[data-theme='light']) .strategy-lab .right-panel-tabs { border-color:var(--border); }
:global(html[data-theme='light']) .strategy-lab .right-panel-tabs button { color:var(--text-muted); }
:global(html[data-theme='light']) .strategy-lab .right-panel-tabs button.active { color:var(--accent); }
:global(html[data-theme='light']) .strategy-lab .event-explanation-card { border-color:var(--border); background:#f4f8f9; }
:global(html[data-theme='light']) .strategy-lab .event-explanation-card h3,
:global(html[data-theme='light']) .strategy-lab .event-detail-line strong { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .event-explanation-message { color:var(--text-secondary); }
:global(html[data-theme='light']) .strategy-lab .event-open-timeline,
:global(html[data-theme='light']) .strategy-lab .timeline-mode-button,
:global(html[data-theme='light']) .strategy-lab .control-button { color:var(--text-secondary); border-color:var(--border); background:#f5f8f9; }
:global(html[data-theme='light']) .strategy-lab .completion-metrics span,
:global(html[data-theme='light']) .strategy-lab .completion-actions { color:var(--text-muted); }
:global(html[data-theme='light']) .strategy-lab .completion-metrics strong { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .policy-drawer { color:var(--text-primary); background:#fff; }
:global(html[data-theme='light']) .strategy-lab .policy-drawer-header h2,
:global(html[data-theme='light']) .strategy-lab .security-rule-copy strong { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .policy-highlight div strong { color:var(--text-primary); }
:global(html[data-theme='light']) .strategy-lab .rule-editor { border-color:var(--border); background:#f5f8f9; }
:global(html[data-theme='light']) .strategy-lab .rule-editor input,
:global(html[data-theme='light']) .strategy-lab .rule-editor select { color:var(--text-primary); background:#fff; }
:global(html[data-theme='light']) .strategy-lab .security-rule-row { border-color:var(--border); }
.presentation-mode .lab-utility-popover,.presentation-mode .scene-hint,.presentation-mode .lab-disclaimer { display:none !important; }
@media(max-width:1450px) { .strategy-workspace { grid-template-columns:214px minmax(0,1fr) 250px; gap:12px; } }
@media(max-width:1220px) { .strategy-workspace { grid-template-columns:200px minmax(0,1fr) 238px; gap:9px; }.lab-heading h1 { font-size:27px; }.page-scenario-select { width:260px; } }
@media(max-width:1000px) { .strategy-workspace { grid-template-columns:1fr; }.lab-left-panel,.lab-right-panel { min-height:auto; max-height:none; }.lab-scene-panel { min-height:560px; }.lab-left-panel { overflow:visible; }.lab-scene-canvas { min-height:460px; }.lab-heading { flex-direction:row; align-items:center; }.completion-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); row-gap:8px; }.timeline-heading { flex-wrap:wrap; }.timeline-current-event { max-width:100%; order:3; margin-left:0; flex-basis:100%; } }
.scene-empty-overlay { inset:auto; top:48px; left:50%; right:auto; bottom:auto; width:max-content; max-width:calc(100% - 24px); padding:8px 12px; flex-direction:row; gap:9px; border:1px solid rgba(109,184,190,.14); border-radius:7px; background:rgba(7,18,28,.78); transform:translateX(-50%); }
.empty-orbit { display:none; }
.scene-empty-overlay strong,.scene-empty-overlay small { margin:0; font-size:12px; }
.scene-empty-overlay small { color:#8199a4; font-size:10px; }
.challenge-panel-primary .challenge-actions { display:flex; flex-direction:column; gap:6px; }
.challenge-panel-primary .challenge-actions > button { width:100%; min-height:32px; margin:0; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
.challenge-panel-primary .challenge-actions .challenge-policy-link { font-size:10px; }
.strategy-workspace { grid-template-columns:minmax(240px,260px) minmax(0,1fr) minmax(260px,290px); gap:12px; }
.lab-scene-toolbar { min-width:0; gap:12px; }
.scene-toolbar-title { min-width:112px; display:flex; flex-direction:column; gap:3px; }
.scene-toolbar-actions { flex:0 0 auto; }
.lab-right-panel { position:relative; }
.presentation-event-close { position:absolute; top:9px; right:9px; z-index:4; width:28px; height:28px; border:1px solid var(--border); border-radius:6px; color:var(--text-secondary); background:var(--panel-bg); font-size:20px; line-height:1; cursor:pointer; }
.strategy-workspace.presentation-layout { grid-template-columns:220px minmax(0,1fr) 232px; }
.strategy-workspace.presentation-layout .lab-left-panel { min-width:0; }
.strategy-workspace.presentation-layout.presentation-right-hidden { grid-template-columns:220px minmax(0,1fr); }
.strategy-workspace.presentation-layout.presentation-right-hidden .lab-right-panel { display:none; }
.strategy-workspace.topology-focused { display:block; }
.strategy-workspace.topology-focused .lab-left-panel,
.strategy-workspace.topology-focused .lab-right-panel { display:none !important; }
.strategy-workspace.topology-focused .lab-scene-panel { min-height:max(650px,calc(100vh - 280px)); }
.strategy-workspace.topology-focused .lab-scene-canvas { min-height:0; }
.simulation-controls-focus { margin-top:8px; padding:9px 13px; }
.simulation-controls-focus .timeline-heading { min-height:28px; }
.simulation-controls-focus .timeline-rail { margin:6px 0 8px; }
.simulation-controls-focus .lab-disclaimer { margin-top:6px; }
@media (min-width:1451px) and (max-width:1599px) {
  .strategy-workspace { grid-template-columns:230px minmax(0,1fr) 250px; gap:10px; }
  .strategy-workspace.presentation-layout { grid-template-columns:210px minmax(0,1fr) 222px; }
  .strategy-workspace.presentation-layout.presentation-right-hidden { grid-template-columns:210px minmax(0,1fr); }
}
@media (max-width:1450px) {
  .strategy-workspace { position:relative; display:block; }
  .lab-scene-panel { min-height:620px; }
  .lab-scene-panel .lab-scene-canvas { min-height:0; }
  .scene-legend { display:none; }
  .scene-drawer-button { display:inline-flex; align-items:center; justify-content:center; }
  .strategy-workspace .lab-left-panel,
  .strategy-workspace .lab-right-panel { position:absolute; top:62px; bottom:12px; z-index:12; min-height:0; max-height:none; margin:0; overflow:auto; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .16s ease,transform .16s ease,visibility .16s ease; }
  .strategy-workspace .lab-left-panel { left:12px; width:min(230px,calc(100% - 24px)); transform:translateX(-8px); }
  .strategy-workspace .lab-right-panel { right:12px; width:min(250px,calc(100% - 24px)); transform:translateX(8px); }
  .strategy-workspace.left-drawer-open .lab-left-panel,
  .strategy-workspace.right-drawer-open .lab-right-panel { opacity:1; visibility:visible; pointer-events:auto; transform:translateX(0); }
  .strategy-workspace.presentation-right-hidden .lab-right-panel { opacity:0; visibility:hidden; pointer-events:none; }
  .strategy-workspace.topology-focused .lab-left-panel,
  .strategy-workspace.topology-focused .lab-right-panel { opacity:0; visibility:hidden; pointer-events:none; }
  .strategy-workspace.topology-focused .lab-scene-panel { min-height:max(650px,calc(100vh - 280px)); }
  .strategy-workspace.topology-focused .lab-scene-canvas { min-height:0; }
  .scene-toolbar-actions { gap:5px; }
  .scene-toolbar-button { min-height:30px; padding:0 8px; font-size:11px; }
}
@media (max-width:1000px) {
  .lab-heading { align-items:flex-start; flex-direction:column; gap:10px; }
  .lab-heading-actions { width:100%; }
  .lab-scene-toolbar { padding:0 10px; }
  .scene-toolbar-title { min-width:0; }
  .scene-toolbar-title small { display:none; }
  .scene-toolbar-actions { gap:4px; }
  .scene-toolbar-button { padding:0 6px; font-size:10px; }
  .strategy-workspace .lab-scene-panel { min-height:560px; }
}
</style>
