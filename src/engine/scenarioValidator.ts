import { NETWORK_ZONES, SERVICE_TYPES } from '../types/network'
import type { Scenario } from '../types/scenario'

const serviceValues = new Set<string>(SERVICE_TYPES)
const concreteServiceValues = new Set<string>(SERVICE_TYPES.filter((service) => service !== 'ANY'))
const zoneValues = new Set<string>(NETWORK_ZONES)

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicate.add(id)
    seen.add(id)
  }
  return [...duplicate]
}

export function validateScenario(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['场景数据必须是对象。']
  const scenario = value as Partial<Scenario>
  const errors: string[] = []
  if (!scenario.id || !scenario.name) errors.push('场景必须包含 id 和 name。')
  if (!Array.isArray(scenario.nodes) || !Array.isArray(scenario.edges) || !Array.isArray(scenario.rules)
    || !Array.isArray(scenario.initialEvents) || !Array.isArray(scenario.businessPaths)) {
    return [...errors, 'nodes、edges、rules、initialEvents 和 businessPaths 必须是数组。']
  }

  const nodeIds = scenario.nodes.map((node) => node?.id).filter((id): id is string => Boolean(id))
  const nodeIdSet = new Set(nodeIds)
  for (const id of duplicateIds(nodeIds)) errors.push('节点 ID 重复：' + id)
  for (const node of scenario.nodes) {
    if (!node.id || !node.name) errors.push('每个节点都必须包含 id 和 name。')
    if (!zoneValues.has(node.zone)) errors.push('节点 ' + node.id + ' 的区域无效：' + node.zone)
    for (const service of node.services ?? []) if (!concreteServiceValues.has(service)) errors.push('节点 ' + node.id + ' 的服务无效：' + service)
  }

  for (const id of duplicateIds(scenario.edges.map((edge) => edge.id))) errors.push('连接 ID 重复：' + id)
  for (const edge of scenario.edges) {
    if (!nodeIdSet.has(edge.source)) errors.push('连接 ' + edge.id + ' 的 source 不存在：' + edge.source)
    if (!nodeIdSet.has(edge.target)) errors.push('连接 ' + edge.id + ' 的 target 不存在：' + edge.target)
    if (!concreteServiceValues.has(edge.service)) errors.push('连接 ' + edge.id + ' 的服务类型无效。')
  }

  for (const id of duplicateIds(scenario.rules.map((rule) => rule.id))) errors.push('规则 ID 重复：' + id)
  for (const rule of scenario.rules) {
    if (rule.sourceZone !== 'ANY' && !zoneValues.has(rule.sourceZone)) errors.push('规则 ' + rule.id + ' 的来源区域无效。')
    if (rule.targetZone !== 'ANY' && !zoneValues.has(rule.targetZone)) errors.push('规则 ' + rule.id + ' 的目标区域无效。')
    if (!serviceValues.has(rule.service) || !['ALLOW', 'DENY'].includes(rule.action)) errors.push('规则 ' + rule.id + ' 的服务或动作无效。')
  }

  for (const trigger of scenario.initialEvents) {
    if (!nodeIdSet.has(trigger.sourceId) || !nodeIdSet.has(trigger.targetId)) errors.push('初始事件 ' + trigger.id + ' 引用了不存在的节点。')
    if (!concreteServiceValues.has(trigger.service)) errors.push('初始事件 ' + trigger.id + ' 的服务无效。')
  }

  for (const path of scenario.businessPaths) {
    if (!path.id || !path.label) errors.push('业务路径必须包含 id 和 label。')
    if (!nodeIdSet.has(path.sourceId) || !nodeIdSet.has(path.targetId)) errors.push('业务路径 ' + path.id + ' 引用了不存在的节点。')
    if (!concreteServiceValues.has(path.service)) errors.push('业务路径 ' + path.id + ' 的服务无效。')
  }
  for (const id of duplicateIds(scenario.businessPaths.map((path) => path.id))) errors.push('业务路径 ID 重复：' + id)

  if (scenario.challenge) {
    if (!nodeIdSet.has(scenario.challenge.protectedNodeId)) errors.push('安全挑战引用了不存在的关键节点。')
    const businessPathIds = new Set(scenario.businessPaths.map((path) => path.id))
    for (const id of scenario.challenge.requiredBusinessPathIds) {
      if (!businessPathIds.has(id)) errors.push('安全挑战引用了不存在的业务路径：' + id)
    }
  }
  return errors
}

export function assertValidScenario(value: unknown): asserts value is Scenario {
  const errors = validateScenario(value)
  if (errors.length) throw new Error('场景 JSON 校验失败：' + errors.join(' '))
}
