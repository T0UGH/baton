#!/usr/bin/env node
/**
 * 飞书服务器入口
 * 启动 WebSocket 长链接连接到飞书平台，接收和处理消息事件
 * 生产环境部署的主要入口，支持内网运行无需公网暴露
 */
import { loadConfig } from './config/loader';
import { FeishuAdapter } from './im/feishu';
import { createLogger } from './utils/logger';

const logger = createLogger('FeishuServer');

export async function main(configPath?: string) {
  let adapter: FeishuAdapter | null = null;

  try {
    // 加载配置
    const config = loadConfig(configPath);

    // 检查飞书配置
    if (!config.feishu) {
      logger.error('Error: Feishu configuration is required');
      logger.error('Please create baton.config.json with feishu settings');
      logger.error('See baton.config.example.json for reference');
      process.exit(1);
    }

    // 创建飞书适配器
    adapter = new FeishuAdapter(config);

    // 优雅关闭处理
    const shutdown = async (signal: string) => {
      logger.info(`\nReceived ${signal}, shutting down gracefully...`);

      // 移除监听器避免重复触发
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('SIGTERM', sigtermHandler);

      try {
        if (adapter) {
          await adapter.stop();
        }
        logger.info('✅ Gracefully shut down');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    const sigintHandler = () => shutdown('SIGINT');
    const sigtermHandler = () => shutdown('SIGTERM');

    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigtermHandler);

    // 启动
    logger.info('╔════════════════════════════════════════╗');
    logger.info('║        Baton Feishu Server             ║');
    logger.info('║        (WebSocket Long Connection)     ║');
    logger.info('╚════════════════════════════════════════╝');
    logger.info(`\nProject: ${config.project.path}`);
    logger.info(`App ID: ${config.feishu.appId}`);
    logger.info(`Domain: ${config.feishu.domain || 'feishu'}`);
    logger.info('\nConnecting to Feishu via WebSocket...\n');

    await adapter.start();

    logger.info('✅ Connected successfully!');
    logger.info('Press Ctrl+C to exit\n');

    // 保持进程运行（使用 setInterval 而不是 stdin.resume）
    const keepAlive = setInterval(() => {}, 1000);

    // 清理 keepAlive
    process.on('exit', () => {
      clearInterval(keepAlive);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}
