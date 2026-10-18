# 智御网络

面向网络安全教育的三维交互式策略验证平台。项目使用教学型抽象网络模型，允许在浏览器中调整拓扑配置和防御策略，运行确定性仿真并观察事件路径、节点状态、业务可达性及 A/B 结果。

> 本系统采用教学型抽象网络安全仿真模型，用于展示网络拓扑、安全策略和事件传播之间的关系，不等同于真实网络环境中的漏洞利用、恶意代码执行或网络风险预测。

## 技术栈

- Vue 3、TypeScript、Vite
- Vue Router、Pinia
- Three.js、Element Plus、ECharts
- Vitest

本项目是纯前端应用，没有后端、数据库或账号系统。场景配置和学习进度使用 TypeScript 数据及浏览器本地存储。

## 安装、启动与构建

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

运行自动化测试：

```bash
npm run test
```

## 页面

- `/`：首页与实验入口
- `/lab`：场景选择、Three.js 网络拓扑、策略配置、事件时间线和仿真控制
- `/compare`：对内置场景的原始基线与当前配置执行 A/B 计算。导入的自定义场景没有原始基线时不能运行 A/B
- `/analysis`：展示最近运行的仿真或对比结果
- `/learn`：知识卡片、静态题库图表、随堂练习和模拟考试
- `/about`：项目说明

## 六个实验场景

1. **终端失陷与横向传播**：唯一使用 `ATTACK_STATE` 模式。Office-PC-01 以 USER 权限作为实验初始控制状态；后续需通过通信可达、抽象目标条件和权限要求，才能发生远程服务迁移、应用服务入口访问、本地权限提升或数据库 DATA_ACCESS 状态转移。场景保留一条顺序错误的 Office → Database 放行规则作为策略问题。
2. **外部访问与防火墙拦截**：外部 WEB、MAIL 请求通过边界策略；到数据库的请求被默认拒绝。
3. **网络分区防御实验**：使用相同企业拓扑，但默认关闭办公区到数据库的错误放行；必要 Web 和应用数据库业务保持可达。
4. **供应链入口传播路径实验**：Web 节点为预设受影响入口；DMZ 内 Mail 服务可达，跨区到 Application Server 则须命中两台路径 Firewall 的显式放行规则；不模拟软件投毒或代码执行。
5. **勒索风险传播与文件服务保护**：展示受影响状态沿通信路径传播，Office 到文件服务的必要 FILE 业务默认可达；不模拟文件加密、解密或恢复。
6. **工业控制网：SCADA/PLC 横向蔓延**：展示教学场景中的控制中心、监控、现场设备和历史数据区策略路径。

六个实验由场景中的拓扑、接口、VLAN、路由、Service、Firewall Policy 和初始条件驱动。除 lateral 外，其余五个实验继续使用 `TEACHING_PROPAGATION` 模式。

## 教学仿真模型

- `communicationEngine` 根据端点接口、VLAN、二层物理连接、路由和路径中 Firewall 的 First Match 规则计算通信结果。
- `simulationEngine` 按 `Scenario.simulationMode` 分流：五个旧场景继续由教学传播模型计算；lateral 由 `attackStateEngine` 搜索可达的抽象攻击状态转移。
- lateral 使用独立的 `AttackState`：`controlledEndpoints` 为端点记录 `nodeId`、USER / ADMIN 权限及首次控制该端点的转移 ID；`assetAccess` 独立记录 `NONE` / `DATA_ACCESS`；`executedTransitionIds` 记录该状态见证链上的成功转移。节点 `compromised` 只是展示映射；获得数据库数据访问能力不会被伪装成数据库主机被控制。
- lateral 当前教学链从初始 `Office-PC-01(USER)` 开始，经 `应用服务访问` 获得 Application Server USER，再由 `本地权限提升` 获得 ADMIN，最后通过 `数据库数据访问` 获得 Customer Database `DATA_ACCESS`。PC01 到数据库的网络通信即使被错误策略放行，也不能越过行为来源范围、权限和目标条件直接授予数据访问。
- 每项 lateral 教学行为要满足其显式来源/目标范围、源权限、源/目标教学条件、`communicationEngine` 返回的通信许可和目标安全控制。通信可达本身不会直接改变目标状态；Firewall、Protection、Isolation 分别作用于通信判断或声明受影响的教学行为。
- `AttackState` 搜索按状态签名去重，最大搜索深度为 8、最多探索 160 个状态。`AttackTransition` 明确记录 `SUCCESS`、`BLOCKED` 或 `NOT_APPLICABLE`，包含完整前置条件检查和状态前后值；受限搜索会在结果中注明触及的边界。
- `TeachingCondition`、`TeachingTechnique` 和 `AttackTransition` 均为人为配置的教学抽象，不是漏洞扫描发现、真实攻击能力或攻击路径预测。当前不包含操作系统、软件版本、真实凭据、漏洞利用与真实权限提升逻辑。
- `SimulationEvent` 保存通信路径、规则匹配、技术名称、权限前后状态及前置条件检查；Three.js 只按事件携带的路径播放可视反馈。
- Metrics 区分节点受影响、网络通信拒绝、旧模式教学传播阻止、AttackState 转移、受控 Endpoint、ADMIN Endpoint、关键目标可达性和预设业务路径可达性。seed 表示实验开始前已有的状态，不计入旧模式的 `propagationSteps`。
- A/B 使用同一内置 Scenario 的拓扑和初始条件，比较原始配置与用户当前安全配置。自定义场景没有可信的原始基线，因此禁用 A/B。

Service 当前是 WEB、MAIL、DATABASE、FILE、INTERNAL 等教学抽象类别。TCP/UDP 和 destinationPort 字段尚未用于通信判定，场景中的端口标为 `TO_BE_VERIFIED`。

## 使用方式

1. 在实验室选择场景并查看初始条件。
2. 运行仿真；在 lateral 中检查教学攻击行为、权限、通信路径、前置条件和状态转移；在其他场景中检查通信及教学传播结果。
3. 修改规则顺序、启用状态、Default Policy、终端防护或隔离设置，再次运行以核验变化。
4. 对内置场景进入方案对比，比较原始配置与当前配置，并检查业务可达性。
5. 在实验分析页查看最近一次仿真或 A/B 结果；布局调整不会使计算结果过期，改变仿真相关配置会使其过期。

## 项目结构

```text
src/
├── components/       # Three.js、图表、学习测验和演示组件
├── composables/      # 学习进度等组合式逻辑
├── data/             # 场景、题库与演示脚本
├── engine/           # 通信、拓扑、路由、策略、仿真、指标、对比与校验
├── router/           # 页面路由
├── stores/           # 场景、仿真和设置状态
├── types/            # TypeScript 数据模型
├── utils/            # 报告导出等工具
└── views/            # 首页、实验室、对比、分析、学习和关于页面
```

自动化测试位于 `tests/`，覆盖通信路径、仿真指标和场景一致性。
