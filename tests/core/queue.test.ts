/**
 * 队列引擎单元测试
 * 测试队列的竞态条件防护、任务状态管理等
 */
import { describe, it, beforeEach, expect, mock } from 'bun:test';
import { TaskQueueEngine } from '../../src/core/queue';
import type { Session, IMResponse } from '../../src/types';

describe('TaskQueueEngine', () => {
  let queueEngine: TaskQueueEngine;
  let capturedResponses: IMResponse[];
  const testProjectPath = process.cwd();

  function createMockSession(userId: string = 'test-user'): Session {
    return {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      projectPath: testProjectPath,
      acpClient: null,
      queue: {
        pending: [],
        current: null,
      },
      isProcessing: false,
      availableModes: [],
      availableModels: [],
      pendingPermissions: new Map(),
    };
  }

  beforeEach(() => {
    capturedResponses = [];
    queueEngine = new TaskQueueEngine(async (session, response) => {
      capturedResponses.push(response);
    });
  });

  describe('Basic Queue Operations', () => {
    it('should execute immediately when queue is empty', async () => {
      const session = createMockSession();

      const result = await queueEngine.enqueue(session, 'Immediate task', 'prompt');

      expect(result.success).toBe(true);
      expect(result.message).toBe('');
      expect(result.data).toBeUndefined();
    });

    it('should return taskId when task is queued (not immediate)', async () => {
      const session = createMockSession();

      const mockSendPrompt = mock(async (content: string) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, message: `Processed: ${content}` };
      });

      session.acpClient = {
        sendPrompt: mockSendPrompt,
        sendCommand: async () => ({ success: true, message: '' }),
        startAgent: async () => {},
        stop: async () => {},
        getModeState: () => ({ availableModes: [], currentModeId: undefined }),
        getModelState: () => ({ availableModels: [], currentModelId: undefined }),
        setMode: async () => ({ success: true, message: '' }),
        setModel: async () => ({ success: true, message: '' }),
        cancelCurrentTask: async () => {},
      } as any;

      const result1 = await queueEngine.enqueue(session, 'First task', 'prompt');
      const result2 = await queueEngine.enqueue(session, 'Second task', 'prompt');

      expect(result1.success).toBe(true);
      expect(result1.data?.taskId).toBeUndefined();
      expect(result2.data?.taskId).toBeDefined();
      expect(result2.data?.position).toBe(1);
      expect(session.queue.pending.length).toBe(1);
    });
  });

  describe('Concurrent Access Protection', () => {
    it('should handle concurrent enqueue calls safely', async () => {
      const session = createMockSession();

      const results = await Promise.all([
        queueEngine.enqueue(session, 'Concurrent 1', 'prompt'),
        queueEngine.enqueue(session, 'Concurrent 2', 'prompt'),
        queueEngine.enqueue(session, 'Concurrent 3', 'prompt'),
      ]);

      expect(results.every(r => r.success)).toBe(true);
    });

    it('should create unique task IDs for queued tasks', async () => {
      const session = createMockSession();

      const mockSendPrompt = mock(async (content: string) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, message: `Processed: ${content}` };
      });

      session.acpClient = {
        sendPrompt: mockSendPrompt,
        sendCommand: async () => ({ success: true, message: '' }),
        startAgent: async () => {},
        stop: async () => {},
        getModeState: () => ({ availableModes: [], currentModeId: undefined }),
        getModelState: () => ({ availableModels: [], currentModelId: undefined }),
        setMode: async () => ({ success: true, message: '' }),
        setModel: async () => ({ success: true, message: '' }),
        cancelCurrentTask: async () => {},
      } as any;

      await queueEngine.enqueue(session, 'First task', 'prompt');
      const task2 = await queueEngine.enqueue(session, 'Task 2', 'prompt');
      const task3 = await queueEngine.enqueue(session, 'Task 3', 'prompt');

      expect(task2.data?.taskId).toBeDefined();
      expect(task3.data?.taskId).toBeDefined();
      expect(task2.data?.taskId).not.toBe(task3.data?.taskId);
    });
  });

  describe('Session Isolation', () => {
    it('should maintain separate queues for different sessions', async () => {
      const session1 = createMockSession('user-1');
      const session2 = createMockSession('user-2');

      await queueEngine.enqueue(session1, 'User1 Task 1', 'prompt');
      await queueEngine.enqueue(session2, 'User2 Task 1', 'prompt');
      await queueEngine.enqueue(session1, 'User1 Task 2', 'prompt');

      expect(session1.queue.pending.length).toBe(1);
      expect(session2.queue.pending.length).toBe(0);
    });

    it('should have independent processing state per session', async () => {
      const session1 = createMockSession('user-a');
      const session2 = createMockSession('user-b');

      await queueEngine.enqueue(session1, 'Session1 task', 'prompt');
      await queueEngine.enqueue(session2, 'Session2 task', 'prompt');

      expect(session1.isProcessing).toBe(true);
      expect(session2.isProcessing).toBe(true);
    });
  });

  describe('Task Type Handling', () => {
    it('should handle prompt tasks', async () => {
      const session = createMockSession();
      const mockSendPrompt = mock(async (content: string) => ({
        success: true,
        message: `Processed: ${content}`,
      }));

      session.acpClient = {
        sendPrompt: mockSendPrompt,
        sendCommand: async () => ({ success: true, message: '' }),
        startAgent: async () => {},
        stop: async () => {},
        getModeState: () => ({ availableModes: [], currentModeId: undefined }),
        getModelState: () => ({ availableModels: [], currentModelId: undefined }),
        setMode: async () => ({ success: true, message: '' }),
        setModel: async () => ({ success: true, message: '' }),
        cancelCurrentTask: async () => {},
      } as any;

      const result = await queueEngine.enqueue(session, 'Test prompt', 'prompt');

      expect(result.success).toBe(true);
    });

    it('should handle command tasks', async () => {
      const session = createMockSession();
      const mockSendCommand = mock(async (content: string) => ({
        success: true,
        message: `Command result: ${content}`,
      }));

      session.acpClient = {
        sendPrompt: async () => ({ success: true, message: '' }),
        sendCommand: mockSendCommand,
        startAgent: async () => {},
        stop: async () => {},
        getModeState: () => ({ availableModes: [], currentModeId: undefined }),
        getModelState: () => ({ availableModels: [], currentModelId: undefined }),
        setMode: async () => ({ success: true, message: '' }),
        setModel: async () => ({ success: true, message: '' }),
        cancelCurrentTask: async () => {},
      } as any;

      const result = await queueEngine.enqueue(session, '/test', 'command');

      expect(result.success).toBe(true);
    });
  });
});
