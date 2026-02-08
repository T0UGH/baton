import { describe, it, expect, mock } from 'bun:test';
import { ACPClient } from '../../src/acp/client';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Mock child_process.spawn
mock.module('node:child_process', () => ({
  spawn: mock(() => ({
    stdout: { on: mock() },
    stderr: { on: mock() },
    exitCode: null,
    kill: mock(),
    on: mock()
  }))
}));

// Mock fs/promises
mock.module('node:fs/promises', () => ({
  writeFile: mock(async () => {}),
  readFile: mock(async () => 'mock content'),
}));

describe('BatonClient Logic', () => {
  const testProjectPath = process.cwd();

  it('should execute writeTextFile directly (Agent responsible for permission in ACP)', async () => {
    const client = new ACPClient(testProjectPath, async () => 'allow');
    const batonClient = (client as any).batonClient;

    await batonClient.writeTextFile({
      path: 'test.sh',
      content: 'echo hello'
    });
    // If it didn't throw, it's successful (mocked fs)
  });

  it('should execute createTerminal directly (Agent responsible for permission in ACP)', async () => {
    const client = new ACPClient(testProjectPath, async () => 'allow');
    const batonClient = (client as any).batonClient;

    const { terminalId } = await batonClient.createTerminal({
      command: 'ls',
      args: ['-la']
    });

    expect(terminalId).toBeDefined();
    expect(terminalId).toContain('term-');
  });

  it('should handle terminal output and exit', async () => {
    const client = new ACPClient(testProjectPath, async () => 'allow');
    const batonClient = (client as any).batonClient;

    const { terminalId } = await batonClient.createTerminal({ command: 'echo' });
    
    // Simulate output
    const term = (batonClient as any).terminals.get(terminalId);
    term.output.push('hello world');

    const result = await batonClient.terminalOutput({ terminalId });
    expect(result.output).toBe('hello world');
    expect(term.output.length).toBe(0); // Should be cleared
  });

  it('should block path escape in readTextFile', async () => {
    const client = new ACPClient(testProjectPath, async () => 'allow');
    const batonClient = (client as any).batonClient;

    try {
      await batonClient.readTextFile({ path: '../../etc/passwd' });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('Access denied');
    }
  });
});
