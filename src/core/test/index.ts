/**
 * 测试工具模块导出
 */

export { FakeACPClient, FakeACPClientFactory } from './fake-acp';
export {
  TestSessionManager,
  DefaultACPClientFactory,
  FakeACPClientFactory as TestACPClientFactory,
} from './test-session';
export { LocalCLIMode } from './cli-mode';
export { MockIMClient, MockIMAdapter } from './mock-im';

import { FakeACPClientFactory } from './fake-acp';
import { TestSessionManager, DefaultACPClientFactory } from './test-session';

export function createTestEnvironment() {
  const acpFactory = new FakeACPClientFactory();
  const sessionManager = new TestSessionManager({
    acpClientFactory: new DefaultACPClientFactory(),
    permissionTimeoutSeconds: 30,
  });

  return {
    acpFactory,
    sessionManager,
  };
}

export function createTestEnvironmentWithDefault() {
  const { acpFactory, sessionManager } = createTestEnvironment();

  const mockRepos = [
    { index: 1, name: 'test-repo', path: '/tmp/test-repo', gitPath: '/tmp/test-repo/.git' },
  ];

  sessionManager.setRepoManager({
    findRepo: (id: string) =>
      mockRepos.find(r => r.name.toLowerCase() === id.toLowerCase()) || null,
    listRepos: () => mockRepos,
  });

  sessionManager.setCurrentRepo({
    name: 'test-repo',
    path: '/tmp/test-repo',
    gitPath: '/tmp/test-repo/.git',
  });

  return {
    acpFactory,
    sessionManager,
    mockRepos,
  };
}
