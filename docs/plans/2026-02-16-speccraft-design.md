# SpecCraft 设计文档

> Spec Creator — 帮团队创建和管理 spec-driven 工作流的工具

---

## 1. 核心定位与原则

### 1.1 一句话定义

**SpecCraft**（简称 Craft）是一个 Spec Creator — 帮团队创建和管理 spec-driven 工作流的工具。

### 1.2 核心价值

| 价值 | 说明 |
|------|------|
| **创建工作流** | 通过引导式问答或从示例学习，帮团队定义自己的 spec 工作流 |
| **跨平台** | 产物是纯静态文件（SKILL.md + workflow.yaml），各 Agent 平台通用 |
| **静态与运行时分离** | 工作流定义是纯静态的，CLI 是独立的运行时 |

### 1.3 不是什么

- 不是所有工作流都需要 spec（bug-fix、hotfix 可能不需要）
- 不是工作流执行引擎，CLI 只是辅助工具
- 不强制 NPM 分发，Git URL 即可

### 1.4 核心原则

| 原则 | 说明 |
|------|------|
| **YAML + 模板拆分** | workflow.yaml 定义逻辑，大模板独立文件 |
| **通用命令驱动** | `craft run <workflow> <command>` 支持任意工作流 |
| **SKILL.md 是说明书** | SKILL.md 告诉 Agent 用哪些 CLI 命令 |

---

## 2. 整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           SpecCraft                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────┐      ┌────────────────────────────┐    │
│  │   @speccraft/cli       │      │   @speccraft/templates     │    │
│  │   (脚手架 + 运行时)     │      │   (内置模板库)              │    │
│  │                        │      │                            │    │
│  │  - craft init          │      │  - brainstorm/             │    │
│  │  - craft copy          │      │  - feature-dev/            │    │
│  │  - craft create        │      │  - api-design/             │    │
│  │  - craft run           │      │                            │    │
│  └────────────────────────┘      └────────────────────────────┘    │
│                 │                          │                        │
│                 ▼                          ▼                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              团队 Marketplace (纯静态)                        │   │
│  │              myteam-spec-workflows/                          │   │
│  │                                                              │   │
│  │  ├── marketplace.json                                        │   │
│  │  ├── brainstorm/           # 从模板复制                      │   │
│  │  │   ├── SKILL.md                                           │   │
│  │  │   ├── workflow.yaml                                      │   │
│  │  │   └── templates/                                         │   │
│  │  └── bug-triage/            # 团队自定义                     │   │
│  │      ├── SKILL.md                                           │   │
│  │      ├── workflow.yaml                                      │   │
│  │      └── templates/                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │              使用者 (团队成员)                      │
        │                                                    │
        │  方式1: 作为 Marketplace 安装到 Agent               │
        │  /plugin marketplace add https://github.com/...    │
        │  /brainstorm ...                                   │
        │                                                    │
        │  方式2: CLI 直接运行                                │
        │  npx @speccraft/cli run brainstorm init <topic>    │
        └───────────────────────────────────────────────────┘
```

### 2.2 两个核心产物

| 产物 | 职责 | 使用者 |
|------|------|--------|
| `@speccraft/cli` | 脚手架工具 + 工作流运行时 | TL/技术负责人创建，团队成员使用 |
| `@speccraft/templates` | 内置模板库 | 作为 CLI 的依赖 |

### 2.3 分发模型

```
团队 Marketplace (Git Repo)
└── myteam-spec-workflows/     # 一个 marketplace
    ├── marketplace.json        # marketplace 配置
    ├── brainstorm/             # 多个 workflow/skill
    ├── feature-dev/
    └── bug-triage/
```

**使用方式**：
```bash
# 团队成员安装团队的 marketplace
/plugin marketplace add https://github.com/myteam/myteam-spec-workflows

# 然后就能用里面的所有工作流
/brainstorm ...
/feature-dev ...
```

---

## 3. 产物结构

### 3.1 CLI 结构

```
@speccraft/cli/
├── bin/
│   └── craft.js              # 入口脚本
├── src/
│   ├── index.ts              # 主入口
│   ├── commands/             # 子命令实现
│   │   ├── init.ts           # craft init - 创建 marketplace
│   │   ├── copy.ts           # craft copy - 从模板复制工作流
│   │   ├── create.ts         # craft create - 自定义创建工作流
│   │   └── run.ts            # craft run - 运行工作流命令
│   ├── core/                 # 核心引擎
│   │   ├── WorkflowLoader.ts    # 加载 workflow.yaml
│   │   ├── CommandExecutor.ts   # 执行命令
│   │   └── TemplateRenderer.ts  # 渲染模板
│   └── utils/
├── package.json
└── README.md
```

### 3.2 Templates 结构

```
@speccraft/templates/
├── brainstorm/
│   ├── SKILL.md
│   ├── workflow.yaml
│   └── templates/
│       └── brainstorm.md
├── feature-dev/
│   ├── SKILL.md
│   ├── workflow.yaml
│   └── templates/
│       ├── spec.md
│       ├── plan.md
│       └── tasks.md
└── api-design/
    ├── SKILL.md
    ├── workflow.yaml
    └── templates/
        └── api-spec.md
```

### 3.3 团队 Marketplace 结构

```
myteam-spec-workflows/
├── marketplace.json          # marketplace 配置
├── brainstorm/               # 工作流 (从模板复制)
│   ├── SKILL.md              # Agent 读取的技能说明
│   ├── workflow.yaml         # CLI 读取的工作流定义
│   └── templates/            # 模板文件
│       └── brainstorm.md
├── bug-triage/               # 工作流 (团队自定义)
│   ├── SKILL.md
│   ├── workflow.yaml
│   └── templates/
│       ├── init.md
│       └── triage.md
└── feature-dev/
    ├── SKILL.md
    ├── workflow.yaml
    └── templates/
        ├── spec.md
        ├── plan.md
        └── tasks.md
```

---

## 4. workflow.yaml 规范

### 4.1 基本结构

```yaml
# workflow.yaml
name: brainstorm
version: 1.0.0
description: 通过问答式交互，将模糊想法转化为清晰设计

# 变量定义
variables:
  topic:
    type: string
    required: true
    description: 要探索的主题
  outputDir:
    type: string
    default: "specs/{{topic}}"

# 命令定义
commands:
  init:
    description: 初始化 brainstorm
    template: templates/init.md
    output: "{{outputDir}}/brainstorm.md"
    
  next:
    description: 继续下一个问题
    # 无模板，交互式
    
  status:
    description: 查看当前状态
    
  validate:
    description: 验证 brainstorm 是否完整
    
  done:
    description: 完成 brainstorm
    template: templates/summary.md
    output: "{{outputDir}}/summary.md"
```

### 4.2 命令类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **template** | 使用模板生成文件 | `init`, `done` |
| **interactive** | 交互式，无模板 | `next` |
| **query** | 查询状态，不修改文件 | `status`, `validate` |

### 4.3 变量系统

```yaml
variables:
  # 字符串类型
  topic:
    type: string
    required: true
    
  # 选择类型
  priority:
    type: select
    options: [P0, P1, P2, P3]
    default: P2
    
  # 带默认值
  outputDir:
    type: string
    default: "specs/{{topic}}"
    
  # 计算变量
  slug:
    type: computed
    formula: "{{topic | slugify}}"
```

---

## 5. SKILL.md 规范

### 5.1 作用

SKILL.md 是给 Agent 看的"说明书"，告诉 Agent：
- 这个工作流做什么
- 用哪些 CLI 命令
- 命令的顺序和逻辑

### 5.2 示例

```markdown
# Brainstorm 工作流

通过问答式交互，将模糊想法转化为清晰的设计文档。

## 何时使用

- 有一个模糊的想法，需要探索和细化
- 需要做技术决策，想系统性地分析
- 开始一个新功能前，想先理清思路

## 使用方式

使用 `craft run brainstorm <command>` 执行命令：

### 初始化

\`\`\`bash
craft run brainstorm init <topic>
\`\`\`

创建一个新的 brainstorm 文档，开始探索。

### 继续探索

\`\`\`bash
craft run brainstorm next
\`\`\`

Agent 会提出下一个问题来深化思考。

### 查看状态

\`\`\`bash
craft run brainstorm status
\`\`\`

查看当前探索的进度和已覆盖的维度。

### 验证

\`\`\`bash
craft run brainstorm validate
\`\`\`

检查 brainstorm 是否完整，是否可以进入下一阶段。

### 完成

\`\`\`bash
craft run brainstorm done
\`\`\`

生成最终的设计摘要。

## 流程建议

1. 先运行 `init` 开始
2. 多次运行 `next` 深入探索
3. 随时用 `status` 查看进度
4. 用 `validate` 检查完整性
5. 最后用 `done` 完成

## 产出

- `specs/<topic>/brainstorm.md` — 探索过程记录
- `specs/<topic>/summary.md` — 最终设计摘要
```

---

## 6. CLI 命令设计

### 6.1 命令总览

```bash
# Marketplace 管理
craft init <name>              # 创建新的 marketplace
craft init .                   # 在当前目录初始化

# 工作流管理
craft copy <template>          # 从模板库复制工作流
craft create <name>            # 交互式创建新工作流

# 工作流执行
craft run <workflow> <cmd>     # 运行工作流命令
craft <workflow> <cmd>         # 快捷方式（内置工作流）

# 查询
craft list                     # 列出所有工作流
craft show <workflow>          # 显示工作流详情
```

### 6.2 craft init

```bash
craft init myteam-spec-workflows

# 产出
myteam-spec-workflows/
├── marketplace.json
└── README.md
```

### 6.3 craft copy

```bash
# 从模板库复制
craft copy brainstorm
craft copy feature-dev

# 产出（在当前 marketplace 目录下）
brainstorm/
├── SKILL.md
├── workflow.yaml
└── templates/
```

### 6.4 craft create

```bash
craft create bug-triage

# 交互式问答
? 工作流名称: bug-triage
? 描述: Bug 分类和处理工作流
? 变量: bug-name (string, 必填)
? 命令: init, triage, validate, done
? 命令 init 的模板文件: templates/init.md
...
```

### 6.5 craft run

```bash
# 通用格式
craft run <workflow> <command> [options]

# 示例
craft run brainstorm init user-auth
craft run brainstorm next
craft run brainstorm status
craft run feature-dev init --name=login --priority=P0
craft run bug-triage init BUG-123
```

---

## 7. 使用流程

### 7.1 TL/技术负责人：创建 Marketplace

```bash
# 1. 创建 marketplace
npx @speccraft/cli init myteam-spec-workflows
cd myteam-spec-workflows

# 2. 从模板复制常用工作流
npx @speccraft/cli copy brainstorm
npx @speccraft/cli copy feature-dev

# 3. 自定义工作流
npx @speccraft/cli create bug-triage

# 4. 推送到 Git
git init && git add . && git commit -m "Initial commit"
git remote add origin https://github.com/myteam/myteam-spec-workflows
git push -u origin main
```

### 7.2 团队成员：使用工作流

**方式1：作为 Marketplace 安装**

```bash
# Claude Code
/plugin marketplace add https://github.com/myteam/myteam-spec-workflows

# 然后在对话中使用
/brainstorm init user-auth
```

**方式2：CLI 直接运行**

```bash
# 在项目目录下
npx @speccraft/cli run brainstorm init user-auth
npx @speccraft/cli run brainstorm next
npx @speccraft/cli run brainstorm status
```

---

## 8. 内置模板

### 8.1 brainstorm

将模糊想法转化为清晰设计。

**命令**：`init`, `next`, `status`, `validate`, `done`

**产出**：
- `specs/<topic>/brainstorm.md` — 探索记录
- `specs/<topic>/summary.md` — 设计摘要

### 8.2 feature-dev

标准功能开发流程。

**命令**：`init`, `spec`, `plan`, `tasks`, `status`, `validate`

**产出**：
- `specs/<feature>/spec.md` — 需求规格
- `specs/<feature>/plan.md` — 实现计划
- `specs/<feature>/tasks.md` — 任务列表

### 8.3 api-design

API 设计流程。

**命令**：`init`, `define`, `review`, `done`

**产出**：
- `specs/<api>/api-spec.md` — API 规格

---

## 9. 跨平台适配

### 9.1 统一格式

SpecCraft 产物是纯静态文件：
- `SKILL.md` — Markdown 格式，所有 Agent 平台通用
- `workflow.yaml` — YAML 格式，CLI 通用
- `templates/` — Markdown 模板

### 9.2 各平台适配

| 平台 | 适配方式 |
|------|----------|
| Claude Code | 直接作为 marketplace plugin 使用 |
| OpenCode | 转换为 `.opencode/` 格式 |
| Codex | 转换为 `.codex/` 格式 |
| Cursor | 转换为 `.cursor/` 格式 |

### 9.3 转换工具

```bash
# 可选：转换为其他平台格式
craft export --target opencode
craft export --target codex
```

---

## 10. 实现路线图

### Phase 1: 核心 CLI (MVP)

- [ ] `craft init` - 创建 marketplace
- [ ] `craft copy` - 从模板复制
- [ ] `craft run` - 运行工作流命令
- [ ] 内置模板：brainstorm

### Phase 2: 工作流创建

- [ ] `craft create` - 交互式创建工作流
- [ ] workflow.yaml 解析和执行
- [ ] 变量系统

### Phase 3: 完善

- [ ] 更多内置模板
- [ ] 跨平台导出
- [ ] 从示例学习功能
- [ ] 文档和示例

---

*设计完成，待实现*
