/**
 * Baton 核心类型定义
 * 定义整个应用的基础数据结构和接口，包括会话、任务、消息等核心概念
 * 被所有模块共享，是整个项目的类型基础
 */

import type { ACPClient } from './acp/client';

export interface Session {
  id: string;
  userId: string;
  projectPath: string;
  acpClient: ACPClient | null;
  queue: TaskQueue;
  isProcessing: boolean;
}

export interface Task {
  id: string;
  type: 'prompt' | 'command';
  content: string;
  timestamp: number;
}

export interface TaskQueue {
  pending: Task[];
  current: Task | null;
}

export interface IMMessage {
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

export interface IMResponse {
  success: boolean;
  message: string;
  data?: any;
}

export type CommandType = 'repo' | 'current' | 'stop' | 'reset' | 'mode' | 'help' | 'prompt';

export interface ParsedCommand {
  type: CommandType;
  args: string[];
  raw: string;
}
