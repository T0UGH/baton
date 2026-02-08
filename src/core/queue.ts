/**
 * 任务队列引擎
 * 负责管理用户请求的 FIFO 队列，确保同一会话串行处理
 * 是 Baton 核心机制层的关键组件，协调用户请求与 ACP Agent 的执行
 */
import type { Session, Task, IMResponse } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('TaskQueue');

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

  async enqueue(
    session: Session,
    content: string,
    type: 'prompt' | 'command' = 'prompt'
  ): Promise<IMResponse> {
    const task: Task = {
      id: generateUUID(),
      type,
      content,
      timestamp: Date.now(),
    };

    // 如果当前没有任务在执行，直接执行
    if (!session.isProcessing && !session.queue.current) {
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
    const position = session.queue.pending.length;

    return {
      success: true,
      message: `请求已加入队列，当前排在第 ${position} 位，请稍候...`,
      data: { taskId: task.id, position },
    };
  }

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
      await this.processNext(session);
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
      await this.processNext(session);
    }
  }

  private async processNext(session: Session): Promise<void> {
    session.queue.current = null;
    session.isProcessing = false;

    // 检查队列中是否有待处理任务
    if (session.queue.pending.length > 0) {
      const nextTask = session.queue.pending.shift()!;
      session.queue.current = nextTask;
      session.isProcessing = true;

      logger.info({ taskId: nextTask.id }, 'Starting next task');

      // 异步执行下一个任务
      this.processTask(session, nextTask).catch((err: Error) => logger.error(err));
    } else {
      logger.info('No more tasks in queue');
    }
  }
}
