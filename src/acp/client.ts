/**
 * ACP 协议客户端
 * 封装与本地 ACP Agent（如 opencode）的通信，管理子进程生命周期
 * 实现 Agent Client Protocol 标准，提供标准化的 AI Agent 接入能力
 */
import { spawn } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import type { IMResponse } from '../types';
import { createLogger } from '../utils/logger';
import * as acp from '@agentclientprotocol/sdk';
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  StopReason,
  Client,
} from '@agentclientprotocol/sdk';

const logger = createLogger('ACPClient');

// 实现 ACP Client 接口
class BatonClient implements Client {
  private messageBuffer: string[] = [];
  private responsePromise: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor() {}

  // 处理会话更新（agent 发来的消息）
  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          this.messageBuffer.push(update.content.text);
        }
        break;

      case 'tool_call':
        logger.info(`[ACP] Tool call: ${update.title} (${update.status})`);
        break;

      case 'tool_call_update':
        logger.info(`[ACP] Tool ${update.toolCallId} updated: ${update.status}`);
        break;

      case 'plan': {
        const planSummary = update.entries.map(e => e.content).join(', ');
        logger.info(`[ACP] Plan: ${planSummary || 'Agent is planning...'}`);
        break;
      }

      case 'agent_thought_chunk':
      case 'user_message_chunk':
      case 'available_commands_update':
      case 'current_mode_update':
      case 'config_option_update':
      case 'session_info_update':
      case 'usage_update':
        // 这些更新在 MVP 中忽略
        break;

      default:
        break;
    }
  }

  // 权限请求（MVP 直接允许）
  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    logger.info(`[ACP] Permission requested: ${params.toolCall.title}`);

    // MVP: 直接允许第一个选项
    return {
      outcome: {
        outcome: 'selected',
        optionId: params.options[0]?.optionId || 'allow',
      },
    };
  }

  // 文件读取
  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 路径安全检查
    const resolvedPath = path.resolve(params.path);
    const projectRoot = process.cwd();

    if (!resolvedPath.startsWith(projectRoot)) {
      throw new Error('Access denied: path outside project root');
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    return { content };
  }

  // 文件写入
  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 路径安全检查
    const resolvedPath = path.resolve(params.path);
    const projectRoot = process.cwd();

    if (!resolvedPath.startsWith(projectRoot)) {
      throw new Error('Access denied: path outside project root');
    }

    await fs.writeFile(resolvedPath, params.content, 'utf-8');
    return {};
  }

  // 等待完整响应
  async waitForResponse(timeout: number = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const partial = this.messageBuffer.join('');
        this.messageBuffer = [];
        this.responsePromise = null;
        resolve(partial || '[Response timeout]');
      }, timeout);

      this.responsePromise = {
        resolve: (value: string) => {
          clearTimeout(timer);
          this.responsePromise = null;
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          this.responsePromise = null;
          reject(error);
        },
      };
    });
  }

  // 标记响应完成
  onPromptComplete(stopReason: StopReason): void {
    if (this.responsePromise) {
      const fullResponse = this.messageBuffer.join('');
      this.messageBuffer = [];
      this.responsePromise.resolve(fullResponse || `[Completed: ${stopReason}]`);
    }
  }
}

export class ACPClient {
  private projectPath: string;
  private connection: acp.ClientSideConnection | null = null;
  private batonClient: BatonClient;
  private agentProcess: ReturnType<typeof spawn> | null = null;
  private currentSessionId: string | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.batonClient = new BatonClient();
  }

  async startAgent(): Promise<void> {
    logger.info(`[ACP] Starting opencode acp in ${this.projectPath}`);

    // 启动 opencode acp 进程
    this.agentProcess = spawn('opencode', ['acp'], {
      cwd: this.projectPath,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const pid = this.agentProcess.pid!;
    logger.info(`[ACP] Agent started with PID: ${pid}`);

    // 创建流
    const input = Writable.toWeb(this.agentProcess.stdin!) as unknown as WritableStream<Uint8Array>;
    const output = Readable.toWeb(
      this.agentProcess.stdout!
    ) as unknown as ReadableStream<Uint8Array>;

    // 创建 ACP 流
    const stream = acp.ndJsonStream(input, output);

    // 创建客户端连接
    this.connection = new acp.ClientSideConnection(() => this.batonClient, stream);

    // 初始化连接
    logger.info('[ACP] Initializing connection...');
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    logger.info(`[ACP] Connected (protocol v${initResult.protocolVersion})`);

    // 创建新会话
    logger.info('[ACP] Creating new session...');
    const sessionResult = await this.connection.newSession({
      cwd: this.projectPath,
      mcpServers: [],
    });

    this.currentSessionId = sessionResult.sessionId;
    logger.info(`[ACP] Session created: ${sessionResult.sessionId}`);
  }

  async stop(): Promise<void> {
    logger.info(`[ACP] Stopping agent`);

    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
    }

    this.connection = null;
    this.currentSessionId = null;

    logger.info(`[ACP] Agent stopped.`);
  }

  async sendPrompt(prompt: string): Promise<IMResponse> {
    if (!this.connection || !this.currentSessionId) {
      throw new Error('Agent not initialized');
    }

    logger.info(`[ACP] Sending prompt: ${prompt.substring(0, 50)}...`);

    // 启动等待响应
    const responsePromise = this.batonClient.waitForResponse();

    // 发送 prompt
    const promptResult = await this.connection.prompt({
      sessionId: this.currentSessionId,
      prompt: [
        {
          type: 'text',
          text: prompt,
        },
      ],
    });

    // Prompt 完成，触发响应
    this.batonClient.onPromptComplete(promptResult.stopReason);

    // 等待完整响应
    const response = await responsePromise;

    return {
      success: true,
      message: response || `[Completed: ${promptResult.stopReason}]`,
    };
  }

  async sendCommand(command: string): Promise<IMResponse> {
    // 命令透传，与 prompt 类似
    return this.sendPrompt(command);
  }

  async cancelCurrentTask(): Promise<void> {
    if (!this.connection || !this.currentSessionId) {
      return;
    }

    logger.info('[ACP] Cancelling current task...');

    // 发送 cancel 通知
    await this.connection.cancel({
      sessionId: this.currentSessionId,
    });

    // 终止等待
    if (this.batonClient) {
      this.batonClient.onPromptComplete('cancelled');
    }
  }
}
