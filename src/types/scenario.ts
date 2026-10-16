import type { BusinessPath, NetworkEdge, NetworkNode, SecurityRule, ServiceType } from './network'

export type Difficulty = '入门' | '进阶' | '挑战'

export interface ScenarioTrigger {
  id: string
  type: 'seed' | 'request'
  sourceId: string
  targetId: string
  service: Exclude<ServiceType, 'ANY'>
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
  edges: NetworkEdge[]
  rules: SecurityRule[]
  initialEvents: ScenarioTrigger[]
  learningObjectives: string[]
  businessPaths: BusinessPath[]
  challenge?: SecurityChallenge
}
