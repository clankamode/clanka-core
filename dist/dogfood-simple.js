import { ClankaKernel } from './src/runtime/kernel.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
async function dogfoodSimple() {
    console.log('⚡ Dogfood: Direct File Mutation Trace');
    const kernel = new ClankaKernel('dogfood-files-001');
    const testDir = './test-workspace';
    // Setup
    fs.mkdirSync(testDir, { recursive: true });
    const decision = await kernel.log('decision.made', 'clanka', {
        rationale: 'Create and mutate test files to verify DAR kernel.',
        plan: ['Create file.txt', 'Modify file.txt', 'Verify digests']
    }, []);
    // File 1: Create
    const filePath = path.join(testDir, 'file.txt');
    const content1 = 'Hello, World!';
    fs.writeFileSync(filePath, content1);
    const digest1 = createHash('sha256').update(content1).digest('hex');
    const create = await kernel.log('fs.diff', 'agent', {
        txId: 'tx_1',
        path: 'test-workspace/file.txt',
        beforeDigest: 'null',
        afterDigest: digest1,
        patch: { kind: 'unified', text: '+Hello, World!' }
    }, [decision.id]);
    // Snapshot after creation
    const snap1 = await kernel.log('fs.snapshot', 'kernel', {
        workspaceHash: createHash('sha256').update(JSON.stringify([{ path: 'test-workspace/file.txt', digest: digest1, size: content1.length }])).digest('hex'),
        txId: 'tx_1',
        files: [{ path: 'test-workspace/file.txt', digest: digest1, size: content1.length }]
    }, [create.id]);
    // File 2: Mutate
    const content2 = 'Hello, DAR!';
    fs.writeFileSync(filePath, content2);
    const digest2 = createHash('sha256').update(content2).digest('hex');
    const modify = await kernel.log('fs.diff', 'agent', {
        txId: 'tx_2',
        path: 'test-workspace/file.txt',
        beforeDigest: digest1,
        afterDigest: digest2,
        patch: { kind: 'unified', text: '-Hello, World!\n+Hello, DAR!' }
    }, [snap1.id]);
    const snap2 = await kernel.log('fs.snapshot', 'kernel', {
        workspaceHash: createHash('sha256').update(JSON.stringify([{ path: 'test-workspace/file.txt', digest: digest2, size: content2.length }])).digest('hex'),
        txId: 'tx_2',
        files: [{ path: 'test-workspace/file.txt', digest: digest2, size: content2.length }]
    }, [modify.id]);
    // Log it
    const history = kernel.getHistory();
    console.log(`\n✅ Trace Complete. ${history.length} events recorded.`);
    fs.mkdirSync('./runs', { recursive: true });
    fs.writeFileSync('./runs/dogfood-simple.jsonl', history.map(e => JSON.stringify(e)).join('\n'));
    console.log('📝 Log saved to ./runs/dogfood-simple.jsonl');
    // Verify DAG integrity
    console.log('\n--- Event DAG ---');
    history.forEach((e, i) => {
        console.log(`[${i}] ${e.type} | causes: ${e.causes.length > 0 ? e.causes[0].slice(0, 8) : 'none'} | digest: ${e.id.slice(0, 8)}`);
    });
    // Cleanup
    fs.rmSync(testDir, { recursive: true });
}
dogfoodSimple();
