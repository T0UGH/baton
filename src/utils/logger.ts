/**
 * 日志工具
 * 基于 pino 的高性能日志库，支持结构化日志输出和分级日志
 * 自动适配开发环境（pretty 格式）和生产环境（JSON 格式）
 */
import pino from 'pino';

// 日志级别从环境变量读取，默认 info
const level = process.env.LOG_LEVEL || 'info';

// 开发环境使用 pino-pretty，生产环境使用 JSON
const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,env,component',
          messageFormat: '{if component}[{component}] {end}{msg}',
        },
      }
    : undefined,
  // 基础字段 - 开发环境简化
  base: isDev
    ? {}
    : {
        env: process.env.NODE_ENV || 'production',
      },
});

// 子 logger 工厂函数 - 简化版本
export function createLogger(name: string) {
  return isDev ? logger.child({ component: name }, { level }) : logger.child({ component: name });
}
