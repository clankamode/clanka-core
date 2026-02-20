import { ClankaKernel } from './kernel.js';
import { invariant_planBeforeAction } from './invariant.js';

async function test() {
  const kernel = new ClankaKernel('test-run-' + Date.now());
  kernel.registerInvariant(invariant_planBeforeAction());
  
  console.log('--- Case 1: Valid flow (Decision -> Tool with causal link) ---');
  const decision = await kernel.log('decision.made', { thought: 'I should list files' }, { agentId: 'test-agent' });
  await kernel.log('tool.requested', { command: 'ls' }, { agentId: 'test-agent', tool: 'exec' }, [decision.id]);
  
  const history1 = kernel.getHistory();
  const violations1 = history1.filter(e => e.type === 'invariant.failed');
  console.log('Violations:', violations1.length);

  console.log('\n--- Case 2: Invalid flow (Tool without Decision in causes) ---');
  await kernel.log('tool.requested', { command: 'rm -rf /' }, { agentId: 'rogue-agent', tool: 'exec' });
  
  const history2 = kernel.getHistory();
  const violations2 = history2.filter(e => e.type === 'invariant.failed' && e.payload.invariant === 'plan_before_action');
  console.log('Violations:', violations2.length);
  if (violations2.length > 0) {
    console.log('Message:', violations2[0].payload.message);
  }
}

test().catch(console.error);
