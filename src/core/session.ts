/**
 * 会话管理器
 * 管理用户会话生命周期，包括创建、查找、销毁和 ACP Agent 进程的启停
 * 提供用户隔离机制，确保每个用户有独立的执行环境和状态
 */
import type { Session, IMResponse } from '../types';
import { ACPClient } from '../acp/client';
import { createLogger } from '../utils/logger';
import { EventEmitter } from 'node:events';
import type { RequestPermissionRequest, PermissionOption } from '@agentclientprotocol/sdk';

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
  private permissionTimeout: number; // 毫秒

  constructor(projectPath: string, permissionTimeoutSeconds: number = 300) {
    super();
    this.projectPath = projectPath;
    this.permissionTimeout = permissionTimeoutSeconds * 1000;
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

          // 存入 pendingPermissions
          session.pendingPermissions.set(requestId, {
            resolve,
            reject,
            timestamp: Date.now(),
            request: req,
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
            if (session.pendingPermissions.has(requestId)) {
              const pending = session.pendingPermissions.get(requestId);
              // 默认拒绝：查找是否有 deny/cancel 选项，没有则选第一个
              const fallbackOption =
                req.options.find(
                  (o: PermissionOption) =>
                    o.name.toLowerCase().includes('deny') || o.name.toLowerCase().includes('cancel')
                )?.optionId ||
                req.options[0]?.optionId ||
                'deny';
              pending?.resolve(fallbackOption);
              session.pendingPermissions.delete(requestId);
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
  resolvePermission(sessionId: string, requestId: string, optionIdOrIndex: string): IMResponse {
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

    const pending = session.pendingPermissions.get(requestId);
    if (!pending) {
      return { success: false, message: 'Permission request not found or expired' };
    }

    let finalOptionId = optionIdOrIndex;
    const options = pending.request.options;

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
    session.pendingPermissions.delete(requestId);

    logger.info({ sessionId, requestId, finalOptionId }, 'Permission resolved by user');
    return { success: true, message: `已选择选项: ${finalOptionId}` };
  }

  getSession(userId: string, contextId?: string): Session | undefined {
    const sessionKey = this.buildSessionKey(userId, contextId);
    return sessions.get(sessionKey);
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
    if (session.pendingPermissions.size > 0) {
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
      session.pendingPermissions.set(requestId, {
        resolve: async optionId => {
          if (session.acpClient) {
            const res = await session.acpClient.setMode(optionId);
            session.currentModeId = optionId;
            resolve(res);
          }
        },
        reject: () => resolve({ success: false, message: '已取消' }),
        timestamp: Date.now(),
        request: fakeReq,
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
    if (session.pendingPermissions.size > 0) {
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
      session.pendingPermissions.set(requestId, {
        resolve: async optionId => {
          if (session.acpClient) {
            const res = await session.acpClient.setModel(optionId);
            session.currentModelId = optionId;
            resolve(res);
          }
        },
        reject: () => resolve({ success: false, message: '已取消' }),
        timestamp: Date.now(),
        request: fakeReq,
      });

      this.emit('permissionRequest', {
        sessionId: session.id,
        requestId,
        userId: session.userId,
        request: fakeReq,
      });
    });
  }
}
