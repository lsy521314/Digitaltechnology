export type NodeType = 'Internet' | 'Gateway' | 'Firewall' | 'Router' | 'Switch' | 'Workstation' | 'Server' | 'Database'
export type NetworkZone = 'Internet' | 'DMZ' | 'Office' | 'Server' | 'Database'
export type NodeStatus = 'normal' | 'warning' | 'compromised' | 'isolated' | 'protected'
export type ServiceType = 'ANY' | 'WEB' | 'DATABASE' | 'FILE' | 'MAIL' | 'INTERNAL'
export type RuleAction = 'ALLOW' | 'DENY'

export const NETWORK_ZONES: NetworkZone[] = ['Internet', 'DMZ', 'Office', 'Server', 'Database']
export const SERVICE_TYPES: ServiceType[] = ['ANY', 'WEB', 'DATABASE', 'FILE', 'MAIL', 'INTERNAL']

export interface Position3D { x: number; y: number; z: number }

export interface NetworkNode {
  id: string
  name: string
  type: NodeType
  zone: NetworkZone
  position: Position3D
  status: NodeStatus
  ip: string
  isCritical: boolean
  protectionEnabled: boolean
  isolationEnabled?: boolean
  services?: Exclude<ServiceType, 'ANY'>[]
  description: string
}

export interface NetworkEdge {
  id: string
  source: string
  target: string
  service: Exclude<ServiceType, 'ANY'>
  enabled: boolean
  bidirectional: boolean
}

export interface SecurityRule {
  id: string
  name: string
  sourceZone: NetworkZone | 'ANY'
  targetZone: NetworkZone | 'ANY'
  service: ServiceType
  action: RuleAction
  enabled: boolean
}

export interface BusinessPath {
  id: string
  sourceId: string
  targetId: string
  service: Exclude<ServiceType, 'ANY'>
  label: string
}

export interface BusinessPathResult extends BusinessPath {
  allowed: boolean
  reason: string
  route: string[]
  routeEdgeIds: string[]
  matchedRuleId?: string
  matchedRuleName?: string
}
