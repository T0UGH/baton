/**
 * 飞书适配器
 * 实现飞书平台的 WebSocket 长链接通信，处理消息收发和事件订阅
 * 作为 IM 接入层与核心逻辑层的桥梁，将飞书消息转换为 Baton 内部格式
 */
import * as lark from '@larksuiteoapi/node-sdk';
import type { BatonConfig } from '../config/types';
import type { IMMessage, IMResponse, Session } from '../types';
import { CommandDispatcher } from '../core/dispatcher';
import { SessionManager } from '../core/session';
import { TaskQueueEngine } from '../core/queue';
import { createLogger } from '../utils/logger';
import { BaseIMAdapter, IMPlatform, type IMMessageFormat, type IMReplyOptions } from './adapter';

const logger = createLogger('FeishuAdapter');

// 飞书消息数据结构接口
interface FeishuMessage {
  message_id: string;
  chat_id: string;
  content: string;
  create_time: string;
  message_type?: string;
}

interface FeishuSender {
  sender_id: {
    user_id?: string;
    open_id?: string;
    name?: string;
  };
  sender_type?: string;
}

interface FeishuMessageData {
  message: FeishuMessage;
  sender: FeishuSender;
}

export class FeishuAdapter extends BaseIMAdapter {
  readonly platform = IMPlatform.FEISHU;

  private config: BatonConfig;
  private client: lark.Client;
  private wsClient: lark.WSClient;
  private eventDispatcher: lark.EventDispatcher;
  private dispatcher: CommandDispatcher;
  private sessionManager: SessionManager;
  private queueEngine: TaskQueueEngine;
  // 存储 message_id 用于后续回复
  private messageContext: Map<string, { chatId: string; messageId: string }> = new Map();

  constructor(config: BatonConfig) {
    super();
    this.config = config;

    if (!config.feishu) {
      throw new Error('Feishu config is required');
    }

    // 创建飞书客户端
    this.client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: config.feishu.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
    });

    // 创建会话管理器
    this.sessionManager = new SessionManager(config.project.path);

    // 创建任务队列引擎，传入完成回调
    this.queueEngine = new TaskQueueEngine(this.onTaskComplete.bind(this));

    // 创建指令分发器
    this.dispatcher = new CommandDispatcher(this.sessionManager, this.queueEngine);

    // 创建事件分发器
    this.eventDispatcher = new lark.EventDispatcher({});

    // 注册事件处理器
    this.registerEventHandlers();

    // 创建 WebSocket 长链接客户端
    this.wsClient = new lark.WSClient({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      domain: config.feishu.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
    });
  }

  private registerEventHandlers(): void {
    // 注册消息接收事件
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        await this.handleMessage(data as FeishuMessageData);
      },
    });

    // 注册消息已读事件（忽略，避免警告）
    this.eventDispatcher.register({
      'im.message.message_read_v1': async (_data: any) => {
        // 忽略已读事件
      },
    });

    // 注册卡片交互事件
    this.eventDispatcher.register({
      'card.action.trigger': async (data: any) => {
        await this.handleCardAction(data);
      },
    });
  }

  private async handleMessage(data: FeishuMessageData): Promise<void> {
    try {
      // 调试：打印完整数据结构
      logger.debug({ rawData: data }, 'Raw message data');

      const message = data.message;
      const sender = data.sender;

      // 安全检查
      if (!message || !sender) {
        logger.warn({ data }, 'Invalid message data');
        return;
      }

      // 调试：打印关键字段
      logger.debug(
        {
          message_id: message.message_id,
          chat_id: message.chat_id,
          content: message.content,
          create_time: message.create_time,
          sender_id: sender.sender_id,
          sender_type: sender.sender_type,
        },
        'Message structure'
      );

      // 提取消息内容
      let text = '';
      try {
        const content = JSON.parse(message.content || '{}') as { text?: string };
        text = (content as { text?: string }).text || '';
      } catch (e) {
        text = message.content || '';
      }

      // 提取用户ID（可能是 user_id 或 open_id）
      const userId = sender.sender_id?.user_id || sender.sender_id?.open_id || 'unknown';
      const userName = sender.sender_id?.name || 'Unknown';

      // 构建 IMMessage
      const imMessage: IMMessage = {
        userId,
        userName,
        text: text.trim(),
        timestamp: Date.now(),
      };

      logger.info({ userName, userId, text: text.substring(0, 50) }, 'Received message');

      // 获取或创建会话
      const session = await this.sessionManager.getOrCreateSession(imMessage.userId);

      // 存储消息上下文（用于后续回复）
      this.messageContext.set(session.id, {
        chatId: message.chat_id,
        messageId: message.message_id,
      });

      // 添加 "眼睛" reaction 表示已读（仅在 message_id 存在时）
      if (message.message_id) {
        await this.addReaction(message.chat_id, message.message_id, 'OK').catch(() => {
          // 忽略 reaction 失败
        });
      }

      // 发送到指令分发器
      const response = await this.dispatcher.dispatch(imMessage);

      // 仅在需要时发送初始回复（比如队列排队信息）
      if (response.message) {
        const formattedMessage = this.formatMessage(response);
        await this.sendReply(message.chat_id, message.message_id, formattedMessage);
      }
    } catch (error) {
      logger.error(error, 'Error handling message');
    }
  }

  private async handleCardAction(_data: any): Promise<void> {
    logger.info({ data: _data }, 'Card action received');
  }

  // 实现 IMAdapter 接口方法

  async start(): Promise<void> {
    logger.info('Starting WebSocket client...');
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    logger.info('WebSocket client started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping WebSocket client...');
    this.wsClient.close();
    logger.info('WebSocket client stopped');
  }

  async sendMessage(
    chatId: string,
    message: IMMessageFormat,
    _options?: IMReplyOptions
  ): Promise<void> {
    const content = this.buildFeishuContent(message);

    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify(content),
        msg_type: this.getMessageType(message),
      },
    });

    logger.debug({ chatId, messageType: this.getMessageType(message) }, 'Message sent');
  }

  async sendReply(
    chatId: string,
    messageId: string | undefined,
    message: IMMessageFormat
  ): Promise<void> {
    // 飞书支持引用回复
    const content = this.buildFeishuContent(message);

    interface MessageData {
      receive_id: string;
      content: string;
      msg_type: string;
      reply_message_id?: string;
    }

    const data: MessageData = {
      receive_id: chatId,
      content: JSON.stringify(content),
      msg_type: this.getMessageType(message),
    };

    // 仅在 messageId 存在时添加引用
    if (messageId) {
      data.reply_message_id = messageId;
    }

    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data,
    });

    logger.debug({ chatId, hasReply: !!messageId }, 'Reply sent');
  }

  async addReaction(_chatId: string, messageId: string, reaction: string): Promise<void> {
    try {
      // 飞书表情回复 API
      await this.client.im.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: reaction,
          },
        },
      });
      logger.debug({ messageId, reaction }, 'Reaction added');
    } catch (error) {
      // Reaction 失败不影响主流程
      logger.debug({ messageId, reaction, error }, 'Failed to add reaction');
    }
  }

  async onTaskComplete(session: Session, response: IMResponse): Promise<void> {
    const context = this.messageContext.get(session.id);
    if (!context) {
      logger.error('No message context found for session');
      return;
    }

    const { chatId, messageId } = context;
    const formattedMessage = this.formatMessage(response);

    // 发送 agent 的回复
    await this.sendReply(chatId, messageId, formattedMessage);

    // 添加完成 reaction
    await this.addReaction(chatId, messageId, 'OK').catch(() => {});

    logger.info({ sessionId: session.id, chatId }, 'Task completed and reply sent');
  }

  formatMessage(response: IMResponse): IMMessageFormat {
    // 飞书支持 Markdown，可以直接使用
    return {
      text: response.message,
      markdown: response.message,
    };
  }

  // 辅助方法

  private buildFeishuContent(message: IMMessageFormat): any {
    if (message.card) {
      return message.card;
    }

    if (message.code) {
      return {
        code: {
          language: message.code.language,
          content: message.code.content,
        },
      };
    }

    if (message.markdown) {
      return {
        text: message.markdown,
      };
    }

    return {
      text: message.text || '',
    };
  }

  private getMessageType(message: IMMessageFormat): string {
    if (message.card) return 'interactive';
    if (message.code) return 'text'; // 代码块作为文本发送
    return 'text';
  }

  // 获取飞书客户端实例（用于高级操作）
  getClient(): lark.Client {
    return this.client;
  }
}
