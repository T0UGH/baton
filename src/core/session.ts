/**
 * 会话管理器
 * 管理用户会话生命周期，包括创建、查找、销毁和 ACP Agent 进程的启停
 * 提供用户隔离机制，确保每个用户有独立的执行环境和状态
 * 支持多仓库切换，每个仓库有独立的 session
 */
import type { Session, IMResponse, RepoInfo } from '../types';
import { ACPClient } from '../acp/client';
import { createLogger } from '../utils/logger';
import { EventEmitter } from 'node:events';
import type { RequestPermissionRequest, PermissionOption } from '@agentclientprotocol/sdk';
import { RepoManager } from './repo';

const logger = createLogger('SessionManager');

// 简单的 UUID 生成函数
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 内存存储，进程重启即重置
const sessions = new Map<string, Session>();

export class SessionManager extends EventEmitter {
  private projectPath: string;
  private permissionTimeout: number;
  private repoManager: RepoManager | null = null;
  private currentRepoInfo: RepoInfo | null = null;

  constructor(projectPath: string, permissionTimeoutSeconds: number = 300) {
    super();
    this.projectPath = projectPath;
    this.permissionTimeout = permissionTimeoutSeconds * 1000;
  }

  setRepoManager(repoManager: RepoManager): void {
    this.repoManager = repoManager;
  }

  setCurrentRepo(repoInfo: RepoInfo): void {
    this.currentRepoInfo = repoInfo;
    this.projectPath = repoInfo.path;
  }

  getCurrentRepo(): RepoInfo | null {
    return this.currentRepoInfo;
  }

  getRepoManager(): RepoManager | null {
    return this.repoManager;
  }

  private buildSessionKey(userId: string, contextId?: string): string {
    if (contextId) {
      return `${userId}:${contextId}:${this.projectPath}`;
    }
    return `${userId}:${this.projectPath}`;
  }

  async getOrCreateSession(userId: string, contextId?: string): Promise<Session> {
    const sessionKey = this.buildSessionKey(userId, contextId);

    if (!sessions.has(sessionKey)) {
      const session: Session = {
        id: generateUUID(),
        userId,
        projectPath: this.projectPath,
        repoName: this.currentRepoInfo?.name,
        acpClient: null,
        queue: {
          pending: [],
          current: null,
        },
        isProcessing: false,
        availableModes: [],
        availableModels: [],
        pendingInteractions: new Map(),
      };
      sessions.set(sessionKey, session);
      logger.info(`[Session] Created new session for user ${userId}`);
    }

    const session = sessions.get(sessionKey)!;

    // 确保 agent 进程已启动
    if (!session.acpClient) {
      logger.info(`[Session] Starting agent for session ${session.id}`);

      // 定义权限处理函数
      const permissionHandler = async (req: RequestPermissionRequest): Promise<string> => {
        return new Promise<string>((resolve, reject) => {
          const requestId = generateUUID(); // 生成本次请求的唯一 ID

          // 存入 pendingInteractions
          session.pendingInteractions.set(requestId, {
            type: 'permission',
            resolve,
            reject,
            timestamp: Date.now(),
            data: {
              title: req.toolCall.title ?? '权限请求',
              options: req.options.map(o => ({ optionId: o.optionId, name: o.name })),
              originalRequest: req,
            },
          });

          logger.info(
            { sessionId: session.id, requestId, tool: req.toolCall.title },
            'Permission requested, waiting for user...'
          );

          // 触发事件通知 IM 层
          this.emit('permissionRequest', {
            sessionId: session.id,
            requestId,
            userId: session.userId,
            request: req,
          });

          // 设置超时自动拒绝
          setTimeout(() => {
            if (session.pendingInteractions.has(requestId)) {
              const pending = session.pendingInteractions.get(requestId);
              // 默认拒绝：查找是否有 deny/cancel 选项，没有则选第一个
              const fallbackOption =
                req.options.find(
                  (o: PermissionOption) =>
                    o.name.toLowerCase().includes('deny') || o.name.toLowerCase().includes('cancel')
                )?.optionId ||
                req.options[0]?.optionId ||
                'deny';
              pending?.resolve(fallbackOption);
              session.pendingInteractions.delete(requestId);
              logger.warn({ sessionId: session.id, requestId }, 'Permission request timed out');
            }
          }, this.permissionTimeout);
        });
      };

      const acpClient = new ACPClient(this.projectPath, permissionHandler);
      await acpClient.startAgent();
      session.acpClient = acpClient;

      // 同步初始状态
      const modeState = acpClient.getModeState();
      const modelState = acpClient.getModelState();
      session.availableModes = modeState.availableModes;
      session.currentModeId = modeState.currentModeId;
      session.availableModels = modelState.availableModels;
      session.currentModelId = modelState.currentModelId;
    }

    return session;
  }

  // 处理权限确认结果
  resolveInteraction(sessionId: string, requestId: string, optionIdOrIndex: string): IMResponse {
    // 查找 session
    let session: Session | undefined;
    for (const s of sessions.values()) {
      if (s.id === sessionId) {
        session = s;
        break;
      }
    }

    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    const pending = session.pendingInteractions.get(requestId);
    if (!pending) {
      return { success: false, message: 'Permission request not found or expired' };
    }

    let finalOptionId = optionIdOrIndex;
    const options = pending.data.options;

    // 检查是否是序号
    const index = parseInt(optionIdOrIndex, 10);
    if (!isNaN(index) && index >= 0 && index < options.length) {
      finalOptionId = options[index].optionId;
    } else {
      // 检查 optionId 是否存在
      const exists = options.some(o => o.optionId === optionIdOrIndex);
      if (!exists) {
        return {
          success: false,
          message: `无效的选项: ${optionIdOrIndex}。可选: ${options.map(o => o.optionId).join(', ')} 或序号 0-${options.length - 1}`,
        };
      }
    }

    // 执行回调
    pending.resolve(finalOptionId);
    session.pendingInteractions.delete(requestId);

    logger.info({ sessionId, requestId, finalOptionId }, 'Interaction resolved by user');
    return { success: true, message: `已选择选项: ${finalOptionId}` };
  }

  // 创建仓库选择交互
  async createRepoSelection(
    userId: string,
    contextId: string | undefined,
    repos: { index: number; name: string; path: string }[]
  ): Promise<IMResponse> {
    const session = await this.getOrCreateSession(userId, contextId);

    // 检查是否已有待处理的交互
    if (session.pendingInteractions.size > 0) {
      return {
        success: false,
        message: '当前有待处理的选择，请先完成后再试',
      };
    }

    return new Promise(resolve => {
      const requestId = generateUUID();
      session.pendingInteractions.set(requestId, {
        type: 'repo_selection',
        resolve: async optionId => {
          const repoManager = this.getRepoManager();
          if (repoManager) {
            const targetRepo = repoManager.findRepo(optionId);
            if (targetRepo) {
              await this.resetAllSessions();
              this.setCurrentRepo(targetRepo);
              resolve({
                success: true,
                message: `🔄 已切换到仓库: ${targetRepo.name}`,
              });
            } else {
              resolve({ success: false, message: `未找到仓库: ${optionId}` });
            }
          } else {
            resolve({ success: false, message: '仓库管理器未初始化' });
          }
        },
        reject: () => resolve({ success: false, message: '已取消' }),
        timestamp: Date.now(),
        data: {
          title: '选择仓库',
          options: repos.map(r => ({ optionId: String(r.index), name: r.name })),
        },
      });

      this.emit('permissionRequest', {
        sessionId: session.id,
        requestId,
        userId: session.userId,
        request: {
          sessionId: session.id,
          toolCall: { title: '📦 选择仓库', toolCallId: 'repo_selection' },
          options: repos.map(r => ({
            optionId: String(r.index),
            name: `${r.name} (${r.path})`,
            kind: 'allow_once' as const,
          })),
        },
      });
    });
  }

  getSession(userId: string, contextId?: string): Session | undefined {
    const sessionKey = this.buildSessionKey(userId, contextId);
    return sessions.get(sessionKey);
  }

  getSessionById(sessionId: string): Session | undefined {
    for (const session of sessions.values()) {
      if (session.id === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  async resetSession(userId: string, contextId?: string): Promise<IMResponse> {
    const sessionKey = this.buildSessionKey(userId, contextId);
    const session = sessions.get(sessionKey);

    if (session?.acpClient) {
      await session.acpClient.stop();
    }

    sessions.delete(sessionKey);

    return {
      success: true,
      message: 'Session reset successfully. All context cleared.',
    };
  }

  getQueueStatus(userId: string, contextId?: string): IMResponse {
    const session = this.getSession(userId, contextId);
    if (!session) {
      return {
        success: true,
        message: 'No active session.',
      };
    }

    const queueInfo = {
      current: session.queue.current,
      pending: session.queue.pending,
      pendingCount: session.queue.pending.length,
      isProcessing: session.isProcessing,
    };

    return {
      success: true,
      message: `Queue status: ${queueInfo.pendingCount} pending, ${session.isProcessing ? 'processing' : 'idle'}`,
      data: queueInfo,
    };
  }

  async stopTask(userId: string, taskId?: string, contextId?: string): Promise<IMResponse> {
    const session = this.getSession(userId, contextId);
    if (!session) {
      return {
        success: false,
        message: 'No active session.',
      };
    }

    if (taskId === 'all') {
      // 停止当前任务并清空队列
      if (session.queue.current && session.acpClient) {
        await session.acpClient.cancelCurrentTask();
      }
      session.queue.pending = [];
      session.queue.current = null;
      session.isProcessing = false;

      return {
        success: true,
        message: 'All tasks stopped and queue cleared.',
      };
    }

    if (taskId) {
      // 移除指定任务
      const index = session.queue.pending.findIndex(t => t.id === taskId);
      if (index > -1) {
        session.queue.pending.splice(index, 1);
        return {
          success: true,
          message: `Task ${taskId} removed from queue.`,
        };
      }
      return {
        success: false,
        message: `Task ${taskId} not found in queue.`,
      };
    }

    // 默认停止当前任务
    if (session.queue.current && session.acpClient) {
      await session.acpClient.cancelCurrentTask();
      session.queue.current = null;
      session.isProcessing = false;

      return {
        success: true,
        message: 'Current task stopped.',
      };
    }

    return {
      success: true,
      message: 'No running task to stop.',
    };
  }

  // 触发模式选择
  async triggerModeSelection(userId: string, contextId?: string): Promise<IMResponse> {
    const session = await this.getOrCreateSession(userId, contextId);

    // 检查是否已有待处理的权限请求
    if (session.pendingInteractions.size > 0) {
      return {
        success: false,
        message: '当前已有待处理的权限请求，请先处理完当前请求再试',
      };
    }

    const state = session.acpClient?.getModeState();

    if (!state || state.availableModes.length === 0) {
      return { success: false, message: '当前 Agent 不支持模式切换' };
    }

    // 构建一个模拟的权限请求来复用选择逻辑
    const fakeReq: RequestPermissionRequest = {
      sessionId: session.id,
      toolCall: {
        title: `切换模式 (当前: ${state.currentModeId || '未知'})`,
        toolCallId: 'internal',
      },
      options: state.availableModes.map(m => ({
        optionId: m.id,
        name: m.name || m.id,
        kind: 'allow_once',
      })),
    };

    return new Promise(resolve => {
      const requestId = generateUUID();
      session.pendingInteractions.set(requestId, {
        type: 'mode_selection',
        resolve: async optionId => {
          if (session.acpClient) {
            const res = await session.acpClient.setMode(optionId);
            session.currentModeId = optionId;
            resolve(res);
          }
        },
        reject: () => resolve({ success: false, message: '已取消' }),
        timestamp: Date.now(),
        data: {
          title: fakeReq.toolCall.title ?? '选择',
          options: fakeReq.options.map(o => ({ optionId: o.optionId, name: o.name })),
        },
      });

      this.emit('permissionRequest', {
        sessionId: session.id,
        requestId,
        userId: session.userId,
        request: fakeReq,
      });
    });
  }

  // 触发模型选择
  async triggerModelSelection(userId: string, contextId?: string): Promise<IMResponse> {
    const session = await this.getOrCreateSession(userId, contextId);

    // 检查是否已有待处理的权限请求
    if (session.pendingInteractions.size > 0) {
      return {
        success: false,
        message: '当前已有待处理的权限请求，请先处理完当前请求再试',
      };
    }

    const state = session.acpClient?.getModelState();

    if (!state || state.availableModels.length === 0) {
      return { success: false, message: '当前 Agent 不支持模型切换' };
    }

    // 构建一个模拟的权限请求来复用选择逻辑
    const fakeReq: RequestPermissionRequest = {
      sessionId: session.id,
      toolCall: {
        title: `切换模型 (当前: ${state.currentModelId || '未知'})`,
        toolCallId: 'internal',
      },
      options: state.availableModels.map(m => ({
        optionId: m.modelId,
        name: m.name || m.modelId,
        kind: 'allow_once',
      })),
    };

    return new Promise(resolve => {
      const requestId = generateUUID();
      session.pendingInteractions.set(requestId, {
        type: 'model_selection',
        resolve: async optionId => {
          if (session.acpClient) {
            const res = await session.acpClient.setModel(optionId);
            session.currentModelId = optionId;
            resolve(res);
          }
        },
        reject: () => resolve({ success: false, message: '已取消' }),
        timestamp: Date.now(),
        data: {
          title: fakeReq.toolCall.title ?? '选择',
          options: fakeReq.options.map(o => ({ optionId: o.optionId, name: o.name })),
        },
      });

      this.emit('permissionRequest', {
        sessionId: session.id,
        requestId,
        userId: session.userId,
        request: fakeReq,
      });
    });
  }

  async resetAllSessions(): Promise<void> {
    for (const session of sessions.values()) {
      if (session.acpClient) {
        await session.acpClient.stop();
      }
    }
    sessions.clear();
    logger.info('[Session] All sessions reset');
  }
}
