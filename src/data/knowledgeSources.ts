/**
 * Per-scenario knowledge sources.
 *
 * The competition guide requires that scenarios involving professional knowledge
 * "确保内容准确并注明资料来源". These entries map each teaching abstraction in a
 * scenario back to a public, citable reference. They are documentation only and are
 * deliberately excluded from simulationFingerprint: citing a source must never make
 * a computed result stale.
 */

export interface KnowledgeSource {
  /** Public document title, kept in its original language. */
  title: string
  publisher: string
  /** Section or topic inside the document that the scenario relies on. */
  section: string
  /** What this source backs in this specific scenario. */
  note: string
  url?: string
}

export interface ScenarioKnowledge {
  /** One sentence describing the teaching abstraction boundary of the scenario. */
  scope: string
  sources: KnowledgeSource[]
}

const FIREWALL_POLICY: KnowledgeSource = {
  title: 'Guidelines on Firewalls and Firewall Policy (SP 800-41 Rev.1)',
  publisher: 'NIST',
  section: 'Firewall policy design: default deny, rule ordering, first match',
  note: '本场景的 First Match 顺序判定、Default DENY 与「顺序错误的放行规则」均依据该指南的策略设计原则。',
  url: 'https://csrc.nist.gov/pubs/sp/800/41/r1/final',
}

const ACL_FLOW: KnowledgeSource = {
  title: 'Security and Privacy Controls for Information Systems (SP 800-53 Rev.5)',
  publisher: 'NIST',
  section: 'AC-4 Information Flow Enforcement / SC-7 Boundary Protection',
  note: '区域间访问控制与边界保护的抽象依据；本系统只判定允许/拒绝，不模拟真实设备实现。',
  url: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final',
}

const MLPS_BOUNDARY: KnowledgeSource = {
  title: '信息安全技术 网络安全等级保护基本要求（GB/T 22239-2019）',
  publisher: '全国信息安全标准化技术委员会',
  section: '安全区域边界：边界防护与访问控制',
  note: '办公区、DMZ、服务器区、数据区的分区边界与访问控制要求，对应本场景的 Zone 与防火墙策略模型。',
}

const VLAN_8021Q: KnowledgeSource = {
  title: 'IEEE 802.1Q — Bridges and Bridged Networks (VLAN tagging)',
  publisher: 'IEEE',
  section: 'VLAN tagging, access / trunk port membership',
  note: '二层可达性按 ACCESS/TRUNK 端口的 VLAN 承载关系判定；跨 VLAN 必须经过三层网关。',
}

const LONGEST_PREFIX: KnowledgeSource = {
  title: 'Requirements for IP Version 4 Routers (RFC 1812)',
  publisher: 'IETF',
  section: 'Routing table lookup / longest prefix match',
  note: '本系统的路由查询采用最长前缀匹配，直连路由仅在前缀长度相同时优先。',
  url: 'https://www.rfc-editor.org/rfc/rfc1812',
}

const PRIVATE_ADDR: KnowledgeSource = {
  title: 'Address Allocation for Private Internets (RFC 1918)',
  publisher: 'IETF',
  section: 'Private address space 10/8, 172.16/12, 192.168/16',
  note: '场景中的 10.10.0.0/16、192.168.0.0/16 等内网地址属于保留私有地址段。',
  url: 'https://www.rfc-editor.org/rfc/rfc1918',
}

const ATTACK_LATERAL: KnowledgeSource = {
  title: 'MITRE ATT&CK — TA0008 Lateral Movement / T1021 Remote Services',
  publisher: 'MITRE',
  section: 'Lateral Movement tactics and remote service techniques',
  note: '「远程服务访问」「应用服务访问」两个教学行为的抽象来源；本系统不复现具体工具或凭据。',
  url: 'https://attack.mitre.org/tactics/TA0008/',
}

const ATTACK_PRIV: KnowledgeSource = {
  title: 'MITRE ATT&CK — T1068 Exploitation for Privilege Escalation / T1078 Valid Accounts',
  publisher: 'MITRE',
  section: 'Privilege Escalation and Defense Evasion tactics',
  note: 'USER → ADMIN 的抽象权限变化仅表示权限级别提升，不对应任何真实漏洞或利用链。',
  url: 'https://attack.mitre.org/techniques/T1068/',
}

const ATTACK_COLLECT: KnowledgeSource = {
  title: 'MITRE ATT&CK — T1213 Data from Information Repositories',
  publisher: 'MITRE',
  section: 'Collection tactic: databases and information repositories',
  note: 'DATA_ACCESS 只表示「获得数据访问能力」，不等同于数据库主机被控制。',
  url: 'https://attack.mitre.org/techniques/T1213/',
}

const ZERO_TRUST: KnowledgeSource = {
  title: 'Zero Trust Architecture (SP 800-207)',
  publisher: 'NIST',
  section: 'Micro-segmentation and least-privilege per-request access',
  note: '「在保持必要业务可达的前提下收紧访问」这一权衡目标的理论依据。',
  url: 'https://csrc.nist.gov/pubs/sp/800/207/final',
}

const SUPPLY_CHAIN: KnowledgeSource = {
  title: 'Cybersecurity Supply Chain Risk Management Practices (SP 800-161 Rev.1)',
  publisher: 'NIST',
  section: 'C-SCRM: supplier and entry-point risk',
  note: '把 Web 入口设为「实验开始前已受影响」的供应链情境依据；本系统不模拟投毒或代码执行。',
  url: 'https://csrc.nist.gov/pubs/sp/800/161/r1/final',
}

const RANSOMWARE: KnowledgeSource = {
  title: '#StopRansomware Guide',
  publisher: 'CISA / MS-ISAC',
  section: 'Ransomware protection: segmentation, endpoint protection, backups',
  note: '「受影响状态沿可达服务扩散」的教学抽象依据；本系统不模拟文件加密、解密或恢复。',
  url: 'https://www.cisa.gov/stopransomware/ransomware-guide',
}

const ICS_62443: KnowledgeSource = {
  title: 'IEC 62443-3-3 — Industrial communication networks: System security requirements',
  publisher: 'IEC',
  section: 'Zones and conduits, SR 5.x restricted data flow',
  note: '控制中心、监控区、现场设备区、历史数据区的 Zone/Conduit 划分依据。',
}

const ICS_80082: KnowledgeSource = {
  title: 'Guide to Operational Technology (OT) Security (SP 800-82 Rev.3)',
  publisher: 'NIST',
  section: 'OT network architecture and segmentation',
  note: 'SCADA/PLC 分层结构与工业防火墙位置的教学依据。',
  url: 'https://csrc.nist.gov/pubs/sp/800/82/r3/final',
}

const ICS_ATTACK: KnowledgeSource = {
  title: 'MITRE ATT&CK for ICS — T0855 Unauthorized Command Message / T0831 Manipulation of Control',
  publisher: 'MITRE',
  section: 'ICS tactic: Impair Process Control',
  note: '「SCADA 向 PLC 下发控制指令」被归为内部通信业务路径的依据；不涉及真实协议报文。',
  url: 'https://attack.mitre.org/techniques/T0855/',
}

export const scenarioKnowledge: Record<string, ScenarioKnowledge> = {
  lateral: {
    scope: '以端点权限级别与数据访问能力为状态，演示「通信可达只是前置条件」这一结论；不包含真实漏洞、凭据或利用代码。',
    sources: [ATTACK_LATERAL, ATTACK_PRIV, ATTACK_COLLECT, FIREWALL_POLICY, ACL_FLOW, LONGEST_PREFIX],
  },
  firewall: {
    scope: '只演示边界防火墙对「来源 / 目标 / 服务」三元组的 First Match 判定，不涉及应用层检测或 NAT 行为。',
    sources: [FIREWALL_POLICY, ACL_FLOW, PRIVATE_ADDR, LONGEST_PREFIX],
  },
  segmentation: {
    scope: '演示 VLAN 与区域边界如何限制跨区通信，同时保留必要业务；不评估真实网络设备配置合规性。',
    sources: [MLPS_BOUNDARY, VLAN_8021Q, ZERO_TRUST, FIREWALL_POLICY],
  },
  'supply-chain': {
    scope: '把 Web 入口作为预设受影响节点，演示跨区传播必须逐跳命中显式放行规则；不模拟软件投毒或代码执行。',
    sources: [SUPPLY_CHAIN, ATTACK_LATERAL, FIREWALL_POLICY, MLPS_BOUNDARY],
  },
  ransomware: {
    scope: '演示受影响状态沿可达服务扩散，以及终端防护对状态变化的阻断；不模拟文件加密、解密或数据恢复。',
    sources: [RANSOMWARE, ZERO_TRUST, ACL_FLOW],
  },
  'zero-trust': {
    scope: '演示 Default DENY 下的主机对主机最小权限放行，说明「同区域即可信」被取消后的效果；不涉及真实身份认证、设备信任评分或加密隧道实现。',
    sources: [ZERO_TRUST, ACL_FLOW, ATTACK_LATERAL, MLPS_BOUNDARY],
  },
  'industrial-ics': {
    scope: '演示控制中心、监控区、现场设备区与历史数据区之间的策略路径；不涉及真实工控协议、固件或物理过程。',
    sources: [ICS_62443, ICS_80082, ICS_ATTACK, MLPS_BOUNDARY],
  },
}

export function knowledgeFor(scenarioId: string): ScenarioKnowledge | null {
  return scenarioKnowledge[scenarioId] ?? null
}
