#!/usr/bin/env node
/**
 * Baton 主入口文件
 * 负责根据配置自动选择或手动指定运行模式（CLI/飞书）
 * 是整个应用的启动器和路由器
 */
import { loadConfig } from './config/loader.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('Main');

async function main() {
  const mode = process.argv[2] || 'auto';

  if (mode === 'cli') {
    // 强制 CLI 模式
    const { main: cliMain } = await import('./cli.js');
    await cliMain();
  } else if (mode === 'feishu') {
    // 强制飞书模式
    const { main: feishuMain } = await import('./feishu-server.js');
    await feishuMain();
  } else {
    // 自动判断
    const config = loadConfig();

    if (config.feishu?.appId && config.feishu?.appSecret) {
      logger.info('🤖 检测到飞书配置，启动飞书模式...');
      logger.info('   (使用 bun run start -- cli 强制 CLI 模式)');
      const { main: feishuMain } = await import('./feishu-server.js');
      await feishuMain();
    } else {
      logger.info('💻 未检测到飞书配置，启动 CLI 模式...');
      logger.info('   (使用 bun run start -- feishu 强制飞书模式)');
      const { main: cliMain } = await import('./cli.js');
      await cliMain();
    }
  }
}

main().catch(logger.error);
