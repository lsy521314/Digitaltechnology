import type { NetworkNode, NodeStatus, ServiceId } from '../types/network'
import type { Scenario } from '../types/scenario'
import type { SimulationEvent, SimulationMetrics, SimulationOptions, SimulationResult, SimulationSnapshot } from '../types/simulation'
import { evaluateCommunication } from './communicationEngine'
import { calculateMetrics, evaluateBusinessPaths } from './metricsEngine'
import { assertValidScenario } from './scenarioValidator'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface TeachingPropagationContext {
  statuses: Record<string, NodeStatus>
  compromisedNodeIds: Set<string>
  queue: string[]
}

/** Temporary legacy teaching effect; it is not a real attack/exploit calculation. */
export function applyTeachingPropagation(context: TeachingPropagationContext, target: NetworkNode): NodeStatus {
  context.compromisedNodeIds.add(target.id)
  context.statuses[target.id] = 'compromised'
  context.queue.push(target.id)
  return 'compromised'
}

export function runSimulation(scenarioInput: Scenario, options: SimulationOptions = {}): SimulationResult {
  const scenario = clone(scenarioInput)
  assertValidScenario(scenario)
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
  const attempted = new Set<string>()
  const nameOf = (id: string) => nodes.find((node) => node.id === id)?.name ?? id
  const commit = (input: Omit<SimulationEvent, 'id' | 'stepIndex'>) => {
    const event: SimulationEvent = { ...input, id: 'event-' + String(events.length + 1).padStart(2, '0'), stepIndex: events.length }
    events.push(event)
    snapshots.push({ eventIndex: events.length - 1, nodeStatuses: { ...statuses }, compromisedNodeIds: [...compromisedNodeIds] })
  }
  const commitCommunication = (sourceId: string, targetId: string, service: ServiceId, phase: SimulationEvent['phase']) => {
    const runtimeScenario: Scenario = {
      ...scenario,
      nodes: nodes.map((node) => ({ ...node, status: statuses[node.id] ?? node.status })),
    }
    const decision = evaluateCommunication(runtimeScenario, { sourceNodeId: sourceId, targetNodeId: targetId, serviceId: service })
    const matchedRule = decision.matchedRules[decision.matchedRules.length - 1]
    commit({
      type: decision.allowed ? 'request' : 'blocked',
      phase,
      eventLayer: 'NETWORK',
      sourceId,
      targetId,
      result: decision.allowed ? 'allow' : 'block',
      message: decision.allowed
        ? `网络通信允许：${nameOf(sourceId)} → ${nameOf(targetId)} / ${service}`
        : `网络通信被拒绝：${nameOf(sourceId)} → ${nameOf(targetId)} / ${service}`,
      severity: decision.allowed ? 'normal' : 'success',
      service,
      route: decision.path,
      routeEdgeIds: decision.routeEdgeIds,
      reason: `${decision.reason} · ${decision.detail}`,
      matchedRuleId: matchedRule?.id,
      matchedRuleName: matchedRule?.name,
      matchedRuleIds: decision.matchedRules.map((rule) => rule.id),
      matchedRules: decision.matchedRules,
      firewallDecisions: decision.firewallDecisions,
      communicationReason: decision.reason,
      blockedAt: decision.blockedAt ? nameOf(decision.blockedAt) : undefined,
      stateBefore: statuses[targetId],
      stateAfter: statuses[targetId],
    })
    return decision
  }

  for (const id of isolatedIds) {
    const isolated = nodes.find((node) => node.id === id)
    if (!isolated) continue
    commit({
      type: 'isolate', phase: 'isolation', eventLayer: 'CONTROL', sourceId: id, targetId: id, result: 'info',
      message: isolated.name + ' 已隔离，网络通信不可达。', severity: 'success', service: 'INTERNAL',
      route: [id], routeEdgeIds: [], reason: '隔离配置已在通信计算中用于限制 source、target 和 transit。',
      blockedAt: isolated.name, stateBefore: isolated.status, stateAfter: 'isolated',
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
      if (!isolatedIds.has(target.id)) queue.push(target.id)
      commit({
        type: 'seed', phase: 'initial', eventLayer: 'PROPAGATION', sourceId: source.id, targetId: target.id, result: 'compromise',
        message: trigger.message || `实验初始条件：${target.name} 在仿真开始前已进入受影响状态。`,
        severity: 'critical', service: trigger.service, route: [target.id], routeEdgeIds: [],
        reason: 'seed 是本次实验开始前已存在的状态，不代表通信请求或漏洞利用。',
        stateBefore: before, stateAfter: statuses[target.id],
      })
    } else {
      commitCommunication(source.id, target.id, trigger.service, 'initial')
    }
  }

  while (queue.length) {
    const sourceId = queue.shift()!
    if (visitedSources.has(sourceId)) continue
    visitedSources.add(sourceId)
    const source = nodes.find((node) => node.id === sourceId)
    if (!source || isolatedIds.has(sourceId)) continue

    for (const target of nodes) {
      if (target.id === sourceId || target.deviceRole !== 'ENDPOINT') continue
      for (const service of target.services ?? []) {
        const attemptKey = `${sourceId}->${target.id}:${service}`
        if (attempted.has(attemptKey)) continue
        attempted.add(attemptKey)
        const before = statuses[target.id]
        const decision = commitCommunication(sourceId, target.id, service, 'propagation')
        if (!decision.allowed || compromisedNodeIds.has(target.id)) continue

        if (target.protectionEnabled) {
          commit({
            type: 'blocked', phase: 'propagation', eventLayer: 'CONTROL', sourceId, targetId: target.id, result: 'block',
            message: '教学传播被终端防护阻止：' + target.name,
            severity: 'success', service, route: decision.path, routeEdgeIds: decision.routeEdgeIds,
            reason: '目标节点终端防护已启用，网络通信虽可达，但教学传播模型不改变目标状态。',
            blockedAt: target.name, stateBefore: before, stateAfter: before,
          })
          continue
        }

        const stateAfter = applyTeachingPropagation({ statuses, compromisedNodeIds, queue }, target)
        commit({
          type: 'compromise', phase: 'propagation', eventLayer: 'PROPAGATION', sourceId, targetId: target.id, result: 'compromise',
          message: `教学传播导致目标节点进入受影响状态：${target.name}`,
          severity: 'critical', service, route: decision.path, routeEdgeIds: decision.routeEdgeIds,
          reason: '网络通信已允许；随后由当前 Legacy Teaching Propagation 教学层改变目标状态。该结果不是漏洞利用或真实攻击结论。',
          matchedRuleId: decision.matchedRules.at(-1)?.id,
          matchedRuleName: decision.matchedRules.at(-1)?.name,
          matchedRuleIds: decision.matchedRules.map((rule) => rule.id),
          matchedRules: decision.matchedRules,
          firewallDecisions: decision.firewallDecisions,
          communicationReason: decision.reason,
          stateBefore: before, stateAfter,
        })
      }
    }
  }

  const businessPathResults = evaluateBusinessPaths(scenario, statuses)
  const metrics: SimulationMetrics = calculateMetrics(scenario, events, [...compromisedNodeIds], businessPathResults)
  return {
    events, snapshots, metrics, businessPathResults,
    compromisedNodeIds: [...compromisedNodeIds], finalStatuses: { ...statuses },
    scenarioId: scenario.id, generatedAt: new Date().toISOString(),
  }
}

export function formatTimestamp(stepIndex: number): string {
  return 'T' + Math.max(0, stepIndex)
}
