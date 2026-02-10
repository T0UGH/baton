// 交互上下文和状态管理
// 支持多轮对话、权限请求、用户确认等复杂场景

import type { IMAdapter } from './adapter';
import type { IMMessage } from '../types';

/**
 * 交互状态
 */
export enum InteractionState {
  IDLE = 'idle', // 空闲状态
  PROCESSING = 'processing', // 处理中
  WAITING_CONFIRM = 'waiting_confirm', // 等待用户确认
  PAUSED = 'paused', // 暂停（等待用户输入）
}

/**
 * 交互类型
 */
export enum InteractionType {
  NORMAL = 'normal', // 普通对话
  PERMISSION_REQUEST = 'permission_request', // 权限请求
  CLARIFICATION = 'clarification', // 需要澄清
  CONFIRMATION = 'confirmation', // 确认操作
}

/**
 * 交互上下文
 * 跟踪一次完整的交互流程
 */
export interface InteractionContext {
  // 唯一标识
  id: string;
  // 关联的会话ID
  sessionId: string;
  // 关联的用户ID
  userId: string;
  // 关联的聊天ID
  chatId: string;
  // 当前状态
  state: InteractionState;
  // 交互类型
  type: InteractionType;
  // 原始消息
  originalMessage: IMMessage;
  // 创建时间
  createdAt: number;
  // 最后更新时间
  updatedAt: number;
  // 自定义数据（用于保存上下文）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  // 恢复函数（当用户响应时调用）
  resume?: (userResponse: UserResponse) => Promise<void>;
  // 超时时间（毫秒）
  timeout?: number;
  // 超时处理函数
  onTimeout?: () => Promise<void>;
}

/**
 * 用户响应
 */
export interface UserResponse {
  // 响应类型
  type: 'confirm' | 'deny' | 'text' | 'cancel';
  // 响应内容
  content?: string;
  // 关联的交互ID
  interactionId: string;
  // 时间戳
  timestamp: number;
  // 额外数据
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
}

/**
 * 权限请求选项
 */
export interface PermissionRequest {
  // 权限类型
  permissionType: string;
  // 标题
  title: string;
  // 详细描述
  description: string;
  // 风险等级
  riskLevel: 'low' | 'medium' | 'high';
  // 请求的操作
  operation: string;
  // 超时时间（秒）
  timeout?: number;
}

/**
 * 交互管理器接口
 */
export interface IInteractionManager {
  /**
   * 创建新的交互上下文
   */
  createContext(
    sessionId: string,
    userId: string,
    chatId: string,
    message: IMMessage,
    type?: InteractionType
  ): InteractionContext;

  /**
   * 获取交互上下文
   */
  getContext(interactionId: string): InteractionContext | undefined;

  /**
   * 更新交互状态
   */
  updateState(
    interactionId: string,
    state: InteractionState,
    metadata?: Record<string, unknown>
  ): void;

  /**
   * 注册恢复函数
   */
  registerResume(
    interactionId: string,
    resume: (response: UserResponse) => Promise<void>,
    timeout?: number,
    onTimeout?: () => Promise<void>
  ): void;

  /**
   * 处理用户响应
   */
  handleUserResponse(interactionId: string, response: UserResponse): Promise<void>;

  /**
   * 结束交互
   */
  endContext(interactionId: string): void;

  /**
   * 请求用户确认/权限
   */
  requestPermission(context: InteractionContext, request: PermissionRequest): Promise<UserResponse>;
}

/**
 * 交互管理器实现
 */
export class InteractionManager implements IInteractionManager {
  private contexts: Map<string, InteractionContext> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private imAdapter: IMAdapter;

  constructor(imAdapter: IMAdapter) {
    this.imAdapter = imAdapter;
  }

  createContext(
    sessionId: string,
    userId: string,
    chatId: string,
    message: IMMessage,
    type: InteractionType = InteractionType.NORMAL
  ): InteractionContext {
    const id = this.generateId();
    const context: InteractionContext = {
      id,
      sessionId,
      userId,
      chatId,
      state: InteractionState.IDLE,
      type,
      originalMessage: message,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };

    this.contexts.set(id, context);
    return context;
  }

  getContext(interactionId: string): InteractionContext | undefined {
    return this.contexts.get(interactionId);
  }

  updateState(
    interactionId: string,
    state: InteractionState,
    metadata?: Record<string, unknown>
  ): void {
    const context = this.contexts.get(interactionId);
    if (context) {
      context.state = state;
      context.updatedAt = Date.now();
      if (metadata) {
        Object.assign(context.metadata, metadata);
      }
    }
  }

  registerResume(
    interactionId: string,
    resume: (response: UserResponse) => Promise<void>,
    timeout?: number,
    onTimeout?: () => Promise<void>
  ): void {
    const context = this.contexts.get(interactionId);
    if (!context) return;

    context.resume = resume;
    context.timeout = timeout;
    context.onTimeout = onTimeout;

    // 设置超时
    if (timeout && timeout > 0) {
      const timeoutId = setTimeout(async () => {
        if (onTimeout) {
          await onTimeout();
        }
        this.endContext(interactionId);
      }, timeout);

      this.timeouts.set(interactionId, timeoutId);
    }
  }

  async handleUserResponse(interactionId: string, response: UserResponse): Promise<void> {
    const context = this.contexts.get(interactionId);
    if (!context) {
      console.warn(`[InteractionManager] Context not found: ${interactionId}`);
      return;
    }

    // 清除超时
    const timeoutId = this.timeouts.get(interactionId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(interactionId);
    }

    // 调用恢复函数
    if (context.resume) {
      await context.resume(response);
    }

    // 如果不是需要继续等待的状态，结束交互
    if (context.state !== InteractionState.WAITING_CONFIRM) {
      this.endContext(interactionId);
    }
  }

  endContext(interactionId: string): void {
    // 清除超时
    const timeoutId = this.timeouts.get(interactionId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(interactionId);
    }

    this.contexts.delete(interactionId);
  }

  async requestPermission(
    context: InteractionContext,
    request: PermissionRequest
  ): Promise<UserResponse> {
    return new Promise(resolve => {
      // 更新状态为等待确认
      this.updateState(context.id, InteractionState.WAITING_CONFIRM, {
        permissionRequest: request,
      });

      // 发送权限请求消息给用户
      this.sendPermissionRequest(context, request);

      // 注册恢复函数
      this.registerResume(
        context.id,
        async (response: UserResponse) => {
          resolve(response);
        },
        (request.timeout || 300) * 1000, // 默认5分钟超时
        async () => {
          // 超时处理
          await this.imAdapter.sendMessage(context.chatId, {
            text: `⏰ 权限请求已超时（${request.timeout || 300}秒），操作已取消。`,
          });
          resolve({
            type: 'cancel',
            interactionId: context.id,
            timestamp: Date.now(),
          });
        }
      );
    });
  }

  private async sendPermissionRequest(
    context: InteractionContext,
    request: PermissionRequest
  ): Promise<void> {
    const emoji =
      request.riskLevel === 'high' ? '⚠️' : request.riskLevel === 'medium' ? '⚡' : 'ℹ️';

    const message = `
${emoji} **权限请求**

**操作：** ${request.title}
**描述：** ${request.description}
**操作详情：** \`${request.operation}\`
**风险等级：** ${request.riskLevel}

请在 ${request.timeout || 300} 秒内回复：
• 发送 "确认" 或 "yes" 允许操作
• 发送 "拒绝" 或 "no" 拒绝操作
    `.trim();

    await this.imAdapter.sendMessage(context.chatId, {
      text: message,
      markdown: message,
    });
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 使用示例：
 *
 * // 1. Agent 请求权限
 * const permissionRequest: PermissionRequest = {
 *   permissionType: 'execute_command',
 *   title: '执行终端命令',
 *   description: 'Agent 需要执行 rm -rf / 命令',
 *   riskLevel: 'high',
 *   operation: 'rm -rf /',
 *   timeout: 60,
 * };
 *
 * const response = await interactionManager.requestPermission(context, permissionRequest);
 *
 * if (response.type === 'confirm') {
 *   // 用户确认，继续执行
 *   await executeCommand(operation);
 * } else {
 *   // 用户拒绝或超时
 *   await sendMessage('操作已取消');
 * }
 */
