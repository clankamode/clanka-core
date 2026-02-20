import { ClankaKernel } from './src/runtime/kernel.js';
import { ClankaRecorder } from './packages/core/recorder.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function dogfood() {
  console.log('⚡ Starting First Dogfood Run [TSC Build Trace]');
  
  const kernel = new ClankaKernel('dogfood-run-001');
  const recorder = new ClankaRecorder(kernel, process.cwd());

  kernel.registerInvariant({
    name: 'plan_before_action',
    description: 'Tools must cite a decision in causes.',
    check: async (ctx) => {
      const toolReqs = ctx.events.filter(e => e.type === 'tool.requested');
      for (const req of toolReqs) {
        const hasDecision = (req.causes || []).some(cid => {
          const cause = ctx.events.find(e => e.id === cid);
          return cause?.type === 'decision.made';
        });
        if (!hasDecision) return { valid: false, message: `Tool ${req.payload.tool} called without decision cause`, severity: 'error' };
      }
      return { valid: true, severity: 'warn' };
    }
  });

  try {
    const decision = await kernel.log('decision.made', 'clanka', {
      rationale: 'Compiling core packages to verify DAR Spec 1.1 runtime.',
      plan: ['Run tsc with explicit outDir']
    }, []);

    console.log('--- Executing tsc ---');
    // Direct call using absolute path and ignoring stdin/help issues
    const tscBin = path.resolve(process.cwd(), 'node_modules/typescript/lib/tsc.js');
    await recorder.executeTool('node', [tscBin, '-p', 'tsconfig.json', '--outDir', 'dist', '--incremental', 'false'], { 
      fsWrite: true, 
      outDir: 'dist' 
    }, [decision.id]);

    const history = kernel.getHistory();
    console.log(`\n✅ Run Complete. ${history.length} events recorded.`);
    
    fs.mkdirSync('./runs', { recursive: true });
    fs.writeFileSync('./runs/dogfood-001.jsonl', history.map(e => JSON.stringify(e)).join('\n'));
    console.log('📝 Log saved to ./runs/dogfood-001.jsonl');

    // Display first few lines of the log for verification
    const logHead = history.slice(0, 3).map(e => `[${e.type}] ${e.id.slice(0,8)}...`).join('\n');
    console.log('\n--- Log Preview ---');
    console.log(logHead);

  } catch (e) {
    console.error('❌ Run Failed:', e);
  }
}

dogfood();
