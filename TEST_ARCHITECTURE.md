# 测试架构设计文档

## 问题分析

### 当前测试架构的问题

1. **Mock 隔离失效**
   - `layered.test.ts` 使用 `mock.module()` 但过于简单
   - 没有模拟权限请求的完整生命周期
   - 无法测试终端创建和命令执行逻辑

2. **全局状态污染**
   - `SessionManager.sessions` 是全局 `Map`
   - 测试间可能相互影响
   - 难以进行并发测试

3. **缺乏本地测试能力**
   - 无法在不启动真实 opencode acp 的情况下测试
   - 调试困难
   - 开发效率低

## 解决方案

### 1. FakeACPClient

内存中的 ACP 协议模拟器，完全模拟 opencode acp 的行为：

```typescript
import { FakeACPClient, FakeACPClientFactory } from './core/test/fake-acp';

// 基本使用
const client = new FakeACPClient();
await client.startAgent();
const response = await client.sendPrompt('hello');

// 配置自定义响应
client.setPromptConfig({
  response: 'Custom response',
  delay: 100,
  triggerPermission: {
    title: 'File Access',
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'deny', name: 'Deny', kind: 'deny' },
    ],
  },
});

// 使用工厂创建
const factory = new FakeACPClientFactory();
const { client, resolvePermission } = factory.createWithPermissionRequest(
  'File Access',
  [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
);
```

### 2. TestSessionManager

可测试的会话管理器，支持：

- 内存隔离：每个实例有独立的 sessions 存储
- 可注入的 ACPClient 工厂
- 快速重置
- 完整的事件系统

```typescript
import { TestSessionManager } from './core/test/test-session';

const sessionManager = new TestSessionManager({
  acpClientFactory: new FakeACPClientFactory(),
  permissionTimeoutSeconds: 30,
});

// 创建会话
const session = await sessionManager.getOrCreateSession(
  'user-1',
  'ctx-1',
  '/path/to/project'
);

// 获取会话状态
const status = sessionManager.getQueueStatus('user-1', 'ctx-1');

// 重置会话
await sessionManager.resetSession('user-1', 'ctx-1');
```

### 3. LocalCLIMode

本地终端测试模式，支持：

- 交互式命令行界面
- 完整的命令支持
- FakeACP 配置
- 快速验证修复

```bash
# 启动 CLI 模式
bun run test:cli
```

## 目录结构

```
src/
└── core/
    └── test/
        ├── fake-acp.ts        # FakeACPClient 实现
        ├── test-session.ts    # TestSessionManager 实现
        ├── cli-mode.ts        # LocalCLIMode 实现
        ├── index.ts          # 模块导出
        └── fixtures/         # 测试固件
```

## 测试层次

### 单元测试 (Unit Tests)

测试单个组件的功能：

```typescript
describe('FakeACPClient', () => {
  it('should return custom response', async () => {
    const client = new FakeACPClient();
    client.setPromptConfig({ response: 'Test' });
    await client.startAgent();
    const response = await client.sendPrompt('hello');
    expect(response.message).toBe('Test');
  });
});
```

### 集成测试 (Integration Tests)

测试多个组件的协作：

```typescript
describe('Session + Queue Integration', () => {
  it('should process tasks in order', async () => {
    const sessionManager = new TestSessionManager();
    const queueEngine = new TaskQueueEngine();
    
    const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/path');
    await queueEngine.enqueue(session, 'Task 1', 'prompt');
    await queueEngine.enqueue(session, 'Task 2', 'prompt');
    
    expect(session.queue.pending.length).toBe(1);
  });
});
```

### E2E 测试 (End-to-End Tests)

使用真实 ACPClient，但可以跳过或 mock：

```typescript
describe('Real ACP Integration', () => {
  it.skip('should work with real opencode acp', async () => {
    // 仅在需要时运行
  });
});
```

## 使用指南

### 1. 运行单元测试

```bash
bun test tests/new-architecture.test.ts
```

### 2. 运行 CLI 模式

```bash
bun run test:cli
```

### 3. 查看测试覆盖率

```bash
bun test --coverage
```

## 最佳实践

1. **优先使用 FakeACPClient**
   - 快速执行
   - 完全可控
   - 可预测的结果

2. **保持测试隔离**
   - 每个测试创建新的 SessionManager
   - 在 afterEach 中调用 resetAllSessions()

3. **测试边界条件**
   - 空会话
   - 并发请求
   - 超时处理

4. **模拟真实场景**
   - 权限请求流程
   - 终端创建
   - 错误恢复

## 迁移指南

### 从旧测试迁移

旧代码：
```typescript
mock.module('../src/acp/client', () => {
  return {
    ACPClient: class Mock { ... }
  };
});
```

新代码：
```typescript
import { TestSessionManager } from '../src/core/test/test-session';

describe('My Test', () => {
  const sessionManager = new TestSessionManager();
  // 使用 TestSessionManager 替代 SessionManager
});
```

## 常见问题

### Q: 如何测试真实的 opencode acp 行为？

A: 使用真正的 `ACPClient`，但确保：
1. 在单独的测试文件中
2. 使用 `it.skip` 标记
3. 设置较长的超时时间

### Q: 如何模拟权限请求被用户拒绝？

A: 在 FakeACPClient 中配置：
```typescript
client.setPromptConfig({
  triggerPermission: {
    title: 'Sensitive Operation',
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'deny', name: 'Deny', kind: 'deny' },
    ],
  },
});

// 然后在测试中解析权限为 deny
```

### Q: 如何测试并发会话？

A: 创建多个 SessionManager 实例或使用独立的 sessions：
```typescript
const manager1 = new TestSessionManager();
const manager2 = new TestSessionManager();

const session1 = await manager1.getOrCreateSession('user-1', 'ctx-1', '/path');
const session2 = await manager2.getOrCreateSession('user-2', 'ctx-1', '/path');
```
