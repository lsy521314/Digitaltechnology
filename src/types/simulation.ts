import type { BusinessPathResult, CommunicationDecision, CommunicationReason, FirewallDecision, FirewallRule, NetworkNode, NodeStatus, PrivilegeLevel, SecurityControl, ServiceId, ServiceType, TeachingCondition } from './network'

export type SimulationResultCode = 'allow' | 'block' | 'compromise' | 'info'
export type SimulationEventType = 'seed' | 'attempt' | 'blocked' | 'compromise' | 'request' | 'info' | 'isolate'
export type EventSeverity = 'normal' | 'warning' | 'critical' | 'success'
export type SimulationEventLayer = 'NETWORK' | 'PROPAGATION' | 'CONTROL' | 'ATTACK'

export type AssetAccessLevel = 'NONE' | 'DATA_ACCESS'

export interface ControlledEndpoint {
  nodeId: string
  privilege: Exclude<PrivilegeLevel, 'NONE'>
  /** Absent for an endpoint already controlled in the initial experiment state. */
  acquiredByTransitionId?: string
}

export interface AttackState {
  /** Endpoint control and privilege are distinct from the display-only NodeStatus. */
  controlledEndpoints: Record<string, ControlledEndpoint>
  /** DATA_ACCESS is an objective capability, not host-level control of the data node. */
  assetAccess: Record<string, AssetAccessLevel>
  /** Successful abstract transitions on this particular state path. */
  executedTransitionIds: string[]
}

export interface TechniqueEffect {
  kind: 'CONTROL_ENDPOINT' | 'ASSET_ACCESS'
  privilege?: Exclude<PrivilegeLevel, 'NONE'>
  capability?: 'DATA_ACCESS'
}

export interface TeachingTechnique {
  id: string
  name: string
  description: string
  requiredSourcePrivilege: Exclude<PrivilegeLevel, 'NONE'>
  requiredSourceConditions?: TeachingCondition[]
  requiredTargetConditions: TeachingCondition[]
  requiredService?: ServiceId
  /** Explicit teaching-model scope; omitted fields mean that dimension is unrestricted. */
  allowedSourceNodeIds?: string[]
  allowedSourceZones?: NetworkNode['zone'][]
  allowedTargetNodeIds?: string[]
  allowedTargetRoles?: NetworkNode['deviceRole'][]
  effect: TechniqueEffect
  blockedByControls?: SecurityControl[]
}

export interface PreconditionsCheck {
  id: string
  label: string
  passed: boolean
  reason: string
}

export interface AttackTransition {
  id: string
  techniqueId: string
  techniqueName: string
  sourceNodeId: string
  targetNodeId: string
  sourcePrivilege: PrivilegeLevel
  targetPrivilegeBefore: PrivilegeLevel
  targetPrivilegeAfter: PrivilegeLevel
  /** CommunicationPath decision is a precondition; null denotes a local technique. */
  communicationDecision: CommunicationDecision | null
  preconditionChecks: PreconditionsCheck[]
  result: 'SUCCESS' | 'BLOCKED' | 'NOT_APPLICABLE'
  /** Effect is present only for a successful state change. */
  effect?: 'CONTROL_GRANTED' | 'PRIVILEGE_ESCALATED' | 'DATA_ACCESS_GRANTED'
  beforeState: AttackState
  afterState: AttackState
  reason: string
}

/** Bounded search output. Search evaluations and the representative teaching chain are kept separate. */
export interface AttackSearchResult {
  initialState: AttackState
  reachableStates: AttackState[]
  successfulTransitions: AttackTransition[]
  /** Deduplicated by technique, source, target, and the actual blocking reason. */
  blockedTransitions: AttackTransition[]
  /** Every assessed SUCCESS, BLOCKED, and NOT_APPLICABLE transition, for technical details only. */
  searchEvaluations: AttackTransition[]
  objectiveReached: boolean
  objectiveWitnessChain: AttackTransition[] | null
  closestBlockedWitness: AttackTransition[] | null
  representativeChain: AttackTransition[]
  searchComplete: boolean
  limitReached: boolean
  searchDepth: number
  depthLimit: number
  stateLimit: number
  depthLimitReached: boolean
  stateLimitReached: boolean
  exploredStateCount: number
  reachableControlledEndpoints: Record<string, ControlledEndpoint>
  reachableAssetAccess: AttackState['assetAccess']
  reachableAdminEndpointIds: string[]
  /** Search-space path count. This is a bounded graph statistic, not a real attack count. */
  objectiveStatePathCount: number
}

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
  attackTechniqueId?: string
  attackTechniqueName?: string
  attackTransitionResult?: AttackTransition['result']
  attackEffect?: AttackTransition['effect']
  sourcePrivilege?: PrivilegeLevel
  targetPrivilegeBefore?: PrivilegeLevel
  targetPrivilegeAfter?: PrivilegeLevel
  preconditionChecks?: PreconditionsCheck[]
  attackObjective?: string
  assetAccessBefore?: AssetAccessLevel
  assetAccessAfter?: AssetAccessLevel
}

export interface SimulationSnapshot {
  eventIndex: number
  nodeStatuses: Record<string, NodeStatus>
  compromisedNodeIds: string[]
  attackState?: AttackState
}

export interface SimulationMetrics {
  totalNodes: number
  affectedNodes: number
  affectedRatio: number
  networkCommunicationRefusals: number
  teachingPropagationBlocks: number
  propagationSteps: number
  criticalAssetCompromised: boolean
  blockedPropagationRatio: number
  businessPathsTotal: number
  businessPathsReachable: number
  businessReachability: number
  attackTransitions?: number
  controlledEndpoints?: number
  adminControlledEndpoints?: number
  criticalObjectiveReached?: boolean
  criticalAttackPaths?: number
  attackSearchComplete?: boolean
  representativeChainLength?: number
  uniqueBlockedCandidateCount?: number
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
  attackTransitions?: AttackTransition[]
  /** Includes successful, blocked, and non-applicable teaching behavior assessments. */
  attackTransitionAttempts?: AttackTransition[]
  finalAttackState?: AttackState
  attackSearchResult?: AttackSearchResult
}

export interface ChallengeCheck {
  id: string
  label: string
  passed: boolean
  reason: string
}

export interface ChallengeEvaluation {
  status: 'unverified' | 'stale' | 'verified' | 'incomplete'
  valid: boolean
  success: boolean | null
  checks: ChallengeCheck[]
}

export interface SimulationOptions {
  isolatedNodeIds?: string[]
}
