import { ClankaKernel } from './src/runtime/kernel.js';
import { ClankaRecorder } from './packages/core/recorder.js';
import * as fs from 'node:fs';

async function testLs() {
  console.log('⚡ Testing Recorder with ls');
  const kernel = new ClankaKernel('test-ls');
  const recorder = new ClankaRecorder(kernel, process.cwd());

  const decision = await kernel.log('decision.made', 'clanka', {
    rationale: 'Testing if arguments are passed correctly.',
    plan: ['Run ls -la packages']
  }, []);

  await recorder.executeTool('ls', ['-la', 'packages'], { fsWrite: false }, [decision.id]);

  const history = kernel.getHistory();
  const response = history.find(e => e.type === 'tool.responded');
  console.log('\n--- Tool Output ---');
  console.log(response?.payload.output);
}

testLs();
