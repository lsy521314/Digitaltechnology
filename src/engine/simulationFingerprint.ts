import type { Scenario } from '../types/scenario'

/**
 * Identifies the inputs that can affect simulation events, business-path results,
 * metrics, or challenge verification. Presentation-only node positions and
 * descriptive copy are deliberately excluded.
 */
export function simulationFingerprint(scenario: Scenario): string {
  const sorted = <T>(items: T[], key: (item: T) => string | number) => [...items].sort((a, b) => {
    const left = key(a)
    const right = key(b)
    return left < right ? -1 : left > right ? 1 : 0
  })

  return JSON.stringify({
    id: scenario.id,
    simulationMode: scenario.simulationMode,
    initialAttackState: scenario.initialAttackState ?? null,
    nodes: sorted(scenario.nodes, (node) => node.id).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      deviceRole: node.deviceRole,
      zone: node.zone,
      status: node.status,
      isCritical: node.isCritical,
      protectionEnabled: node.protectionEnabled,
      isolationEnabled: Boolean(node.isolationEnabled),
      services: [...(node.services ?? [])].sort(),
      teachingConditions: [...(node.teachingConditions ?? [])].sort(),
      securityControls: [...(node.securityControls ?? [])].sort(),
    })),
    interfaces: sorted(scenario.interfaces, (item) => item.id).map((item) => ({
      id: item.id,
      nodeId: item.nodeId,
      kind: item.kind,
      ipv4Address: item.ipv4Address,
      prefixLength: item.prefixLength,
      vlanId: item.vlanId,
      switchportMode: item.switchportMode,
      accessVlanId: item.accessVlanId,
      allowedVlanIds: item.allowedVlanIds ? [...item.allowedVlanIds].sort((a, b) => a - b) : undefined,
      parentInterfaceId: item.parentInterfaceId,
      enabled: item.enabled,
    })),
    edges: sorted(scenario.edges, (item) => item.id),
    vlans: sorted(scenario.vlans, (item) => item.id),
    routes: sorted(scenario.routes, (item) => item.id),
    services: sorted(scenario.services, (item) => item.serviceId),
    firewallPolicies: sorted(scenario.firewallPolicies, (item) => item.firewallId).map((policy) => ({
      firewallId: policy.firewallId,
      defaultAction: policy.defaultAction,
      rules: [...policy.rules].sort((a, b) => a.order - b.order).map((rule) => ({
        id: rule.id,
        firewallId: rule.firewallId,
        order: rule.order,
        name: rule.name,
        source: rule.source,
        destination: rule.destination,
        serviceId: rule.serviceId,
        action: rule.action,
        enabled: rule.enabled,
      })),
    })),
    initialEvents: scenario.initialEvents,
    businessPaths: scenario.businessPaths,
    challenge: scenario.challenge,
  })
}
