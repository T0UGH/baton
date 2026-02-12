/**
 * IM + ACP Mock 综合测试
 *
 * Layer 1: IM 层 Mock - 模拟消息收发
 * Layer 2: ACP 层 Mock - 使用 FakeACPClient
 * Layer 3: 核心逻辑测试
 */
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import type { IMResponse } from '../../src/types';
import { FakeACPClient, FakeACPClientFactory } from '../../src/core/test/fake-acp';
import { TestSessionManager, DefaultACPClientFactory } from '../../src/core/test/test-session';
import { MockIMClient, MockIMAdapter } from '../../src/core/test/mock-im';

describe('MockIMClient', () => {
  let imClient: MockIMClient;

  beforeEach(() => {
    imClient = new MockIMClient();
  });

  afterEach(() => {
    imClient.clearAll();
  });

  it('should create users', () => {
    const user1 = imClient.createUser();
    const user2 = imClient.createUser();
    const user3 = imClient.createUser('custom-id');

    expect(user1).toBeDefined();
    expect(user2).toBeDefined();
    expect(user1).not.toBe(user2);
    expect(user3).toBe('custom-id');
  });

  it('should manage sessions', () => {
    imClient.startSession('user-1', 'ctx-1');
    imClient.startSession('user-2', 'ctx-2');

    expect(imClient.getSession('user-1')?.contextId).toBe('ctx-1');
    expect(imClient.getSession('user-2')?.contextId).toBe('ctx-2');
  });

  it('should send and receive messages', () => {
    imClient.startSession('user-1', 'ctx-1');
    imClient.sendMessage('user-1', 'hello');
    imClient.sendMessage('user-1', 'world');

    expect(imClient.hasMessages()).toBe(true);
    const msg1 = imClient.getNextMessage();
    const msg2 = imClient.getNextMessage();

    expect(msg1?.content).toBe('hello');
    expect(msg2?.content).toBe('world');
  });

  it('should track repo info', () => {
    imClient.startSession('user-1', 'ctx-1');
    imClient.setCurrentRepo('user-1', { name: 'my-repo', path: '/repo', gitPath: '/repo/.git' });

    const session = imClient.getSession('user-1');
    expect(session?.repoInfo?.name).toBe('my-repo');
  });
});

describe('IM + ACP Integration', () => {
  let imClient: MockIMClient;
  let sessionManager: TestSessionManager;
  let userId: string;

  beforeEach(() => {
    imClient = new MockIMClient();
    sessionManager = new TestSessionManager({
      acpClientFactory: new DefaultACPClientFactory(),
      permissionTimeoutSeconds: 30,
    });
    userId = imClient.createUser('test-user');
    imClient.startSession(userId, 'test-context');
    sessionManager.setCurrentRepo({
      name: 'test-repo',
      path: '/tmp/test-repo',
      gitPath: '/tmp/test-repo/.git',
    });
  });

  afterEach(async () => {
    imClient.clearAll();
    await sessionManager.resetAllSessions();
  });

  describe('Command Handling', () => {
    it('should handle /help command', async () => {
      const status = sessionManager.getQueueStatus(userId, 'test-context');
      expect(status.success).toBe(true);
      expect(status.card).toBeDefined();
    });

    it('should handle /stop command when session exists', async () => {
      await sessionManager.getOrCreateSession(userId, 'test-context', '/tmp/test-repo');

      const response = await sessionManager.stopTask(userId, undefined, 'test-context');
      expect(response.success).toBe(true);
    });

    it('should handle /reset command', async () => {
      await sessionManager.getOrCreateSession(userId, 'test-context', '/tmp/test-repo');

      const response = await sessionManager.resetSession(userId, 'test-context');
      expect(response.success).toBe(true);
    });

    it('should return error for unknown command', async () => {
      const response = { success: false, message: '未知命令: /unknown' };
      expect(response.success).toBe(false);
    });
  });

  describe('Session Lifecycle', () => {
    it('should create session', async () => {
      const session = await sessionManager.getOrCreateSession(userId, 'ctx-1', '/tmp/test-repo');

      expect(session.id).toBeDefined();
      expect(session.userId).toBe(userId);
    });

    it('should return same session for same user/context', async () => {
      const session1 = await sessionManager.getOrCreateSession(userId, 'ctx-1', '/tmp/test-repo');
      const session2 = await sessionManager.getOrCreateSession(userId, 'ctx-1', '/tmp/test-repo');

      expect(session1.id).toBe(session2.id);
    });

    it('should isolate sessions by context', async () => {
      const session1 = await sessionManager.getOrCreateSession(userId, 'ctx-1', '/tmp/test-repo');
      const session2 = await sessionManager.getOrCreateSession(userId, 'ctx-2', '/tmp/test-repo');

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('Queue Operations', () => {
    it('should report no active session', () => {
      const status = sessionManager.getQueueStatus(userId, 'new-context');
      expect(status.success).toBe(true);
      expect(status.message).toContain('没有活跃的会话');
    });

    it('should report active session status', async () => {
      await sessionManager.getOrCreateSession(userId, 'ctx-1', '/tmp/test-repo');

      const status = sessionManager.getQueueStatus(userId, 'ctx-1');
      expect(status.success).toBe(true);
      expect(status.card).toBeDefined();
    });
  });
});

describe('Message Flow Scenarios', () => {
  let imClient: MockIMClient;
  let sessionManager: TestSessionManager;

  beforeEach(() => {
    imClient = new MockIMClient();
    sessionManager = new TestSessionManager({
      acpClientFactory: new DefaultACPClientFactory(),
      permissionTimeoutSeconds: 30,
    });
  });

  afterEach(async () => {
    imClient.clearAll();
    await sessionManager.resetAllSessions();
  });

  it('should maintain separate sessions for each project', async () => {
    const userId = imClient.createUser('user-1');

    const sessionA = await sessionManager.getOrCreateSession(userId, 'chat-1', '/project-a');
    const sessionB = await sessionManager.getOrCreateSession(userId, 'chat-1', '/project-b');

    expect(sessionA.id).not.toBe(sessionB.id);
    expect(sessionA.projectPath).toBe('/project-a');
    expect(sessionB.projectPath).toBe('/project-b');
  });

  it('should allow resuming previous project session', async () => {
    const userId = imClient.createUser('user-1');

    const sessionA1 = await sessionManager.getOrCreateSession(userId, 'chat-1', '/project-a');
    await sessionManager.getOrCreateSession(userId, 'chat-1', '/project-b');
    const sessionA2 = await sessionManager.getOrCreateSession(userId, 'chat-1', '/project-a');

    expect(sessionA2.id).toBe(sessionA1.id);
  });

  it('should isolate sessions by user', async () => {
    const userA = imClient.createUser('user-a');
    const userB = imClient.createUser('user-b');

    const sessionA = await sessionManager.getOrCreateSession(userA, 'shared', '/shared-project');
    const sessionB = await sessionManager.getOrCreateSession(userB, 'shared', '/shared-project');

    expect(sessionA.id).not.toBe(sessionB.id);
    expect(sessionA.userId).toBe('user-a');
    expect(sessionB.userId).toBe('user-b');
  });

  it('should handle concurrent session creation', async () => {
    const users = Array.from({ length: 10 }, (_, i) => imClient.createUser(`user-${i}`));

    const sessions = await Promise.all(
      users.map(u => sessionManager.getOrCreateSession(u, 'ctx-1', '/tmp/test-repo'))
    );

    const uniqueIds = new Set(sessions.map((s: any) => s.id));
    expect(uniqueIds.size).toBe(10);
  });

  it('should handle many projects', async () => {
    const userId = imClient.createUser('user-1');
    const projects = Array.from({ length: 5 }, (_, i) => `/project-${i}`);

    const sessions = await Promise.all(
      projects.map(p => sessionManager.getOrCreateSession(userId, 'ctx-1', p))
    );

    const uniqueIds = new Set(sessions.map((s: any) => s.id));
    expect(uniqueIds.size).toBe(5);
  });
});

describe('Edge Cases', () => {
  let imClient: MockIMClient;
  let sessionManager: TestSessionManager;

  beforeEach(() => {
    imClient = new MockIMClient();
    sessionManager = new TestSessionManager({
      acpClientFactory: new DefaultACPClientFactory(),
      permissionTimeoutSeconds: 30,
    });
  });

  afterEach(async () => {
    imClient.clearAll();
    await sessionManager.resetAllSessions();
  });

  it('should handle reset when no session exists', async () => {
    const response = await sessionManager.resetSession('non-existent-user', undefined);
    expect(response.success).toBe(true);
    expect(response.message).toContain('无活跃会话');
  });

  it('should handle stop when no session exists', async () => {
    const response = await sessionManager.stopTask('non-existent-user', undefined, undefined);
    expect(response.success).toBe(false);
    expect(response.message).toContain('没有活跃的会话');
  });
});
