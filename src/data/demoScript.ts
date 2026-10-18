export type DemoStageKey = 'home' | 'lab-initial' | 'lab-configure' | 'lab-reverify' | 'lab-challenge' | 'compare' | 'analysis'

export interface DemoStage {
  key: DemoStageKey
  number: string
  title: string
  message: string
  action: string
}

/** Compact, state-aware guidance for the competition's core experiment route. */
export const demoTour: Record<DemoStageKey, DemoStage> = {
  home: {
    key: 'home', number: '01', title: '从核心实验开始',
    message: '主实验展示办公终端受控后，策略如何影响关键数据访问。',
    action: '进入终端失陷与横向传播',
  },
  'lab-initial': {
    key: 'lab-initial', number: '02', title: '运行原始方案',
    message: '观察代表教学链：办公终端 → 应用服务 → 权限变化 → 数据访问。',
    action: '运行原始方案，查看数据库数据目标状态',
  },
  'lab-configure': {
    key: 'lab-configure', number: '03', title: '调整一项安全控制',
    message: '打开客户数据库节点信息，启用数据访问控制；它不关闭应用到数据库的正常业务通信。',
    action: '定位客户数据库控制项',
  },
  'lab-reverify': {
    key: 'lab-reverify', number: '04', title: '重新验证策略',
    message: '配置已改变，上一轮结果已过期。重新运行后查看关键数据目标与必要业务。',
    action: '重新运行当前方案',
  },
  'lab-challenge': {
    key: 'lab-challenge', number: '05', title: '检查挑战结果',
    message: '确认关键数据保护、办公 Web 业务和应用数据库业务三项条件。',
    action: '验证安全挑战',
  },
  compare: {
    key: 'compare', number: '06', title: '查看 A / B 对照',
    message: '方案 A 使用原始配置，方案 B 使用当前策略；两者从同一拓扑与初始状态重新计算。',
    action: '运行对照实验后查看结果',
  },
  analysis: {
    key: 'analysis', number: '07', title: '回看事件与结论',
    message: '从代表链、阻断原因与业务可达性回顾这次策略验证。',
    action: '完成核心演示',
  },
}
