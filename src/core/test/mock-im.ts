/**
 * MockIMClient - 模拟 IM 层的消息收发
 *
 * 用于测试 Baton 核心逻辑，隔离真实的 IM 平台（飞书、企业微信等）
 */
import type { IMResponse, RepoInfo } from '../../types';

export interface IMMessage {
  userId: string;
  contextId?: string;
  content: string;
  timestamp: number;
}

export interface IMSession {
  userId: string;
  contextId?: string;
  repoInfo?: RepoInfo;
}

export type MessageHandler = (response: IMResponse) => void;

export class MockIMClient {
  private sessions: Map<string, IMSession> = new Map();
  private handlers: Map<string, MessageHandler[]> = new Map();
  private messageQueue: IMMessage[] = [];
  private userCounter = 0;

  createUser(userId?: string): string {
    const id = userId || `mock-user-${++this.userCounter}`;
    return id;
  }

  startSession(userId: string, contextId?: string): void {
    this.sessions.set(userId, { userId, contextId });
  }

  endSession(userId: string): void {
    this.sessions.delete(userId);
  }

  setCurrentRepo(userId: string, repoInfo: RepoInfo): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.repoInfo = repoInfo;
    }
  }

  sendMessage(userId: string, content: string): void {
    const session = this.sessions.get(userId);
    if (!session) {
      throw new Error(`Session not found for user: ${userId}`);
    }
    this.messageQueue.push({
      userId,
      contextId: session.contextId,
      content,
      timestamp: Date.now(),
    });
  }

  onResponse(userId: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(userId) || [];
    handlers.push(handler);
    this.handlers.set(userId, handlers);
  }

  clearMessages(): void {
    this.messageQueue = [];
  }

  clearHandlers(): void {
    this.handlers.clear();
  }

  clearAll(): void {
    this.sessions.clear();
    this.messageQueue = [];
    this.handlers.clear();
  }

  getNextMessage(): IMMessage | undefined {
    return this.messageQueue.shift();
  }

  hasMessages(): boolean {
    return this.messageQueue.length > 0;
  }

  getSession(userId: string): IMSession | undefined {
    return this.sessions.get(userId);
  }

  getAllSessions(): IMSession[] {
    return Array.from(this.sessions.values());
  }
}

export class MockIMAdapter {
  private imClient: MockIMClient;
  private handlers: Map<string, (content: string) => Promise<IMResponse>> = new Map();
  private onDisconnect?: (userId: string) => void;

  constructor(imClient: MockIMClient) {
    this.imClient = imClient;
  }

  setHandler(userId: string, handler: (content: string) => Promise<IMResponse>): void {
    this.handlers.set(userId, handler);
  }

  setDisconnectHandler(handler: (userId: string) => void): void {
    this.onDisconnect = handler;
  }

  async processNextMessage(): Promise<boolean> {
    const msg = this.imClient.getNextMessage();
    if (!msg) return false;

    const handler = this.handlers.get(msg.userId);
    if (!handler) {
      console.warn(`[MockIM] No handler for user: ${msg.userId}`);
      return true;
    }

    const response = await handler(msg.content);
    this.sendResponse(msg.userId, response);
    return true;
  }

  async processAllMessages(): Promise<void> {
    while (this.imClient.hasMessages()) {
      await this.processNextMessage();
    }
  }

  private sendResponse(userId: string, response: IMResponse): void {
    const handlers = this.imClient['handlers']?.get(userId);
    if (handlers) {
      handlers.forEach(h => h(response));
    }
  }

  disconnectUser(userId: string): void {
    this.onDisconnect?.(userId);
    this.imClient.endSession(userId);
    this.handlers.delete(userId);
  }

  disconnectAll(): void {
    this.imClient.getAllSessions().forEach(s => {
      this.disconnectUser(s.userId);
    });
  }
}

export function createTestDispatcher(
  sessionManager: any,
  getProjectPath: (userId: string) => string
): (content: string) => Promise<IMResponse> {
  return async (content: string): Promise<IMResponse> => {
    if (content.startsWith('/')) {
      const [cmd, ...args] = content.slice(1).split(' ');
      switch (cmd) {
        case 'help':
          return { success: true, message: '帮助信息...' };
        case 'current':
          return sessionManager.getQueueStatus('user-1', undefined);
        case 'stop':
          return await sessionManager.stopTask('user-1', undefined, undefined);
        case 'reset':
          return await sessionManager.resetSession('user-1', undefined);
        case 'mode':
          return { success: true, message: `切换到模式: ${args[0] || 'unknown'}` };
        default:
          return { success: false, message: `未知命令: /${cmd}` };
      }
    }
    return { success: false, message: '普通消息需要通过任务队列处理' };
  };
}
