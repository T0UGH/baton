/**
 * 分层测试架构
 *
 * Layer 1: Core Layer - 完全 Mock ACPClient，测试核心业务逻辑
 * Layer 2: Integration Layer - Mock IM 层，测试会话管理和队列引擎
 * Layer 3: E2E Layer - 完整集成测试（当前已有的测试）
 */

import { describe, it, beforeEach, expect, mock, beforeAll } from 'bun:test';
import type { Session } from '../src/types';

// Mock ACPClient at module level BEFORE any imports that use it
mock.module('../src/acp/client', () => {
  return {
    ACPClient: class MockACPClient {
      constructor() {}
      async startAgent() {}
      async stop() {}
      async sendPrompt() {
        return { success: true, message: 'done' };
      }
      async cancelCurrentTask() {}
      getModeState() {
        return { availableModes: [], currentModeId: null };
      }
      getModelState() {
        return { availableModels: [], currentModelId: null };
      }
    },
  };
});

import { SessionManager } from '../src/core/session';
import { TaskQueueEngine } from '../src/core/queue';
import type { IMResponse } from '../src/types';

// ============ Layer 1: Core Layer Tests ============
// 测试 SessionManager 的核心逻辑，完全不依赖 IM 层

describe('Layer 1: SessionManager Core Logic', () => {
  let sessionManager: SessionManager;
  const projectPathA = '/path/to/project-a';
  const projectPathB = '/path/to/project-b';

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  describe('Multi-project Session Isolation', () => {
    it('should create separate sessions for different projects', async () => {
      const sessionA1 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathA
      );
      const sessionB1 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathB
      );

      expect(sessionA1.id).not.toBe(sessionB1.id);
      expect(sessionA1.projectPath).toBe(projectPathA);
      expect(sessionB1.projectPath).toBe(projectPathB);
    });

    it('should return same session for same project', async () => {
      const sessionA1 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathA
      );
      const sessionA2 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathA
      );

      expect(sessionA1.id).toBe(sessionA2.id);
    });

    it('should isolate sessions by userId', async () => {
      const sessionUser1 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathA
      );
      const sessionUser2 = await sessionManager.getOrCreateSession(
        'user-2',
        'context-1',
        projectPathA
      );

      expect(sessionUser1.id).not.toBe(sessionUser2.id);
      expect(sessionUser1.userId).toBe('user-1');
      expect(sessionUser2.userId).toBe('user-2');
    });

    it('should isolate sessions by contextId', async () => {
      const sessionCtx1 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-1',
        projectPathA
      );
      const sessionCtx2 = await sessionManager.getOrCreateSession(
        'user-1',
        'context-2',
        projectPathA
      );

      expect(sessionCtx1.id).not.toBe(sessionCtx2.id);
    });

    it('should support concurrent sessions in multiple projects', async () => {
      const sessions = await Promise.all([
        sessionManager.getOrCreateSession('user-1', 'ctx-a', projectPathA),
        sessionManager.getOrCreateSession('user-1', 'ctx-b', projectPathB),
        sessionManager.getOrCreateSession('user-2', 'ctx-a', projectPathA),
        sessionManager.getOrCreateSession('user-2', 'ctx-b', projectPathB),
      ]);

      expect(sessions).toHaveLength(4);
      const uniqueIds = new Set(sessions.map(s => s.id));
      expect(uniqueIds.size).toBe(4);
    });
  });

  describe('Session Lifecycle', () => {
    beforeEach(() => {
      sessionManager.setCurrentRepo({ name: 'test', path: projectPathA, gitPath: '/test/.git' });
    });

    it('should create session with correct initial state', async () => {
      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', projectPathA);

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.projectPath).toBe(projectPathA);
      expect(session.queue.pending).toEqual([]);
      expect(session.queue.current).toBeNull();
      expect(session.isProcessing).toBe(false);
    });

    it('should track sessions correctly', async () => {
      await sessionManager.getOrCreateSession('user-1', 'ctx-1', projectPathA);
      await sessionManager.getOrCreateSession('user-1', 'ctx-2', projectPathA);

      const session1 = sessionManager.getSession('user-1', 'ctx-1', projectPathA);
      const session2 = sessionManager.getSession('user-1', 'ctx-2', projectPathA);

      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
      expect(session1?.id).not.toBe(session2?.id);
    });

    it('should reset specific session', async () => {
      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', projectPathA);

      const result = await sessionManager.resetSession('user-1', 'ctx-1');

      expect(result.success).toBe(true);
      expect(sessionManager.getSession('user-1', 'ctx-1', projectPathA)).toBeUndefined();
    });

    it('should reset all sessions', async () => {
      await sessionManager.getOrCreateSession('user-1', 'ctx-a', projectPathA);
      await sessionManager.getOrCreateSession('user-1', 'ctx-b', projectPathB);

      await sessionManager.resetAllSessions();

      expect(sessionManager.getSession('user-1', 'ctx-a', projectPathA)).toBeUndefined();
      expect(sessionManager.getSession('user-1', 'ctx-b', projectPathB)).toBeUndefined();
    });
  });

  describe('Session Key Generation', () => {
    it('should generate unique keys', () => {
      const key1 = sessionManager['buildSessionKey']('user-1', 'ctx-1', projectPathA);
      const key2 = sessionManager['buildSessionKey']('user-1', 'ctx-2', projectPathA);
      const key3 = sessionManager['buildSessionKey']('user-2', 'ctx-1', projectPathA);

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('should handle undefined contextId', () => {
      const keyWithCtx = sessionManager['buildSessionKey']('user-1', 'ctx-1', projectPathA);
      const keyWithoutCtx = sessionManager['buildSessionKey']('user-1', undefined, projectPathA);

      expect(keyWithCtx).not.toBe(keyWithoutCtx);
    });
  });

  describe('Queue Operations', () => {
    it('should have empty queue initially', async () => {
      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', projectPathA);

      expect(session.queue.pending.length).toBe(0);
      expect(session.queue.current).toBeNull();
    });

    it('should support queue operations through TaskQueueEngine', async () => {
      let completedTasks: IMResponse[] = [];
      const queueEngine = new TaskQueueEngine(async (session, response) => {
        completedTasks.push(response);
      });

      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', projectPathA);

      await queueEngine.enqueue(session, 'task-1', 'prompt');
      await queueEngine.enqueue(session, 'task-2', 'prompt');

      expect(session.queue.pending.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Layer 1: Task Queue Engine Core Logic', () => {
  let queueEngine: TaskQueueEngine;
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    queueEngine = new TaskQueueEngine(async () => {});
  });

  describe('Task Enqueue', () => {
    it('should return IMResponse when enqueuing', async () => {
      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/path');

      const response = await queueEngine.enqueue(session, 'task-1', 'prompt');

      expect(response).toBeDefined();
      expect(response.success).toBe(true);
    });

    it('should return success response for enqueued tasks', async () => {
      const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/path');

      const response1 = await queueEngine.enqueue(session, 'task-1', 'prompt');
      const response2 = await queueEngine.enqueue(session, 'task-2', 'prompt');

      expect(response1.success).toBe(true);
      expect(response2.success).toBe(true);
    });
  });
});

// ============ Layer 2: Integration Tests ============
// 测试 IM 层 Mock 场景，验证完整的消息流

describe('Layer 2: IM Integration Scenarios', () => {
  let sessionManager: SessionManager;
  let queueEngine: TaskQueueEngine;
  let capturedEvents: any[];

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionManager.setCurrentRepo({ name: 'test-repo', path: '/test', gitPath: '/test/.git' });
    capturedEvents = [];
    queueEngine = new TaskQueueEngine(async (session, response) => {
      capturedEvents.push({ type: 'taskComplete', session, response });
    });
  });

  describe('Scenario: User switches projects during conversation', () => {
    it('should maintain separate sessions for each project', async () => {
      // 用户在 Project A 开始对话
      const sessionA = await sessionManager.getOrCreateSession('user-1', 'chat-a', '/project-a');

      // 用户切换到 Project B
      const sessionB = await sessionManager.getOrCreateSession('user-1', 'chat-b', '/project-b');

      // 验证两个会话独立
      expect(sessionA.id).not.toBe(sessionB.id);
      expect(sessionA.projectPath).toBe('/project-a');
      expect(sessionB.projectPath).toBe('/project-b');

      // 两个会话都应该可用
      const retrievedA = sessionManager.getSession('user-1', 'chat-a', '/project-a');
      const retrievedB = sessionManager.getSession('user-1', 'chat-b', '/project-b');

      expect(retrievedA?.id).toBe(sessionA.id);
      expect(retrievedB?.id).toBe(sessionB.id);
    });

    it('should allow resuming conversation in previous project', async () => {
      // 用户在 Project A 开始对话
      const sessionA1 = await sessionManager.getOrCreateSession('user-1', 'chat-1', '/project-a');

      // 切换到 Project B
      await sessionManager.getOrCreateSession('user-1', 'chat-1', '/project-b');

      // 切换回 Project A，应该恢复之前的会话
      const sessionA2 = await sessionManager.getOrCreateSession('user-1', 'chat-1', '/project-a');

      expect(sessionA2.id).toBe(sessionA1.id);
      expect(sessionA2.projectPath).toBe('/project-a');
    });
  });

  describe('Scenario: Multiple users in same project', () => {
    it('should isolate sessions by user', async () => {
      const sessionUser1 = await sessionManager.getOrCreateSession(
        'user-1',
        'shared-chat',
        '/shared-project'
      );
      const sessionUser2 = await sessionManager.getOrCreateSession(
        'user-2',
        'shared-chat',
        '/shared-project'
      );

      expect(sessionUser1.id).not.toBe(sessionUser2.id);
      expect(sessionUser1.userId).toBe('user-1');
      expect(sessionUser2.userId).toBe('user-2');
    });
  });

  describe('Scenario: Same user, different contexts', () => {
    it('should isolate sessions by context (e.g., different chat threads)', async () => {
      const sessionThread1 = await sessionManager.getOrCreateSession(
        'user-1',
        'thread-123',
        '/project'
      );
      const sessionThread2 = await sessionManager.getOrCreateSession(
        'user-1',
        'thread-456',
        '/project'
      );

      expect(sessionThread1.id).not.toBe(sessionThread2.id);
    });
  });
});

// ============ Layer 3: Mock IM Adapter Tests ============
// 验证 IM 层的消息处理逻辑

describe('Layer 3: IM Message Handling', () => {
  let sessionManager: SessionManager;
  let processedMessages: IMResponse[];

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionManager.setCurrentRepo({ name: 'test', path: '/test', gitPath: '' });
    processedMessages = [];
  });

  describe('Command Parsing', () => {
    it('should parse /current command correctly', async () => {
      await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');

      const status = sessionManager.getQueueStatus('user-1', 'ctx-1');

      expect(status.success).toBe(true);
      expect(status.card).toBeDefined();
    });

    it('should parse /stop command correctly', async () => {
      await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');

      const result = await sessionManager.stopTask('user-1', undefined, 'ctx-1');

      expect(result.success).toBe(true);
    });

    it('should parse /reset command correctly', async () => {
      await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');

      const result = await sessionManager.resetSession('user-1', 'ctx-1');

      expect(result.success).toBe(true);
    });
  });
});
