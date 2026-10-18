import type { ChallengeEvaluation, ChallengeCheck, SimulationResult } from '../types/simulation'
import type { Scenario } from '../types/scenario'
import { simulationFingerprint } from './simulationFingerprint'

/** Pure challenge evaluation; the saved simulation and its input fingerprint are the only result source. */
export function evaluateChallenge(
  scenario: Scenario,
  result: SimulationResult | null | undefined,
  resultFingerprint: string | null | undefined,
  completed = true,
): ChallengeEvaluation {
  if (!scenario.challenge || !result) return { status: 'unverified', valid: false, success: null, checks: [] }

  if (!resultFingerprint || result.scenarioId !== scenario.id || resultFingerprint !== simulationFingerprint(scenario)) {
    return { status: 'stale', valid: false, success: null, checks: [] }
  }
  if (!completed) return { status: 'unverified', valid: false, success: null, checks: [] }

  const challenge = scenario.challenge
  const dataAccess = result.finalAttackState?.assetAccess[challenge.protectedNodeId] === 'DATA_ACCESS'
  const endpointControlled = Boolean(result.finalAttackState?.controlledEndpoints[challenge.protectedNodeId])
  const nodeAffected = result.compromisedNodeIds.includes(challenge.protectedNodeId)
  const searchComplete = result.metrics.attackSearchComplete !== false
  const attackObjectiveReached = result.finalAttackState
    ? result.metrics.criticalObjectiveReached === true
    : endpointControlled || nodeAffected
  const protectedAsset = !attackObjectiveReached && searchComplete
  const checks: ChallengeCheck[] = [{
    id: 'protected-asset',
    label: '关键目标保护',
    passed: protectedAsset,
    reason: !searchComplete
      ? '状态搜索达到深度或状态数量边界，当前结果不足以确认关键数据目标安全。'
      : dataAccess || attackObjectiveReached && result.finalAttackState
      ? '攻击状态已获得该资产的数据访问能力。'
      : endpointControlled
        ? '攻击状态已控制该目标节点。'
        : nodeAffected
          ? '该目标节点进入受影响状态。'
          : '目标未进入受影响状态，也未授予数据访问能力。',
  }]

  for (const pathId of challenge.requiredBusinessPathIds) {
    const path = result.businessPathResults.find((item) => item.id === pathId)
    checks.push({
      id: pathId,
      label: path?.label ?? pathId,
      passed: Boolean(path?.allowed),
      reason: path?.allowed ? '预设必要业务路径当前可达。' : path?.detail ?? path?.reason ?? '仿真结果中没有该业务路径。',
    })
  }

  if (result.finalAttackState && !searchComplete) {
    checks.push({
      id: 'attack-search-complete',
      label: '攻击状态搜索完整性',
      passed: false,
      reason: '达到教学搜索边界；请缩小场景状态空间后重新验证，不能据此证明关键数据目标受到保护。',
    })
  }

  if (!searchComplete) return { status: 'incomplete', valid: false, success: null, checks }
  const success = checks.length > 0 && checks.every((item) => item.passed)
  return { status: 'verified', valid: true, success, checks }
}
