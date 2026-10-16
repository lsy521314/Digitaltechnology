export type NodeType = 'Internet' | 'Gateway' | 'Firewall' | 'Router' | 'Switch' | 'Workstation' | 'Server' | 'Database'
export type DeviceRole = 'EXTERNAL_NETWORK' | 'ENDPOINT' | 'L2_SWITCH' | 'L3_SWITCH' | 'FIREWALL'
export type NetworkZone = 'Internet' | 'DMZ' | 'Office' | 'Server' | 'Database'
export type NodeStatus = 'normal' | 'warning' | 'compromised' | 'isolated' | 'protected'
export type ServiceType = 'ANY' | 'WEB' | 'DATABASE' | 'FILE' | 'MAIL' | 'INTERNAL'
export type ServiceId = Exclude<ServiceType, 'ANY'>
export type RuleAction = 'ALLOW' | 'DENY'
export type InterfaceKind = 'ENDPOINT_NIC' | 'SWITCH_PORT' | 'L3_INTERFACE' | 'VLAN_GATEWAY'
export type SwitchPortMode = 'ACCESS' | 'TRUNK'
export type RouteKind = 'DIRECT' | 'STATIC' | 'DEFAULT'

export const NETWORK_ZONES: NetworkZone[] = ['Internet', 'DMZ', 'Office', 'Server', 'Database']
export const SERVICE_TYPES: ServiceType[] = ['ANY', 'WEB', 'DATABASE', 'FILE', 'MAIL', 'INTERNAL']

export interface Position3D { x: number; y: number; z: number }

export interface NetworkNode {
  id: string
  name: string
  type: NodeType
  deviceRole: DeviceRole
  zone: NetworkZone
  position: Position3D
  status: NodeStatus
  /** Display convenience only. Communication decisions use NetworkInterface addresses. */
  ip: string
  isCritical: boolean
  protectionEnabled: boolean
  isolationEnabled?: boolean
  services?: ServiceId[]
  description: string
}

export interface NetworkInterface {
  id: string
  nodeId: string
  name: string
  kind: InterfaceKind
  ipv4Address?: string
  prefixLength?: number
  vlanId?: number
  switchportMode?: SwitchPortMode
  accessVlanId?: number
  allowedVlanIds?: number[]
  /** A logical VLAN gateway can be associated with its physical uplink port. */
  parentInterfaceId?: string
  enabled: boolean
}

/** A NetworkEdge is a physical link between two interfaces. It carries no service semantics. */
export interface NetworkEdge {
  id: string
  source: string
  target: string
  sourceInterfaceId: string
  targetInterfaceId: string
  enabled: boolean
}

export interface VlanDefinition {
  id: number
  name: string
  zone: NetworkZone
  subnetCidr: string
  gatewayInterfaceId: string
}

export interface NetworkService {
  serviceId: ServiceId
  name: string
  transport?: 'TCP' | 'UDP' | 'TO_BE_VERIFIED'
  destinationPort?: number | 'TO_BE_VERIFIED'
  verificationStatus: 'TO_BE_VERIFIED' | 'VERIFIED'
}

export type NetworkSelector =
  | { kind: 'ANY' }
  | { kind: 'ZONE'; zone: NetworkZone }
  | { kind: 'NODE'; nodeId: string }

export interface FirewallRule {
  id: string
  firewallId: string
  order: number
  name: string
  source: NetworkSelector
  destination: NetworkSelector
  serviceId: ServiceId | 'ANY'
  action: RuleAction
  enabled: boolean
}

export interface FirewallPolicy {
  firewallId: string
  defaultAction: RuleAction
  rules: FirewallRule[]
}

export interface RouteEntry {
  id: string
  deviceId: string
  kind: RouteKind
  destinationCidr: string
  nextHopIp?: string
  outInterfaceId: string
}

export interface BusinessPath {
  id: string
  sourceId: string
  targetId: string
  service: ServiceId
  label: string
}

export interface FirewallDecision {
  firewallId: string
  allowed: boolean
  reason: string
  matchedRuleId?: string
  matchedRuleName?: string
  defaultAction?: RuleAction
}

export type CommunicationReason =
  | 'ALLOWED'
  | 'NO_INTERFACE'
  | 'LINK_DISABLED'
  | 'VLAN_MISMATCH'
  | 'NO_L2_PATH'
  | 'NO_ROUTE'
  | 'FIREWALL_DENY'
  | 'SERVICE_UNAVAILABLE'
  | 'ISOLATED'
  | 'INVALID_CONFIGURATION'

export interface CommunicationDecision {
  allowed: boolean
  sourceNodeId: string
  targetNodeId: string
  sourceIp?: string
  targetIp?: string
  path: string[]
  routeEdgeIds: string[]
  firewallsTraversed: string[]
  firewallDecisions: FirewallDecision[]
  matchedRules: FirewallRule[]
  serviceId: ServiceId
  reason: CommunicationReason
  detail: string
  blockedAt?: string
}

export interface BusinessPathResult extends BusinessPath {
  allowed: boolean
  reason: string
  detail?: string
  route: string[]
  routeEdgeIds: string[]
  matchedRuleId?: string
  matchedRuleName?: string
}
