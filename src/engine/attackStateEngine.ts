import type { CommunicationDecision, NetworkNode, PrivilegeLevel, SecurityControl, TeachingCondition } from '../types/network'
import type { AttackSearchResult, AttackState, AttackTransition, ControlledEndpoint, PreconditionsCheck, TeachingTechnique } from '../types/simulation'
import type { Scenario } from '../types/scenario'
import { evaluateCommunication } from './communicationEngine'

export const MAX_ATTACK_DEPTH = 8
export const MAX_ATTACK_STATES = 160

export interface TechniqueAssessment {
  technique: TeachingTechnique
  sourceNodeId: string
  targetNodeId: string
  sourcePrivilege: PrivilegeLevel
  targetPrivilegeBefore: PrivilegeLevel
  communicationDecision: CommunicationDecision | null
  preconditions: PreconditionsCheck[]
  executable: boolean
  result: AttackTransition['result']
  reason: string
}

export interface AttackStateAction {
  kind: 'blocked' | 'transition' | 'not-applicable'
  assessment: TechniqueAssessment
  transition: AttackTransition
  beforeState: AttackState
  afterState: AttackState
}

export interface AttackStateSearchOptions {
  maxDepth?: number
  maxStates?: number
}

export interface AttackStateRun {
  searchResult: AttackSearchResult
  initialState: AttackState
  /** Final state of the representative chain (or the best reachable witness if there is no block). */
  finalState: AttackState
  /** Compatibility aliases retained for existing callers and technical details. */
  transitions: AttackTransition[]
  attempts: AttackTransition[]
  actions: AttackStateAction[]
  reachableControlledEndpoints: Record<string, ControlledEndpoint>
  reachableAssetAccess: AttackState['assetAccess']
  criticalAttackPaths: number
  exploredStateCount: number
  depthLimitReached: boolean
  stateLimitReached: boolean
}

const privilegeRank: Record<PrivilegeLevel, number> = { NONE: 0, USER: 1, ADMIN: 2 }

const conditionCopy: Record<TeachingCondition, { name: string; explanation: string }> = {
  REMOTE_ACCESS_EXPOSED: { name: '远程服务入口条件', explanation: '教学模型将该服务视为可供抽象行为尝试的入口；不代表已发现真实漏洞。' },
  WEAK_CREDENTIAL_CONDITION: { name: '弱访问条件', explanation: '教学模型假设存在较弱的访问条件；不表示真实凭据或检测结果。' },
  PRIVILEGE_ESCALATION_CONDITION: { name: '本地权限变化条件', explanation: '教学模型允许展示 USER 到 ADMIN 的抽象权限变化；不对应真实漏洞。' },
  APPLICATION_SERVICE_ROLE: { name: '应用服务角色', explanation: '该节点在实验中承担应用服务角色，是数据访问行为的限定来源。' },
  DATA_ACCESS_CONDITION: { name: '数据访问条件', explanation: '教学模型允许验证数据访问目标；不代表真实数据库缺陷。' },
}

export const lateralTeachingTechniques: TeachingTechnique[] = [
  {
    id: 'remote-service-movement', name: '远程服务访问',
    description: '通过允许的 INTERNAL 通信和目标弱访问教学条件，从已控制的办公终端获得 USER 控制状态。',
    requiredSourcePrivilege: 'USER', requiredTargetConditions: ['WEAK_CREDENTIAL_CONDITION'], requiredService: 'INTERNAL',
    allowedSourceZones: ['Office'], allowedTargetNodeIds: ['pc02', 'pc03'], allowedTargetRoles: ['ENDPOINT'],
    effect: { kind: 'CONTROL_ENDPOINT', privilege: 'USER' }, blockedByControls: ['ENDPOINT_PROTECTION'],
  },
  {
    id: 'application-access', name: '应用服务访问',
    description: '通过允许的 WEB 通信和应用服务器远程访问教学条件，从办公终端获得应用服务器 USER 控制状态。',
    requiredSourcePrivilege: 'USER', requiredTargetConditions: ['REMOTE_ACCESS_EXPOSED'], requiredService: 'WEB',
    allowedSourceZones: ['Office'], allowedTargetNodeIds: ['app'], allowedTargetRoles: ['ENDPOINT'],
    effect: { kind: 'CONTROL_ENDPOINT', privilege: 'USER' }, blockedByControls: ['ENDPOINT_PROTECTION'],
  },
  {
    id: 'privilege-escalation', name: '本地权限提升',
    description: '在应用服务器具备权限变化教学条件且未启用服务加固时，将该端点的抽象权限从 USER 提升到 ADMIN。',
    requiredSourcePrivilege: 'USER', requiredSourceConditions: ['PRIVILEGE_ESCALATION_CONDITION'],
    requiredTargetConditions: ['PRIVILEGE_ESCALATION_CONDITION'], allowedSourceNodeIds: ['app'],
    allowedTargetNodeIds: ['app'], allowedTargetRoles: ['ENDPOINT'],
    effect: { kind: 'CONTROL_ENDPOINT', privilege: 'ADMIN' }, blockedByControls: ['SERVICE_HARDENING'],
  },
  {
    id: 'database-access', name: '数据库数据访问',
    description: '仅应用服务器 ADMIN 状态、DATABASE 通信和数据库数据访问教学条件同时满足时，才授予 DATA_ACCESS。',
    requiredSourcePrivilege: 'ADMIN', requiredSourceConditions: ['APPLICATION_SERVICE_ROLE'],
    requiredTargetConditions: ['DATA_ACCESS_CONDITION'], requiredService: 'DATABASE',
    allowedSourceNodeIds: ['app'], allowedTargetNodeIds: ['db'], allowedTargetRoles: ['ENDPOINT'],
    effect: { kind: 'ASSET_ACCESS', capability: 'DATA_ACCESS' }, blockedByControls: ['DATA_ACCESS_CONTROL'],
  },
]

function cloneState(state: Partial<AttackState> | undefined): AttackState {
  const rawControlled = state?.controlledEndpoints ?? {}
  const controlledEndpoints = Object.fromEntries(Object.entries(rawControlled).map(([nodeId, value]) => {
    // Migrate persisted V1 records that represented control as a bare privilege string.
    const legacy = value as unknown as string | ControlledEndpoint
    const controlled = typeof legacy === 'string' ? { nodeId, privilege: legacy } : { ...legacy, nodeId }
    return [nodeId, controlled]
  })) as Record<string, ControlledEndpoint>
  return {
    controlledEndpoints,
    assetAccess: { ...(state?.assetAccess ?? {}) },
    executedTransitionIds: [...(state?.executedTransitionIds ?? [])],
  }
}

/** History is intentionally excluded, so equivalent security states merge during graph search. */
export function attackStateSignature(state: AttackState): string {
  return JSON.stringify({
    controlledEndpoints: Object.entries(state.controlledEndpoints)
      .map(([id, endpoint]) => [id, endpoint.privilege])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
    assetAccess: Object.entries(state.assetAccess).sort(([a], [b]) => a.localeCompare(b)),
  })
}

function privilegeOf(state: AttackState, nodeId: string): PrivilegeLevel {
  return state.controlledEndpoints[nodeId]?.privilege ?? 'NONE'
}

function hasControl(node: NetworkNode | undefined, control: SecurityControl): boolean {
  if (!node) return false
  if (node.securityControls?.includes(control)) return true
  return control === 'ENDPOINT_PROTECTION' && node.protectionEnabled
}

function controlLabel(control: SecurityControl): string {
  if (control === 'ENDPOINT_PROTECTION') return '终端防护'
  if (control === 'DATA_ACCESS_CONTROL') return '数据访问控制'
  return '服务加固'
}

function conditionCheck(id: string, label: string, passed: boolean, reason: string): PreconditionsCheck {
  return { id, label, passed, reason }
}

function conditionResult(condition: TeachingCondition, passed: boolean, location: '源端' | '目标'): PreconditionsCheck {
  const copy = conditionCopy[condition]
  return conditionCheck(`${location === '源端' ? 'source' : 'target'}-${condition}`, `${location}教学抽象条件：${copy.name}`, passed,
    passed ? `满足教学抽象条件。${copy.explanation}` : `未满足教学抽象条件。${copy.explanation}`)
}

function effectAlreadyPresent(state: AttackState, targetId: string, technique: TeachingTechnique): boolean {
  if (technique.effect.kind === 'ASSET_ACCESS') return state.assetAccess[targetId] === (technique.effect.capability ?? 'DATA_ACCESS')
  const current = privilegeOf(state, targetId)
  return privilegeRank[current] >= privilegeRank[technique.effect.privilege ?? 'USER']
}

export function evaluateTeachingTechnique(
  scenario: Scenario,
  stateInput: AttackState,
  sourceNodeId: string,
  targetNodeId: string,
  technique: TeachingTechnique,
): TechniqueAssessment {
  const state = cloneState(stateInput)
  const source = scenario.nodes.find((node) => node.id === sourceNodeId)
  const target = scenario.nodes.find((node) => node.id === targetNodeId)
  const sourcePrivilege = privilegeOf(state, sourceNodeId)
  const targetPrivilegeBefore = privilegeOf(state, targetNodeId)
  const sourceConditions = source?.teachingConditions ?? []
  const targetConditions = target?.teachingConditions ?? []
  const communicationDecision = technique.requiredService
    ? evaluateCommunication(scenario, { sourceNodeId, targetNodeId, serviceId: technique.requiredService })
    : null

  const sourceScopeAllowed = Boolean(source)
    && (!technique.allowedSourceNodeIds || technique.allowedSourceNodeIds.includes(sourceNodeId))
    && (!technique.allowedSourceZones || technique.allowedSourceZones.includes(source!.zone))
  const targetScopeAllowed = Boolean(target)
    && (!technique.allowedTargetNodeIds || technique.allowedTargetNodeIds.includes(targetNodeId))
    && (!technique.allowedTargetRoles || technique.allowedTargetRoles.includes(target!.deviceRole))
  const preconditions: PreconditionsCheck[] = [
    conditionCheck('source-scope', '行为允许的源节点范围', sourceScopeAllowed,
      sourceScopeAllowed ? '源节点符合该教学行为定义的范围。' : '源节点不属于该教学行为允许的来源。'),
    conditionCheck('source-privilege', '源端点权限', privilegeRank[sourcePrivilege] >= privilegeRank[technique.requiredSourcePrivilege],
      sourcePrivilege === 'NONE' ? '当前攻击状态未控制源端点。' : `源端点为 ${sourcePrivilege}，该教学行为要求至少 ${technique.requiredSourcePrivilege}。`),
  ]

  for (const condition of technique.requiredSourceConditions ?? []) {
    preconditions.push(conditionResult(condition, sourceConditions.includes(condition), '源端'))
  }

  preconditions.push(conditionCheck('target-scope', '行为允许的目标范围', targetScopeAllowed,
    targetScopeAllowed ? '目标符合该教学行为定义的节点范围。' : '目标不属于该教学行为允许的目标。'))

  if (communicationDecision) {
    preconditions.push(conditionCheck('communication', '网络通信前置条件', communicationDecision.allowed,
      communicationDecision.allowed ? `网络通信允许：${communicationDecision.detail}` : `网络通信不可达：${communicationDecision.detail}`))
  }

  for (const condition of technique.requiredTargetConditions) {
    preconditions.push(conditionResult(condition, targetConditions.includes(condition), '目标'))
  }

  preconditions.push(conditionCheck('target-effect', '目标状态尚未达到', !effectAlreadyPresent(state, targetNodeId, technique),
    effectAlreadyPresent(state, targetNodeId, technique) ? '目标已具有该教学行为的结果状态。' : '目标尚未具有该教学行为的结果状态。'))

  const activeControls = (technique.blockedByControls ?? []).filter((control) => hasControl(target, control))
  preconditions.push(conditionCheck('security-controls', '目标安全控制', activeControls.length === 0,
    activeControls.length ? `目标${activeControls.map(controlLabel).join('、')}已启用，按该教学行为定义阻止本次状态转移。` : '没有启用会阻止该教学行为的目标安全控制。'))

  const scopeFailed = !sourceScopeAllowed || !targetScopeAllowed
  const blockedCheck = preconditions.find((item) => !item.passed && (item.id === 'communication' || item.id === 'security-controls'))
  const failed = preconditions.find((item) => !item.passed)
  const result: AttackTransition['result'] = scopeFailed
    ? 'NOT_APPLICABLE'
    : blockedCheck
      ? 'BLOCKED'
      : failed
        ? 'NOT_APPLICABLE'
        : 'SUCCESS'
  return {
    technique, sourceNodeId, targetNodeId, sourcePrivilege, targetPrivilegeBefore,
    communicationDecision, preconditions, executable: result === 'SUCCESS', result,
    reason: scopeFailed
      ? (preconditions.find((item) => !item.passed && (item.id === 'source-scope' || item.id === 'target-scope'))?.reason ?? '该教学行为不适用于当前节点范围。')
      : blockedCheck?.reason ?? (failed ? failed.reason : `所有教学前置条件满足，可以执行「${technique.name}」。`),
  }
}

function applyEffect(state: AttackState, targetId: string, technique: TeachingTechnique, transitionId: string): void {
  if (technique.effect.kind === 'ASSET_ACCESS') {
    state.assetAccess[targetId] = technique.effect.capability ?? 'DATA_ACCESS'
  } else {
    const existing = state.controlledEndpoints[targetId]
    state.controlledEndpoints[targetId] = {
      nodeId: targetId,
      privilege: technique.effect.privilege ?? 'USER',
      acquiredByTransitionId: existing?.acquiredByTransitionId ?? transitionId,
    }
  }
  state.executedTransitionIds.push(transitionId)
}

function effectFor(technique: TeachingTechnique, before: AttackState, after: AttackState, targetId: string): AttackTransition['effect'] {
  if (technique.effect.kind === 'ASSET_ACCESS') return 'DATA_ACCESS_GRANTED'
  const beforePrivilege = privilegeOf(before, targetId)
  const afterPrivilege = privilegeOf(after, targetId)
  return beforePrivilege === 'NONE' ? 'CONTROL_GRANTED' : afterPrivilege === 'ADMIN' ? 'PRIVILEGE_ESCALATED' : 'CONTROL_GRANTED'
}

function candidateTargets(scenario: Scenario, source: NetworkNode, technique: TeachingTechnique): NetworkNode[] {
  if (!technique.requiredService && technique.effect.kind === 'CONTROL_ENDPOINT') return [source]
  if (technique.allowedTargetNodeIds) {
    return technique.allowedTargetNodeIds.map((id) => scenario.nodes.find((node) => node.id === id)).filter((node): node is NetworkNode => Boolean(node))
  }
  return scenario.nodes.filter((node) => (!technique.allowedTargetRoles || technique.allowedTargetRoles.includes(node.deviceRole))
    && (!technique.requiredService || node.services?.includes(technique.requiredService)))
}

function objectiveReached(state: AttackState, objectiveId: string | undefined): boolean {
  return Boolean(objectiveId && state.assetAccess[objectiveId] === 'DATA_ACCESS')
}

function stateRichness(state: AttackState): [number, number, number, number] {
  const endpoints = Object.values(state.controlledEndpoints)
  return [
    Object.keys(state.assetAccess).filter((id) => state.assetAccess[id] === 'DATA_ACCESS').length,
    endpoints.length,
    endpoints.filter((endpoint) => endpoint.privilege === 'ADMIN').length,
    state.executedTransitionIds.length,
  ]
}

function isBetterWitness(candidate: AttackState, current: AttackState, objectiveId: string | undefined): boolean {
  const candidateObjective = objectiveReached(candidate, objectiveId)
  const currentObjective = objectiveReached(current, objectiveId)
  if (candidateObjective !== currentObjective) return candidateObjective
  if (candidateObjective && candidate.executedTransitionIds.length !== current.executedTransitionIds.length) {
    return candidate.executedTransitionIds.length < current.executedTransitionIds.length
  }
  const candidateScore = stateRichness(candidate)
  const currentScore = stateRichness(current)
  for (let index = 0; index < candidateScore.length; index += 1) {
    if (candidateScore[index] !== currentScore[index]) return candidateScore[index] > currentScore[index]
  }
  return attackStateSignature(candidate).localeCompare(attackStateSignature(current)) < 0
}

function updateReachableState(
  aggregate: AttackState,
  state: AttackState,
): void {
  for (const [nodeId, endpoint] of Object.entries(state.controlledEndpoints)) {
    const current = aggregate.controlledEndpoints[nodeId]
    if (!current || privilegeRank[endpoint.privilege] > privilegeRank[current.privilege]) {
      aggregate.controlledEndpoints[nodeId] = { ...endpoint }
    }
  }
  for (const [nodeId, access] of Object.entries(state.assetAccess)) {
    if (access === 'DATA_ACCESS') aggregate.assetAccess[nodeId] = access
  }
}

function countPathsToObjective(initial: AttackState, transitions: AttackTransition[], objectiveId: string | undefined): number {
  if (!objectiveId || !transitions.length) return 0
  const outgoing = new Map<string, AttackTransition[]>()
  for (const transition of transitions) {
    const key = attackStateSignature(transition.beforeState)
    const list = outgoing.get(key) ?? []
    list.push(transition)
    outgoing.set(key, list)
  }
  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  const count = (state: AttackState): number => {
    if (objectiveReached(state, objectiveId)) return 1
    const key = attackStateSignature(state)
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    if (visiting.has(key)) return 0
    visiting.add(key)
    const result = (outgoing.get(key) ?? []).reduce((sum, edge) => sum + count(edge.afterState), 0)
    visiting.delete(key)
    memo.set(key, result)
    return result
  }
  return count(initial)
}

/** Union of endpoint control states that are each reachable in at least one explored state. */
export function getReachableControlledEndpointUnion(states: AttackState[]): Record<string, ControlledEndpoint> {
  const union: AttackState = { controlledEndpoints: {}, assetAccess: {}, executedTransitionIds: [] }
  for (const state of states) updateReachableState(union, state)
  return union.controlledEndpoints
}

function chainKey(chain: AttackTransition[]): string {
  return chain.map((item) => `${item.techniqueId}|${item.sourceNodeId}|${item.targetNodeId}`).join('>')
}

function chooseShortestStableChain(chains: AttackTransition[][]): AttackTransition[] | null {
  return [...chains].sort((a, b) => a.length - b.length || chainKey(a).localeCompare(chainKey(b)))[0] ?? null
}

function blockReason(transition: AttackTransition): string {
  return transition.preconditionChecks.find((item) => !item.passed
    && (item.id === 'communication' || item.id === 'security-controls'))?.reason ?? transition.reason
}

function blockedSignature(transition: AttackTransition): string {
  return [transition.techniqueId, transition.sourceNodeId, transition.targetNodeId, blockReason(transition)].join('|')
}

function completedObjectiveStages(prefix: AttackTransition[], blocked: AttackTransition): number {
  let neededNodeId = blocked.sourceNodeId
  let neededPrivilege = blocked.sourcePrivilege
  let completed = 0
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const transition = prefix[index]!
    if (transition.targetNodeId !== neededNodeId
      || privilegeRank[transition.targetPrivilegeAfter] < privilegeRank[neededPrivilege]) continue
    completed += 1
    neededNodeId = transition.sourceNodeId
    neededPrivilege = transition.sourcePrivilege
  }
  return completed
}

/** Deterministic bounded state-space search; every network decision comes from communicationEngine. */
export function runAttackStateEngine(
  scenario: Scenario,
  isolatedNodeIds: string[] = [],
  options: AttackStateSearchOptions = {},
): AttackStateRun {
  const maxDepth = Math.max(0, Math.min(options.maxDepth ?? MAX_ATTACK_DEPTH, MAX_ATTACK_DEPTH))
  const maxStates = Math.max(1, Math.min(options.maxStates ?? MAX_ATTACK_STATES, MAX_ATTACK_STATES))
  const isolated = new Set(isolatedNodeIds)
  const runtimeScenario: Scenario = {
    ...scenario,
    nodes: scenario.nodes.map((node) => isolated.has(node.id) ? { ...node, isolationEnabled: true } : node),
  }
  const initialState = cloneState(scenario.initialAttackState)
  const stateQueue: Array<{ state: AttackState; depth: number }> = [{ state: cloneState(initialState), depth: 0 }]
  const visitedStates = new Set([attackStateSignature(initialState)])
  const predecessorByState = new Map<string, AttackTransition>()
  const reachableStates: AttackState[] = [cloneState(initialState)]
  const actions: AttackStateAction[] = []
  const transitions: AttackTransition[] = []
  const attempts: AttackTransition[] = []
  const seenActionIds = new Set<string>()
  const objectiveWitnessCandidates: AttackTransition[][] = []
  const blockedWitnessCandidates: Array<{ prefix: AttackTransition[]; transition: AttackTransition }> = []
  const objectiveId = scenario.challenge?.protectedNodeId ?? scenario.nodes.find((node) => node.isCritical)?.id
  let finalState = cloneState(initialState)
  let depthLimitReached = false
  let stateLimitReached = false
  let maxExploredDepth = 0

  const assessState = (state: AttackState): Array<{ source: NetworkNode; target: NetworkNode; technique: TeachingTechnique; assessment: TechniqueAssessment }> => {
    const candidates: Array<{ source: NetworkNode; target: NetworkNode; technique: TeachingTechnique; assessment: TechniqueAssessment }> = []
    const sources = Object.keys(state.controlledEndpoints).sort()
    for (const sourceNodeId of sources) {
      const source = runtimeScenario.nodes.find((node) => node.id === sourceNodeId)
      if (!source || source.deviceRole !== 'ENDPOINT') continue
      for (const technique of lateralTeachingTechniques) {
        const targets = candidateTargets(runtimeScenario, source, technique)
        for (const target of targets) {
          if (effectAlreadyPresent(state, target.id, technique)) continue
          const assessment = evaluateTeachingTechnique(runtimeScenario, state, sourceNodeId, target.id, technique)
          candidates.push({ source, target, technique, assessment })
        }
      }
    }
    return candidates.sort((a, b) => a.technique.id.localeCompare(b.technique.id)
      || a.source.id.localeCompare(b.source.id)
      || a.target.id.localeCompare(b.target.id))
  }

  const pathToState = (state: AttackState): AttackTransition[] => {
    const reversed: AttackTransition[] = []
    let key = attackStateSignature(state)
    while (predecessorByState.has(key)) {
      const edge = predecessorByState.get(key)!
      reversed.push(edge)
      key = attackStateSignature(edge.beforeState)
    }
    return reversed.reverse()
  }

  while (stateQueue.length) {
    const current = stateQueue.shift()!
    maxExploredDepth = Math.max(maxExploredDepth, current.depth)
    if (current.depth >= maxDepth) {
      if (assessState(current.state).some((item) => item.assessment.executable)) depthLimitReached = true
      continue
    }
    for (const { source, target, technique, assessment } of assessState(current.state)) {
      const beforeKey = attackStateSignature(current.state)
      const actionBaseId = `${beforeKey}|${technique.id}|${source.id}|${target.id}`
      if (seenActionIds.has(actionBaseId)) continue
      seenActionIds.add(actionBaseId)

      const beforeState = cloneState(current.state)
      const afterState = cloneState(current.state)
      const transitionId = `transition-${String(attempts.length + 1).padStart(3, '0')}`
      let result = assessment.result
      let effect: AttackTransition['effect']
      if (assessment.executable) {
        applyEffect(afterState, target.id, technique, transitionId)
        effect = effectFor(technique, beforeState, afterState, target.id)
        result = 'SUCCESS'
      }

      const transition: AttackTransition = {
        id: transitionId,
        techniqueId: technique.id,
        techniqueName: technique.name,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourcePrivilege: assessment.sourcePrivilege,
        targetPrivilegeBefore: assessment.targetPrivilegeBefore,
        targetPrivilegeAfter: privilegeOf(afterState, target.id),
        communicationDecision: assessment.communicationDecision,
        preconditionChecks: assessment.preconditions,
        result,
        effect,
        beforeState,
        afterState: cloneState(afterState),
        reason: assessment.reason,
      }
      attempts.push(transition)

      if (result === 'SUCCESS') {
        transitions.push(transition)
        const objectiveChain = pathToState(current.state).concat(transition)
        if (objectiveReached(afterState, objectiveId)) objectiveWitnessCandidates.push(objectiveChain)
        if (isBetterWitness(afterState, finalState, objectiveId)) finalState = cloneState(afterState)
      } else if (result === 'BLOCKED') {
        blockedWitnessCandidates.push({ prefix: pathToState(current.state), transition })
      }

      const action: AttackStateAction = {
        kind: result === 'SUCCESS' ? 'transition' : result === 'BLOCKED' ? 'blocked' : 'not-applicable',
        assessment,
        transition,
        beforeState,
        afterState: cloneState(afterState),
      }
      actions.push(action)

      if (result !== 'SUCCESS') continue
      const afterKey = attackStateSignature(afterState)
      if (visitedStates.has(afterKey)) continue
      if (visitedStates.size >= maxStates) {
        stateLimitReached = true
        continue
      }
      visitedStates.add(afterKey)
      predecessorByState.set(afterKey, transition)
      reachableStates.push(cloneState(afterState))
      stateQueue.push({ state: afterState, depth: current.depth + 1 })
    }
  }

  const objectiveWitnessChain = chooseShortestStableChain(objectiveWitnessCandidates)
  const closestBlockedWitnessCandidate = [...blockedWitnessCandidates].sort((a, b) => {
    const stagesA = completedObjectiveStages(a.prefix, a.transition)
    const stagesB = completedObjectiveStages(b.prefix, b.transition)
    if (stagesA !== stagesB) return stagesB - stagesA
    const objectiveA = a.transition.targetNodeId === objectiveId ? 1 : 0
    const objectiveB = b.transition.targetNodeId === objectiveId ? 1 : 0
    if (objectiveA !== objectiveB) return objectiveB - objectiveA
    const passedA = a.transition.preconditionChecks.filter((item) => item.passed).length
    const passedB = b.transition.preconditionChecks.filter((item) => item.passed).length
    if (passedA !== passedB) return passedB - passedA
    if (a.prefix.length !== b.prefix.length) return a.prefix.length - b.prefix.length
    const keyA = chainKey(a.prefix.concat(a.transition))
    const keyB = chainKey(b.prefix.concat(b.transition))
    return keyA.localeCompare(keyB) || blockReason(a.transition).localeCompare(blockReason(b.transition))
  })[0]
  const closestBlockedWitness = closestBlockedWitnessCandidate
    ? closestBlockedWitnessCandidate.prefix.concat(closestBlockedWitnessCandidate.transition)
    : null
  const objectiveReachedValue = objectiveWitnessChain !== null
  const representativeChain = objectiveWitnessChain
    ?? closestBlockedWitness
    ?? pathToState(finalState)
  const representativeEndState = representativeChain.at(-1)?.afterState
    ?? initialState
  finalState = cloneState(representativeEndState)
  const reachableControlledEndpoints = getReachableControlledEndpointUnion(reachableStates)
  const reachableState = reachableStates.reduce<AttackState>((aggregate, state) => {
    updateReachableState(aggregate, state)
    return aggregate
  }, { controlledEndpoints: {}, assetAccess: {}, executedTransitionIds: [] })
  const blockedTransitions: AttackTransition[] = []
  const seenBlocked = new Set<string>()
  for (const transition of attempts) {
    if (transition.result !== 'BLOCKED') continue
    const signature = blockedSignature(transition)
    if (seenBlocked.has(signature)) continue
    seenBlocked.add(signature)
    blockedTransitions.push(transition)
  }
  const criticalAttackPaths = countPathsToObjective(initialState, transitions, objectiveId)
  const searchResult: AttackSearchResult = {
    initialState,
    reachableStates,
    successfulTransitions: transitions,
    blockedTransitions,
    searchEvaluations: attempts,
    objectiveReached: objectiveReachedValue,
    objectiveWitnessChain,
    closestBlockedWitness,
    representativeChain,
    searchComplete: !depthLimitReached && !stateLimitReached,
    limitReached: depthLimitReached || stateLimitReached,
    searchDepth: maxExploredDepth,
    depthLimit: maxDepth,
    stateLimit: maxStates,
    depthLimitReached,
    stateLimitReached,
    exploredStateCount: visitedStates.size,
    reachableControlledEndpoints,
    reachableAssetAccess: reachableState.assetAccess,
    reachableAdminEndpointIds: Object.entries(reachableControlledEndpoints)
      .filter(([, endpoint]) => endpoint.privilege === 'ADMIN')
      .map(([nodeId]) => nodeId)
      .sort(),
    objectiveStatePathCount: criticalAttackPaths,
  }

  return {
    searchResult,
    initialState,
    finalState,
    actions,
    transitions,
    attempts,
    reachableControlledEndpoints,
    reachableAssetAccess: reachableState.assetAccess,
    criticalAttackPaths,
    exploredStateCount: visitedStates.size,
    depthLimitReached,
    stateLimitReached,
  }
}
