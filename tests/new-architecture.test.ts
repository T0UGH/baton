import { describe, it, beforeEach, expect, afterEach } from 'bun:test';
import { FakeACPClient, FakeACPClientFactory } from '../src/core/test/fake-acp';
import { TestSessionManager, DefaultACPClientFactory } from '../src/core/test/test-session';

describe('FakeACPClient', () => {
  let client: FakeACPClient;
  beforeEach(() => { client = new FakeACPClient(); });
  afterEach(async () => { await client.stop(); });

  it('should start agent', async () => {
    await client.startAgent();
    expect(client.getAgentStatus().running).toBe(true);
  });

  it('should return response', async () => {
    await client.startAgent();
    const response = await client.sendPrompt('hello');
    expect(response.success).toBe(true);
    expect(response.message).toContain('[FakeACP]');
  });

  it('should switch mode', async () => {
    await client.startAgent();
    const result = await client.setMode('coding');
    expect(result.success).toBe(true);
    expect(client.getModeState().currentModeId).toBe('coding');
  });

  it('should switch model', async () => {
    await client.startAgent();
    const result = await client.setModel('claude-3');
    expect(result.success).toBe(true);
    expect(client.getModelState().currentModelId).toBe('claude-3');
  });

  it('should use custom response', async () => {
    client.setPromptConfig({ response: 'Custom' });
    await client.startAgent();
    const response = await client.sendPrompt('hello');
    expect(response.message).toBe('Custom');
  });
});

describe('FakeACPClientFactory', () => {
  it('should create client', async () => {
    const factory = new FakeACPClientFactory();
    const client = factory.create();
    await client.startAgent();
    expect((await client.sendPrompt('test')).success).toBe(true);
    await client.stop();
  });
});

describe('TestSessionManager', () => {
  let sessionManager: TestSessionManager;
  beforeEach(() => {
    sessionManager = new TestSessionManager({
      acpClientFactory: new DefaultACPClientFactory(),
      permissionTimeoutSeconds: 30,
    });
    sessionManager.setCurrentRepo({ name: 'test', path: '/test', gitPath: '/test/.git' });
  });
  afterEach(async () => { await sessionManager.resetAllSessions(); });

  it('should create session', async () => {
    const session = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    expect(session.id).toBeDefined();
    expect(session.userId).toBe('user-1');
  });

  it('should return same session', async () => {
    const s1 = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    const s2 = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    expect(s1.id).toBe(s2.id);
  });

  it('should isolate users', async () => {
    const s1 = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    const s2 = await sessionManager.getOrCreateSession('user-2', 'ctx-1', '/test');
    expect(s1.id).not.toBe(s2.id);
  });

  it('should isolate contexts', async () => {
    const s1 = await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    const s2 = await sessionManager.getOrCreateSession('user-1', 'ctx-2', '/test');
    expect(s1.id).not.toBe(s2.id);
  });

  it('should reset session', async () => {
    await sessionManager.getOrCreateSession('user-1', 'ctx-1', '/test');
    const result = await sessionManager.resetSession('user-1', 'ctx-1');
    expect(result.success).toBe(true);
  });

  it('should get queue status', () => {
    const status = sessionManager.getQueueStatus('user-x', 'ctx-1');
    expect(status.success).toBe(true);
    expect(status.message).toContain('活跃的会话');
  });
});

describe('TestSessionManager Integration', () => {
  let sessionManager: TestSessionManager;
  beforeEach(() => {
    sessionManager = new TestSessionManager({
      acpClientFactory: new DefaultACPClientFactory(),
      permissionTimeoutSeconds: 30,
    });
  });
  afterEach(async () => { await sessionManager.resetAllSessions(); });

  it('should switch projects', async () => {
    sessionManager.setRepoManager({
      findRepo: (id: string) => {
        if (id === 'a') return { name: 'A', path: '/a', gitPath: '/a/.git' };
        return null;
      },
      listRepos: () => [{ name: 'A', path: '/a', gitPath: '/a/.git' }],
    });
    sessionManager.setCurrentRepo({ name: 'A', path: '/a', gitPath: '/a/.git' });
    const s1 = await sessionManager.getOrCreateSession('user-1', 'chat', '/a');
    
    sessionManager.setCurrentRepo({ name: 'B', path: '/b', gitPath: '/b/.git' });
    const s2 = await sessionManager.getOrCreateSession('user-1', 'chat', '/b');
    
    expect(s1.id).not.toBe(s2.id);
    expect(s1.projectPath).toBe('/a');
    expect(s2.projectPath).toBe('/b');
  });
});
