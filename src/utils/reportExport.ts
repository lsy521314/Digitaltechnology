import type { Scenario } from '../types/scenario'
import type { SimulationResult, SimulationEvent } from '../types/simulation'

export interface ReportSection {
  title: string
  lines: string[]
}

export interface ReportOptions {
  title: string
  subtitle: string
  meta: string[]
  sections: ReportSection[]
}

/** 转义 HTML 特殊字符，避免报告内容被误解析。 */
function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** 打开打印友好的实验报告窗口。 */
export function openReportWindow(options: ReportOptions): void {
  const sections = options.sections
    .map((section) => `
      <section class="report-section">
        <h2>${esc(section.title)}</h2>
        <div class="section-body">${section.lines
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `<p>${esc(line)}</p>`)
          .join('')}</div>
      </section>`)
    .join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${esc(options.title)} · 实验报告</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 42px 56px; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #243640; background: #f7fafb; line-height: 1.75; }
  .report-head { padding-bottom: 18px; border-bottom: 2px solid #1f8f8f; }
  .report-head .kicker { color: #1f8f8f; font-size: 12px; letter-spacing: .12em; font-weight: 600; }
  .report-head h1 { margin: 8px 0 6px; font-size: 26px; }
  .report-head .subtitle { color: #52636d; font-size: 14px; }
  .report-meta { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 12px; color: #72838d; }
  .report-meta strong { color: #3c4c56; font-weight: 600; }
  .report-section { margin-top: 26px; }
  .report-section h2 { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid #1f8f8f; color: #243640; font-size: 17px; }
  .section-body p { margin: 0 0 7px; font-size: 13.5px; color: #3c4c56; }
  .report-foot { margin-top: 36px; padding-top: 14px; border-top: 1px solid #d5e0e4; color: #92a2ab; font-size: 11px; text-align: center; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="report-head">
    <div class="kicker">智御网络 · 实验报告</div>
    <h1>${esc(options.title)}</h1>
    <div class="subtitle">${esc(options.subtitle)}</div>
    <div class="report-meta">${options.meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
  </div>
  ${sections}
  <div class="report-foot">本报告由「智御网络」教学仿真平台基于本地引擎计算结果自动生成 · 仅用于教学演示</div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=980,height=760')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

/** 根据关键事件生成可读的事件步骤说明（与页面展示一致）。 */
export function describeEvents(events: SimulationEvent[], nodeName: (id: string) => string, displayText: (text: string) => string): string[] {
  if (!events.length) return ['本次仿真没有产生事件。']
  const selected = selectKeyEvents(events)
  return selected.map((event) => {
    const resultText = event.result === 'block' ? '阻断' : event.result === 'compromise' ? '受影响' : event.result === 'allow' ? '允许' : event.result === 'info' ? '信息' : '初始状态'
    let line = `· ${nodeName(event.sourceId)} → ${nodeName(event.targetId)} · ${event.service} —— ${resultText}`
    if (event.message) line += `。${displayText(event.message)}`
    if (event.reason) line += `（原因：${displayText(event.reason)}）`
    if (event.matchedRuleName) line += `；匹配规则“${event.matchedRuleName}”`
    if (event.blockedAt) line += `；阻断位置：${displayText(event.blockedAt)}`
    return line
  })
}

function selectKeyEvents(items: SimulationEvent[]): SimulationEvent[] {
  const selected: SimulationEvent[] = []
  const seenSeeds = new Set<string>()
  const seenCompromises = new Set<string>()
  const seenRules = new Set<string>()
  const seenProtectionBlocks = new Set<string>()
  const seenIsolationBlocks = new Set<string>()
  const seenIsolationEvents = new Set<string>()
  const seenCriticalChanges = new Set<string>()
  for (const event of items) {
    if (event.phase === 'initial' && event.type === 'seed' && !seenSeeds.has(event.targetId)) { seenSeeds.add(event.targetId); selected.push(event); continue }
    if (event.result === 'compromise' && event.stateAfter === 'compromised' && event.stateBefore !== 'compromised' && !seenCompromises.has(event.targetId)) { seenCompromises.add(event.targetId); selected.push(event); continue }
    if (event.result === 'block' && event.matchedRuleId && !seenRules.has(event.matchedRuleId)) { seenRules.add(event.matchedRuleId); selected.push(event); continue }
    if (event.result === 'block' && event.reason.includes('终端防护已启用') && !seenProtectionBlocks.has(event.targetId)) { seenProtectionBlocks.add(event.targetId); selected.push(event); continue }
    if (event.result === 'block' && event.reason.includes('隔离状态不可达') && !seenIsolationBlocks.has(event.blockedAt ?? event.targetId)) { seenIsolationBlocks.add(event.blockedAt ?? event.targetId); selected.push(event); continue }
    if (event.type === 'isolate' && !seenIsolationEvents.has(event.targetId)) { seenIsolationEvents.add(event.targetId); selected.push(event); continue }
    if (event.stateBefore !== event.stateAfter && !seenCriticalChanges.has(event.targetId)) seenCriticalChanges.add(event.targetId)
  }
  return selected
}

/** 生成通用报告头元信息。 */
export function buildMeta(scenario: Scenario, generatedAt: string | number): string[] {
  return [
    `实验场景：${scenario.name}`,
    `节点数：${scenario.nodes.length} · 连接数：${scenario.edges.length} · 初始事件：${scenario.initialEvents.length}`,
    `生成时间：${new Date(generatedAt).toLocaleString('zh-CN', { hour12: false })}`,
  ]
}

export type { SimulationResult }
