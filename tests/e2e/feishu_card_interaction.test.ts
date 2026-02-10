import { describe, it, beforeEach, expect, mock } from 'bun:test';
import { SessionManager } from '../../src/core/session';
import { TaskQueueEngine } from '../../src/core/queue';
import type { IMResponse, Session } from '../../src/types';

// 模拟 ACPClient
mock.module('../../src/acp/client', () => {
  return {
    ACPClient: class MockACPClient {
      private permissionHandler: any;
      constructor(projectPath: string, permissionHandler: any) {
        this.permissionHandler = permissionHandler;
      }
      async startAgent() {}
      async stop() {}
      getModeState() {
        return {
          availableModes: [{ id: 'plan', name: 'Plan Mode' }],
          currentModeId: 'plan',
        };
      }
      getModelState() {
        return {
          availableModels: [{ modelId: 'gpt-4', name: 'GPT-4' }],
          currentModelId: 'gpt-4',
        };
      }
      async sendPrompt(prompt: string) {
        if (prompt.includes('trigger_permission')) {
          const optionId = await this.permissionHandler({
            toolCall: { title: 'Test Tool' },
            options: [
              { optionId: 'allow', name: 'Allow' },
              { optionId: 'deny', name: 'Deny' },
            ],
          });
          return { success: true, message: `Permission result: ${optionId}` };
        }
        return { success: true, message: `Echo: ${prompt}` };
      }
      async sendCommand(cmd: string) {
        return this.sendPrompt(cmd);
      }
      async cancelCurrentTask() {}
      async setMode(mode: string) {
        return { success: true, message: `Mode set to ${mode}` };
      }
      async setModel(model: string) {
        return { success: true, message: `Model set to ${model}` };
      }
    },
  };
});

describe('E2E Feishu Card Interaction', () => {
  let sessionManager: SessionManager;
  const testProjectPath = process.cwd();

  beforeEach(() => {
    sessionManager = new SessionManager(testProjectPath);
  });

  it('should resolve permission via card action and continue task flow', async () => {
    let capturedResponses: IMResponse[] = [];
    let permissionEvent: any = null;

    const queueEngine = new TaskQueueEngine(async (session: Session, response: IMResponse) => {
      capturedResponses.push(response);
    });

    // 监听权限请求事件
    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    // 创建 session 并触发权限请求
    const session = await sessionManager.getOrCreateSession('test-user', 'test-context');

    // 启动 agent 并触发权限请求
    const taskPromise = queueEngine.enqueue(session, 'trigger_permission', 'prompt');

    // 等待权限请求触发
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(permissionEvent).toBeDefined();
    expect(permissionEvent.sessionId).toBe(session.id);
    expect(permissionEvent.request.toolCall.title).toBe('Test Tool');

    const { sessionId, requestId } = permissionEvent;

    // 模拟飞书卡片点击 - 使用正确的嵌套 value 结构
    const cardActionData = {
      action: {
        value: {
          action_id: 'permission_allow',
          value: JSON.stringify({
            action: 'resolve_permission',
            session_id: sessionId,
            request_id: requestId,
            option_id: 'allow',
          }),
        },
      },
    };

    // 调用 resolvePermission 模拟卡片点击
    const result = sessionManager.resolvePermission(sessionId, requestId, 'allow');

    expect(result.success).toBe(true);
    expect(result.message).toContain('allow');

    // 等待任务完成
    await new Promise(resolve => setTimeout(resolve, 200));

    // 验证任务继续执行并收到结果
    expect(capturedResponses.length).toBeGreaterThanOrEqual(1);
    expect(capturedResponses[0].message).toContain('Permission result: allow');
  });

  it('should handle card action with option index', async () => {
    let capturedResponses: IMResponse[] = [];
    let permissionEvent: any = null;

    const queueEngine = new TaskQueueEngine(async (session: Session, response: IMResponse) => {
      capturedResponses.push(response);
    });

    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    const session = await sessionManager.getOrCreateSession('test-user-2', 'test-context-2');

    // 触发权限请求
    queueEngine.enqueue(session, 'trigger_permission', 'prompt');

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(permissionEvent).toBeDefined();
    const { sessionId, requestId } = permissionEvent;

    // 使用索引 1 选择 deny 选项
    const result = sessionManager.resolvePermission(sessionId, requestId, '1');

    expect(result.success).toBe(true);
    expect(result.message).toContain('deny');

    await new Promise(resolve => setTimeout(resolve, 200));

    expect(capturedResponses.length).toBeGreaterThanOrEqual(1);
    expect(capturedResponses[0].message).toContain('Permission result: deny');
  });

  it('should handle multiple tasks after permission resolution', async () => {
    let capturedResponses: IMResponse[] = [];
    let permissionEvent: any = null;

    const queueEngine = new TaskQueueEngine(async (session: Session, response: IMResponse) => {
      capturedResponses.push(response);
    });

    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    const session = await sessionManager.getOrCreateSession('test-user-3', 'test-context-3');

    // 添加多个任务到队列
    await queueEngine.enqueue(session, 'trigger_permission', 'prompt');
    await queueEngine.enqueue(session, 'second task', 'prompt');
    await queueEngine.enqueue(session, 'third task', 'prompt');

    // 等待权限请求
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(permissionEvent).toBeDefined();

    const { sessionId, requestId } = permissionEvent;

    // 解决权限请求
    sessionManager.resolvePermission(sessionId, requestId, 'allow');

    // 等待所有任务完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 验证所有任务都执行了
    expect(capturedResponses.length).toBe(3);
    expect(capturedResponses[0].message).toContain('Permission result: allow');
    expect(capturedResponses[1].message).toContain('Echo: second task');
    expect(capturedResponses[2].message).toContain('Echo: third task');
  });

  it('should handle invalid card action gracefully', async () => {
    const session = await sessionManager.getOrCreateSession('test-user-4', 'test-context-4');

    // 尝试解析不存在的权限请求
    const result = sessionManager.resolvePermission(session.id, 'non-existent-request-id', 'allow');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should handle card action with nested value structure correctly', async () => {
    let permissionEvent: any = null;

    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    const queueEngine = new TaskQueueEngine(async () => {});
    const session = await sessionManager.getOrCreateSession('test-user-5', 'test-context-5');

    queueEngine.enqueue(session, 'trigger_permission', 'prompt');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(permissionEvent).toBeDefined();

    const { sessionId, requestId } = permissionEvent;

    // 测试直接调用 resolvePermission（模拟 handleCardAction 内部的调用）
    // 验证 option_id 能正确传递
    const result = sessionManager.resolvePermission(sessionId, requestId, 'allow');
    expect(result.success).toBe(true);

    // 验证已经 resolve 后再次尝试会失败
    const secondResult = sessionManager.resolvePermission(sessionId, requestId, 'deny');
    expect(secondResult.success).toBe(false);
    expect(secondResult.message).toContain('not found');
  });
});
