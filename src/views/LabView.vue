<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import NetworkScene from '../components/three/NetworkScene.vue'
import { scenarios } from '../data/scenarios'
import { formatTimestamp } from '../engine/simulationEngine'
import { attackStateSignature } from '../engine/attackStateEngine'
import { evaluateChallenge } from '../engine/challengeEngine'
import { NETWORK_ZONES, SERVICE_TYPES, type FirewallDecision, type FirewallPolicy, type NetworkSelector, type NetworkZone, type RuleAction, type SecurityControl, type ServiceType } from '../types/network'
import type { SimulationEvent } from '../types/simulation'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useSettingsStore } from '../stores/settings'

const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const settingsStore = useSettingsStore()
const scenario = computed(() => scenarioStore.current)
const attackStateMode = computed(() => scenario.value.simulationMode === 'ATTACK_STATE')
const selectedNode = computed(() => scenario.value.nodes.find((node) => node.id === scenarioStore.selectedNodeId) ?? null)
const qualityName = computed(() => ({ high: '高', medium: '中', low: '低' })[settingsStore.renderQuality] ?? '高')
const statuses = computed(() => simulationStore.currentStatuses)
const currentEvent = computed(() => simulationStore.currentEvent)
const displayedAttackState = computed(() => simulationStore.currentAttackState ?? scenario.value.initialAttackState ?? null)
const displayedAssetAccess = computed(() => displayedAttackState.value?.assetAccess ?? {})
const attackSearchComplete = computed(() => simulationStore.result?.attackSearchResult?.searchComplete)
const selectedDataAccessLabel = computed(() => assetAccessLabel(displayedAssetAccess.value[selectedNode.value?.id ?? ''] ?? 'NONE', attackSearchComplete.value))
const isStale = computed(() => simulationStore.simulationStale)
const rightTab = ref<'node' | 'policy' | 'event'>('event')
const eventMode = ref<'key' | 'all'>('key')
const showRuleForm = ref(false)
const showPolicyDrawer = ref(false)
const showEventDecisionDialog = ref(false)
const showUtilities = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const challengePanelRef = ref<HTMLElement | null>(null)
const focusTopology = ref(false)
const compactViewport = ref(false)
const activeCompactPanel = ref<'left' | 'right' | null>(null)
const compactEventNotice = ref('')
const topologyFitRequest = ref(0)
const isVerifying = ref(false)
const playbackStarted = ref(false)
const expandedChallengeReasonId = ref<string | null>(null)
const showCompletionDetails = ref(false)
let compactEventNoticeTimer: ReturnType<typeof setTimeout> | undefined
let compactViewportQuery: MediaQueryList | undefined
const ruleDraft = reactive({
  firewallId: 'internal-fw',
  name: '办公区访问数据库限制',
  sourceKind: 'ZONE' as NetworkSelector['kind'],
  sourceZone: 'Office' as NetworkZone,
  sourceNodeId: 'pc01',
  destinationKind: 'ZONE' as NetworkSelector['kind'],
  targetZone: 'Database' as NetworkZone,
  targetNodeId: 'db',
  serviceId: 'DATABASE' as ServiceType,
  action: 'DENY' as RuleAction,
})

const events = computed(() => simulationStore.result?.events ?? [])
const visibleEvents = computed(() => eventMode.value === 'all' ? events.value : selectKeyEvents(events.value))
const attackChainEvents = computed(() => visibleEvents.value.filter((event) => (event.phase === 'initial' && event.type === 'seed') || Boolean(event.attackTechniqueId)))
const attackSearchResult = computed(() => simulationStore.result?.attackSearchResult ?? null)
const allRules = computed(() => scenario.value.firewallPolicies.flatMap((policy) => policy.rules))
const enabledRules = computed(() => allRules.value.filter((rule) => rule.enabled))
const enabledDenyRules = computed(() => enabledRules.value.filter((rule) => rule.action === 'DENY'))
const enabledAllowRules = computed(() => enabledRules.value.filter((rule) => rule.action === 'ALLOW'))
const highlightedRule = computed(() => enabledRules.value.find((rule) => rule.id === 'internal-20-office-db-allow') ?? enabledDenyRules.value[0] ?? enabledRules.value[0] ?? null)
const selectedInterfaces = computed(() => scenario.value.interfaces.filter((item) => item.nodeId === selectedNode.value?.id))
const selectedInterface = computed(() => selectedInterfaces.value.find((item) => item.kind === 'ENDPOINT_NIC')
  ?? selectedInterfaces.value.find((item) => item.kind === 'VLAN_GATEWAY')
  ?? selectedInterfaces.value.find((item) => item.vlanId !== undefined))
const selectedRoutes = computed(() => scenario.value.routes.filter((route) => route.deviceId === selectedNode.value?.id))
const selectedVlan = computed(() => scenario.value.vlans.find((item) => item.id === selectedInterface.value?.vlanId))
const selectedGateway = computed(() => scenario.value.interfaces.find((item) => item.id === selectedVlan.value?.gatewayInterfaceId))
const selectedFirewallPolicy = computed(() => scenario.value.firewallPolicies.find((policy) => policy.firewallId === selectedNode.value?.id))
const challenge = computed(() => scenario.value.challenge)
const primaryAssetId = computed(() => challenge.value?.protectedNodeId ?? scenario.value.nodes.find((node) => node.isCritical)?.id ?? '')
const primaryAssetName = computed(() => nodeName(primaryAssetId.value))
const verifiedResult = computed(() => simulationStore.result && !isStale.value ? simulationStore.result : null)
const hasCurrentResult = computed(() => Boolean(verifiedResult.value))
const completedAssetReached = computed(() => Boolean(verifiedResult.value?.metrics.criticalObjectiveReached
  ?? verifiedResult.value?.compromisedNodeIds.includes(primaryAssetId.value)))
const completedAssetOutcome = computed(() => {
  const result = verifiedResult.value
  if (!result) return '未验证'
  if (result.attackSearchResult) {
    if (!result.attackSearchResult.searchComplete) return '暂不能判定'
    return result.attackSearchResult.objectiveReached ? '数据目标已访问' : '数据目标受保护'
  }
  return result.compromisedNodeIds.includes(primaryAssetId.value) ? '受到影响' : '安全'
})
const completedAssetTone = computed(() => !verifiedResult.value?.attackSearchResult?.searchComplete
  ? 'asset-unknown'
  : completedAssetReached.value ? 'asset-risk' : 'asset-safe')
const dataObjectiveDisplay = computed(() => {
  if (isStale.value) return '待重新验证'
  if (!verifiedResult.value) return '待验证'
  if (verifiedResult.value.attackSearchResult?.searchComplete === false) return '暂不能判定'
  return completedAssetReached.value ? '已访问' : '已保护'
})
const taskStatusTone = computed(() => isStale.value ? 'stale' : !verifiedResult.value ? 'pending' : completedAssetReached.value ? 'risk' : 'safe')
const challengeEvaluation = computed(() => evaluateChallenge(
  scenario.value,
  simulationStore.result,
  simulationStore.resultFingerprint,
  hasCurrentResult.value,
))
const challengeChecks = computed(() => {
  if (!challengeEvaluation.value.valid) return null
  const checks = challengeEvaluation.value.checks
  const databaseProtected = checks[0]?.passed ?? false
  const businessChecks = checks.slice(1).map((check) => check.passed)
  return {
    databaseProtected,
    checks: businessChecks,
    success: challengeEvaluation.value.success === true,
    passedCount: checks.filter((check) => check.passed).length,
    totalCount: checks.length,
  }
})
const coreResultSummary = computed(() => {
  const result = verifiedResult.value
  if (!result) return null
  const outcome = completedAssetOutcome.value
  return {
    asset: outcome === '数据目标已访问' ? '已访问' : outcome === '数据目标受保护' ? '已保护' : outcome,
    assetProtected: outcome === '数据目标受保护',
    business: `${result.metrics.businessPathsReachable}/${result.metrics.businessPathsTotal}`,
  }
})
const focusChainNodeIds = computed(() => [...new Set(attackChainEvents.value.flatMap((event) => [
  ...event.route,
  event.sourceId,
  event.targetId,
]))])
const focusChainEdgeIds = computed(() => [...new Set(attackChainEvents.value.flatMap((event) => event.routeEdgeIds))])
function isDatabaseAccessAction(event: SimulationEvent) {
  return event.attackTechniqueId === 'database-access' || event.attackEffect === 'DATA_ACCESS_GRANTED'
}
const isCriticalDataAccessBlock = computed(() => {
  const event = currentEvent.value
  return Boolean(event
    && attackStateMode.value
    && event.targetId === primaryAssetId.value
    && event.attackTechniqueId === 'database-access'
    && event.attackTransitionResult === 'BLOCKED'
    && event.reason.includes('数据访问控制'))
})
const cameraInsets = computed(() => ({
  left: compactViewport.value && activeCompactPanel.value === 'left' ? 262 : 0,
  right: compactViewport.value && activeCompactPanel.value === 'right'
    ? 298
    : compactViewport.value && showPolicyDrawer.value
      ? Math.min(560, Math.round(window.innerWidth * 0.92))
      : 0,
  top: 0,
  bottom: 0,
}))
const challengeIncomplete = computed(() => challengeEvaluation.value.status === 'incomplete')
const challengeIncompleteReason = computed(() => challengeEvaluation.value.checks.find((check) => check.id === 'attack-search-complete')?.reason
  ?? '状态搜索未完整完成，暂不能判定挑战结果。')
const challengePathSummary = computed(() => (challenge.value?.requiredBusinessPathIds ?? []).map((id) => {
  const path = scenario.value.businessPaths.find((p) => p.id === id)
  return { id, label: path ? businessPathDisplay(path) : id, service: path?.service ?? 'ANY' }
}))
const challengeTotalCount = computed(() => 1 + (challenge.value?.requiredBusinessPathIds.length ?? 0))
const challengeProgressText = computed(() => {
  if (isVerifying.value) return '验证中'
  if (challengeIncomplete.value) return `暂不能判定 · ${challengeTotalCount.value} 项`
  if (challengeChecks.value) return `${challengeChecks.value.passedCount} / ${challengeChecks.value.totalCount}`
  if (isStale.value) return `待重新验证 · ${challengeTotalCount.value} 项`
  return `0 / ${challengeTotalCount.value}`
})
const challengeCheckItems = computed(() => {
  const result = verifiedResult.value
  const checks = challengeEvaluation.value.checks
  if (!result || !challengeChecks.value || !challenge.value) return []
  const assetId = challenge.value.protectedNodeId
  const assetReached = Boolean(result.metrics.criticalObjectiveReached
    || result.compromisedNodeIds.includes(assetId)
    || result.finalAttackState?.assetAccess[assetId] === 'DATA_ACCESS')
  const businessItems = challengePathSummary.value.map((path, index) => {
    const check = checks[index + 1]
    return {
      id: path.id,
      label: path.label,
      passed: check?.passed ?? false,
      detail: check?.passed ? '正常' : '当前不可达',
      cause: `本轮计算中「${path.label}」这条必要业务路径不可达。`,
      suggestion: '检查该路径对应的连接、路由与防火墙放行规则，再重新验证。',
    }
  })
  return [{
    id: 'protected-asset',
    label: '关键资产保护',
    passed: challengeChecks.value.databaseProtected,
    detail: challengeChecks.value.databaseProtected
      ? `${nodeName(assetId)}的数据目标未被访问`
      : result.finalAttackState?.assetAccess[assetId] === 'DATA_ACCESS'
        ? `${nodeName(assetId)}的数据访问目标仍可达到`
        : assetReached ? `${nodeName(assetId)}已进入受影响状态` : `${nodeName(assetId)}仍存在可达风险`,
    cause: result.finalAttackState?.assetAccess[assetId] === 'DATA_ACCESS'
      ? `${nodeName(assetId)}的数据访问目标仍可达到。`
      : `${nodeName(assetId)}仍存在可达的受影响状态。`,
    suggestion: '检查目标节点的安全控制与相关策略，并保留必要业务后重新验证。',
  }, ...businessItems]
})
const decisionChain = computed(() => {
  const event = currentEvent.value
  if (!event) return []
  if (event.phase === 'initial' && event.type === 'seed') {
    return [{ label: '实验初始状态', value: event.eventLayer === 'ATTACK' ? `初始 AttackState：${privilegeLabel(event.sourcePrivilege)}` : '仿真开始前已受影响', state: 'neutral' }]
  }
  if (event.eventLayer === 'ATTACK' && event.message.includes('状态空间搜索完成')) {
    const state = event.attackObjective === '关键目标未达成' ? 'pass' : event.attackObjective === '关键目标可达' ? 'fail' : 'neutral'
    return [{ label: '搜索结果', value: event.attackObjective ?? '当前状态空间已搜索', state }]
  }
  if (event.attackTechniqueName) {
    const passed = event.preconditionChecks?.filter((item) => item.passed).length ?? 0
    const total = event.preconditionChecks?.length ?? 0
    const outcomeState = event.attackTransitionResult === 'SUCCESS' ? 'pass' : event.attackTransitionResult === 'BLOCKED' ? 'fail' : 'neutral'
    const outcomeLabel = event.attackTransitionResult === 'SUCCESS' ? '成功' : event.attackTransitionResult === 'BLOCKED' ? '被阻断' : '不适用于当前状态'
    return [
      { label: '教学攻击行为', value: event.attackTechniqueName, state: outcomeState },
      { label: '行为判定', value: outcomeLabel, state: outcomeState },
      { label: '源端权限', value: privilegeLabel(event.sourcePrivilege), state: event.sourcePrivilege === 'NONE' ? 'fail' : 'pass' },
      { label: '前置条件', value: `${passed} / ${total} 满足`, state: outcomeState },
      { label: '目标权限 / 结果', value: event.attackObjective ?? `${privilegeLabel(event.targetPrivilegeBefore)} → ${privilegeLabel(event.targetPrivilegeAfter)}`, state: outcomeState },
    ]
  }
  const hasRoute = event.route.length > 1
  const networkBlocked = event.eventLayer === 'NETWORK' && event.result === 'block'
  const teachingBlocked = event.eventLayer === 'CONTROL' && event.result === 'block'
  return [
    { label: '网络路径', value: hasRoute ? event.route.map(nodeName).join(' → ') : '未形成可用路径', state: hasRoute ? 'pass' : 'fail' },
    { label: '网络通信', value: networkBlocked ? '防火墙拒绝' : event.eventLayer === 'NETWORK' && event.result === 'allow' ? '允许' : '未执行', state: networkBlocked ? 'fail' : event.eventLayer === 'NETWORK' && event.result === 'allow' ? 'pass' : 'neutral' },
    { label: 'Firewall First Match', value: event.matchedRuleName ?? (event.eventLayer === 'NETWORK' ? '本机 Default Policy' : '未参与'), state: networkBlocked ? 'fail' : event.matchedRuleName ? 'pass' : 'neutral' },
    { label: '后续状态模型', value: teachingBlocked ? '终端防护未改变目标状态' : event.eventLayer === 'PROPAGATION' ? 'Legacy Teaching Propagation' : '未触发传播状态变化', state: teachingBlocked ? 'pass' : 'neutral' },
  ]
})

function displayStatus(nodeId: string) {
  const node = scenario.value.nodes.find((item) => item.id === nodeId)
  return statuses.value?.[nodeId]
    ?? (node?.isolationEnabled || node?.status === 'isolated' ? 'isolated' : node?.protectionEnabled && node.status === 'normal' ? 'protected' : node?.status ?? 'normal')
}
function displayNodeName(name: string) {
  return ({
    Internet: '互联网', 'Edge Gateway': '边界网关', Firewall: '防火墙', 'Core Switch': '核心交换机', 'Core L3': '核心三层交换机',
    'DMZ Switch': 'DMZ交换机', 'Public Web Server': '公网Web服务器', 'Mail Server': '邮件服务器',
    'Office Switch': '办公交换机', 'Office-PC-01': '办公终端 01', 'Office-PC-02': '办公终端 02',
    'Office-PC-03': '办公终端 03', 'Office-PC-04': '办公终端 04', 'Server Switch': '服务器交换机',
    'Application Server': '应用服务器', 'File Server': '文件服务器', 'Customer Database': '客户数据库',
    'Finance Database': '财务数据库', 'Perimeter Firewall': '边界防火墙', 'Edge Firewall': '边界防火墙', 'Internal Firewall': '内部防火墙', 'Data Switch': '数据交换机',
    'Office Endpoint': '办公终端',
    'Control Switch': '控制交换机',
    'Operator HMI': '操作员 HMI',
    'Engineer Station': '工程师站',
    'Industrial Firewall': '工业防火墙',
    'SCADA Switch': 'SCADA交换机',
    'SCADA Server': 'SCADA服务器',
    'Process File Server': '报表文件服务器',
    'Field Switch': '现场交换机',
    'PLC-01 Pump': '水泵 PLC-01',
    'PLC-02 Line': '产线 PLC-02',
    'RTU Gateway': '采集终端 RTU',
    'Historian Switch': '历史交换机',
    'Historian Database': '历史数据库',
  } as Record<string, string>)[name] ?? name
}
function nodeTypeLabel(type: string) {
  return ({ Internet: '外部网络', Gateway: '网关', Firewall: '防火墙', Router: '路由器', Switch: '交换机', Workstation: '终端', Server: '服务器', Database: '数据库' } as Record<string, string>)[type] ?? type
}
function nodeName(id: string) { const name = scenario.value.nodes.find((node) => node.id === id)?.name; return name ? displayNodeName(name) : id }
function businessEndpointLabel(id: string) {
  const node = scenario.value.nodes.find((item) => item.id === id)
  if (!node) return id
  if (node.type === 'Workstation' && node.zone === 'Office') return '办公区'
  if (node.name === 'Public Web Server') return '公网 Web'
  if (node.name === 'Customer Database') return '客户数据库'
  if (node.name === 'Finance Database') return '财务数据库'
  if (node.name === 'Application Server') return '应用服务器'
  if (node.name === 'File Server') return '文件服务器'
  if (node.name === 'Mail Server') return '邮件服务器'
  if (node.name === 'Historian Database') return '历史数据库'
  if (node.name === 'SCADA Server') return 'SCADA 服务器'
  return displayNodeName(node.name)
}
function businessPathDisplay(path: { sourceId: string; targetId: string }) {
  return `${businessEndpointLabel(path.sourceId)} → ${businessEndpointLabel(path.targetId)}`
}
function firewallDecisionSummary(decisions: FirewallDecision[]) {
  return decisions.map((item) => {
    const outcome = item.allowed ? 'ALLOW' : 'DENY'
    const rule = item.matchedRuleName ?? `Default ${item.defaultAction ?? 'DENY'}`
    return `${nodeName(item.firewallId)} · ${outcome} · ${rule}`
  }).join('；')
}
function displayText(text: string) {
  const nodeNames = scenario.value.nodes.map((node) => node.name).sort((a, b) => b.length - a.length)
  return nodeNames.reduce((result, name) => result.replaceAll(name, displayNodeName(name)), text)
    .replaceAll('Office', '办公区')
    .replaceAll('Database', '数据区')
    .replaceAll('Office → Database', '办公区 → 数据区')
    .replaceAll('Office→Database', '办公区→数据区')
    .replaceAll('Office 用户访问', '办公区用户访问')
    .replaceAll('Database 区域', '数据区')
    .replaceAll('USER', '普通用户级')
    .replaceAll('ADMIN', '管理员级')
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
    if (event.attackTechniqueId && (event.attackTransitionResult === 'SUCCESS' || event.attackTransitionResult === 'BLOCKED')) {
      const key = `${event.attackTechniqueId}:${event.sourceId}:${event.targetId}:${event.attackTransitionResult ?? event.result}:${event.attackObjective ?? event.matchedRuleId ?? event.preconditionChecks?.find((item) => !item.passed)?.id ?? ''}`
      if (!seenAttackActions.has(key)) { seenAttackActions.add(key); selected.push(event) }
      continue
    }
    if (event.attackEffect === 'DATA_ACCESS_GRANTED') { selected.push(event); continue }
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
  if (event.attackTransitionResult === 'NOT_APPLICABLE') return '行为条件不适用'
  if (event.attackTransitionResult === 'BLOCKED') return event.reason.includes('数据访问控制') ? '数据访问行为被阻断' : event.eventLayer === 'NETWORK' ? '行为通信前置条件未满足' : '教学行为被阻断'
  if (event.attackEffect === 'DATA_ACCESS_GRANTED') return '数据目标已访问'
  if (event.attackTransitionResult === 'SUCCESS') return '教学攻击行为成功'
  if (event.eventLayer === 'NETWORK' && event.result === 'block') return '网络通信被拒绝'
  if (event.eventLayer === 'CONTROL' && event.result === 'block') return '教学传播被阻止'
  if (event.eventLayer === 'PROPAGATION' && event.result === 'compromise') return '教学传播状态变化'
  if (event.eventLayer === 'ATTACK' && event.result !== 'block') return '教学状态变化'
  if (event.result === 'allow') return '允许'
  return '观察'
}
function privilegeLabel(privilege?: string) { return ({ NONE: '无控制', USER: '普通用户级', ADMIN: '管理员级' } as Record<string, string>)[privilege ?? ''] ?? '—' }
function eventLayerLabel(event: SimulationEvent) {
  if (event.attackTechniqueName) return '教学行为'
  return ({ NETWORK: '网络通信', PROPAGATION: '教学传播', CONTROL: '安全控制', ATTACK: '初始状态' } as Record<string, string>)[event.eventLayer] ?? '实验事件'
}
function serviceLabel(service: string) {
  return ({ ANY: '任意服务', WEB: 'Web 服务', DATABASE: '数据库服务', FILE: '文件服务', MAIL: '邮件服务', INTERNAL: '内部通信' } as Record<string, string>)[service] ?? service
}
function assetAccessLabel(access: string, complete?: boolean) {
  if (access === 'DATA_ACCESS') return '数据目标已访问'
  if (complete === false) return '暂不能判定'
  if (complete === true) return '数据目标受保护'
  return '数据尚未访问'
}
function eventRouteLabel(event: SimulationEvent) {
  if (event.attackTechniqueId === 'privilege-escalation') return '节点内部状态变化，无网络路径'
  return event.route.length ? event.route.map(nodeName).join(' → ') : '未形成可用通信路径'
}
function transitionResultLabel(result: string) {
  return ({ SUCCESS: '前置条件满足', BLOCKED: '被阻断', NOT_APPLICABLE: '不适用于当前状态' } as Record<string, string>)[result] ?? result
}
function attackStepTitle(event: SimulationEvent) {
  if (event.phase === 'initial' && event.type === 'seed') return '实验初始状态'
  if (isDatabaseAccessAction(event)) return event.attackTransitionResult === 'BLOCKED' ? '数据访问拦截' : '数据访问'
  if (event.attackEffect === 'CONTROL_GRANTED') return '应用端访问'
  if (event.attackEffect === 'PRIVILEGE_ESCALATED') return '本地权限提升'
  return event.attackTechniqueName ?? event.message
}
function attackStepState(event: SimulationEvent) {
  if (event.phase === 'initial' && event.type === 'seed') return `${nodeName(event.targetId)} · ${privilegeLabel(event.targetPrivilegeAfter)}`
  if (event.attackTransitionResult === 'BLOCKED' && isDatabaseAccessAction(event)) return event.reason.includes('数据访问控制') ? '数据目标已保护' : '数据访问未完成'
  if (event.attackEffect === 'DATA_ACCESS_GRANTED') return '数据目标已访问'
  if (event.attackEffect === 'PRIVILEGE_ESCALATED') return `${privilegeLabel(event.targetPrivilegeBefore)} → ${privilegeLabel(event.targetPrivilegeAfter)}`
  if (event.attackEffect === 'CONTROL_GRANTED') return `${nodeName(event.targetId)} · ${privilegeLabel(event.targetPrivilegeAfter)}`
  return event.attackTransitionResult ? transitionResultLabel(event.attackTransitionResult) : eventLabel(event)
}
function chooseScenario(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
}
async function verifyScenario() {
  if (isVerifying.value) return
  isVerifying.value = true
  expandedChallengeReasonId.value = null
  showCompletionDetails.value = false
  playbackStarted.value = false
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  try {
    simulationStore.reset()
    simulationStore.makeResult()
    if (simulationStore.result?.events.length) simulationStore.seek(0)
    ElMessage.success(challenge.value ? '方案已验证，可以播放计算过程' : '实验结果已计算，可以播放过程')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '方案验证失败')
  } finally {
    isVerifying.value = false
  }
}
function playProcess() {
  if (!hasCurrentResult.value || simulationStore.status === 'running' || simulationStore.status === 'completed') return
  playbackStarted.value = true
  if (simulationStore.cursor < 0) simulationStore.seek(0)
  simulationStore.resume()
}
function continueProcess() {
  if (!hasCurrentResult.value || simulationStore.status !== 'paused') return
  playbackStarted.value = true
  simulationStore.resume()
}
function replayProcess() {
  if (!hasCurrentResult.value) return
  playbackStarted.value = true
  simulationStore.seek(0)
  simulationStore.resume()
}
function toggleProtection() {
  const node = selectedNode.value
  if (!node || !['Workstation', 'Server'].includes(node.type)) return
  scenarioStore.updateNode(node.id, { protectionEnabled: !node.protectionEnabled })
  ElMessage.success(node.protectionEnabled ? '已关闭终端防护' : '已启用教学仿真终端防护')
}
function toggleSecurityControl(control: SecurityControl) {
  const node = selectedNode.value
  if (!node) return
  const controls = new Set(node.securityControls ?? [])
  if (controls.has(control)) controls.delete(control)
  else controls.add(control)
  scenarioStore.updateNode(node.id, { securityControls: [...controls] })
  const label = control === 'DATA_ACCESS_CONTROL' ? '数据访问控制' : '服务加固'
  ElMessage.success(controls.has(control) ? `已启用教学仿真${label}` : `已关闭教学仿真${label}`)
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
  const makeSelector = (kind: NetworkSelector['kind'], selectedZone: NetworkZone, nodeId: string): NetworkSelector => kind === 'ANY'
    ? { kind: 'ANY' }
    : kind === 'ZONE' ? { kind: 'ZONE', zone: selectedZone } : { kind: 'NODE', nodeId }
  scenarioStore.addFirewallRule(ruleDraft.firewallId, {
    name,
    source: makeSelector(ruleDraft.sourceKind, ruleDraft.sourceZone as NetworkZone, ruleDraft.sourceNodeId),
    destination: makeSelector(ruleDraft.destinationKind, ruleDraft.targetZone, ruleDraft.targetNodeId),
    serviceId: ruleDraft.serviceId,
    action: ruleDraft.action,
  })
  showRuleForm.value = false
  ElMessage.success('安全策略已添加')
}
function seek(index: number) {
  simulationStore.seek(index)
  playbackStarted.value = true
}
async function toggleChallengeFailure(id: string) {
  expandedChallengeReasonId.value = expandedChallengeReasonId.value === id ? null : id
  if (expandedChallengeReasonId.value === null) return
  await nextTick()
  requestAnimationFrame(() => challengePanelRef.value
    ?.querySelector<HTMLElement>('[data-open-reason="true"]')
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}
function eventTone(event: SimulationEvent) {
  if (event.attackTransitionResult === 'BLOCKED' || event.result === 'block') return 'blocked'
  if (event.attackTransitionResult === 'NOT_APPLICABLE') return 'info'
  if (event.result === 'compromise' || event.attackEffect === 'DATA_ACCESS_GRANTED') return 'risk'
  return event.result === 'info' ? 'info' : 'normal'
}
function zoneLabel(zone: string) { return ({ Internet: '外部网络', DMZ: 'DMZ', Office: '办公区', Server: '服务器区', Database: '数据区', Control: '控制中心', Field: '现场设备区', Historian: '历史数据区' } as Record<string, string>)[zone] ?? zone }
function selectorLabel(selector: NetworkSelector) {
  if (selector.kind === 'ANY') return '任意'
  if (selector.kind === 'ZONE') return zoneLabel(selector.zone)
  return nodeName(selector.nodeId)
}
function policyName(policy: FirewallPolicy) { return nodeName(policy.firewallId) }
function roleLabel(role: string) { return ({ EXTERNAL_NETWORK: '外部网络', ENDPOINT: '终端设备', L2_SWITCH: '二层交换机', L3_SWITCH: '三层交换设备', FIREWALL: '防火墙' } as Record<string, string>)[role] ?? role }
function stateLabel(status: string) { return ({ normal: '正常', warning: '风险提示', compromised: '受影响', isolated: '已隔离', protected: '已防护' } as Record<string, string>)[status] ?? status }
function onTimelineInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const selectedEvent = visibleEvents.value[value]
  if (selectedEvent) seek(events.value.indexOf(selectedEvent))
}
function managePolicy() {
  rightTab.value = 'policy'
  if (compactViewport.value) activeCompactPanel.value = null
  showPolicyDrawer.value = true
}
async function toggleTopologyFocus() {
  focusTopology.value = !focusTopology.value
  if (focusTopology.value) activeCompactPanel.value = null
  await nextTick()
  topologyFitRequest.value += 1
}
function resetTopologyView() { topologyFitRequest.value += 1 }
function toggleCompactPanel(panel: 'left' | 'right') {
  activeCompactPanel.value = activeCompactPanel.value === panel ? null : panel
  if (panel === 'right') rightTab.value = 'event'
}
function toggleRightPanel() {
  toggleCompactPanel('right')
}
function onCompactViewportChange(event: Pick<MediaQueryListEvent, 'matches'>) {
  compactViewport.value = event.matches
  if (!event.matches) return
  activeCompactPanel.value = null
}
function onDemoOpenDatabase() {
  const nodeId = scenario.value.challenge?.protectedNodeId ?? 'db'
  scenarioStore.selectNode(nodeId)
  rightTab.value = 'node'
  if (compactViewport.value) activeCompactPanel.value = 'right'
}
function onDemoVerifyChallenge() {
  void verifyScenario()
}
function onSelectNode(id: string) {
  scenarioStore.selectNode(id)
  rightTab.value = 'node'
  if (compactViewport.value) activeCompactPanel.value = 'right'
}
function onMoveNode(id: string, position: { x: number; y: number; z: number }) {
  scenarioStore.moveNode(id, position)
}
function restoreDefaults() {
  scenarioStore.restoreDefaults()
  simulationStore.reset()
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

watch(() => currentEvent.value?.id, () => {
  showEventDecisionDialog.value = false
  const event = currentEvent.value
  if (!compactViewport.value || !event) return
  const target = scenario.value.nodes.find((node) => node.id === event.targetId)
  const importantChange = target?.isCritical && event.result === 'compromise' && event.stateBefore !== event.stateAfter
  if (event.result !== 'block' && !importantChange) return
  compactEventNotice.value = isCriticalDataAccessBlock.value
    ? '网络通信正常 · 数据访问已阻止'
    : event.result === 'block' ? '关键行为被阻止 · 可查看事件详情' : '关键资产状态变化 · 可查看事件详情'
  if (compactEventNoticeTimer) clearTimeout(compactEventNoticeTimer)
  compactEventNoticeTimer = setTimeout(() => { compactEventNotice.value = '' }, 3600)
})

watch(() => settingsStore.presentationMode, (enabled) => {
  if (enabled) {
    focusTopology.value = false
    activeCompactPanel.value = null
  }
})

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (showEventDecisionDialog.value) showEventDecisionDialog.value = false
  else if (showPolicyDrawer.value) showPolicyDrawer.value = false
  else if (activeCompactPanel.value) activeCompactPanel.value = null
  else if (showUtilities.value) showUtilities.value = false
}

onMounted(() => {
  compactViewportQuery = window.matchMedia('(max-width: 1450px)')
  if (compactViewportQuery.matches) onCompactViewportChange(compactViewportQuery)
  compactViewportQuery.addEventListener('change', onCompactViewportChange)
  window.addEventListener('keydown', onEscape)
  window.addEventListener('zhiyu-demo:open-database', onDemoOpenDatabase)
  window.addEventListener('zhiyu-demo:verify-challenge', onDemoVerifyChallenge)
})

onBeforeUnmount(() => {
  if (compactEventNoticeTimer) clearTimeout(compactEventNoticeTimer)
  compactViewportQuery?.removeEventListener('change', onCompactViewportChange)
  window.removeEventListener('keydown', onEscape)
  window.removeEventListener('zhiyu-demo:open-database', onDemoOpenDatabase)
  window.removeEventListener('zhiyu-demo:verify-challenge', onDemoVerifyChallenge)
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

    <div v-if="isStale" class="strategy-stale-banner"><span>↻</span><div><strong>安全策略已修改，请重新运行仿真以验证结果。</strong><small>当前场景状态已更新，画面保留上一轮结果直到你重新运行。</small></div><button :disabled="isVerifying" @click="verifyScenario">{{ isVerifying ? '验证中…' : challenge ? '重新验证方案' : '重新运行实验' }}</button></div>

    <div class="lab-workspace strategy-workspace" :class="{ 'topology-focused': focusTopology, 'presentation-layout': settingsStore.presentationMode, 'presentation-right-hidden': settingsStore.presentationMode && compactViewport && activeCompactPanel !== 'right', 'left-drawer-open': activeCompactPanel === 'left', 'right-drawer-open': activeCompactPanel === 'right', 'attack-state-lab': attackStateMode }">
      <aside class="lab-left-panel panel-surface">
        <div class="lab-experiment-intro"><span>当前实验 · {{ scenario.difficulty }}</span><h2>{{ scenario.name }}</h2><details class="lab-experiment-details"><summary>实验说明</summary><p>{{ displayText(scenario.description) }}</p><ul><li v-for="objective in scenario.learningObjectives" :key="objective">{{ objective }}</li></ul><div v-if="scenario.initialEvents.some(event => event.type === 'seed')" class="initial-condition"><strong>实验初始状态</strong><p>{{ displayText(scenario.initialEvents.find(event => event.type === 'seed')?.message ?? '') }}</p></div><RouterLink v-if="!settingsStore.presentationMode" class="lab-related-knowledge" to="/learn">相关知识 <span>→</span></RouterLink></details></div>
        <section v-if="challenge" ref="challengePanelRef" class="challenge-panel challenge-panel-primary">
          <div class="challenge-heading-row"><span class="challenge-live-tag">安全挑战</span><strong class="challenge-progress">{{ challengeProgressText }}</strong></div>
          <h3>{{ displayText(challenge.title.replace(/^保护\s+/, '保护')) }}</h3>
          <div class="challenge-goal"><strong>任务目标</strong><p>{{ displayText(challenge.description) }}</p></div>
          <div class="challenge-requirements"><strong>必要业务</strong><div v-for="path in challengePathSummary" :key="path.id"><i>✓</i><span>{{ path.label }}</span><b>{{ path.service }}</b></div></div>
          <div class="challenge-actions"><button class="challenge-policy-link" @click="managePolicy">管理安全策略 <span>→</span></button><button class="button-primary challenge-run-button" :disabled="isVerifying" @click="verifyScenario">{{ isVerifying ? '验证中…' : hasCurrentResult ? '重新验证方案' : '验证方案' }}</button></div>
          <section v-if="challengeIncomplete" class="challenge-result-area challenge-result-incomplete" aria-live="polite"><h4>验证结果</h4><p>状态搜索未完整完成，暂不能判定目标是否安全。{{ challengeIncompleteReason }}</p></section>
          <section v-else-if="hasCurrentResult && challengeChecks" class="challenge-result-area" aria-live="polite">
            <header><h4>验证结果</h4><span :class="challengeChecks.success ? 'result-pass' : 'result-fail'">{{ challengeChecks.success ? '挑战通过' : '需要调整' }}</span></header>
            <div class="challenge-check-list">
              <article v-for="item in challengeCheckItems" :key="item.id" class="challenge-check-item" :class="item.passed ? 'check-passed' : 'check-failed'">
                <div class="challenge-check-main"><i>{{ item.passed ? '✓' : '×' }}</i><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><button v-if="!item.passed" class="challenge-reason-toggle" :aria-expanded="expandedChallengeReasonId === item.id" @click="toggleChallengeFailure(item.id)">{{ expandedChallengeReasonId === item.id ? '收起失败原因' : '查看失败原因' }}</button></div>
                <div v-if="!item.passed && expandedChallengeReasonId === item.id" class="challenge-failure-reason" data-open-reason="true"><div><strong>原因</strong><p>{{ item.cause }}</p></div><div><strong>建议</strong><p>{{ item.suggestion }}</p></div><button @click="toggleChallengeFailure(item.id)">收起</button></div>
              </article>
            </div>
          </section>
          <div v-else class="challenge-hint">{{ isStale ? '策略已变更，请重新验证。' : '调整策略后验证；系统会从相同初始条件重新计算。' }}</div>
        </section>
        <section v-else class="challenge-panel learning-objectives-panel"><h3>本实验学习目标</h3><ul><li v-for="objective in scenario.learningObjectives" :key="objective">{{ objective }}</li></ul><div class="challenge-actions"><button class="challenge-policy-link" @click="managePolicy">管理安全策略 <span>→</span></button><button class="button-primary challenge-run-button" :disabled="isVerifying" @click="verifyScenario">{{ isVerifying ? '计算中…' : hasCurrentResult ? '重新运行实验' : '运行实验' }}</button></div></section>
      </aside>

      <section class="lab-scene-panel panel-surface">
        <div v-if="attackStateMode" class="lab-task-status" :class="'task-' + taskStatusTone">
          <div class="lab-task-primary"><span>当前任务</span><strong>保护{{ primaryAssetName }}</strong></div>
          <div class="lab-task-result"><span>核心结果</span>
            <strong v-if="!coreResultSummary">{{ isVerifying ? '正在验证' : isStale ? '待重新验证' : '尚未验证' }}</strong>
            <div v-else class="core-result-items">
              <span>数据目标 <b :class="coreResultSummary.assetProtected ? 'core-result-safe' : 'core-result-risk'">{{ coreResultSummary.asset }}</b></span><i></i>
              <span>必要业务 <b>{{ coreResultSummary.business }}</b></span>
            </div>
          </div>
          <div class="lab-host-data-state"><div><small>数据库主机</small><b>{{ stateLabel(displayStatus(primaryAssetId)) }}</b></div><i></i><div><small>数据目标</small><b :class="dataObjectiveDisplay === '已访问' ? 'data-state-risk' : dataObjectiveDisplay === '已保护' ? 'data-state-safe' : ''">{{ dataObjectiveDisplay }}</b></div></div>
        </div>
        <div class="lab-scene-toolbar"><div class="scene-toolbar-title"><strong>{{ scenario.shortName }}</strong><small>{{ simulationStore.status === 'running' ? '过程播放中' : simulationStore.status === 'completed' ? '过程播放完成' : hasCurrentResult ? '方案已验证' : '教学型网络场景' }}</small></div><div class="scene-legend"><span><i class="legend-normal"></i>正常</span><span><i class="legend-risk"></i>受影响</span><span><i class="legend-protected"></i>防护</span><span><i class="legend-isolated"></i>隔离</span></div><div class="scene-toolbar-actions"><button class="scene-toolbar-button scene-drawer-button" :aria-expanded="activeCompactPanel === 'left'" @click="toggleCompactPanel('left')">{{ activeCompactPanel === 'left' ? '关闭任务' : '任务' }}</button><button class="scene-toolbar-button scene-drawer-button" :aria-expanded="activeCompactPanel === 'right'" @click="toggleRightPanel">{{ activeCompactPanel === 'right' ? '关闭事件' : settingsStore.presentationMode ? '查看事件' : '事件 / 策略' }}</button><span v-if="compactEventNotice && compactViewport" class="scene-event-notice" role="status">{{ compactEventNotice }}</span><span v-if="challengeChecks?.success && !attackStateMode" class="scene-challenge-success" role="status">挑战通过 {{ challengeChecks.passedCount }}/{{ challengeChecks.totalCount }}</span><button class="scene-toolbar-button" :title="'渲染质量：' + qualityName + '（点击循环切换高/中/低）'" @click="settingsStore.cycleRenderQuality()">画质·{{ qualityName }}</button><button class="scene-toolbar-button" @click="resetTopologyView">重置视图</button><button class="scene-toolbar-button scene-focus-button" @click="toggleTopologyFocus">{{ focusTopology ? '退出聚焦' : '聚焦拓扑' }}</button></div></div>
        <div class="lab-scene-canvas"><NetworkScene :scenario="scenario" :statuses="statuses" :events="simulationStore.result?.events ?? []" :asset-access="displayedAssetAccess" :asset-search-complete="attackSearchComplete" :active-index="simulationStore.cursor" :selected-node-id="scenarioStore.selectedNodeId" :show-labels="true" :compact-labels="true" :model-scale="1.1" :fit-request="topologyFitRequest" :camera-insets="cameraInsets" :focus-mode="focusTopology" :focus-node-ids="focusChainNodeIds" :focus-edge-ids="focusChainEdgeIds" :editable="!settingsStore.presentationMode" @select-node="onSelectNode" @move-node="onMoveNode" /><div v-if="!settingsStore.presentationMode" class="scene-hint">拖动旋转 · 滚轮缩放 · 点击设备查看信息</div></div>
        <div class="scene-bottom-status"><span><i :class="'status-' + (simulationStore.status === 'running' ? 'running' : simulationStore.status)"></i>{{ simulationStore.status === 'running' ? '过程播放中' : simulationStore.status === 'completed' ? '过程播放完成' : simulationStore.status === 'paused' && playbackStarted ? '过程已暂停' : hasCurrentResult ? '方案已验证' : isStale ? '待重新验证' : '待验证' }}</span><span>当前设备：{{ selectedNode ? displayNodeName(selectedNode.name) : '点击设备查看信息' }}</span><span>教学型抽象仿真 · 不执行真实网络通信</span></div>
      </section>

      <aside class="lab-right-panel">
        <button v-if="settingsStore.presentationMode && compactViewport && activeCompactPanel === 'right'" class="presentation-event-close" aria-label="关闭事件详情" @click="activeCompactPanel = null">×</button>
        <div class="right-panel-tabs"><button :class="{ active: rightTab === 'event' }" @click="rightTab = 'event'">当前事件</button><button :class="{ active: rightTab === 'node' }" @click="rightTab = 'node'">节点信息</button><button :class="{ active: rightTab === 'policy' }" @click="rightTab = 'policy'">安全策略</button></div>

        <section v-if="rightTab === 'node'" class="node-inspector panel-surface">
          <div class="lab-panel-title"><div><h2>节点信息</h2></div><span v-if="selectedNode" class="node-status-pill" :class="'pill-' + displayStatus(selectedNode.id)">{{ stateLabel(displayStatus(selectedNode.id)) }}</span></div>
          <template v-if="selectedNode">
            <div class="node-identity"><span class="node-type-icon">{{ selectedNode.type === 'Database' ? '▤' : selectedNode.type === 'Server' ? '▣' : selectedNode.type === 'Firewall' ? '⛨' : selectedNode.type === 'Workstation' ? '▤' : '⌁' }}</span><div><strong>{{ displayNodeName(selectedNode.name) }}</strong><small>{{ nodeTypeLabel(selectedNode.type) }} · {{ roleLabel(selectedNode.deviceRole) }}</small></div></div>
            <div class="node-properties"><div><span>{{ selectedInterface?.ipv4Address ? '接口 IPv4' : '管理/主地址' }}</span><strong>{{ selectedInterface?.ipv4Address ? `${selectedInterface.ipv4Address}/${selectedInterface.prefixLength}` : selectedNode.ip }}</strong></div><div><span>设备角色 · Zone</span><strong>{{ roleLabel(selectedNode.deviceRole) }} · {{ zoneLabel(selectedNode.zone) }}</strong></div><div v-if="selectedVlan"><span>VLAN / Subnet</span><strong>{{ selectedVlan.id }} · {{ selectedVlan.subnetCidr }}</strong></div><div v-if="selectedGateway?.ipv4Address"><span>VLAN Gateway</span><strong>{{ selectedGateway.ipv4Address }}</strong></div><div><span>关键资产</span><strong>{{ selectedNode.isCritical ? '是' : '否' }}</strong></div><div><span>提供服务</span><strong>{{ selectedNode.services?.join(' / ') || '无' }}</strong></div><div v-if="selectedFirewallPolicy"><span>Firewall</span><strong>{{ selectedFirewallPolicy.rules.length }} 条规则 · Default {{ selectedFirewallPolicy.defaultAction }}</strong></div><div v-if="selectedNode.deviceRole === 'L3_SWITCH' || selectedNode.deviceRole === 'FIREWALL'"><span>静态路由</span><strong>{{ selectedRoutes.length }} 条配置</strong></div></div>
            <div v-if="attackStateMode && selectedNode.type === 'Database'" class="asset-access-properties"><div><span>数据库主机</span><strong>{{ stateLabel(displayStatus(selectedNode.id)) }}</strong></div><div><span>数据目标</span><strong :class="{ 'data-target-risk': selectedDataAccessLabel === '数据目标已访问', 'data-target-safe': selectedDataAccessLabel === '数据目标受保护' }">{{ selectedDataAccessLabel }}</strong></div></div>
            <details v-if="selectedInterfaces.length || selectedRoutes.length" class="node-network-details"><summary>接口与路由详情</summary><small v-for="intf in selectedInterfaces" :key="intf.id">{{ intf.name }} · {{ intf.kind }} · {{ intf.ipv4Address ? `${intf.ipv4Address}/${intf.prefixLength}` : '无 IPv4' }}{{ intf.vlanId ? ` · VLAN ${intf.vlanId}` : '' }}</small><small v-for="route in selectedRoutes" :key="route.id">{{ route.kind }} {{ route.destinationCidr }} → {{ route.nextHopIp ?? '直连' }} · {{ route.outInterfaceId }}</small></details>
            <label class="node-edit-field"><span>节点名称</span><input :value="selectedNode.name" @change="scenarioStore.updateNode(selectedNode.id, { name: ($event.target as HTMLInputElement).value })" /></label>
            <label class="node-edit-field"><span>所属区域</span><select :value="selectedNode.zone" @change="scenarioStore.updateNode(selectedNode.id, { zone: ($event.target as HTMLSelectElement).value as NetworkZone })"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option></select></label>
            <div v-if="['Workstation', 'Server'].includes(selectedNode.type)" class="protection-card"><div><span class="protection-shield">⛨</span><span><strong>终端防护</strong><small>教学仿真参数，用于表示终端存在有效安全防护。</small></span></div><el-switch :model-value="selectedNode.protectionEnabled" @change="toggleProtection" /></div>
            <div v-if="selectedNode.type === 'Server'" class="critical-toggle"><span><strong>服务加固</strong><small>教学抽象控制，仅影响应用服务器本地权限变化行为。</small></span><el-switch :model-value="Boolean(selectedNode.securityControls?.includes('SERVICE_HARDENING'))" @change="toggleSecurityControl('SERVICE_HARDENING')" /></div>
            <div v-if="selectedNode.type === 'Database'" class="critical-toggle"><span><strong>数据访问控制</strong><small>教学抽象控制，仅阻止数据访问行为，不改变正常网络通信。</small></span><el-switch :model-value="Boolean(selectedNode.securityControls?.includes('DATA_ACCESS_CONTROL'))" @change="toggleSecurityControl('DATA_ACCESS_CONTROL')" /></div>
            <div class="critical-toggle"><span><strong>关键资产</strong><small>关键状态标识与统计口径</small></span><el-switch :model-value="selectedNode.isCritical" @change="toggleCritical" /></div>
            <div class="critical-toggle"><span><strong>节点隔离</strong><small>隔离后无法参与通信，也会影响业务可达性。</small></span><el-switch :model-value="Boolean(selectedNode.isolationEnabled || selectedNode.status === 'isolated')" @change="toggleIsolation" /></div>
            <div v-if="currentEvent && (currentEvent.sourceId === selectedNode.id || currentEvent.targetId === selectedNode.id)" class="node-related-event"><span class="section-kicker">当前关联事件 · {{ formatTimestamp(currentEvent.stepIndex) }}</span><strong>{{ displayText(currentEvent.message) }}</strong><p>{{ displayText(currentEvent.reason) }}</p><small v-if="currentEvent.matchedRuleName">匹配规则：{{ currentEvent.matchedRuleName }}</small></div>
          </template>
          <div v-else class="lab-empty-state"><strong>选择一个节点</strong><p>点击三维场景中的设备查看属性。</p></div>
        </section>

        <section v-else-if="rightTab === 'policy'" class="security-policy-summary panel-surface">
          <div class="lab-panel-title"><h2>安全策略</h2><span>{{ allRules.length }} 条规则</span></div>
          <div class="policy-count-grid"><div><strong>{{ enabledRules.length }}</strong><span>当前启用</span></div><div><strong>{{ enabledDenyRules.length }}</strong><span>拒绝规则</span></div><div><strong>{{ enabledAllowRules.length }}</strong><span>允许规则</span></div></div>
          <div v-if="highlightedRule" class="policy-highlight"><span :class="highlightedRule.action === 'DENY' ? 'policy-action-deny' : 'policy-action-allow'">{{ highlightedRule.action === 'DENY' ? '拒绝' : '允许' }}</span><div><strong>{{ highlightedRule.name }}</strong><small>{{ policyName(scenario.firewallPolicies.find((item) => item.firewallId === highlightedRule.firewallId)!) }} · #{{ highlightedRule.order }} · {{ selectorLabel(highlightedRule.source) }} → {{ selectorLabel(highlightedRule.destination) }} · {{ highlightedRule.serviceId }}</small></div></div>
          <p class="policy-summary-note">每台 Firewall 独立按 order 升序 First Match；无匹配时使用本机 Default Policy。</p>
          <button class="policy-manage-button" @click="showPolicyDrawer = true">查看全部策略并管理 <span>→</span></button>
        </section>

        <section v-else class="event-inspector panel-surface">
          <div class="lab-panel-title"><div><h2>当前事件</h2></div><span v-if="currentEvent" class="event-time-pill">{{ formatTimestamp(currentEvent.stepIndex) }}</span></div>
          <template v-if="currentEvent">
            <div class="event-explanation-card" :class="'tone-' + eventTone(currentEvent)">
              <span class="event-explanation-result">{{ eventLabel(currentEvent) }}</span>
              <div v-if="isCriticalDataAccessBlock" class="critical-data-access-summary">
                <div class="critical-data-access-heading"><span>数据库数据访问</span><strong>{{ nodeName(currentEvent.sourceId) }} <i>→</i> {{ nodeName(currentEvent.targetId) }}</strong></div>
                <div class="critical-data-access-status"><span>网络通信 <b class="communication-established">正常</b></span><span>教学数据访问 <b>已阻止</b></span></div>
                <div class="critical-data-access-route"><span>实际路径</span><strong>{{ currentEvent.route.map(nodeName).join(' → ') }}</strong></div>
                <p>{{ displayText(currentEvent.reason) }}</p>
                <div class="critical-data-access-conclusion">业务通信正常，非授权数据访问被阻止。</div>
              </div>
              <div v-else-if="attackStateMode" class="event-focus-summary">
                <div class="event-focus-endpoints"><span>{{ eventLayerLabel(currentEvent) }}</span><strong>{{ nodeName(currentEvent.sourceId) }} <i>→</i> {{ nodeName(currentEvent.targetId) }}</strong><small>{{ currentEvent.phase === 'initial' && currentEvent.type === 'seed' ? '实验开始前已处于受影响状态' : `服务：${serviceLabel(currentEvent.service)}` }}</small></div>
                <div class="event-focus-outcome"><span>结果</span><strong>{{ eventLabel(currentEvent) }}</strong></div>
                <div class="event-focus-reason"><span>原因</span><p>{{ displayText(currentEvent.reason) }}</p></div>
                <div v-if="currentEvent.route.length" class="event-focus-route"><span>实际路径</span><p>{{ currentEvent.route.map(nodeName).join(' → ') }}</p></div>
              </div>
              <div v-else class="event-explanation-grid">
                <section class="event-explanation-block"><span>{{ eventLayerLabel(currentEvent) }}</span><strong>{{ nodeName(currentEvent.sourceId) }} <i>→</i> {{ nodeName(currentEvent.targetId) }}</strong><small>{{ currentEvent.phase === 'initial' && currentEvent.type === 'seed' ? '实验开始前已处于受影响状态' : `服务：${serviceLabel(currentEvent.service)}` }}</small></section>
                <section class="event-explanation-block"><span>实际路径</span><div class="event-route-chips"><template v-if="currentEvent.route.length"><template v-for="(nodeId, index) in currentEvent.route" :key="nodeId"><i v-if="index" class="route-chip-arrow">›</i><b>{{ nodeName(nodeId) }}</b></template></template><small v-else>{{ eventRouteLabel(currentEvent) }}</small></div></section>
                <section class="event-explanation-block"><span>为什么</span><strong v-if="currentEvent.attackTechniqueName">{{ currentEvent.attackTechniqueName }}</strong><strong v-else-if="currentEvent.matchedRuleName">{{ currentEvent.matchedRuleName }}</strong><small v-if="currentEvent.attackTechniqueName">源权限 {{ privilegeLabel(currentEvent.sourcePrivilege) }} · 目标权限 {{ privilegeLabel(currentEvent.targetPrivilegeBefore) }} → {{ privilegeLabel(currentEvent.targetPrivilegeAfter) }}</small><small v-else-if="currentEvent.matchedRuleName">{{ currentEvent.result === 'block' ? '命中拒绝规则' : '命中允许规则' }} · {{ currentEvent.service }}</small><strong v-else>{{ displayText(currentEvent.reason) }}</strong><small v-if="currentEvent.blockedAt">判定位置：{{ displayText(currentEvent.blockedAt) }}</small></section>
                <section class="event-explanation-block event-outcome-block"><span>结果</span><strong>{{ eventLabel(currentEvent) }}</strong><small v-if="currentEvent.attackEffect === 'PRIVILEGE_ESCALATED'">节点权限变化：普通用户 → 管理员</small><small v-else-if="currentEvent.attackEffect === 'DATA_ACCESS_GRANTED'">数据目标：未访问 → 已访问；数据库主机仍为 {{ stateLabel(currentEvent.stateAfter ?? 'normal') }}</small><small v-else-if="currentEvent.stateBefore || currentEvent.stateAfter">{{ currentEvent.stateBefore ? stateLabel(currentEvent.stateBefore) : '—' }} → {{ currentEvent.stateAfter ? stateLabel(currentEvent.stateAfter) : '—' }}</small></section>
              </div>
              <button v-if="currentEvent.phase !== 'initial'" class="event-diagnostic-open" @click="showEventDecisionDialog = true"><span><strong>查看完整判定过程</strong><small>展开行为判定与前置条件说明</small></span><b aria-hidden="true">↗</b></button>
            </div>
          </template>
          <div v-else class="lab-empty-state event-empty-state"><strong>{{ isStale ? '方案待重新验证' : '尚未验证方案' }}</strong><p>验证后可在这里查看代表链事件判定。</p></div>
          <button v-if="currentEvent" class="event-open-timeline" @click="eventMode = 'all'">在下方时间线查看全部事件 <span>↓</span></button>
        </section>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="showEventDecisionDialog && currentEvent" class="event-decision-backdrop" @click.self="showEventDecisionDialog = false">
        <section class="event-decision-dialog" role="dialog" aria-modal="true" aria-labelledby="event-decision-title">
          <header class="event-decision-header">
            <div><span>事件判定详情 · {{ formatTimestamp(currentEvent.stepIndex) }}</span><h2 id="event-decision-title">判定过程</h2></div>
            <button aria-label="关闭判定过程" @click="showEventDecisionDialog = false">×</button>
          </header>
          <div class="event-decision-dialog-body">
            <section class="event-decision-overview" :class="'tone-' + eventTone(currentEvent)">
              <span class="event-explanation-result">{{ eventLabel(currentEvent) }}</span>
              <strong>{{ nodeName(currentEvent.sourceId) }} <i>→</i> {{ nodeName(currentEvent.targetId) }}</strong>
              <small>{{ currentEvent.phase === 'initial' && currentEvent.type === 'seed' ? '实验开始前已处于受影响状态' : `服务：${serviceLabel(currentEvent.service)}` }}</small>
            </section>
            <section v-if="currentEvent.route.length" class="event-decision-route">
              <span>仿真记录的实际路径</span>
              <div><template v-for="(nodeId, index) in currentEvent.route" :key="nodeId"><i v-if="index" aria-hidden="true">→</i><b>{{ nodeName(nodeId) }}</b></template></div>
            </section>
            <section v-if="currentEvent.matchedRuleName || currentEvent.blockedAt" class="event-decision-rule">
              <div v-if="currentEvent.matchedRuleName"><span>匹配规则</span><strong>{{ currentEvent.matchedRuleName }}</strong></div>
              <div v-if="currentEvent.blockedAt"><span>判定位置</span><strong>{{ displayText(currentEvent.blockedAt) }}</strong></div>
            </section>
            <section class="event-decision-section">
              <div class="event-decision-section-heading"><span>01</span><h3>行为与通信判定</h3></div>
              <div class="event-decision-list">
                <article v-for="(item, index) in decisionChain" :key="item.label" class="event-decision-row" :class="'chain-' + item.state">
                  <span class="event-decision-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <i>{{ item.state === 'pass' ? '✓' : item.state === 'fail' ? '×' : '·' }}</i>
                  <div><strong>{{ item.label }}</strong><p>{{ item.value }}</p></div>
                  <b>{{ item.state === 'pass' ? '通过' : item.state === 'fail' ? '未通过' : '说明' }}</b>
                </article>
              </div>
            </section>
            <section v-if="currentEvent.preconditionChecks?.length" class="event-decision-section">
              <div class="event-decision-section-heading"><span>02</span><h3>教学行为前置条件</h3><small>{{ currentEvent.preconditionChecks.filter((check) => check.passed).length }} / {{ currentEvent.preconditionChecks.length }} 项满足</small></div>
              <div class="event-precondition-list">
                <article v-for="check in currentEvent.preconditionChecks" :key="check.id" class="event-precondition-row" :class="{ passed: check.passed }">
                  <i>{{ check.passed ? '✓' : '×' }}</i>
                  <div><strong>{{ check.label }}</strong><p>{{ check.reason }}</p></div>
                  <b>{{ check.passed ? '满足' : '未满足' }}</b>
                </article>
              </div>
            </section>
            <section class="event-decision-conclusion"><span>本次判定说明</span><p>{{ displayText(currentEvent.reason) }}</p></section>
          </div>
          <footer class="event-decision-footer"><span>内容来自当前仿真事件的判定结果</span><button @click="showEventDecisionDialog = false">完成</button></footer>
        </section>
      </div>
      <div v-if="showPolicyDrawer" class="policy-drawer-backdrop" @click.self="showPolicyDrawer = false">
        <section class="policy-drawer" role="dialog" aria-modal="true" aria-labelledby="policy-drawer-title">
          <header class="policy-drawer-header"><div><span>每台 Firewall 独立执行策略</span><h2 id="policy-drawer-title">安全策略管理</h2></div><button aria-label="关闭策略管理" @click="showPolicyDrawer = false">×</button></header>
          <div v-if="isStale" class="policy-stale-banner">配置已变更，当前结果已过期。请重新运行实验。</div>
          <div class="policy-drawer-counts"><span>启用 <b>{{ enabledRules.length }}</b></span><span>拒绝 <b>{{ enabledDenyRules.length }}</b></span><span>允许 <b>{{ enabledAllowRules.length }}</b></span></div>
          <p class="rule-priority-note">First Match：按 order 从小到大检查，第一条匹配即生效；无匹配时采用本机 Default DENY。</p>
          <button class="small-add-button" @click="showRuleForm = !showRuleForm">{{ showRuleForm ? '取消新增' : '+ 新增规则' }}</button>
          <div v-if="showRuleForm" class="rule-editor">
            <label>规则名称<input v-model="ruleDraft.name" maxlength="40" placeholder="输入规则名称" /></label>
            <label>所属 Firewall<select v-model="ruleDraft.firewallId"><option v-for="policy in scenario.firewallPolicies" :key="policy.firewallId" :value="policy.firewallId">{{ policyName(policy) }}</option></select></label>
            <div class="rule-editor-grid"><label>来源类型<select v-model="ruleDraft.sourceKind"><option value="ANY">ANY</option><option value="ZONE">ZONE</option><option value="NODE">NODE</option></select></label><label v-if="ruleDraft.sourceKind === 'ZONE'">来源区域<select v-model="ruleDraft.sourceZone"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option></select></label><label v-else-if="ruleDraft.sourceKind === 'NODE'">来源节点<select v-model="ruleDraft.sourceNodeId"><option v-for="node in scenario.nodes" :key="node.id" :value="node.id">{{ displayNodeName(node.name) }}</option></select></label></div>
            <div class="rule-editor-grid"><label>目标类型<select v-model="ruleDraft.destinationKind"><option value="ANY">ANY</option><option value="ZONE">ZONE</option><option value="NODE">NODE</option></select></label><label v-if="ruleDraft.destinationKind === 'ZONE'">目标区域<select v-model="ruleDraft.targetZone"><option v-for="zone in NETWORK_ZONES" :key="zone" :value="zone">{{ zoneLabel(zone) }}</option></select></label><label v-else-if="ruleDraft.destinationKind === 'NODE'">目标节点<select v-model="ruleDraft.targetNodeId"><option v-for="node in scenario.nodes" :key="node.id" :value="node.id">{{ displayNodeName(node.name) }}</option></select></label></div>
            <div class="rule-editor-grid"><label>服务<select v-model="ruleDraft.serviceId"><option v-for="service in SERVICE_TYPES" :key="service" :value="service">{{ service }}</option></select></label><label>动作<select v-model="ruleDraft.action"><option value="ALLOW">允许</option><option value="DENY">拒绝</option></select></label></div>
            <button class="rule-save-button" @click="addRule">保存规则</button>
          </div>
          <div class="firewall-policy-groups">
            <section v-for="policy in scenario.firewallPolicies" :key="policy.firewallId" class="firewall-policy-group">
              <header><strong>{{ policyName(policy) }}</strong><label>Default Policy<select :value="policy.defaultAction" @change="scenarioStore.setFirewallDefault(policy.firewallId, ($event.target as HTMLSelectElement).value as RuleAction)"><option value="DENY">DENY</option><option value="ALLOW">ALLOW</option></select></label></header>
              <div v-for="(rule, index) in policy.rules.slice().sort((a, b) => a.order - b.order)" :key="rule.id" class="security-rule-row" :class="{ 'rule-disabled': !rule.enabled }">
                <span class="rule-order">{{ rule.order }}</span><span class="rule-action-pill" :class="rule.action.toLowerCase()">{{ rule.action }}</span>
                <div class="security-rule-copy"><strong>{{ rule.name }}</strong><small>{{ selectorLabel(rule.source) }} → {{ selectorLabel(rule.destination) }} · {{ rule.serviceId }}</small></div>
                <div class="rule-row-actions"><button aria-label="上移规则" :disabled="index === 0" @click="scenarioStore.moveFirewallRule(rule.id, -1)">↑</button><button aria-label="下移规则" :disabled="index === policy.rules.length - 1" @click="scenarioStore.moveFirewallRule(rule.id, 1)">↓</button><el-switch :model-value="rule.enabled" size="small" :aria-label="'启用规则 ' + rule.name" @change="scenarioStore.updateFirewallRule(rule.id, { enabled: Boolean($event) })" /><button class="rule-delete-button" :aria-label="'删除规则 ' + rule.name" @click="scenarioStore.removeFirewallRule(rule.id)">删</button></div>
              </div>
              <div v-if="!policy.rules.length" class="rule-list-empty">无规则，使用本机 Default {{ policy.defaultAction }}。</div>
            </section>
          </div>
          <footer class="policy-drawer-footer">策略顺序和启用状态会参与下一轮 First Match 计算；端口仍标记为待核定。</footer>
        </section>
      </div>
    </Teleport>

    <section class="simulation-controls panel-surface" :class="{ 'simulation-controls-focus': focusTopology, 'simulation-controls-unverified': !hasCurrentResult }">
      <div class="timeline-heading">
        <div><strong>{{ attackStateMode ? '代表攻击链' : '实验过程' }}</strong><small>{{ hasCurrentResult ? attackStateMode ? `${attackChainEvents.length} 个状态步骤 · 点击步骤回看` : `${eventMode === 'key' ? '关键事件' : '全部事件'} · ${visibleEvents.length} 个` : isStale ? '策略已修改，重新验证后查看计算结果' : '验证方案后可查看系统计算出的代表状态链' }}</small></div>
        <div v-if="hasCurrentResult && currentEvent" class="timeline-current-event"><b>{{ formatTimestamp(currentEvent.stepIndex) }}</b><span>{{ displayText(currentEvent.message) }}</span></div>
        <button v-if="hasCurrentResult && !attackStateMode" class="timeline-mode-button" @click="eventMode = eventMode === 'key' ? 'all' : 'key'">{{ eventMode === 'key' ? '查看全部事件' : '仅看关键事件' }}</button>
      </div>
      <div v-if="!hasCurrentResult" class="attack-chain-empty" role="status">{{ isStale ? '本轮配置尚未验证，代表链与回放控制暂不可用。' : '验证方案后，这里会显示计算出的状态步骤。' }}</div>
      <template v-else>
        <div v-if="attackStateMode" class="attack-chain-steps">
          <button v-for="(event, index) in attackChainEvents" :key="event.id" class="attack-chain-step" :class="[{ active: events.indexOf(event) === simulationStore.cursor }, 'step-' + eventTone(event)]" @click="seek(events.indexOf(event))">
            <span class="attack-chain-index">T{{ index }}</span><div><strong>{{ attackStepTitle(event) }}</strong><small>{{ nodeName(event.sourceId) }}{{ event.sourceId !== event.targetId ? ` → ${nodeName(event.targetId)}` : '' }}</small><b>{{ attackStepState(event) }}</b></div><i v-if="index < attackChainEvents.length - 1" class="attack-chain-connector">→</i>
          </button>
          <div v-if="!attackChainEvents.length" class="attack-chain-empty">本轮没有生成代表链步骤。</div>
        </div>
        <div v-else class="timeline-rail"><input class="timeline-range" type="range" min="0" :max="Math.max(0, visibleEvents.length - 1)" :value="Math.max(0, visibleEvents.findIndex(event => events.indexOf(event) === simulationStore.cursor))" :disabled="!visibleEvents.length" aria-label="实验事件时间线" @input="onTimelineInput" /><div class="timeline-markers"><button v-for="(event, index) in visibleEvents" :key="event.id" :class="['marker-' + eventTone(event), { active: events.indexOf(event) === simulationStore.cursor }]" :style="{ left: visibleEvents.length < 2 ? '0%' : `${index / (visibleEvents.length - 1) * 100}%` }" :title="`${formatTimestamp(event.stepIndex)} · ${event.message}`" @click="seek(events.indexOf(event))"></button></div></div>
        <div class="simulation-control-row">
          <div class="simulation-buttons">
            <button class="control-button primary" :disabled="simulationStore.status === 'running' || simulationStore.status === 'completed'" @click="playProcess">▶ 播放过程</button>
            <button class="control-button" :disabled="simulationStore.status !== 'running'" @click="simulationStore.pause()">Ⅱ 暂停</button>
            <button class="control-button" :disabled="simulationStore.status !== 'paused' || !playbackStarted" @click="continueProcess">▶ 继续</button>
            <button class="control-button" :disabled="simulationStore.cursor <= 0 || simulationStore.status === 'running'" @click="seek(simulationStore.cursor - 1)">上一步</button>
            <button class="control-button" :disabled="simulationStore.cursor >= events.length - 1 || simulationStore.status === 'running'" @click="seek(simulationStore.cursor + 1)">下一步</button>
            <button class="control-button" :disabled="simulationStore.status === 'running'" @click="replayProcess">重新播放</button>
          </div>
          <div class="simulation-speed"><span>速度</span><button v-for="speed in ([1, 2, 4] as const)" :key="speed" :class="{ active: simulationStore.speed === speed }" @click="simulationStore.setSpeed(speed)">×{{ speed }}</button></div>
        </div>
      </template>
    </section>

    <section v-if="verifiedResult" class="lab-completion-card panel-surface">
      <div class="completion-heading"><span class="completion-check">✓</span><div><h2>实验结果</h2></div><span class="completion-badge">本轮计算完成</span></div>
      <div class="completion-metrics">
        <template v-if="attackStateMode">
          <div class="completion-asset" :class="completedAssetTone"><span>关键数据目标 · {{ primaryAssetName }}</span><strong>{{ completedAssetOutcome }}</strong></div>
          <div><span>代表链</span><strong>{{ verifiedResult.metrics.representativeChainLength ?? 0 }} <small>步</small></strong></div>
          <div><span>必要业务</span><strong>{{ verifiedResult.metrics.businessPathsReachable }} <small>/ {{ verifiedResult.metrics.businessPathsTotal }}</small></strong></div>
        </template>
        <template v-else>
          <div><span>受影响节点</span><strong>{{ verifiedResult.metrics.affectedNodes }} <small>/ {{ verifiedResult.metrics.totalNodes }}</small></strong></div>
          <div><span>传播步骤</span><strong>{{ verifiedResult.metrics.propagationSteps }}</strong></div>
          <div class="completion-asset" :class="completedAssetReached ? 'asset-risk' : 'asset-safe'"><span>{{ primaryAssetName }}</span><strong>{{ completedAssetOutcome }}</strong></div>
          <div><span>业务可达率</span><strong>{{ verifiedResult.metrics.businessReachability }}<small>%</small></strong></div>
        </template>
      </div>
      <button class="result-details-toggle" :aria-expanded="showCompletionDetails" @click="showCompletionDetails = !showCompletionDetails">{{ showCompletionDetails ? '收起详情' : '查看详情' }}</button>
      <div v-if="showCompletionDetails" class="completion-details">
        <p v-if="attackStateMode" class="completion-search-status" :class="{ incomplete: !verifiedResult.attackSearchResult?.searchComplete }">{{ verifiedResult.attackSearchResult?.searchComplete ? '状态搜索完整 · ' + (verifiedResult.attackSearchResult.objectiveReached ? '关键数据目标存在可达代表链' : '当前搜索范围内未发现目标可达链') : '状态搜索未完整完成，目标安全状态暂不能判定。' }}</p>
        <p>必要业务可达率按本场景预设路径计算，不代表企业 SLA。</p>
        <span v-if="attackStateMode && verifiedResult.attackSearchResult">已探索 {{ verifiedResult.attackSearchResult.exploredStateCount }} 个状态 · 搜索深度 {{ verifiedResult.attackSearchResult.searchDepth }} / {{ verifiedResult.attackSearchResult.depthLimit }}</span>
        <details v-if="attackStateMode && attackSearchResult && !settingsStore.presentationMode" class="attack-search-details">
          <summary>技术详情 · 完整状态搜索记录（{{ attackSearchResult.searchEvaluations.length }} 项评估）</summary>
          <div class="attack-search-summary"><span>已探索状态 <b>{{ attackSearchResult.exploredStateCount }}</b></span><span>可行转移 <b>{{ attackSearchResult.successfulTransitions.length }}</b></span><span>去重阻断候选 <b>{{ attackSearchResult.blockedTransitions.length }}</b></span><span>搜索完整 <b>{{ attackSearchResult.searchComplete ? '是' : '否' }}</b></span><span>搜索深度 <b>{{ attackSearchResult.searchDepth }} / {{ attackSearchResult.depthLimit }}</b></span><span>状态上限 <b>{{ attackSearchResult.exploredStateCount }} / {{ attackSearchResult.stateLimit }}</b></span><span>是否触及上限 <b>{{ attackSearchResult.limitReached ? '是' : '否' }}</b></span><span>搜索范围内目标状态路径数量 <b>{{ attackSearchResult.objectiveStatePathCount }}</b></span></div>
          <div class="attack-search-evaluations"><article v-for="evaluation in attackSearchResult.searchEvaluations" :key="evaluation.id"><div><strong>{{ evaluation.techniqueName }} · {{ nodeName(evaluation.sourceNodeId) }} → {{ nodeName(evaluation.targetNodeId) }}</strong><span :class="'evaluation-' + evaluation.result.toLowerCase()">{{ transitionResultLabel(evaluation.result) }}</span></div><p>{{ displayText(evaluation.reason) }}</p><small v-if="evaluation.communicationDecision">通信路径：{{ evaluation.communicationDecision.path.map(nodeName).join(' → ') || '无可用路径' }}<template v-if="evaluation.communicationDecision.matchedRules.length"> · 规则：{{ evaluation.communicationDecision.matchedRules.map(rule => rule.name).join('、') }}</template></small><small v-if="evaluation.communicationDecision?.firewallDecisions.length">防火墙判定：{{ firewallDecisionSummary(evaluation.communicationDecision.firewallDecisions) }}</small><details><summary>Transition ID、状态签名与完整前置条件</summary><code>Transition ID {{ evaluation.id }}</code><code>前态 {{ attackStateSignature(evaluation.beforeState) }}</code><code>后态 {{ attackStateSignature(evaluation.afterState) }}</code><span v-for="check in evaluation.preconditionChecks" :key="check.id">{{ check.passed ? '✓' : '×' }} {{ check.label }} · {{ displayText(check.reason) }}</span></details></article></div>
        </details>
        <p v-if="!settingsStore.presentationMode" class="lab-disclaimer">本系统采用教学型抽象网络安全仿真模型，用于展示网络拓扑、安全策略和事件传播关系，不等同于真实网络攻击或风险预测。</p>
      </div>
      <div class="completion-actions"><span>查看本轮结果</span><div><RouterLink to="/compare">查看方案对比 →</RouterLink><button @click="managePolicy">重新配置策略</button><RouterLink to="/analysis">查看实验分析 →</RouterLink></div></div>
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
.challenge-panel { padding:16px 13px; }.challenge-title-mark { width:30px; height:30px; margin-bottom:10px; display:grid; place-items:center; border:1px solid rgba(106,191,188,.25); border-radius:9px; color:#8bd1ca; background:rgba(66,151,152,.1); font-size:17px; }.challenge-panel h3 { margin:5px 0 7px; color:#d4e2e4; font-size:13px; }.challenge-panel>p { margin:0; color:#879aa3; font-size:8px; line-height:1.65; }.challenge-goal { margin-top:13px; padding:10px; border:1px solid rgba(121,171,181,.13); border-radius:6px; background:rgba(43,84,99,.07); }.challenge-goal strong { color:#a9c7cb; font-size:8px; }.challenge-goal ul { margin:7px 0 0; padding-left:15px; color:#8298a2; font-size:7px; line-height:1.9; }.challenge-run-button { width:100%; min-height:33px; margin-top:12px; justify-content:center; font-size:9px; }.challenge-verdict { margin-top:10px; padding:8px; display:flex; align-items:center; gap:7px; border-radius:5px; }.challenge-verdict.passed { border:1px solid rgba(89,191,148,.23); color:#75c9a6; background:rgba(64,144,110,.1); }.challenge-verdict.failed { border:1px solid rgba(223,158,84,.2); color:#dbb772; background:rgba(166,119,52,.09); }.challenge-verdict i { width:16px; height:16px; flex:0 0 auto; display:grid; place-items:center; border:1px solid currentColor; border-radius:50%; font-style:normal; font-size:9px; }.challenge-verdict strong { font-size:7px; line-height:1.5; }.challenge-check-list { margin-top:8px; }.challenge-check-list>div { min-height:28px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(141,174,191,.07); color:#8ea1a9; font-size:7px; }.challenge-check-list b { color:#e09b80; font-size:7px; font-weight:500; }.challenge-check-list b.pass { color:#70c9a6; }.challenge-metrics { margin-top:8px; display:flex; justify-content:space-between; color:#778d98; font-size:6px; }.challenge-metrics b { color:#bad0d2; font:8px 'DM Mono',monospace; }.challenge-hint { margin-top:10px; color:#758b96; font-size:7px; line-height:1.6; }.challenge-diagnosis { margin-top:9px; padding:8px 9px; border:1px solid rgba(223,158,84,.22); border-radius:6px; background:rgba(166,119,52,.07); }.diagnosis-heading { display:flex; align-items:baseline; gap:6px; margin-bottom:5px; }.diagnosis-heading>span { color:#dfb276; font-size:8px; font-weight:600; letter-spacing:.5px; }.diagnosis-heading small { color:#9a8864; font-size:7px; }.diagnosis-item { display:flex; gap:8px; padding:7px 0 6px 3px; border-top:1px dashed rgba(223,158,84,.15); }.diagnosis-item+.diagnosis-item { margin-top:1px; }.diagnosis-item i { width:14px; height:14px; flex:0 0 auto; margin-top:1px; display:grid; place-items:center; border:1px solid rgba(230,168,96,.45); border-radius:50%; color:#dfb276; font-style:normal; font-size:7px; }.diagnosis-item>div { min-width:0; flex:1; }.diagnosis-item strong { display:block; color:#cfae77; font-size:8px; line-height:1.4; }.diagnosis-item p { margin:3px 0 4px; color:#a2885f; font-size:7px; line-height:1.55; }.diagnosis-item small { display:block; color:#b99c6a; font-size:7px; line-height:1.55; }
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
.strategy-lab .section-kicker { font-size:13px; }.strategy-lab .lab-panel-title h2 { font-size:17px; }.strategy-lab .scenario-summary-card>strong { font-size:15px; }.strategy-lab .scenario-summary-card p { font-size:14px; }.strategy-lab .scenario-level { font-size:13px; }.strategy-lab .initial-condition strong { font-size:14px; }.strategy-lab .initial-condition p { font-size:13px; }.strategy-lab .challenge-panel-primary>p,.strategy-lab .challenge-panel-primary .challenge-goal li { font-size:14px; }.strategy-lab .challenge-condition-block span { font-size:13px; }.strategy-lab .challenge-condition-block strong { font-size:14px; }.strategy-lab .challenge-hint { font-size:14px; }.strategy-lab .challenge-check-list>div,.strategy-lab .challenge-check-list b { font-size:13px; }.strategy-lab .challenge-metrics { font-size:13px; }.strategy-lab .lab-heading-actions .lab-utility-button { font-size:13px; }.strategy-lab .scene-bottom-status { font-size:13px; }.strategy-lab .timeline-heading strong { font-size:16px; }.strategy-lab .timeline-heading small { font-size:13px; }.strategy-lab .control-button { font-size:13px; }.strategy-lab .simulation-speed { font-size:13px; }.strategy-lab .simulation-speed button { font-size:13px; }.strategy-lab .simulation-metrics-mini { font-size:12px; }.strategy-lab .simulation-metrics-mini b { font-size:12px; }.strategy-lab .lab-disclaimer { font-size:13px; }
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
.challenge-diagnosis { margin-top:12px; padding:12px; border:1px solid color-mix(in srgb, var(--warning) 30%, var(--border)); border-radius:8px; background:color-mix(in srgb, var(--warning) 6%, var(--panel-bg)); }
.diagnosis-heading { display:flex; align-items:baseline; gap:8px; margin-bottom:8px; }.diagnosis-heading>span { color:var(--warning); font-size:14px; font-weight:650; letter-spacing:.5px; }.diagnosis-heading small { color:var(--text-muted); font-size:12px; }
.diagnosis-item { display:flex; gap:10px; padding:9px 2px 9px 4px; border-top:1px dashed color-mix(in srgb, var(--warning) 22%, transparent); }.diagnosis-item>i { width:17px; height:17px; flex:0 0 auto; margin-top:2px; display:grid; place-items:center; border:1px solid color-mix(in srgb, var(--warning) 55%, transparent); border-radius:50%; color:var(--warning); font-style:normal; font-size:10px; }.diagnosis-item>div { min-width:0; flex:1; }.diagnosis-item strong { display:block; color:var(--text-primary); font-size:13px; line-height:1.4; }.diagnosis-item p { margin:4px 0 5px; color:var(--text-secondary); font-size:12px; line-height:1.55; }.diagnosis-item small { display:block; color:var(--warning); font-size:12px; line-height:1.55; }
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
.challenge-semantics { margin:10px 0 11px; color:var(--accent); font-size:14px; font-weight:650; line-height:1.4; }
.challenge-panel-primary .challenge-requirements > strong,
.challenge-panel-primary .challenge-requirements > div > span,
.challenge-panel-primary .challenge-requirements > div > b,
.challenge-panel-primary .challenge-brief-row > span,
.challenge-panel-primary .challenge-brief-row > strong { font-size:14px; }
.challenge-panel-primary .challenge-check-list span,
.challenge-panel-primary .challenge-check-list b,
.challenge-panel-primary .challenge-count,
.challenge-panel-primary .challenge-verdict,
.challenge-panel-primary .challenge-verdict strong { font-size:14px; }
.challenge-panel-primary .challenge-diagnosis p,
.challenge-panel-primary .challenge-diagnosis small,
.challenge-panel-primary .challenge-diagnosis strong { font-size:14px; }
.challenge-panel-primary .initial-condition p { font-size:14px; }
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
.asset-access-properties { margin:0 11px 8px; padding:9px 10px; border:1px solid rgba(113,186,164,.18); border-radius:6px; background:rgba(44,104,86,.07); }
.asset-access-properties>div { display:flex; justify-content:space-between; gap:10px; padding:4px 0; color:var(--text-muted); font-size:13px; }
.asset-access-properties strong { color:var(--text-primary); font-size:13px; }
.asset-access-properties .data-target-risk { color:var(--danger); }.asset-access-properties .data-target-safe { color:var(--success); }
.completion-asset.asset-unknown strong { color:var(--warning); }
.completion-search-status { margin:-2px 0 10px; color:var(--success); font-size:14px; }.completion-search-status.incomplete { color:var(--warning); }
.event-diagnostic-details { margin:8px 0 0; padding:8px 10px; border:1px solid var(--border); border-radius:7px; background:var(--panel-raised); }
.event-diagnostic-details>summary,.attack-search-details>summary { color:var(--accent); font-size:14px; font-weight:600; cursor:pointer; }
.event-diagnostic-details .event-explanation-message { margin:10px 0 2px; font-size:13px; line-height:1.55; }
.attack-search-details { margin-top:12px; padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:var(--panel-bg); }
.attack-search-summary { padding:12px 0; display:flex; flex-wrap:wrap; gap:16px; color:var(--text-muted); font-size:13px; }
.attack-search-summary b { margin-left:4px; color:var(--text-primary); }
.attack-search-evaluations { max-height:420px; overflow:auto; border-top:1px solid var(--border); }
.attack-search-evaluations>article { padding:11px 2px; border-bottom:1px solid var(--border); }
.attack-search-evaluations>article>div { display:flex; justify-content:space-between; gap:10px; }
.attack-search-evaluations strong { color:var(--text-primary); font-size:14px; }
.attack-search-evaluations p,.attack-search-evaluations small { display:block; margin:5px 0; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.attack-search-evaluations code,.attack-search-evaluations details>span { display:block; margin:5px 0; overflow-wrap:anywhere; color:var(--text-muted); font-size:12px; }
.evaluation-success { color:var(--success); }.evaluation-blocked { color:var(--warning); }.evaluation-not_applicable { color:var(--text-muted); }
.attack-search-evaluations details>summary { margin-top:8px; color:var(--accent); font-size:13px; cursor:pointer; }
.asset-access-properties,.event-diagnostic-details,.attack-search-details { color:var(--text-secondary); }
.policy-drawer { overflow:hidden; }
.policy-stale-banner { flex:0 0 auto; margin:12px 0 0; padding:11px 13px; border:1px solid color-mix(in srgb,var(--warning) 35%,transparent); border-radius:7px; color:var(--warning); background:color-mix(in srgb,var(--warning) 8%,var(--panel-bg)); font-size:13px; }
.firewall-policy-groups { min-height:0; flex:1 1 auto; overflow:auto; padding-right:5px; }
.firewall-policy-group { margin:12px 0; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }
.firewall-policy-group>header { min-height:38px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--border); }
.firewall-policy-group>header strong { color:var(--text-primary); font-size:15px; }
.firewall-policy-group>header label { display:flex; align-items:center; gap:7px; color:var(--text-muted); font-size:12px; }
.firewall-policy-group>header select { padding:5px 7px; border:1px solid var(--border); border-radius:5px; color:var(--text-primary); background:var(--panel-bg); }
.security-rule-row { min-height:58px; grid-template-columns:34px 66px minmax(120px,1fr) auto; align-items:center; }
.rule-order { color:var(--text-muted); font:12px 'DM Mono',monospace; }
.rule-action-pill { width:auto; min-width:48px; }
.rule-row-actions { display:flex; align-items:center; gap:5px; }
.rule-row-actions button:not(.rule-delete-button) { width:27px; height:27px; border:1px solid var(--border); border-radius:5px; color:var(--text-secondary); background:var(--panel-bg); cursor:pointer; }
.rule-row-actions button:disabled { opacity:.35; cursor:default; }
.rule-row-actions .rule-delete-button { min-width:34px; width:34px; }
.rule-editor { max-height:34vh; overflow:auto; }
.rule-editor-grid { grid-template-columns:1fr 1fr; }
.rule-editor label { min-width:0; }
.rule-priority-note { flex:0 0 auto; }
.policy-drawer-footer { flex:0 0 auto; }

/* Final presentation hierarchy: task, topology, explanation, then controls. */
.lab-heading { margin:4px 0 12px; }
.lab-heading h1 { font-size:28px; }
.heading-subtitle { font-size:14px; }
.strategy-workspace { grid-template-columns:minmax(224px,250px) minmax(560px,1fr) minmax(268px,290px); gap:12px; }
.lab-left-panel { max-height:calc(100vh - 180px); padding-bottom:10px; }
.lab-experiment-intro { padding:15px 16px 13px; }
.lab-experiment-intro h2 { margin:7px 0 9px; font-size:18px; }
.lab-experiment-details { color:var(--text-secondary); }
.lab-experiment-details>summary { color:var(--accent); font-size:13px; cursor:pointer; }
.lab-experiment-details>p { margin-top:9px; font-size:13px; line-height:1.55; }
.lab-experiment-details ul { margin:8px 0 0; padding-left:18px; color:var(--text-muted); font-size:13px; line-height:1.55; }
.lab-experiment-details .initial-condition { margin:10px 0 0; padding:10px; }
.lab-experiment-details .initial-condition p { margin:5px 0 0; font-size:13px; }
.challenge-panel-primary { margin:0; padding:17px 16px 12px; overflow:visible; border:0; border-radius:0; background:transparent; }
.challenge-heading-row { margin-bottom:8px; }
.challenge-title-mark { width:25px; height:25px; margin:0; border-radius:7px; font-size:14px; }
.challenge-live-tag { color:var(--accent); font-size:14px; }
.challenge-panel-primary h3 { margin:5px 0 13px; font-size:19px; }
.challenge-panel-primary .challenge-requirements { margin-top:12px; padding:10px 0 4px; border:0; border-top:1px solid var(--border); border-radius:0; background:transparent; }
.challenge-panel-primary .challenge-requirements>strong { margin-bottom:6px; color:var(--text-secondary); font-size:14px; }
.challenge-panel-primary .challenge-requirements>div { min-height:34px; gap:7px; font-size:13px; }
.challenge-panel-primary .challenge-requirements>div>b { font-size:11px; }
.challenge-semantics { margin:11px 0 13px; color:var(--accent); font-size:13px; font-weight:650; }
.challenge-panel-primary .challenge-actions { display:grid; grid-template-columns:1fr; gap:8px; }
.challenge-panel-primary .challenge-actions>button { min-height:40px; font-size:14px; }
.challenge-panel-primary .challenge-actions .challenge-policy-link { justify-content:space-between; padding:0 12px; border:1px solid var(--border); border-radius:7px; background:var(--panel-raised); }
.challenge-panel-primary .challenge-run-button { padding:0 12px; }
.challenge-panel-primary .challenge-verdict { margin-top:13px; padding:11px; gap:9px; }
.challenge-panel-primary .challenge-verdict strong { font-size:13px; line-height:1.45; }
.challenge-panel-primary .challenge-check-list { margin-top:8px; }
.challenge-panel-primary .challenge-check-list>div { min-height:34px; padding:2px 0; font-size:13px; }
.challenge-panel-primary .challenge-check-list b { font-size:13px; }
.challenge-panel-primary .challenge-count { margin-top:8px; color:var(--text-muted); font-size:12px; }
.challenge-panel-primary .challenge-diagnosis { padding:0; border:0; border-top:1px solid var(--border); border-radius:0; background:transparent; }
.challenge-panel-primary .challenge-diagnosis>summary { padding:10px 0 4px; color:var(--warning); font-size:13px; font-weight:600; cursor:pointer; }
.challenge-panel-primary .diagnosis-item { gap:8px; padding:9px 0; }
.challenge-panel-primary .diagnosis-item strong { font-size:13px; }.challenge-panel-primary .diagnosis-item p,.challenge-panel-primary .diagnosis-item small { font-size:12px; line-height:1.5; }
.learning-objectives-panel { margin:14px; padding:0 2px; border:0; background:transparent; }
.learning-objectives-panel h3 { font-size:16px; }.learning-objectives-panel li { font-size:13px; }
.lab-learning-link { margin:10px 16px 0; }
.lab-scene-panel { min-height:620px; }
.lab-scene-panel:has(.lab-task-status) { grid-template-rows:auto 56px minmax(440px,1fr) 38px; }
.lab-task-status { min-height:70px; padding:11px 16px; display:grid; grid-template-columns:minmax(170px,1fr) minmax(180px,1fr) auto; align-items:center; gap:18px; border-bottom:1px solid var(--border); background:linear-gradient(90deg,rgba(52,118,119,.11),transparent 60%); }
.lab-task-primary,.lab-task-result { display:flex; flex-direction:column; gap:4px; }
.lab-task-primary>span,.lab-task-result>span { color:#8ba2ac; font-size:12px; }
.lab-task-primary>strong { color:#e2eeee; font-size:18px; line-height:1.25; }
.lab-task-result>strong { color:#c4d3d7; font-size:15px; line-height:1.3; }
.lab-task-status.task-pending .lab-task-result>strong { color:#aabac1; }.lab-task-status.task-risk .lab-task-result>strong { color:#ec9386; }.lab-task-status.task-safe .lab-task-result>strong { color:#79d0a6; }.lab-task-status.task-stale .lab-task-result>strong { color:#e1bd73; }
.lab-host-data-state { min-width:210px; display:flex; align-items:center; gap:13px; padding:8px 11px; border-left:1px solid rgba(143,177,190,.17); }
.lab-host-data-state>div { min-width:78px; display:flex; flex-direction:column; gap:4px; }.lab-host-data-state small { color:#859ba4; font-size:11px; }.lab-host-data-state b { color:#d0dfe1; font-size:13px; font-weight:600; }.lab-host-data-state i { width:1px; height:28px; background:rgba(143,177,190,.2); }
.lab-host-data-state .data-state-risk { color:#ee9588; }.lab-host-data-state .data-state-safe { color:#77d0a4; }
.lab-scene-toolbar { min-width:0; gap:10px; }.scene-toolbar-title { flex:0 0 auto; }.scene-toolbar-actions { gap:6px; }.scene-toolbar-button { min-height:34px; padding:0 9px; font-size:12px; }
.lab-right-panel { min-height:570px; max-height:calc(100vh - 180px); }
.event-explanation-card { margin:8px 10px; padding:13px 12px; }
.event-explanation-result { font-size:13px; }
.event-explanation-grid { grid-template-columns:1fr; gap:0; }
.event-explanation-block { min-height:0; padding:10px 0; border:0; border-bottom:1px solid var(--border); border-radius:0; background:transparent; }
.event-explanation-block>span { margin-bottom:5px; font-size:12px; }
.event-explanation-block>strong { font-size:14px; line-height:1.5; }
.event-explanation-block>small { font-size:12px; line-height:1.5; }
.event-route-chips b { font-size:12px; }.event-route-chips .route-chip-arrow { font-size:14px; }
.event-diagnostic-details { padding:9px 0 0; border:0; border-top:1px solid var(--border); border-radius:0; background:transparent; }
.event-open-timeline { width:calc(100% - 22px); margin:0 11px 11px; }
.completion-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); }
.completion-actions>span { display:none; }
.simulation-controls { padding:13px 16px; }
.timeline-heading { gap:10px; }.timeline-heading>div:first-child { flex-direction:column; align-items:flex-start; gap:3px; }.timeline-heading strong { font-size:17px; }
.attack-chain-steps { min-height:76px; margin:9px 2px 11px; display:flex; align-items:stretch; overflow-x:auto; scrollbar-width:thin; }
.attack-chain-step { min-width:0; flex:1 1 0; position:relative; padding:8px 13px 8px 10px; display:grid; grid-template-columns:32px minmax(0,1fr); align-items:start; gap:9px; border:0; border-top:2px solid var(--border-strong); color:var(--text-primary); background:transparent; text-align:left; cursor:pointer; }
.attack-chain-step:hover,.attack-chain-step.active { border-top-color:var(--accent); background:color-mix(in srgb,var(--accent) 6%,transparent); }
.attack-chain-index { width:29px; height:29px; display:grid; place-items:center; border:1px solid var(--border-strong); border-radius:50%; color:var(--accent); font:600 12px 'DM Mono',monospace; }
.attack-chain-step>div { min-width:0; display:flex; flex-direction:column; gap:4px; }
.attack-chain-step strong { color:var(--text-primary); font-size:13px; line-height:1.4; }.attack-chain-step small { color:var(--text-muted); font-size:12px; line-height:1.4; }.attack-chain-step>div>b { color:var(--text-secondary); font-size:12px; font-weight:600; }
.attack-chain-step.step-risk>div>b { color:var(--danger); }.attack-chain-step.step-blocked>div>b { color:var(--success); }.attack-chain-connector { position:absolute; top:-10px; right:-5px; z-index:1; color:var(--text-muted); font-size:13px; font-style:normal; }
.attack-chain-empty { padding:18px 10px; color:var(--text-muted); font-size:14px; }
.simulation-controls-focus .attack-chain-steps { min-height:60px; margin-top:7px; }
@media(min-width:1451px) and (max-width:1599px) {
  .strategy-workspace { grid-template-columns:230px minmax(0,1fr) 250px; }
  .strategy-workspace.presentation-layout { grid-template-columns:214px minmax(0,1fr) 234px; }
  .strategy-workspace.presentation-layout.presentation-right-hidden { grid-template-columns:214px minmax(0,1fr); }
}
@media(max-width:1450px) {
  .strategy-workspace { display:block; }
  .lab-scene-panel:has(.lab-task-status) { grid-template-rows:auto 56px minmax(440px,1fr) 38px; }
  .lab-task-status { grid-template-columns:minmax(140px,1fr) minmax(140px,1fr) auto; gap:10px; padding:9px 12px; }
  .lab-host-data-state { min-width:185px; gap:8px; padding:7px 9px; }
  .attack-chain-step { min-width:190px; }
}
@media(max-width:1240px) {
  .lab-task-status { grid-template-columns:1fr 1fr; }
  .lab-host-data-state { grid-column:1/-1; min-width:0; padding:7px 0 0; border-left:0; border-top:1px solid rgba(143,177,190,.17); }
  .lab-scene-panel:has(.lab-task-status) { grid-template-rows:auto 56px minmax(390px,1fr) 38px; }
}

.attack-state-lab .lab-experiment-intro>span { color:var(--text-muted); font-size:14px; }
.attack-state-lab .lab-experiment-intro h2 { color:var(--text-primary); font-size:19px; line-height:1.4; }
.attack-state-lab .lab-experiment-details>summary { font-size:14px; }
.attack-state-lab .lab-experiment-details>p,
.attack-state-lab .lab-experiment-details ul,
.attack-state-lab .lab-experiment-details .initial-condition p { font-size:14px; line-height:1.55; }
.attack-state-lab .challenge-panel-primary h3 { font-size:19px; }
.attack-state-lab .challenge-requirements>strong,
.attack-state-lab .challenge-requirements>div>span,
.attack-state-lab .challenge-requirements>div>b,
.attack-state-lab .challenge-semantics,
.attack-state-lab .challenge-verdict strong,
.attack-state-lab .challenge-check-list>div,
.attack-state-lab .challenge-check-list b,
.attack-state-lab .challenge-count,
.attack-state-lab .challenge-hint { font-size:14px; }
.attack-state-lab .challenge-verdict small,
.attack-state-lab .diagnosis-item p,
.attack-state-lab .diagnosis-item small { font-size:13px; line-height:1.5; }
.attack-state-lab .scene-toolbar-title strong { font-size:15px; }
.attack-state-lab .scene-toolbar-title small { font-size:13px; }
.attack-state-lab .scene-toolbar-button { min-height:36px; font-size:14px; }
.attack-state-lab .lab-task-primary>span,
.attack-state-lab .lab-task-result>span { font-size:13px; }
.attack-state-lab .lab-host-data-state small { font-size:12px; }
.attack-state-lab .lab-host-data-state b { font-size:14px; }
.attack-state-lab .event-explanation-result { font-size:14px; }
.attack-state-lab .event-explanation-block>span { font-size:13px; }
.attack-state-lab .event-explanation-block>strong,
.attack-state-lab .event-explanation-block>small,
.attack-state-lab .event-diagnostic-details>summary { font-size:14px; line-height:1.5; }
.attack-state-lab .timeline-heading>div:first-child>small,
.attack-state-lab .timeline-current-event { font-size:14px; }
.attack-state-lab .attack-chain-step strong,
.attack-state-lab .attack-chain-step small,
.attack-state-lab .attack-chain-step>div>b { font-size:14px; line-height:1.45; }
.attack-state-lab .simulation-control-row .control-button,
.attack-state-lab .simulation-speed>span,
.attack-state-lab .simulation-speed button { min-height:38px; font-size:14px; }
.attack-state-lab .completion-metrics>div>span,
.attack-state-lab .completion-asset>span { font-size:14px; }
.attack-state-lab .completion-actions a,
.attack-state-lab .completion-actions button { font-size:14px; }
@media(max-width:1450px) {
  .attack-state-lab .lab-left-panel { width:min(250px,calc(100% - 28px)); }
  .attack-state-lab .lab-right-panel { width:min(286px,calc(100% - 28px)); }
  .attack-state-lab .lab-task-status { grid-template-columns:minmax(130px,1fr) minmax(130px,1fr) auto; }
}
@media(max-width:1240px) {
  .attack-state-lab .lab-task-status { grid-template-columns:1fr 1fr; }
}
.scene-event-notice,
.scene-challenge-success { min-height:30px; padding:0 9px; display:inline-flex; align-items:center; border:1px solid var(--border); border-radius:6px; font-size:13px; white-space:nowrap; }
.scene-event-notice { color:var(--warning); border-color:color-mix(in srgb,var(--warning) 30%,var(--border)); background:color-mix(in srgb,var(--warning) 7%,var(--panel-bg)); }
.scene-challenge-success { color:var(--success); border-color:color-mix(in srgb,var(--success) 30%,var(--border)); background:color-mix(in srgb,var(--success) 7%,var(--panel-bg)); }
.strategy-lab .lab-heading-actions .lab-utility-button { min-height:38px; padding-inline:12px; color:var(--text-secondary); font-size:13px; }
.strategy-lab .lab-task-primary>span,
.strategy-lab .lab-task-result>span,
.strategy-lab .lab-host-data-state small { font-size:13px; }
.strategy-lab .lab-host-data-state b { font-size:14px; }
.strategy-lab .scene-hint { font-size:13px; }
.strategy-lab .scene-bottom-status,
.strategy-lab .scene-bottom-status>span { font-size:13px; }
.strategy-lab .timeline-heading strong { font-size:16px; }
.strategy-lab .timeline-heading small,
.strategy-lab .timeline-current-event { font-size:13px; }
.strategy-lab .simulation-control-row .control-button { min-height:36px; font-size:13px; }
.strategy-lab .simulation-speed,
.strategy-lab .simulation-speed button { font-size:13px; }
.strategy-lab .simulation-metrics-mini { font-size:12px; }
.strategy-lab .simulation-metrics-mini b { font-size:12px; }
.strategy-lab .lab-disclaimer { font-size:12px; }
.strategy-lab :deep(.page-scenario-select .el-select__placeholder),
.strategy-lab :deep(.page-scenario-select .el-select__selected-item) { font-size:14px; }
.strategy-lab :deep(.page-scenario-select .el-select__wrapper) { min-height:38px; }
.strategy-lab .challenge-panel-primary .challenge-actions .challenge-policy-link { min-height:36px; font-size:13px; }
.strategy-lab .challenge-panel-primary .challenge-actions .challenge-run-button { min-height:40px; font-size:15px; }
.policy-drawer .firewall-policy-group>header label,
.policy-drawer .security-rule-copy small,
.policy-drawer .policy-highlight small,
.strategy-lab .protection-card small,
.strategy-lab .critical-toggle small,
.strategy-lab .node-related-event p,
.strategy-lab .node-related-event small { font-size:13px; line-height:1.45; }
.policy-drawer .rule-action-pill,
.policy-drawer .rule-delete-button { font-size:13px; }
.strategy-lab .event-explanation-result,
.strategy-lab .event-explanation-service,
.strategy-lab .event-detail-line span,
.strategy-lab .event-rule-match>span,
.strategy-lab .event-rule-match small,
.strategy-lab .event-route-chips b { font-size:13px; }
@media(max-width:1450px) {
  .strategy-workspace.left-drawer-open .lab-right-panel,
  .strategy-workspace.right-drawer-open .lab-left-panel { opacity:0; visibility:hidden; pointer-events:none; }
  .strategy-workspace.presentation-layout.presentation-right-hidden .lab-right-panel { display:none; }
  .strategy-workspace .lab-left-panel { width:min(250px,calc(100% - 28px)); }
  .strategy-workspace .lab-right-panel { width:min(286px,calc(100% - 28px)); }
  .scene-toolbar-button { min-height:34px; padding:0 9px; font-size:13px; }
  .scene-drawer-button { display:inline-flex; }
}

@media (min-width:1200px) and (max-height:820px) {
  .strategy-lab { min-height:calc(100vh - 60px); padding-top:4px; padding-bottom:8px; }
  .strategy-lab .lab-heading { min-height:44px; margin:0 0 6px; }
  .strategy-lab .lab-heading h1 { font-size:24px; }
  .strategy-lab .heading-subtitle { font-size:14px; }
  .strategy-lab .strategy-stale-banner { min-height:44px; margin-bottom:8px; }
  .strategy-lab .lab-scene-panel,
  .strategy-lab .lab-scene-panel:has(.lab-task-status) { min-height:460px; grid-template-rows:auto 42px minmax(340px,1fr) 28px; }
  .strategy-lab .lab-task-status { min-height:48px; padding:5px 9px; gap:7px; }
  .strategy-lab .lab-task-primary>strong { font-size:16px; }
  .strategy-lab .lab-scene-toolbar { min-height:42px; padding:0 9px; gap:6px; }
  .strategy-lab .lab-scene-canvas,
  .strategy-lab .lab-scene-canvas :deep(.network-scene) { min-height:340px; }
  .strategy-lab .scene-bottom-status { min-height:28px; }
  .strategy-lab .simulation-controls { margin-top:7px; padding:6px 10px; }
  .strategy-lab .timeline-heading { min-height:28px; gap:7px; }
  .strategy-lab .timeline-heading>div:first-child { gap:2px; }
  .strategy-lab .attack-chain-steps { min-height:42px; margin:4px 2px 5px; }
  .strategy-lab .attack-chain-step { padding:3px 8px 3px 6px; }
  .strategy-lab .attack-chain-index { width:22px; height:22px; }
  .strategy-lab .simulation-control-row { min-height:34px; gap:7px; }
  .strategy-lab .simulation-buttons { gap:4px; }
  .strategy-lab .simulation-control-row .control-button,
  .strategy-lab .simulation-speed button { min-height:32px; padding:0 8px; }
  .strategy-lab .lab-disclaimer { display:none; }
  .strategy-lab .attack-search-details { margin-top:7px; }
}

.attack-state-lab .lab-task-status { grid-template-columns:minmax(150px,.7fr) minmax(440px,1.8fr) minmax(205px,auto); }
.attack-state-lab .lab-task-result { min-width:0; }
.core-result-items { min-width:0; display:flex; align-items:center; gap:9px; white-space:nowrap; }
.core-result-items>span { color:var(--text-secondary); font-size:13px; }
.core-result-items b { margin-left:3px; color:var(--text-primary); font-size:15px; font-weight:700; }
.core-result-items b.core-result-safe { color:var(--success); }.core-result-items b.core-result-risk { color:var(--danger); }
.core-result-items>i { width:1px; height:19px; flex:0 0 auto; background:var(--border-strong); }
.critical-data-access-summary { margin-top:12px; padding:12px; border:1px solid color-mix(in srgb,var(--success) 28%,var(--border)); border-radius:8px; background:color-mix(in srgb,var(--success) 6%,var(--panel-bg)); }
.critical-data-access-heading { display:flex; flex-direction:column; gap:5px; }.critical-data-access-heading>span,.critical-data-access-route>span { color:var(--text-muted); font-size:13px; }
.critical-data-access-heading>strong { color:var(--text-primary); font-size:16px; line-height:1.45; }.critical-data-access-heading i { color:var(--accent); font-style:normal; }
.critical-data-access-status { margin-top:10px; display:flex; gap:16px; }.critical-data-access-status span { color:var(--text-secondary); font-size:14px; }
.critical-data-access-status b { margin-left:4px; color:var(--success); font-size:14px; }.critical-data-access-status .communication-established { color:var(--accent); }
.critical-data-access-route { margin-top:11px; padding-top:9px; border-top:1px solid var(--border); }.critical-data-access-route strong { margin-top:5px; display:block; color:var(--text-primary); font-size:13px; line-height:1.65; overflow-wrap:anywhere; }
.critical-data-access-summary p { margin:9px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.critical-data-access-conclusion { margin-top:9px; color:var(--success); font-size:14px; font-weight:650; line-height:1.45; }
@media (min-width:1200px) and (max-height:820px) {
  .strategy-lab .attack-chain-steps { min-height:48px; margin:4px 2px 5px; }
  .strategy-lab .attack-chain-step { grid-template-columns:22px minmax(0,1fr); gap:6px; padding:3px 8px 3px 5px; }
  .strategy-lab .attack-chain-index { width:22px; height:22px; }
  .strategy-lab .attack-chain-step>div { display:grid; grid-template-columns:minmax(0,1fr); align-content:center; gap:1px; }
  .strategy-lab .attack-chain-step>div>small { display:none; }
  .strategy-lab .attack-chain-step strong { font-size:14px; line-height:1.35; }
  .strategy-lab .attack-chain-step>div>b { font-size:13px; line-height:1.3; }
  .core-result-items { gap:7px; }
  .core-result-items b { font-size:14px; }
}
.lab-scene-panel > .lab-scene-canvas { width:100%; min-width:0; }
.lab-scene-panel > .lab-scene-canvas :deep(.network-scene) { width:100%; min-width:0; }
@media (max-width:1240px) {
  .attack-state-lab .lab-task-status { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .attack-state-lab .lab-host-data-state { grid-column:1/-1; }
  .attack-state-lab .lab-task-result { grid-column:1/-1; }
  .core-result-items { flex-wrap:wrap; }
}
@media (min-width:1200px) and (max-height:820px) {
  .strategy-lab { height:auto; overflow:visible; }
  .strategy-lab .strategy-workspace { height:490px; min-height:490px; flex:0 0 490px; }
  .strategy-lab .lab-scene-panel { height:100%; min-height:0; }
}
.challenge-panel-primary .challenge-check-list {
  display:flex;
  flex-direction:column;
  gap:6px;
}
.challenge-panel-primary .challenge-check-list>div {
  min-height:40px;
  padding:8px 10px;
  display:flex;
  flex-direction:row;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  box-sizing:border-box;
  border:1px solid var(--border);
  border-radius:7px;
  background:var(--panel-raised);
}
.challenge-panel-primary .challenge-check-list>div>span {
  min-height:0;
  color:var(--text-secondary);
  font-size:14px;
  line-height:1.45;
}
.challenge-panel-primary .challenge-check-list>div>b {
  flex:0 0 auto;
  padding:3px 8px;
  border:1px solid color-mix(in srgb, var(--danger) 24%, var(--border));
  border-radius:999px;
  color:var(--danger);
  font-size:13px;
  font-weight:650;
  line-height:1.3;
}
.challenge-panel-primary .challenge-check-list>div>b.pass {
  border-color:color-mix(in srgb, var(--success) 26%, var(--border));
  color:var(--success);
}
.strategy-lab .lab-left-panel {
  min-height:0;
  max-height:none;
  height:max-content;
  overflow:visible;
  align-self:start;
}
.strategy-lab .lab-experiment-intro { padding:15px 16px 12px; }
.strategy-lab .lab-experiment-details>summary { color:var(--accent); font-size:13px; cursor:pointer; }
.strategy-lab .lab-experiment-details>p { margin-top:9px; }
.lab-related-knowledge { margin-top:9px; display:inline-flex; align-items:center; gap:6px; color:var(--accent); font-size:13px; text-decoration:none; }
.lab-related-knowledge:hover { color:var(--text-primary); }
.challenge-panel-primary { padding:14px 16px; overflow:visible; border-bottom:1px solid var(--border); }
.challenge-panel-primary .challenge-heading-row { display:flex; justify-content:space-between; align-items:center; margin:0 0 5px; }
.challenge-progress { padding:4px 8px; border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border)); border-radius:999px; color:var(--accent); font-size:13px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.challenge-panel-primary h3 { margin:7px 0 10px; font-size:18px; }
.challenge-goal { margin:0; padding:9px 10px; border:0; border-left:2px solid color-mix(in srgb,var(--accent) 52%,transparent); border-radius:0 6px 6px 0; background:color-mix(in srgb,var(--accent) 5%,var(--panel-bg)); }
.challenge-goal strong { color:var(--text-secondary); font-size:12px; }
.challenge-goal p { margin:4px 0 0; color:var(--text-primary); font-size:13px; line-height:1.5; }
.challenge-panel-primary .challenge-requirements { margin-top:12px; padding:10px 0 0; border-top:1px solid var(--border); }
.challenge-panel-primary .challenge-requirements>strong { margin-bottom:4px; color:var(--text-secondary); font-size:13px; }
.challenge-panel-primary .challenge-requirements>div { min-height:30px; display:grid; grid-template-columns:17px minmax(0,1fr) auto; align-items:center; gap:6px; }
.challenge-panel-primary .challenge-requirements>div>i { color:var(--success); font-size:14px; font-style:normal; }
.challenge-panel-primary .challenge-requirements>div>span { min-width:0; color:var(--text-primary); font-size:13px; line-height:1.4; }
.challenge-panel-primary .challenge-requirements>div>b { padding:2px 5px; border-radius:4px; color:var(--text-muted); background:var(--panel-raised); font:600 10px 'DM Mono',monospace; }
.challenge-panel-primary .challenge-actions { display:grid; grid-template-columns:1fr; gap:7px; margin-top:11px; }
.challenge-panel-primary .challenge-actions>button { min-height:38px; width:100%; box-sizing:border-box; }
.challenge-panel-primary .challenge-actions .challenge-policy-link { justify-content:center; border:1px solid var(--border-strong); color:var(--text-secondary); background:transparent; font-size:13px; }
.challenge-panel-primary .challenge-actions .challenge-policy-link:hover { border-color:var(--accent); color:var(--accent); }
.challenge-panel-primary .challenge-actions .challenge-run-button { justify-content:center; border:1px solid var(--accent); border-radius:7px; color:#092b2d; background:var(--accent); font-size:14px; font-weight:700; }
.challenge-panel-primary .challenge-actions .challenge-run-button:disabled { opacity:.65; cursor:wait; }
.challenge-result-area { margin-top:14px; padding-top:12px; border-top:1px solid var(--border); }
.challenge-result-area>header { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }
.challenge-result-area h4 { margin:0; color:var(--text-primary); font-size:14px; }
.challenge-result-area>header>span { font-size:12px; font-weight:650; }
.challenge-result-area .result-pass { color:var(--success); }
.challenge-result-area .result-fail { color:var(--warning); }
.challenge-result-incomplete p { margin:7px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.5; }
.challenge-panel-primary .challenge-check-list { margin:0; display:flex; flex-direction:column; gap:0; }
.challenge-check-item { padding:9px 0; border-bottom:1px solid var(--border); }
.challenge-check-main { display:grid; grid-template-columns:22px minmax(0,1fr); align-items:start; gap:6px 8px; }
.challenge-check-main>i { grid-column:1; grid-row:1 / span 2; width:20px; height:20px; display:grid; place-items:center; border:1px solid currentColor; border-radius:50%; font-size:12px; font-style:normal; font-weight:700; }
.challenge-check-item.check-passed .challenge-check-main>i { color:var(--success); }
.challenge-check-item.check-failed .challenge-check-main>i { color:var(--danger); }
.challenge-check-main>div { grid-column:2; min-width:0; display:flex; flex-direction:column; gap:2px; }
.challenge-check-main>div>strong { color:var(--text-primary); font-size:13px; line-height:1.4; }
.challenge-check-main>div>small { color:var(--text-muted); font-size:12px; line-height:1.4; }
.challenge-reason-toggle { grid-column:2; justify-self:start; padding:3px 0; border:0; color:var(--accent); background:transparent; font-size:12px; cursor:pointer; }
.challenge-reason-toggle:hover { color:var(--text-primary); }
.challenge-failure-reason { margin:8px 0 0 30px; padding:10px; border:1px solid color-mix(in srgb,var(--warning) 22%,var(--border)); border-radius:7px; background:color-mix(in srgb,var(--warning) 7%,var(--panel-bg)); }
.challenge-failure-reason>div+div { margin-top:8px; padding-top:7px; border-top:1px solid color-mix(in srgb,var(--warning) 15%,var(--border)); }
.challenge-failure-reason strong { color:var(--text-primary); font-size:12px; }
.challenge-failure-reason p { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.5; }
.challenge-failure-reason>button { margin-top:8px; padding:3px 0; border:0; color:var(--accent); background:transparent; font-size:12px; cursor:pointer; }
.learning-objectives-panel { padding:14px 16px; }
.learning-objectives-panel h3 { margin:0 0 8px; color:var(--text-primary); font-size:16px; }
.learning-objectives-panel ul { margin:0; padding-left:18px; color:var(--text-secondary); font-size:13px; line-height:1.55; }
.learning-objectives-panel li+li { margin-top:5px; }
.learning-objectives-panel .challenge-actions { display:grid; margin-top:12px; }
.strategy-lab .lab-right-panel { align-items:stretch; }
.event-inspector .event-empty-state { min-height:0; padding:14px 16px; align-items:flex-start; justify-content:flex-start; text-align:left; }
.event-inspector .event-empty-state strong { margin:0; color:var(--text-primary); font-size:14px; }
.event-inspector .event-empty-state p { max-width:none; margin:5px 0 0; color:var(--text-muted); font-size:13px; line-height:1.5; }
.event-inspector .event-open-timeline { margin-top:0; }
.event-focus-summary { display:flex; flex-direction:column; gap:12px; }
.event-focus-endpoints>span,.event-focus-outcome>span,.event-focus-reason>span,.event-focus-route>span { color:var(--text-muted); font-size:12px; }
.event-focus-endpoints>strong { margin-top:5px; display:block; color:var(--text-primary); font-size:16px; line-height:1.45; overflow-wrap:anywhere; }
.event-focus-endpoints>strong i { color:var(--accent); font-style:normal; }
.event-focus-endpoints>small { margin-top:4px; display:block; color:var(--text-secondary); font-size:12px; }
.event-focus-outcome { display:flex; align-items:center; justify-content:space-between; padding:9px 0; border-block:1px solid var(--border); }
.event-focus-outcome>strong { color:var(--text-primary); font-size:14px; }
.event-focus-reason p,.event-focus-route p { margin:4px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
.event-focus-route { padding-top:8px; border-top:1px solid var(--border); }
.strategy-lab .simulation-controls { position:static; inset:auto; height:auto; min-height:0; flex:0 0 auto; margin:14px 0 0; padding:12px 16px; overflow:visible; transform:none; }
.strategy-lab .simulation-controls-unverified { padding:11px 16px; }
.simulation-controls-unverified .timeline-heading { min-height:24px; }
.simulation-controls-unverified .attack-chain-empty { min-height:0; padding:5px 0 0; color:var(--text-muted); font-size:13px; line-height:1.4; }
.strategy-lab .timeline-heading { min-height:30px; gap:12px; }
.strategy-lab .timeline-heading>div:first-child { flex-direction:row; align-items:baseline; gap:10px; }
.strategy-lab .timeline-heading strong { font-size:15px; }
.strategy-lab .timeline-heading small { font-size:12px; }
.strategy-lab .attack-chain-steps { min-height:0; margin:9px 0 11px; }
.strategy-lab .attack-chain-step { padding:8px 10px; }
.strategy-lab .simulation-control-row { min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:8px; border-top:1px solid var(--border); }
.strategy-lab .simulation-buttons { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.strategy-lab .simulation-control-row .control-button { min-height:36px; padding:0 10px; font-size:13px; white-space:nowrap; }
.strategy-lab .simulation-control-row .control-button.primary { font-size:13px; }
.strategy-lab .simulation-control-row .control-button:disabled { opacity:.42; }
.strategy-lab .simulation-speed { flex:0 0 auto; margin-left:auto; }
.strategy-lab .lab-disclaimer { margin:8px 0 0; font-size:11px; text-align:left; }
.strategy-lab .lab-completion-card { position:static; inset:auto; min-height:0; height:auto; margin:14px 0 0; padding:14px 16px; overflow:visible; transform:none; }
.strategy-lab .completion-heading h2 { font-size:17px; }
.strategy-lab .completion-badge { font-size:12px; }
.strategy-lab .completion-metrics { margin:11px 0 8px; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
.strategy-lab .completion-metrics>div { min-height:52px; padding:5px 10px; gap:5px; border-left:1px solid var(--border); }
.strategy-lab .completion-metrics>div:first-child { padding-left:2px; border-left:0; }
.strategy-lab .completion-metrics span { color:var(--text-muted); font-size:12px; line-height:1.35; }
.strategy-lab .completion-metrics strong { color:var(--text-primary); font:700 19px 'Microsoft YaHei',sans-serif; }
.strategy-lab .completion-metrics strong small { font-size:12px; }
.strategy-lab .completion-asset strong { font-size:16px; }
.strategy-lab .result-details-toggle { margin:2px 0 0; font-size:13px; }
.strategy-lab .completion-details { display:flex; flex-direction:column; align-items:flex-start; gap:7px; padding:9px 0 4px; color:var(--text-secondary); font-size:12px; }
.strategy-lab .completion-details>p { margin:0; font-size:12px; line-height:1.5; }
.strategy-lab .completion-details .completion-search-status { margin:0; }
.strategy-lab .completion-actions { margin-top:9px; padding-top:9px; font-size:12px; }
.strategy-lab .completion-actions>div { gap:12px; }
.strategy-lab .completion-actions a,.strategy-lab .completion-actions button { font-size:12px; }
@media (max-width:1450px) {
  .strategy-workspace .lab-left-panel { max-height:none; overflow-y:auto; overscroll-behavior:contain; }
  .challenge-panel-primary .challenge-requirements>div>b { display:none; }
}
@media (max-width:980px) {
  .strategy-lab .simulation-control-row { align-items:flex-start; flex-direction:column; }
  .strategy-lab .simulation-speed { margin-left:0; }
  .strategy-lab .completion-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .strategy-lab .completion-actions { align-items:flex-start; flex-direction:column; }
}
.event-diagnostic-open { width:calc(100% - 20px); min-height:58px; margin:2px 10px 10px; padding:9px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--border); border-radius:8px; color:var(--text-primary); background:var(--panel-raised); text-align:left; cursor:pointer; }
.event-diagnostic-open:hover { border-color:var(--border-strong); background:color-mix(in srgb,var(--accent) 7%,var(--panel-raised)); }
.event-diagnostic-open span { display:flex; flex-direction:column; gap:4px; }
.event-diagnostic-open strong { font-size:14px; font-weight:650; }
.event-diagnostic-open small { color:var(--text-muted); font-size:12px; line-height:1.4; }
.event-diagnostic-open>b { color:var(--accent); font-size:19px; font-weight:500; }
.event-decision-backdrop { position:fixed; inset:0; z-index:180; display:grid; place-items:center; padding:24px; background:rgba(2,10,16,.65); backdrop-filter:blur(4px); }
.event-decision-dialog { width:min(760px,94vw); max-height:min(88vh,900px); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--border-strong); border-radius:14px; color:var(--text-primary); background:var(--panel-bg); box-shadow:0 24px 90px rgba(0,0,0,.38); }
.event-decision-header { flex:0 0 auto; padding:21px 24px 17px; display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:1px solid var(--border); }
.event-decision-header span { color:var(--text-muted); font-size:13px; }
.event-decision-header h2 { margin:5px 0 0; color:var(--text-primary); font-size:23px; }
.event-decision-header button { width:40px; height:40px; flex:0 0 auto; border:1px solid var(--border); border-radius:8px; color:var(--text-secondary); background:var(--panel-raised); font-size:24px; cursor:pointer; }
.event-decision-dialog-body { min-height:0; padding:20px 24px; overflow:auto; overscroll-behavior:contain; }
.event-decision-overview { padding:15px 17px; display:flex; flex-direction:column; align-items:flex-start; gap:7px; border:1px solid var(--border); border-radius:9px; background:var(--panel-raised); }
.event-decision-overview.tone-risk { border-color:color-mix(in srgb,var(--danger) 35%,var(--border)); background:color-mix(in srgb,var(--danger) 6%,var(--panel-raised)); }
.event-decision-overview.tone-blocked { border-color:color-mix(in srgb,var(--success) 35%,var(--border)); background:color-mix(in srgb,var(--success) 6%,var(--panel-raised)); }
.event-decision-overview .event-explanation-result { font-size:12px; }
.event-decision-overview>strong { color:var(--text-primary); font-size:18px; line-height:1.5; overflow-wrap:anywhere; }
.event-decision-overview>strong i { padding:0 5px; color:var(--accent); font-style:normal; }
.event-decision-overview>small { color:var(--text-secondary); font-size:13px; }
.event-decision-route { margin-top:12px; padding:13px 15px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }
.event-decision-route>span,.event-decision-rule span { display:block; margin-bottom:8px; color:var(--text-muted); font-size:13px; }
.event-decision-route>div { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
.event-decision-route b { padding:6px 9px; border:1px solid var(--border); border-radius:6px; color:var(--text-primary); background:var(--panel-bg); font-size:13px; font-weight:550; }
.event-decision-route i { color:var(--accent); font-size:14px; font-style:normal; }
.event-decision-rule { margin-top:9px; padding:12px 15px; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }
.event-decision-rule>div { min-width:0; }
.event-decision-rule>div+div { padding-left:12px; border-left:1px solid var(--border); }
.event-decision-rule span { margin-bottom:4px; }
.event-decision-rule strong { color:var(--text-primary); font-size:14px; line-height:1.5; overflow-wrap:anywhere; }
.event-decision-section { margin-top:22px; }
.event-decision-section-heading { min-height:32px; margin-bottom:9px; display:flex; align-items:center; gap:10px; }
.event-decision-section-heading>span { width:28px; height:28px; display:grid; place-items:center; border:1px solid var(--border); border-radius:7px; color:var(--accent); font:12px 'DM Mono',monospace; }
.event-decision-section-heading h3 { margin:0; color:var(--text-primary); font-size:16px; }
.event-decision-section-heading>small { margin-left:auto; color:var(--text-muted); font-size:13px; }
.event-decision-list,.event-precondition-list { display:flex; flex-direction:column; gap:8px; }
.event-decision-row,.event-precondition-row { min-height:65px; padding:11px 13px; display:grid; grid-template-columns:34px 25px minmax(0,1fr) auto; align-items:center; gap:11px; border:1px solid var(--border); border-radius:8px; background:var(--panel-raised); }
.event-decision-index { color:var(--text-muted); font:12px 'DM Mono',monospace; }
.event-decision-row>i,.event-precondition-row>i { width:24px; height:24px; display:grid; place-items:center; border:1px solid color-mix(in srgb,var(--success) 35%,transparent); border-radius:50%; color:var(--success); background:color-mix(in srgb,var(--success) 8%,transparent); font-size:14px; font-style:normal; }
.event-decision-row.chain-fail>i,.event-precondition-row:not(.passed)>i { color:var(--danger); border-color:color-mix(in srgb,var(--danger) 35%,transparent); background:color-mix(in srgb,var(--danger) 8%,transparent); }
.event-decision-row.chain-neutral>i { color:var(--text-muted); border-color:var(--border); background:transparent; }
.event-decision-row>div strong,.event-precondition-row>div strong { color:var(--text-primary); font-size:14px; line-height:1.5; }
.event-decision-row>div p,.event-precondition-row>div p { margin:3px 0 0; color:var(--text-secondary); font-size:14px; line-height:1.55; overflow-wrap:anywhere; }
.event-decision-row>b,.event-precondition-row>b { color:var(--success); font-size:13px; font-weight:600; white-space:nowrap; }
.event-decision-row.chain-fail>b,.event-precondition-row:not(.passed)>b { color:var(--danger); }
.event-decision-row.chain-neutral>b { color:var(--text-muted); }
.event-precondition-row { grid-template-columns:25px minmax(0,1fr) auto; }
.event-decision-conclusion { margin-top:22px; padding:14px 16px; border-left:3px solid var(--accent); border-radius:0 7px 7px 0; background:color-mix(in srgb,var(--accent) 6%,var(--panel-raised)); }
.event-decision-conclusion>span { color:var(--text-muted); font-size:13px; }
.event-decision-conclusion p { margin:5px 0 0; color:var(--text-primary); font-size:15px; line-height:1.65; }
.event-decision-footer { min-height:62px; flex:0 0 auto; padding:10px 24px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--border); }
.event-decision-footer>span { color:var(--text-muted); font-size:12px; }
.event-decision-footer button { min-width:88px; min-height:38px; border:1px solid var(--border-strong); border-radius:7px; color:var(--text-primary); background:var(--panel-raised); font-size:14px; cursor:pointer; }
@media (max-width:600px) {
  .event-decision-backdrop { padding:0; }
  .event-decision-dialog { width:100vw; max-height:100dvh; min-height:100dvh; border:0; border-radius:0; }
  .event-decision-header { padding:16px; }
  .event-decision-dialog-body { padding:15px 16px; }
  .event-decision-row { grid-template-columns:22px 24px minmax(0,1fr); gap:8px; padding:10px; }
  .event-decision-row>b { grid-column:3; justify-self:start; }
  .event-precondition-row { grid-template-columns:24px minmax(0,1fr); gap:8px; padding:10px; }
  .event-precondition-row>b { grid-column:2; justify-self:start; }
  .event-decision-section-heading>small { font-size:12px; }
  .event-decision-footer { padding:10px 16px; }
}
</style>
