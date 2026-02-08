/**
 * Baton 单元测试
 * 使用 Node.js 内置测试框架测试核心功能
 * 包括指令解析、任务队列、会话管理等
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CommandDispatcher } from '../src/core/dispatcher';
import { SessionManager } from '../src/core/session';
import { TaskQueueEngine } from '../src/core/queue';
import type { IMMessage } from '../src/types';

// Mock Feishu Client - 直接在单测中模拟 IM 消息
class MockFeishuClient {
  private dispatcher: CommandDispatcher;
  private userId: string = 'test-user-001';
  private userName: string = 'Test User';

  constructor(projectPath: string) {
    const sessionManager = new SessionManager(projectPath);
    const queueEngine = new TaskQueueEngine();
    this.dispatcher = new CommandDispatcher(sessionManager, queueEngine);
  }

  async sendMessage(text: string): Promise<any> {
    const message: IMMessage = {
      userId: this.userId,
      userName: this.userName,
      text,
      timestamp: Date.now()
    };

    return await this.dispatcher.dispatch(message);
  }
}

describe('Baton MVP Tests', () => {
  let mockClient: MockFeishuClient;
  const testProjectPath = process.cwd();

  beforeEach(() => {
    mockClient = new MockFeishuClient(testProjectPath);
  });

  describe('Command Parser', () => {
    it('should parse /help command', async () => {
      const response = await mockClient.sendMessage('/help');
      assert.strictEqual(response.success, true);
      assert.ok(response.message.includes('Baton'));
    });

    it('should parse /current command', async () => {
      const response = await mockClient.sendMessage('/current');
      assert.strictEqual(response.success, true);
    });

    it('should parse /reset command', async () => {
      const response = await mockClient.sendMessage('/reset');
      assert.strictEqual(response.success, true);
    });

    it('should parse /stop command', async () => {
      const response = await mockClient.sendMessage('/stop');
      assert.strictEqual(response.success, true);
    });

    it('should treat regular text as prompt', async () => {
      const response = await mockClient.sendMessage('Hello, this is a test prompt');
      assert.strictEqual(response.success, true);
    });
  });

  describe('Task Queue', () => {
    it('should queue multiple tasks', async () => {
      const response1 = await mockClient.sendMessage('First task');
      const response2 = await mockClient.sendMessage('Second task');

      assert.strictEqual(response1.success, true);
      assert.strictEqual(response2.success, true);
    });

    it('should show queue status', async () => {
      await mockClient.sendMessage('Test task');
      const status = await mockClient.sendMessage('/current');
      
      assert.strictEqual(status.success, true);
    });
  });

  describe('Session Management', () => {
    it('should create session on first message', async () => {
      const sessionManager = new SessionManager(testProjectPath);
      
      const initial = sessionManager.getSession('new-user');
      assert.strictEqual(initial, undefined);

      const response = await mockClient.sendMessage('Hello');
      assert.strictEqual(response.success, true);
    });

    it('should reset session', async () => {
      await mockClient.sendMessage('Create session');
      
      const reset = await mockClient.sendMessage('/reset');
      assert.strictEqual(reset.success, true);
    });
  });

  describe('Mock Feishu Scenarios', () => {
    it('should simulate multi-user interaction', async () => {
      const user1 = new MockFeishuClient(testProjectPath);
      const user2 = new MockFeishuClient(testProjectPath);

      const res1 = await user1.sendMessage('User 1 message');
      const res2 = await user2.sendMessage('User 2 message');

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.success, true);
    });
  });
});