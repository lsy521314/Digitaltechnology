import type { FirewallDecision, FirewallPolicy, FirewallRule, NetworkNode, ServiceId } from '../types/network'

function selectorMatches(selector: FirewallRule['source'], node: NetworkNode): boolean {
  if (selector.kind === 'ANY') return true
  if (selector.kind === 'ZONE') return selector.zone === node.zone
  return selector.nodeId === node.id
}

export function firstMatchRule(
  policy: FirewallPolicy,
  source: NetworkNode,
  destination: NetworkNode,
  serviceId: ServiceId,
): FirewallRule | undefined {
  const ordered = [...policy.rules].filter((rule) => rule.enabled).sort((a, b) => a.order - b.order)
  return ordered.find((rule) => selectorMatches(rule.source, source)
    && selectorMatches(rule.destination, destination)
    && (rule.serviceId === 'ANY' || rule.serviceId === serviceId))
}

export function evaluateFirewall(
  policy: FirewallPolicy | undefined,
  firewallId: string,
  source: NetworkNode,
  destination: NetworkNode,
  serviceId: ServiceId,
): { decision: FirewallDecision; matchedRule?: FirewallRule } {
  const defaultAction = policy?.defaultAction ?? 'DENY'
  const matchedRule = policy ? firstMatchRule(policy, source, destination, serviceId) : undefined
  const allowed = (matchedRule?.action ?? defaultAction) === 'ALLOW'
  const decision: FirewallDecision = {
    firewallId,
    allowed,
    reason: matchedRule
      ? `First Match：${matchedRule.order} · ${matchedRule.name} · ${matchedRule.action}`
      : `未命中启用规则，使用本机 Default ${defaultAction}`,
    matchedRuleId: matchedRule?.id,
    matchedRuleName: matchedRule?.name,
    defaultAction,
  }
  return { decision, matchedRule }
}
