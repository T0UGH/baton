/**
 * 任务队列引擎
 * 负责管理用户请求的 FIFO 队列，确保同一会话串行处理
 * 是 Baton 核心机制层的关键组件，协调用户请求与 ACP Agent 的执行
 *
 * 线程安全设计：
 * - 使用 session 级别的锁来防止竞态条件
 * - 确保 enqueue 操作的原子性
 * - 防止重复调用 processNext 导致的状态不一致
 */
import type { Session, Task, IMResponse } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('TaskQueue');

// 会话级别的锁，防止竞态条件
const sessionLocks = new Map<string, Promise<void>>();

// 简单的 UUID 生成函数
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 任务完成回调函数类型
export type TaskCompleteCallback = (session: Session, response: IMResponse) => Promise<void>;

export class TaskQueueEngine {
  private onTaskComplete?: TaskCompleteCallback;

  constructor(onTaskComplete?: TaskCompleteCallback) {
    this.onTaskComplete = onTaskComplete;
  }

  /**
   * 将任务加入队列
   * 使用锁机制确保队列操作的原子性，防止竞态条件
   */
  async enqueue(
    session: Session,
    content: string,
    type: 'prompt' | 'command' = 'prompt'
  ): Promise<IMResponse> {
    // 获取或创建锁
    const acquireLock = async (): Promise<() => void> => {
      const existingLock = sessionLocks.get(session.id);
      if (existingLock) {
        await existingLock;
      }

      let release: () => void;
      const newLock = new Promise<void>(resolve => {
        release = () => {
          sessionLocks.delete(session.id);
          resolve();
        };
      });

      sessionLocks.set(session.id, newLock);
      return release!;
    };

    const release = await acquireLock();

    try {
      // 双重检查：再次确认状态（可能在上一个锁释放后状态已变）
      const shouldExecuteImmediately = !session.isProcessing && !session.queue.current;

      const task: Task = {
        id: generateUUID(),
        type,
        content,
        timestamp: Date.now(),
      };

      if (shouldExecuteImmediately) {
        // 立即执行
        session.queue.current = task;
        session.isProcessing = true;

        // 异步执行，不阻塞
        this.processTask(session, task).catch((err: Error) => logger.error(err));

        return {
          success: true,
          message: '', // 不发送任何消息，等待 agent 回复
        };
      }

      // 否则加入队列
      session.queue.pending.push(task);
      // Position includes current running task: position = items ahead + 1
      const position = session.queue.pending.length;

      return {
        success: true,
        message: `请求已加入队列，当前排在第 ${position} 位，请稍候...`,
        data: { taskId: task.id, position },
      };
    } finally {
      release();
    }
  }

  /**
   * 处理单个任务
   * 负责调用 ACP client 并发送结果
   */
  private async processTask(session: Session, task: Task): Promise<void> {
    logger.info({ taskId: task.id, content: task.content.substring(0, 50) }, 'Processing task');

    if (!session.acpClient) {
      logger.error({ taskId: task.id }, 'ACP client not initialized');
      if (this.onTaskComplete) {
        await this.onTaskComplete(session, {
          success: false,
          message: '系统错误：ACP 客户端未初始化',
        });
      }
      // 注意：不在此处调用 processNext，由 finally 块统一处理
      return;
    }

    try {
      let response: IMResponse;

      if (task.type === 'prompt') {
        // 调用 ACP 发送 prompt
        response = await session.acpClient.sendPrompt(task.content);
        logger.info({ taskId: task.id }, 'Task completed');
      } else {
        // 命令类型直接透传给 agent
        response = await session.acpClient.sendCommand(task.content);
        logger.info({ taskId: task.id }, 'Command completed');
      }

      // 发送结果给用户
      if (this.onTaskComplete) {
        await this.onTaskComplete(session, response);
      }
    } catch (error) {
      logger.error({ taskId: task.id, error }, 'Task failed');
      if (this.onTaskComplete) {
        await this.onTaskComplete(session, {
          success: false,
          message: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    } finally {
      // 任务完成，处理下一个
      // 这是唯一调用 processNext 的地方，确保不会重复调用
      await this.processNext(session);
    }
  }

  /**
   * 处理队列中的下一个任务
   * 注意：此方法仅在 processTask 的 finally 块中调用，确保串行执行
   */
  private async processNext(session: Session): Promise<void> {
    // 先检查队列，再重置状态，避免竞态窗口
    if (session.queue.pending.length > 0) {
      const nextTask = session.queue.pending.shift()!;
      session.queue.current = nextTask;
      // isProcessing 保持 true，无需重新设置

      logger.info({ taskId: nextTask.id }, 'Starting next task');

      // 异步执行下一个任务
      this.processTask(session, nextTask).catch((err: Error) => logger.error(err));
    } else {
      // 没有待处理任务时，才重置状态
      session.queue.current = null;
      session.isProcessing = false;
      logger.info('No more tasks in queue');
    }
  }
}
