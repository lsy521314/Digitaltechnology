import type { NetworkNode, NodeStatus, ServiceType } from '../types/network'
import type { Scenario } from '../types/scenario'
import type { SimulationEvent, SimulationMetrics, SimulationOptions, SimulationResult, SimulationSnapshot } from '../types/simulation'
import { calculateMetrics, evaluateBusinessPaths } from './metricsEngine'
import { canCommunicate } from './ruleEngine'
import { findServicePath } from './topologyEngine'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function defaultServices(node: NetworkNode): ServiceType[] {
  if (node.services?.length) return node.services
  if (node.type === 'Database') return ['DATABASE']
  if (node.type === 'Server') return ['WEB']
  return ['INTERNAL']
}

function isInfrastructure(node: NetworkNode): boolean {
  return ['Internet', 'Gateway', 'Firewall', 'Router', 'Switch'].includes(node.type)
}

export function runSimulation(scenarioInput: Scenario, options: SimulationOptions = {}): SimulationResult {
  const scenario = clone(scenarioInput)
  const nodes = scenario.nodes
  const isolatedIds = new Set([
    ...(options.isolatedNodeIds ?? []),
    ...nodes.filter((node) => node.isolationEnabled || node.status === 'isolated').map((node) => node.id),
  ])
  const statuses: Record<string, NodeStatus> = Object.fromEntries(nodes.map((node) => {
    if (isolatedIds.has(node.id)) return [node.id, 'isolated']
    if (node.protectionEnabled && node.status === 'normal') return [node.id, 'protected']
    return [node.id, node.status]
  }))
  const compromisedNodeIds = new Set<string>()
  const events: SimulationEvent[] = []
  const snapshots: SimulationSnapshot[] = []
  const queue: string[] = []
  const visitedSources = new Set<string>()
  const attemptedPairs = new Set<string>()

  const commit = (input: Omit<SimulationEvent, 'id' | 'stepIndex'>) => {
    const event: SimulationEvent = { ...input, id: 'event-' + String(events.length + 1).padStart(2, '0'), stepIndex: events.length }
    events.push(event)
    snapshots.push({
      eventIndex: events.length - 1,
      nodeStatuses: { ...statuses },
      compromisedNodeIds: [...compromisedNodeIds],
    })
  }
  const nameOf = (id: string) => nodes.find((node) => node.id === id)?.name ?? id

  for (const id of isolatedIds) {
    const node = nodes.find((item) => item.id === id)
    if (!node) continue
    commit({
      type: 'isolate', phase: 'isolation', sourceId: id, targetId: id, result: 'info',
      message: node.name + ' 已隔离，后续有效通信路径将绕过或在此中断。',
      severity: 'success', service: 'INTERNAL', route: [id], routeEdgeIds: [],
      reason: '节点隔离状态已作为本次实验防御配置载入。',
      blockedAt: node.name, stateBefore: node.status, stateAfter: 'isolated',
    })
  }

  for (const trigger of scenario.initialEvents) {
    const source = nodes.find((node) => node.id === trigger.sourceId)
    const target = nodes.find((node) => node.id === trigger.targetId)
    if (!source || !target) continue
    if (trigger.type === 'seed') {
      const before = statuses[target.id]
      compromisedNodeIds.add(target.id)
      if (!isolatedIds.has(target.id)) statuses[target.id] = 'compromised'
      queue.push(target.id)
      commit({
        type: 'seed', phase: 'initial', sourceId: source.id, targetId: target.id, result: 'compromise',
        message: trigger.message || ('实验初始条件：' + target.name + ' 在仿真开始前已处于受影响状态。'),
        severity: 'critical', service: trigger.service, route: [target.id], routeEdgeIds: [],
        reason: 'seed 表示实验开始前已存在的安全事件，不是本次仿真中的攻击尝试；终端防护不回溯阻止该初始状态。',
        stateBefore: before, stateAfter: statuses[target.id],
      })
      continue
    }

    const runtimeNodes = nodes.map((node) => ({ ...node, status: statuses[node.id] ?? node.status }))
    const runtimeSource = runtimeNodes.find((node) => node.id === source.id)!
    const runtimeTarget = runtimeNodes.find((node) => node.id === target.id)!
    const decision = canCommunicate(runtimeSource, runtimeTarget, trigger.service, runtimeNodes, scenario.edges, scenario.rules)
    commit({
      type: decision.allowed ? 'request' : 'blocked', phase: 'initial',
      sourceId: source.id, targetId: target.id, result: decision.allowed ? 'allow' : 'block',
      message: trigger.message + (decision.allowed ? '：允许' : '：阻断'),
      severity: decision.allowed ? 'normal' : 'success', service: trigger.service,
      route: decision.route, routeEdgeIds: decision.routeEdgeIds, reason: decision.reason,
      matchedRuleId: decision.matchedRule?.id, matchedRuleName: decision.matchedRule?.name,
      blockedAt: decision.blockedAt, stateBefore: statuses[target.id], stateAfter: statuses[target.id],
    })
  }

  while (queue.length) {
    const sourceId = queue.shift()!
    if (visitedSources.has(sourceId)) continue
    visitedSources.add(sourceId)
    const source = nodes.find((node) => node.id === sourceId)
    if (!source || isolatedIds.has(sourceId)) continue

    for (const target of nodes) {
      if (target.id === sourceId || isInfrastructure(target)) continue
      const targetServices = defaultServices(target)
      let service: ServiceType | undefined
      for (const candidate of targetServices) {
        const path = findServicePath(sourceId, target.id, candidate, scenario.edges, nodes, { ignoreIsolation: true })
        if (path) { service = candidate; break }
      }
      if (!service) continue
      const pair = sourceId + '->' + target.id + ':' + service
      if (attemptedPairs.has(pair)) continue
      attemptedPairs.add(pair)

      const before = statuses[target.id]
      if (compromisedNodeIds.has(target.id)) {
        const route = findServicePath(sourceId, target.id, service, scenario.edges, nodes, { ignoreIsolation: true })
        commit({
          type: 'info', phase: 'propagation', sourceId, targetId: target.id, result: 'info',
          message: nameOf(sourceId) + ' 到达 ' + target.name + '，但目标已处于受影响状态。',
          severity: 'normal', service, route: route?.nodeIds ?? [], routeEdgeIds: route?.edgeIds ?? [],
          reason: '该节点已在此前事件中进入受影响状态，没有重复计入传播。',
          stateBefore: before, stateAfter: before,
        })
        continue
      }

      const runtimeNodes = nodes.map((node) => ({ ...node, status: statuses[node.id] ?? node.status }))
      const runtimeSource = runtimeNodes.find((node) => node.id === sourceId)!
      const runtimeTarget = runtimeNodes.find((node) => node.id === target.id)!
      const decision = canCommunicate(runtimeSource, runtimeTarget, service, runtimeNodes, scenario.edges, scenario.rules)
      if (!decision.allowed) {
        commit({
          type: 'blocked', phase: 'propagation', sourceId, targetId: target.id, result: 'block',
          message: nameOf(sourceId) + ' 尝试通过 ' + service + ' 服务传播至 ' + target.name + '，但事件被阻断。',
          severity: 'success', service, route: decision.route, routeEdgeIds: decision.routeEdgeIds,
          reason: decision.reason, matchedRuleId: decision.matchedRule?.id,
          matchedRuleName: decision.matchedRule?.name, blockedAt: decision.blockedAt,
          stateBefore: before, stateAfter: before,
        })
        continue
      }

      const protectedEndpoint = target.protectionEnabled && ['Workstation', 'Server'].includes(target.type)
      if (protectedEndpoint) {
        commit({
          type: 'blocked', phase: 'propagation', sourceId, targetId: target.id, result: 'block',
          message: nameOf(sourceId) + ' 尝试通过 ' + service + ' 服务传播至 ' + target.name + '，但事件被阻断。',
          severity: 'success', service, route: decision.route, routeEdgeIds: decision.routeEdgeIds,
          reason: '目标节点终端防护已启用，传播事件被阻断。',
          blockedAt: target.name, stateBefore: before, stateAfter: before,
        })
        continue
      }

      compromisedNodeIds.add(target.id)
      statuses[target.id] = 'compromised'
      queue.push(target.id)
      commit({
        type: 'compromise', phase: 'propagation', sourceId, targetId: target.id, result: 'compromise',
        message: nameOf(sourceId) + ' 通过 ' + service + ' 服务关系影响了 ' + target.name + '。',
        severity: 'critical', service, route: decision.route, routeEdgeIds: decision.routeEdgeIds,
        reason: decision.reason, matchedRuleId: decision.matchedRule?.id,
        matchedRuleName: decision.matchedRule?.name, stateBefore: before, stateAfter: 'compromised',
      })
    }
  }

  const businessPathResults = evaluateBusinessPaths(scenario, statuses)
  const metrics: SimulationMetrics = calculateMetrics(scenario, events, [...compromisedNodeIds], businessPathResults)
  return {
    events,
    snapshots,
    metrics,
    businessPathResults,
    compromisedNodeIds: [...compromisedNodeIds],
    finalStatuses: { ...statuses },
    scenarioId: scenario.id,
    generatedAt: new Date().toISOString(),
  }
}

export function formatTimestamp(stepIndex: number): string {
  return 'T' + Math.max(0, stepIndex)
}
