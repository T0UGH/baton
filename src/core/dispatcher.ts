/**
 * 指令分发器
 * 解析用户输入，区分系统指令和 Agent Prompt，路由到相应的处理逻辑
 * 作为 IM 层和核心逻辑层的桥梁，统一处理所有用户请求
 */
import type { IMMessage, IMResponse, ParsedCommand } from '../types';
import type { SessionManager } from './session';
import type { TaskQueueEngine } from './queue';

export class CommandDispatcher {
  private sessionManager: SessionManager;
  private queueEngine: TaskQueueEngine;

  constructor(sessionManager: SessionManager, queueEngine: TaskQueueEngine) {
    this.sessionManager = sessionManager;
    this.queueEngine = queueEngine;
  }

  parseCommand(text: string): ParsedCommand {
    const trimmed = text.trim();

    // System Meta Commands (优先级最高)
    if (trimmed.startsWith('/repo')) {
      return { type: 'repo', args: trimmed.split(' ').slice(1), raw: trimmed };
    }
    if (trimmed === '/current') {
      return { type: 'current', args: [], raw: trimmed };
    }
    if (trimmed.startsWith('/stop')) {
      return { type: 'stop', args: trimmed.split(' ').slice(1), raw: trimmed };
    }
    if (trimmed === '/reset') {
      return { type: 'reset', args: [], raw: trimmed };
    }
    if (trimmed.startsWith('/mode')) {
      return { type: 'mode', args: trimmed.split(' ').slice(1), raw: trimmed };
    }
    if (trimmed === '/help') {
      return { type: 'help', args: [], raw: trimmed };
    }

    // 默认作为 prompt 处理
    return { type: 'prompt', args: [trimmed], raw: trimmed };
  }

  async dispatch(message: IMMessage): Promise<IMResponse> {
    const command = this.parseCommand(message.text);
    console.log(
      `[Dispatcher] ${message.userId}: ${command.type} - ${command.raw.substring(0, 30)}`
    );

    switch (command.type) {
      case 'repo':
        return this.handleRepo(message, command);

      case 'current':
        return this.handleCurrent(message);

      case 'stop':
        return this.handleStop(message, command);

      case 'reset':
        return this.handleReset(message);

      case 'mode':
        return this.handleMode(message, command);

      case 'help':
        return this.handleHelp();

      case 'prompt':
      default:
        return this.handlePrompt(message, command);
    }
  }

  private async handleRepo(_message: IMMessage, _command: ParsedCommand): Promise<IMResponse> {
    // MVP 只支持单项目，列出当前项目
    return {
      success: true,
      message: `当前项目: ${process.cwd()}\n\n注意: MVP 版本仅支持单项目模式。`,
    };
  }

  private handleCurrent(message: IMMessage): IMResponse {
    return this.sessionManager.getQueueStatus(message.userId);
  }

  private async handleStop(message: IMMessage, command: ParsedCommand): Promise<IMResponse> {
    const target = command.args[0];
    return this.sessionManager.stopTask(message.userId, target);
  }

  private async handleReset(message: IMMessage): Promise<IMResponse> {
    return this.sessionManager.resetSession(message.userId);
  }

  private handleMode(_message: IMMessage, command: ParsedCommand): IMResponse {
    const mode = command.args[0] || 'default';
    return {
      success: true,
      message: `已切换到 ${mode} 模式\n\n(注：模式切换功能将在后续版本完善)`,
    };
  }

  private handleHelp(): IMResponse {
    const helpText = `
**Baton 指令列表：**

*系统指令：*
- /current - 查看当前会话状态
- /stop [id/all] - 停止当前任务或清空队列
- /reset - 重置会话（清除上下文）
- /mode [mode_name] - 切换 Agent 模式
- /help - 显示此帮助

*Agent 交互：*
- 发送任意文本即可与 AI Agent 对话
- 所有非指令文本都会转发给 Agent

*权限说明：*
- MVP 版本所有文件/工具操作自动批准
- 交互式权限确认将在后续版本添加
    `.trim();

    return {
      success: true,
      message: helpText,
    };
  }

  private async handlePrompt(message: IMMessage, command: ParsedCommand): Promise<IMResponse> {
    // 获取或创建会话
    const session = await this.sessionManager.getOrCreateSession(message.userId);

    // 加入任务队列
    const result = await this.queueEngine.enqueue(session, command.raw, 'prompt');

    return result;
  }
}
