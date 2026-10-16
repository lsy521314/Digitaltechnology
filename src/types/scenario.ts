import type { BusinessPath, FirewallPolicy, NetworkEdge, NetworkInterface, NetworkNode, NetworkService, RouteEntry, ServiceId, VlanDefinition } from './network'

export type Difficulty = '入门' | '进阶' | '挑战'

export interface ScenarioTrigger {
  id: string
  type: 'seed' | 'request'
  sourceId: string
  targetId: string
  service: ServiceId
  message: string
}

export interface SecurityChallenge {
  title: string
  description: string
  protectedNodeId: string
  requiredBusinessPathIds: string[]
}

export interface Scenario {
  id: string
  name: string
  shortName: string
  description: string
  difficulty: Difficulty
  duration: string
  accent: string
  nodes: NetworkNode[]
  interfaces: NetworkInterface[]
  edges: NetworkEdge[]
  vlans: VlanDefinition[]
  routes: RouteEntry[]
  services: NetworkService[]
  firewallPolicies: FirewallPolicy[]
  initialEvents: ScenarioTrigger[]
  learningObjectives: string[]
  businessPaths: BusinessPath[]
  challenge?: SecurityChallenge
}
