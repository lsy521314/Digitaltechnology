import type { BusinessPathResult, CommunicationReason, FirewallDecision, FirewallRule, NodeStatus, ServiceType } from './network'

export type SimulationResultCode = 'allow' | 'block' | 'compromise' | 'info'
export type SimulationEventType = 'seed' | 'attempt' | 'blocked' | 'compromise' | 'request' | 'info' | 'isolate'
export type EventSeverity = 'normal' | 'warning' | 'critical' | 'success'
export type SimulationEventLayer = 'NETWORK' | 'PROPAGATION' | 'CONTROL'

export interface SimulationEvent {
  id: string
  stepIndex: number
  type: SimulationEventType
  phase: 'initial' | 'propagation' | 'isolation'
  eventLayer: SimulationEventLayer
  sourceId: string
  targetId: string
  result: SimulationResultCode
  message: string
  severity: EventSeverity
  service: ServiceType
  route: string[]
  routeEdgeIds: string[]
  reason: string
  matchedRuleId?: string
  matchedRuleName?: string
  matchedRuleIds?: string[]
  matchedRules?: FirewallRule[]
  firewallDecisions?: FirewallDecision[]
  communicationReason?: CommunicationReason
  blockedAt?: string
  stateBefore?: NodeStatus
  stateAfter?: NodeStatus
}

export interface SimulationSnapshot {
  eventIndex: number
  nodeStatuses: Record<string, NodeStatus>
  compromisedNodeIds: string[]
}

export interface SimulationMetrics {
  totalNodes: number
  affectedNodes: number
  affectedRatio: number
  blockedEvents: number
  networkCommunicationRefusals: number
  teachingPropagationBlocks: number
  propagationSteps: number
  criticalAssetCompromised: boolean
  blockedPropagationRatio: number
  businessPathsTotal: number
  businessPathsReachable: number
  businessReachability: number
}

export interface SimulationResult {
  events: SimulationEvent[]
  snapshots: SimulationSnapshot[]
  metrics: SimulationMetrics
  businessPathResults: BusinessPathResult[]
  compromisedNodeIds: string[]
  finalStatuses: Record<string, NodeStatus>
  scenarioId: string
  generatedAt: string
}

export interface SimulationOptions {
  isolatedNodeIds?: string[]
}
