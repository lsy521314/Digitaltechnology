import type { EChartsOption } from 'echarts'

/** 静态随堂自测题库：每题附带预设教学示意图表，用于作答后的概念解释，不读取实时仿真结果。 */

export interface QuizVisual {
  title: string
  caption: string
  linkLabel: string
  linkPath: string
  option: EChartsOption
}

export interface QuizQuestion {
  id: number
  category: string
  question: string
  options: string[]
  correctIndex: number
  explain: string
  visual: QuizVisual
}

const T = {
  tip: '#0d1c29',
  border: '#284557',
  tipText: '#e3eef2',
  label: '#91a3ad',
  split: 'rgba(141,174,192,.14)',
}

const C = {
  teal: '#6fcbd0',
  green: '#67c7a9',
  coral: '#e78172',
  amber: '#dbb269',
  violet: '#a596e7',
  blue: '#81bad6',
  slate: '#8fa8b5',
}

const itemTip = { trigger: 'item' as const, backgroundColor: T.tip, borderColor: T.border, textStyle: { color: T.tipText } }

function barOption(cats: string[], values: number[], color: string | string[], unit = ''): EChartsOption {
  const colors = Array.isArray(color) ? color : cats.map(() => color)
  return {
    grid: { left: 8, right: 10, top: 14, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: T.tip, borderColor: T.border, textStyle: { color: T.tipText }, axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => `${v}${unit}` },
    xAxis: { type: 'category', data: cats, axisLabel: { color: T.label, fontSize: 11 }, axisLine: { lineStyle: { color: T.split } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: T.label, fontSize: 11 }, splitLine: { lineStyle: { color: T.split } } },
    series: [{ type: 'bar', barWidth: '48%', data: values.map((value, i) => ({ value, itemStyle: { color: colors[i], borderRadius: [5, 5, 0, 0] } })) }],
  }
}

function groupedBarOption(cats: string[], series: { name: string; color: string; data: number[] }[]): EChartsOption {
  return {
    grid: { left: 8, right: 10, top: 26, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: T.tip, borderColor: T.border, textStyle: { color: T.tipText }, axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => `${v} 条` },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: T.label, fontSize: 11 } },
    xAxis: { type: 'category', data: cats, axisLabel: { color: T.label, fontSize: 11 }, axisLine: { lineStyle: { color: T.split } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: T.label, fontSize: 11 }, splitLine: { lineStyle: { color: T.split } } },
    series: series.map((s) => ({ name: s.name, type: 'bar', barWidth: '30%', itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0] }, data: s.data })),
  }
}

function lineOption(x: string[], series: { name: string; data: number[]; color: string; dashed?: boolean }[], unit = ' 台'): EChartsOption {
  return {
    grid: { left: 8, right: 10, top: series.length > 1 ? 26 : 12, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: T.tip, borderColor: T.border, textStyle: { color: T.tipText }, valueFormatter: (v: any) => `${v}${unit}` },
    legend: series.length > 1 ? { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: T.label, fontSize: 11 } } : undefined,
    xAxis: { type: 'category', boundaryGap: false, data: x, axisLabel: { color: T.label, fontSize: 11 }, axisLine: { lineStyle: { color: T.split } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: T.label, fontSize: 11 }, splitLine: { lineStyle: { color: T.split } }, minInterval: 1 },
    series: series.map((s) => ({ name: s.name, type: 'line', smooth: 0.35, symbol: 'circle', symbolSize: 5, data: s.data, lineStyle: { color: s.color, width: 2.2, type: s.dashed ? 'dashed' : 'solid' }, itemStyle: { color: s.color } })),
  }
}

function pieOption(data: { name: string; value: number; color: string }[]): EChartsOption {
  return {
    tooltip: { ...itemTip, formatter: (p: any) => `${p.name}：${p.value} 个 · ${p.percent}%` },
    legend: { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: T.label, fontSize: 11 } },
    series: [{ type: 'pie', radius: ['46%', '68%'], center: ['50%', '45%'], itemStyle: { borderColor: '#0c1722', borderWidth: 2 }, label: { color: T.label, fontSize: 10, formatter: '{b} {d}%' }, data: data.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })) }],
  }
}

function radarOption(indicator: string[], series: { name: string; color: string; values: number[] }[]): EChartsOption {
  return {
    color: series.map((s) => s.color),
    tooltip: { ...itemTip },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: T.label, fontSize: 11 } },
    radar: { indicator: indicator.map((name) => ({ name, max: 100 })), radius: '56%', center: ['50%', '44%'], splitLine: { lineStyle: { color: T.split } }, splitArea: { areaStyle: { color: ['rgba(127,171,188,.03)', 'rgba(127,171,188,.06)'] } }, axisName: { color: T.label, fontSize: 10 }, axisLine: { lineStyle: { color: T.split } } },
    series: [{ type: 'radar', data: series.map((s) => ({ name: s.name, value: s.values, areaStyle: { color: `${s.color}33` }, lineStyle: { color: s.color }, itemStyle: { color: s.color } })) }],
  }
}

function gaugeOption(value: number, name: string, color: string): EChartsOption {
  return {
    series: [{
      type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100, radius: '92%', center: ['50%', '58%'],
      progress: { show: true, width: 10, itemStyle: { color } },
      axisLine: { lineStyle: { width: 10, color: [[1, 'rgba(126,164,182,.14)']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
      title: { offsetCenter: [0, '26%'], color: T.label, fontSize: 11 },
      detail: { valueAnimation: true, offsetCenter: [0, 0], formatter: '{value}', color: '#dce7ec', fontSize: 21, fontWeight: 600 },
      data: [{ value, name }],
    }],
  }
}

function graphOption(nodes: { name: string; color: string; value: number }[], links: [string, string][]): EChartsOption {
  return {
    tooltip: { ...itemTip, formatter: (p: any) => (p.dataType === 'node' ? `${p.data?.name}：暴露度 ${p.data?.value}` : `${p.source} → ${p.target}`) },
    series: [{
      type: 'graph', layout: 'force', roam: false, draggable: false, label: { show: true, position: 'bottom', color: '#c3d0d4', fontSize: 9 }, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 6,
      lineStyle: { color: 'rgba(141,174,192,.45)', width: 1.4 }, force: { repulsion: 120, edgeLength: [30, 62] },
      data: nodes.map((n) => ({ name: n.name, value: n.value, symbolSize: n.value * 3 + 13, itemStyle: { color: n.color } })),
      links: links.map((l) => ({ source: l[0], target: l[1] })),
    }],
  }
}

export const quizQuestions: QuizQuestion[] = [
  {
    id: 1, category: '网络分区',
    question: '将办公网络与数据服务器划分到不同区域，最主要的安全收益是什么？',
    options: ['提升所有终端的运行速度', '限制风险事件跨区传播', '减少需要安装的软件数量', '免除所有网络连接的检查'],
    correctIndex: 1,
    explain: '网络分区通过区域边界进行隔离：即使某一区域内的终端失陷，风险也难以直接触达其他区域的关键资产，从根本上收敛影响范围。',
    visual: {
      title: '跨区传播收敛示意', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '进入实验室', linkPath: '/lab',
      option: barOption(['不划分区域', '划分区域'], [12, 4], [C.coral, C.teal], '台'),
    },
  },
  {
    id: 2, category: '防火墙',
    question: '防火墙判断是否允许一次网络连接，主要依据什么？',
    options: ['终端使用者的姓名', '来源区域、目标区域与服务类型', '计算机的品牌与型号', '连接发起的时间段'],
    correctIndex: 1,
    explain: '防火墙策略依据“来源区域 + 目标区域 + 服务端口”的组合进行放行或拒绝，既能保障必要业务路径，又能阻断横向移动尝试。',
    visual: {
      title: '一次策略评估的结果分布', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看规则日志', linkPath: '/lab',
      option: pieOption([{ name: '放行', value: 3, color: C.green }, { name: '阻断', value: 9, color: C.coral }, { name: '受限', value: 4, color: C.amber }]),
    },
  },
  {
    id: 3, category: '终端防护',
    question: '源终端启用防护模型后，一次横向传播尝试会被记录为什么事件？',
    options: ['seed 初始事件', 'block 被阻断事件', 'compromise 失陷事件', 'isolate 隔离事件'],
    correctIndex: 1,
    explain: '当源终端被防护模型覆盖时，指向目标终端的传播会被引擎记为 block 事件，并纳入“传播事件阻断占比”这一关键指标。',
    visual: {
      title: '启用防护后的传播事件构成（示意）', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看对比评分', linkPath: '/compare',
      option: pieOption([{ name: '阻断', value: 14, color: C.green }, { name: '失陷', value: 2, color: C.coral }, { name: '未触达', value: 5, color: C.slate }]),
    },
  },
  {
    id: 4, category: '关键资产',
    question: '为什么要在场景中为关键资产标记“受保护”状态？',
    options: ['让它获得更高系统权限', '作为挑战验收对象，直接检验防护效果', '让它自动拦截所有访问流量', '避免它被任何终端访问'],
    correctIndex: 1,
    explain: '受保护关键资产是每轮挑战的验收对象：观察其最终是否失陷，即可量化不同方案的实际防护能力并影响业务可达率评估。',
    visual: {
      title: '关键资产护盾强度', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看挑战面板', linkPath: '/lab',
      option: gaugeOption(100, '护盾强度', C.green),
    },
  },
  {
    id: 5, category: '横向传播',
    question: '风险事件在拓扑中传播的主要路径是什么？',
    options: ['沿节点间的网络关系边逐跳扩散', '随机跳跃到任意节点', '仅沿互联网出口传播', '在同一台设备内部自行复制'],
    correctIndex: 0,
    explain: '仿真引擎沿设备之间的连接关系逐跳传播，依次触达可达范围内的节点。因此断开关键路径即可有效收敛扩散范围。',
    visual: {
      title: '无干预时的扩散曲线（示意）', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看时间线', linkPath: '/analysis',
      option: lineOption(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], [{ name: '受影响节点', data: [1, 3, 6, 9, 11, 12], color: C.coral }]),
    },
  },
  {
    id: 6, category: '最小权限',
    question: '最小权限原则的核心思想是什么？',
    options: ['所有终端都开放管理员权限', '只开放完成业务所必需的最小访问范围', '关闭防火墙以提升访问速度', '不允许任何网络连接存在'],
    correctIndex: 1,
    explain: '最小权限在保证业务可达的同时收窄攻击面：合法路径可用、非必要路径受限，是纵深防御体系中重要的原则之一。',
    visual: {
      title: '开放路径数量对比', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '调整策略验证', linkPath: '/compare',
      option: barOption(['全开放', '最小权限'], [9, 3], [C.coral, C.green], '条'),
    },
  },
  {
    id: 7, category: '纵深防御',
    question: '纵深防御（Defense in Depth）强调的是？',
    options: ['单点安全设备即可应对所有威胁', '多层防线、多种手段协同，层层拦截', '只保护核心资产，其余区域不管', '系统越复杂就越安全'],
    correctIndex: 1,
    explain: '网络分区、防火墙、终端防护、隔离与监测构成多层防线，单层被突破时仍有其他层兜底，避免单点失效导致全局失守。',
    visual: {
      title: '单层 vs 多层防线五维评分', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '打开雷达图', linkPath: '/compare',
      option: radarOption(['关键资产', '扩散收敛', '业务可达', '阻断实效', '范围控制'], [{ name: '单层防线', color: C.slate, values: [52, 44, 88, 38, 40] }, { name: '多层防线', color: C.green, values: [96, 92, 85, 90, 88] }]),
    },
  },
  {
    id: 8, category: '工控安全',
    question: '在工控 SCADA/PLC 场景中，Historian 历史数据库通常被设定为什么角色？',
    options: ['普通办公终端', '需要重点保护的受保护关键资产', '互联网出口网关', '仅用于日志展示的文件服务器'],
    correctIndex: 1,
    explain: 'Historian 保存生产工艺与生产历史数据，一旦失陷会造成工业数据泄露、产线信任崩塌，因此被设为本场景挑战中的验收关键资产。',
    visual: {
      title: '历史库暴露风险（未隔离时）', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '进入工控挑战', linkPath: '/lab',
      option: gaugeOption(96, '暴露风险', C.coral),
    },
  },
  {
    id: 9, category: '网络分区',
    question: '将网络划分为更多独立区域，相比单一大网的核心收益是什么？',
    options: ['获得更复杂的 IP 编址', '把单次传播限制在更小的半径内', '减少设备采购数量', '加快所有终端的上网速度'],
    correctIndex: 1,
    explain: '区域边界越多，从初始失陷点到任意目标的“最大传播半径”就越短，风险扩散的期望收敛范围也随之缩小。',
    visual: {
      title: '区域数量与受影响节点数', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看区域热力', linkPath: '/analysis',
      option: lineOption(['1 区', '2 区', '3 区', '4 区', '5 区'], [{ name: '受影响节点', data: [16, 10, 6, 4, 3], color: C.teal }]),
    },
  },
  {
    id: 10, category: '防火墙',
    question: '缺少明确放行策略的连接请求，防火墙的默认行为应当是？',
    options: ['默认放行', '默认拒绝', '随机放行一半', '忽略不处理'],
    correctIndex: 1,
    explain: '“默认拒绝”是白名单式安全基线：除明确放行的必要业务外一律阻断，未知传播尝试无法直通任何目标。',
    visual: {
      title: '默认拒绝策略下未授权连接', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看阻断事件', linkPath: '/analysis',
      option: gaugeOption(0, '未授权放行率', C.green),
    },
  },
  {
    id: 11, category: '业务路径',
    question: '“业务路径可达率”衡量的是什么？',
    options: ['网络中配置的 IP 总数', '预设必要业务路径中保持可达的比例', '防火墙规则条数', '被攻陷节点的数量'],
    correctIndex: 1,
    explain: '安全防线必须以业务可用为前提：可达率反映“加了防护之后，必要业务是否仍然可用”，是判断策略是否过严的依据。',
    visual: {
      title: '必要业务路径可达率', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看对比指标', linkPath: '/compare',
      option: gaugeOption(87, '可达率', C.blue),
    },
  },
  {
    id: 12, category: '隔离操作',
    question: '对失陷区域执行“隔离”后，最可能观察到的现象是？',
    options: ['感染继续扩散不受影响', '区域间流量被阻断、扩散曲线转平缓', '全网节点全部离线', '防火墙规则被自动删除'],
    correctIndex: 1,
    explain: '隔离使失陷节点对外不可达，后续传播尝试被裁决为“隔离状态不可达”的 block 事件，受影响曲线随即趋于平缓。',
    visual: {
      title: '隔离干预前后的扩散对比', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '回放时间线', linkPath: '/analysis',
      option: lineOption(['0s', '4s', '8s', '12s', '16s', '20s', '24s'], [{ name: '无隔离', data: [1, 3, 5, 8, 10, 11, 12], color: C.coral, dashed: true }, { name: '隔离后', data: [1, 3, 4, 5, 5, 5, 6], color: C.teal }]),
    },
  },
  {
    id: 13, category: '事件时间线',
    question: '实验运行过程中记录的“快照”主要用于什么？',
    options: ['记录每次鼠标点击', '刻画各时刻所有节点的状态变化', '存储浏览器历史记录', '生成用户聊天日志'],
    correctIndex: 1,
    explain: '快照在每个传播步骤后采样全部节点状态，形成“受影响节点数随时间变化”的序列，正是分析页时间线图与柱形分布的数据来源。',
    visual: {
      title: '各阶段新增失陷节点数', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看阶段分布', linkPath: '/analysis',
      option: barOption(['S1', 'S2', 'S3', 'S4', 'S5'], [2, 3, 2, 1, 0], C.amber, '台'),
    },
  },
  {
    id: 14, category: '风险路径',
    question: '“传播事件阻断占比”较高，最合理的解读是？',
    options: ['防线有效拦截了大量横向尝试', '网络配置出现严重错误', '攻击火力比平时更猛', '场景里节点数量特别多'],
    correctIndex: 0,
    explain: '阻断占比 = 被阻断的传播事件 ÷（成功 + 被阻断）事件。占比越高，说明防线对横向移动的拦截效率越好。',
    visual: {
      title: '传播事件结果构成', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看阻断评分', linkPath: '/compare',
      option: pieOption([{ name: '阻断', value: 62, color: C.green }, { name: '成功', value: 18, color: C.coral }, { name: '未触达', value: 20, color: C.slate }]),
    },
  },
  {
    id: 15, category: '工控安全',
    question: '管理网（IT）与生产网（OT）之间通常应采用哪种连接方式？',
    options: ['直接共用同一台交换机', '经工业防火墙按白名单隔离放行', '彻底断开且不做任何通信', '通过无线蓝牙中继'],
    correctIndex: 1,
    explain: '工业防火墙按 OT 协议白名单放行（如仅允许 SCADA 与 PLC 的必要通信），防止 IT 侧风险直达产线设备。',
    visual: {
      title: 'IT/OT 连接方式对比', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '进入工控场景', linkPath: '/lab',
      option: barOption(['IT 直连 OT', '工业防火墙隔离'], [9, 2], [C.coral, C.green], '台'),
    },
  },
  {
    id: 16, category: '工控安全',
    question: '工控场景把 HMI 工程师站设为初始失陷点，主要模拟哪类入侵方式？',
    options: ['经维护接口、U 盘或远程协助混入工控网', '直接物理砸毁产线设备', '篡改 PLC 底层固件', '干扰卫星定位信号'],
    correctIndex: 0,
    explain: 'HMI 常因远程维护、外带 U 盘等途径被入侵，是攻击者进入 OT 网络的典型跳板，随后沿横向移动渗透至 SCADA 与 PLC。',
    visual: {
      title: 'OT 横向渗透链示意', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '观察传播动画', linkPath: '/lab',
      option: graphOption([{ name: 'HMI', color: C.coral, value: 9 }, { name: 'SCADA', color: C.amber, value: 7 }, { name: '水泵PLC', color: C.violet, value: 6 }, { name: '产线PLC', color: C.violet, value: 6 }, { name: 'Historian', color: C.blue, value: 8 }], [['HMI', 'SCADA'], ['HMI', '水泵PLC'], ['HMI', '产线PLC'], ['SCADA', '水泵PLC'], ['SCADA', '产线PLC'], ['SCADA', 'Historian']]),
    },
  },
  {
    id: 17, category: '方案对比',
    question: '方案 A/B 对照实验的价值在于？',
    options: ['随机更换一次 IP 地址', '同一初始条件下比较两种策略的实际效果', '让仿真运行得更快', '减少场景中的节点数量'],
    correctIndex: 1,
    explain: 'A/B 两次运行共享同一初始失陷事件，仅策略不同，因此结果的差异可以干净地归因于策略本身。',
    visual: {
      title: '方案 A 与方案 B 五维对比', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '打开方案对比', linkPath: '/compare',
      option: radarOption(['关键资产', '业务可达', '扩散收敛', '范围控制', '阻断实效'], [{ name: '方案 A', color: C.slate, values: [60, 72, 90, 58, 62] }, { name: '方案 B', color: C.green, values: [100, 96, 86, 92, 95] }]),
    },
  },
  {
    id: 18, category: '最小权限',
    question: '实施最小权限后发现某条必要业务路径不可达，正确处理是？',
    options: ['删除全部防火墙规则', '按业务需求补充针对性放行，维持默认拒绝', '向所有方向开放端口', '直接关闭防火墙'],
    correctIndex: 1,
    explain: '最小权限并非“禁用业务”，而是“默认拒绝 + 精确放行”：只为确有必要业务的路径补充放行规则，二者同时成立。',
    visual: {
      title: '策略调整前后路径对比', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '对照可达率指标', linkPath: '/compare',
      option: groupedBarOption(['非必要暴露路径', '必要业务路径'], [{ name: '调整前', color: C.coral, data: [6, 3] }, { name: '最小权限后', color: C.green, data: [1, 3] }]),
    },
  },
  {
    id: 19, category: '服务暴露',
    question: '下列服务中，最应避免直接暴露到公网的是？',
    options: ['Web 门户页面', '数据库管理端口', '静态资源文件', 'DNS 解析服务'],
    correctIndex: 1,
    explain: '数据库端口一旦暴露，攻击者可省去横向移动直接读取数据，应仅限内网访问或经 VPN；服务暴露面越小，初始入侵机会越少。',
    visual: {
      title: '各服务暴露风险等级', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '查看服务清单', linkPath: '/lab',
      option: barOption(['Web 门户', '文件服务', '数据库端口'], [4, 7, 10], [C.amber, C.violet, C.coral], '级'),
    },
  },
  {
    id: 20, category: '拓扑可视化',
    question: '三维拓扑图对理解安全事件最大的帮助是？',
    options: ['让页面看起来更炫酷', '直观呈现区域划分、可达路径与传播轨迹', '自动生成防御报告', '减少浏览器内存占用'],
    correctIndex: 1,
    explain: '拓扑把抽象策略具象化：区域着色区分隔离、连线指明可达关系、飞行动画标记传播路径，让“为什么阻断 / 为什么扩散”一目了然。',
    visual: {
      title: '可视化拓扑结构示意', caption: '题库预设静态教学示意，不读取当前实验状态或仿真结果。', linkLabel: '进入三维实验室', linkPath: '/lab',
      option: graphOption([{ name: '互联网', color: C.slate, value: 8 }, { name: '边界防火墙', color: C.teal, value: 6 }, { name: '办公区', color: C.violet, value: 5 }, { name: '应用区', color: C.blue, value: 5 }, { name: '数据库', color: C.coral, value: 6 }], [['互联网', '边界防火墙'], ['边界防火墙', '办公区'], ['边界防火墙', '应用区'], ['办公区', '应用区'], ['应用区', '数据库']]),
    },
  },
]
