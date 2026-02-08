# Baton

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-orange)](https://bun.sh/)

连接 IM 与本地 ACP Agent 的智能代理桥梁。

## 功能特性

- ✅ **飞书/Lark WebSocket 长链接** - 安全内网部署，无需公网暴露
- ✅ **标准 ACP 协议** - 使用官方 `@agentclientprotocol/sdk`
- ✅ **内存会话管理** - 无持久化，快速启动
- ✅ **FIFO 任务队列** - 单写者模型，严格串行化
- ✅ **指令解析与路由** - /help, /current, /stop, /reset 等
- ✅ **卡片消息** - 支持交互式权限确认（预留接口）
- ✅ **文件系统沙盒** - 限制在项目目录内
- ✅ **权限自动批准** - MVP 模式，预留交互确认

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.0.0
- opencode CLI（用于 ACP agent）
- 飞书/Lark 机器人（可选，用于 IM 集成）

### 安装

```bash
# 克隆仓库
git clone <repository-url>
cd baton

# 安装依赖
bun install
```

### 模式一：CLI 模式（本地开发测试）

```bash
# 开发模式（热重载）
bun run dev

# 直接运行
bun start
```

### 模式二：飞书长链接模式（生产部署）

#### 1. 创建飞书机器人

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 **App ID** 和 **App Secret**
4. 启用机器人能力
5. **关键配置**：在「事件订阅」中选择 **使用长连接模式**

#### 2. 配置 Baton（推荐环境变量）

**⚠️ 安全提示：App Secret 是敏感信息，建议使用环境变量！**

##### 方式一：环境变量（推荐）

复制示例文件并填写：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
BATON_FEISHU_APP_ID=cli_你的实际appid
BATON_FEISHU_APP_SECRET=你的实际appsecret
BATON_FEISHU_DOMAIN=feishu

# 可选：项目路径
BATON_PROJECT_PATH=/path/to/your/project
BATON_PROJECT_NAME=my-project
```

然后加载环境变量启动：

```bash
# 方式 1：使用 dotenv（推荐）
npm install -g dotenv-cli
dotenv -e .env bun run start:feishu

# 方式 2：临时设置
export BATON_FEISHU_APP_ID=cli_xxx
export BATON_FEISHU_APP_SECRET=xxx
bun run start:feishu

# 方式 3：使用 docker-compose 或 systemd 时内置
```

##### 方式二：配置文件

```bash
cp baton.config.example.json baton.config.json
```

编辑 `baton.config.json`（**不要提交到 git！**）：

```json
{
  "project": {
    "path": "/path/to/your/project",
    "name": "my-project"
  },
  "feishu": {
    "appId": "cli_xxxxxxxxxxxxxxxx",
    "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "domain": "feishu"
  }
}
```

**注意**：`.gitignore` 已包含 `baton.config.json`，不会被提交。

#### 3. 启动飞书服务

```bash
# 开发模式
bun run dev:feishu

# 生产模式
bun run start:feishu

# 指定配置文件
bun run start:feishu -- /path/to/config.json
```

启动后会看到：

```
╔════════════════════════════════════════╗
║        Baton Feishu Server             ║
║        (WebSocket Long Connection)     ║
╚════════════════════════════════════════╝

Project: /path/to/your/project
App ID: cli_xxxxxxxxxxxxxxxx
Domain: feishu

Connecting to Feishu via WebSocket...

✅ Connected successfully!
Waiting for messages...
```

**无需公网 IP，无需配置域名，内网即可运行！**

## 使用示例

### CLI 模式

```
> /help
显示所有可用指令

> /current
查看当前会话状态和队列

> 你好，请帮我检查一下代码
发送 prompt 给 agent

> /reset
重置会话（清除上下文）

> /stop all
清空队列并停止所有任务

> quit
退出程序
```

### 飞书模式

在飞书群聊中 @机器人：

```
@BatonBot /help
@BatonBot 帮我优化这段代码
@BatonBot /current
```

**私聊模式**：直接发送消息即可

## 支持的指令

| 指令 | 描述 | CLI | 飞书 |
|------|------|-----|------|
| `/help` | 显示帮助信息 | ✅ | ✅ |
| `/current` | 查看会话状态 | ✅ | ✅ |
| `/stop [id/all]` | 停止任务 | ✅ | ✅ |
| `/reset` | 重置会话 | ✅ | ✅ |
| `/mode [name]` | 切换模式 | ✅ | ✅ |
| 任意文本 | 发送 Prompt | ✅ | ✅ |

## 项目结构

```
baton/
├── src/
│   ├── cli.ts                 # CLI 入口
│   ├── feishu-server.ts       # 飞书长链接入口
│   ├── types.ts               # 类型定义
│   ├── config/
│   │   ├── types.ts           # 配置类型
│   │   └── loader.ts          # 配置加载器
│   ├── core/
│   │   ├── session.ts         # 会话管理器
│   │   ├── queue.ts           # 任务队列
│   │   └── dispatcher.ts      # 指令分发器
│   ├── acp/
│   │   └── client.ts          # ACP 客户端
│   └── im/
│       └── feishu.ts          # 飞书 WebSocket 集成
├── tests/
│   └── baton.test.ts          # 单元测试
├── baton.config.example.json  # 配置示例
├── package.json
├── tsconfig.json
├── .gitignore
├── LICENSE
└── README.md
```

## 架构说明

### 三层架构

1. **IM 接入层** 
   - CLI：本地交互模式
   - 飞书：WebSocket 长链接（安全内网部署）
   - 预留：Slack/Discord 接口

2. **核心机制层**
   - 会话管理：内存存储，用户隔离
   - 任务队列：FIFO，单写者模型
   - 指令路由：系统指令 + Prompt 透传

3. **执行层**
   - ACP Runtime：stdio 通信
   - 文件沙盒：项目目录限制
   - 权限控制：自动批准/交互确认

### WebSocket 长链接优势

相比传统 Webhook 模式：

| 特性 | WebSocket 长链接 | Webhook 模式 |
|------|------------------|--------------|
| **安全性** | ✅ 无需公网暴露 | ❌ 需要公网域名 |
| **部署复杂度** | ✅ 内网即可运行 | ❌ 需要公网 IP/域名 |
| **实时性** | ✅ 双向实时通信 | ❌ 依赖 HTTP 请求 |
| **防火墙** | ✅ 出站连接即可 | ❌ 需开放入站端口 |
| **自动重连** | ✅ SDK 内置支持 | ❌ 需自行实现 |

### 会话隔离

- **SessionKey**: `userId:projectPath`
- **进程隔离**: 每个 session 独立 agent 进程
- **文件隔离**: 操作限制在项目根目录
- **队列隔离**: 每个 session 独立 FIFO 队列

## 配置说明

### 配置优先级

**环境变量 > 配置文件 > 默认值**

建议将敏感信息（App ID、App Secret）放在环境变量，其他配置放在配置文件。

### 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BATON_FEISHU_APP_ID` | 飞书 App ID | `cli_xxxxxxxxxx` |
| `BATON_FEISHU_APP_SECRET` | 飞书 App Secret | `xxxxxxxxxxxxxx` |
| `BATON_FEISHU_DOMAIN` | 域名类型 | `feishu` 或 `lark` |
| `BATON_PROJECT_PATH` | 项目绝对路径 | `/home/user/project` |
| `BATON_PROJECT_NAME` | 项目名称 | `my-project` |

### `baton.config.json`

```typescript
{
  // 项目配置
  project: {
    path: string;      // 项目绝对路径
    name: string;      // 项目名称
  };
  
  // 飞书配置（可选，可用环境变量替代）
  feishu: {
    appId: string;                    // 应用 ID
    appSecret: string;                // 应用密钥
    domain?: 'feishu' | 'lark';       // 域名类型
    card?: {
      permissionTimeout: number;      // 权限确认超时（秒）
    };
  };
  
  // ACP 配置
  acp: {
    command: string;      // Agent 命令
    args: string[];       // 命令参数
    cwd: string;          // 工作目录
    env?: Record<string, string>;  // 环境变量
  };
}
```

### 混合配置示例

**.env**（敏感信息）：
```bash
BATON_FEISHU_APP_ID=cli_xxx
BATON_FEISHU_APP_SECRET=xxx
```

**baton.config.json**（非敏感配置）：
```json
{
  "project": {
    "path": "/home/user/my-project",
    "name": "my-project"
  }
}
```

## 部署建议

### 使用 PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 启动飞书服务
pm2 start bun --name "baton-feishu" -- run start:feishu

# 查看日志
pm2 logs baton-feishu
```

### 使用 Docker 部署

```dockerfile
FROM oven/bun:latest

WORKDIR /app
COPY . .

RUN bun install

CMD ["bun", "run", "start:feishu"]
```

**注意**：WebSocket 长链接模式**不需要**暴露端口！

### 使用 systemd 部署

```ini
# /etc/systemd/system/baton.service
[Unit]
Description=Baton Feishu Bot
After=network.target

[Service]
Type=simple
User=baton
WorkingDirectory=/path/to/baton
ExecStart=/usr/local/bin/bun run start:feishu
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 开发计划

### 已完成 ✅

- [x] CLI 交互模式
- [x] 飞书 WebSocket 长链接集成
- [x] ACP 协议支持
- [x] 任务队列管理
- [x] 文件系统沙盒

### 进行中 🚧

- [ ] 权限确认卡片交互
- [ ] 持久化存储（SQLite）
- [ ] 流式响应支持

### 计划中 📋

- [ ] Slack/Discord 支持
- [ ] 多项目配置管理
- [ ] Web UI 管理界面
- [ ] 审计日志

## 依赖

- `@agentclientprotocol/sdk` - ACP 协议官方 SDK
- `@larksuiteoapi/node-sdk` - 飞书开放平台 SDK
- `typescript` - 类型系统
- `bun` - JavaScript 运行时

## License

Apache 2.0 © 2024 Baton Contributors

See [LICENSE](LICENSE) for details.