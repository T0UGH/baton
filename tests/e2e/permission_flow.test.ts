import { describe, it, beforeEach, expect, mock } from 'bun:test';
import { SessionManager } from '../../src/core/session';
import { TaskQueueEngine } from '../../src/core/queue';
import { CommandDispatcher } from '../../src/core/dispatcher';
import type { IMMessage, IMResponse, Session } from '../../src/types';

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
          availableModes: [
            { id: 'plan', name: 'Plan Mode' },
            { id: 'act', name: 'Act Mode' },
          ],
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

describe('E2E Permission Flow', () => {
  let sessionManager: SessionManager;
  let queueEngine: TaskQueueEngine;
  let dispatcher: CommandDispatcher;
  const testProjectPath = process.cwd();

  beforeEach(() => {
    sessionManager = new SessionManager(testProjectPath);
  });

  it('should complete a full permission flow', async () => {
    let capturedResponse: IMResponse | null = null;
    let permissionEvent: any = null;

    queueEngine = new TaskQueueEngine(async (session: Session, response: IMResponse) => {
      capturedResponse = response;
    });

    dispatcher = new CommandDispatcher(sessionManager, queueEngine);

    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    const message: IMMessage = {
      userId: 'test-user',
      userName: 'Tester',
      text: 'please trigger_permission',
      timestamp: Date.now(),
    };

    await dispatcher.dispatch(message);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(permissionEvent).toBeDefined();
    expect(permissionEvent.request.toolCall.title).toBe('Test Tool');

    const { sessionId, requestId } = permissionEvent;

    const selectMessage: IMMessage = {
      userId: 'test-user',
      userName: 'Tester',
      text: `/select ${requestId} allow`,
      timestamp: Date.now(),
    };

    const selectResponse = await dispatcher.dispatch(selectMessage);
    expect(selectResponse.success).toBe(true);
    expect(selectResponse.message).toContain('allow');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(capturedResponse).toBeDefined();
    expect(capturedResponse!.message).toContain('Permission result: allow');
  });

  it('should handle index-based selection', async () => {
    let permissionEvent: any = null;
    queueEngine = new TaskQueueEngine(async () => {});
    dispatcher = new CommandDispatcher(sessionManager, queueEngine);
    sessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    await dispatcher.dispatch({
      userId: 'user2',
      userName: 'Tester2',
      text: 'trigger_permission',
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    const { requestId } = permissionEvent;

    const selectMessage: IMMessage = {
      userId: 'user2',
      userName: 'Tester2',
      text: `/select ${requestId} 1`,
      timestamp: Date.now(),
    };

    const selectResponse = await dispatcher.dispatch(selectMessage);

    expect(selectResponse.success).toBe(true);
    expect(selectResponse.message).toContain('deny');
  });

  it('should timeout and auto-reject permission request', async () => {
    const shortSessionManager = new SessionManager(testProjectPath, 0.1);
    const shortQueueEngine = new TaskQueueEngine(async () => {});
    const shortDispatcher = new CommandDispatcher(shortSessionManager, shortQueueEngine);

    let permissionEvent: any = null;
    shortSessionManager.on('permissionRequest', event => {
      permissionEvent = event;
    });

    await shortDispatcher.dispatch({
      userId: 'timeout-user',
      userName: 'TimeoutTester',
      text: 'trigger_permission',
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(permissionEvent).toBeDefined();
    const { requestId } = permissionEvent;

    await new Promise(resolve => setTimeout(resolve, 150));

    const selectResponse = await shortDispatcher.dispatch({
      userId: 'timeout-user',
      userName: 'TimeoutTester',
      text: `/select ${requestId} allow`,
      timestamp: Date.now(),
    });

    expect(selectResponse.success).toBe(false);
    expect(selectResponse.message).toContain('not found or expired');
  });

  it('should implicitly cancel pending permission when new prompt arrives', async () => {
    let capturedResponses: string[] = [];

    queueEngine = new TaskQueueEngine(async (s, r) => {
      capturedResponses.push(r.message);
    });

    dispatcher = new CommandDispatcher(sessionManager, queueEngine);

    await dispatcher.dispatch({
      userId: 'preempt-user',
      userName: 'PreemptTester',
      text: 'trigger_permission',
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    await dispatcher.dispatch({
      userId: 'preempt-user',
      userName: 'PreemptTester',
      text: 'new instruction',
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(capturedResponses.length).toBeGreaterThanOrEqual(1);
    expect(capturedResponses.some(m => m.includes('new instruction'))).toBe(true);
  });
});

describe('Context Isolation', () => {
  const testProjectPath = process.cwd();

  it('should create different sessions for same user in different contexts', async () => {
    const manager = new SessionManager(testProjectPath);
    const queueEngine = new TaskQueueEngine(async () => {});
    const dispatcher = new CommandDispatcher(manager, queueEngine);

    const msg1: IMMessage = {
      userId: 'user-a',
      userName: 'User A',
      text: 'Hello from chat 1',
      timestamp: Date.now(),
      contextId: 'chat-1',
    };

    const msg2: IMMessage = {
      userId: 'user-a',
      userName: 'User A',
      text: 'Hello from chat 2',
      timestamp: Date.now(),
      contextId: 'chat-2',
    };

    await dispatcher.dispatch(msg1);
    await dispatcher.dispatch(msg2);

    const session1 = manager.getSession('user-a', 'chat-1');
    const session2 = manager.getSession('user-a', 'chat-2');

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session1!.id).not.toBe(session2!.id);
  });

  it('should share session for same user in same context', async () => {
    const manager = new SessionManager(testProjectPath);
    const queueEngine = new TaskQueueEngine(async () => {});
    const dispatcher = new CommandDispatcher(manager, queueEngine);

    const msg1: IMMessage = {
      userId: 'user-b',
      userName: 'User B',
      text: 'First message',
      timestamp: Date.now(),
      contextId: 'same-chat',
    };

    const msg2: IMMessage = {
      userId: 'user-b',
      userName: 'User B',
      text: 'Second message',
      timestamp: Date.now(),
      contextId: 'same-chat',
    };

    await dispatcher.dispatch(msg1);
    await dispatcher.dispatch(msg2);

    const session = manager.getSession('user-b', 'same-chat');
    expect(session).toBeDefined();
  });

  it('should handle missing contextId gracefully (backward compatibility)', async () => {
    const manager = new SessionManager(testProjectPath);
    const queueEngine = new TaskQueueEngine(async () => {});
    const dispatcher = new CommandDispatcher(manager, queueEngine);

    const msgWithoutContext: IMMessage = {
      userId: 'user-c',
      userName: 'User C',
      text: 'Message without context',
      timestamp: Date.now(),
    };

    await dispatcher.dispatch(msgWithoutContext);

    const session = manager.getSession('user-c');
    expect(session).toBeDefined();
    expect(session!.id).toBeDefined();
  });
});
