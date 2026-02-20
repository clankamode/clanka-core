import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
export class ClankaRecorder {
    kernel;
    workspaceRoot;
    lastEventId;
    constructor(kernel, workspaceRoot) {
        this.kernel = kernel;
        this.workspaceRoot = workspaceRoot || process.cwd();
    }
    async executeTool(toolName, args, caps = {}, causes = []) {
        const callId = Math.random().toString(36).slice(2);
        const txId = `tx_${callId}`;
        const req = await this.kernel.log('tool.requested', 'cli', {
            callId,
            txId,
            tool: toolName,
            args,
            caps
        }, causes);
        this.lastEventId = req.id;
        const scanRoot = caps.outDir ? path.resolve(this.workspaceRoot, caps.outDir) : this.workspaceRoot;
        const preState = this.scanWorkspace(scanRoot);
        const result = await this.spawnTool(toolName, args);
        if (caps.fsWrite) {
            const postState = this.scanWorkspace(scanRoot);
            await this.emitDiffsAndSnapshots(txId, preState, postState, [req.id]);
        }
        const res = await this.kernel.log('tool.responded', 'cli', {
            callId,
            txId,
            output: result.stdout,
            exitCode: result.code,
            error: result.error ? { code: 'EXEC_ERROR', message: result.error } : undefined
        }, [this.lastEventId]);
        this.lastEventId = res.id;
        return result;
    }
    async spawnTool(command, args) {
        return new Promise((resolve) => {
            // Joining args into a single command string to ensure shell interprets them correctly
            const fullCommand = `${command} ${args.join(' ')}`;
            const proc = spawn(fullCommand, {
                cwd: this.workspaceRoot,
                shell: true,
                env: { ...process.env, PATH: `${process.env.PATH}:${path.join(this.workspaceRoot, 'node_modules/.bin')}` }
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (data) => stdout += data.toString());
            proc.stderr.on('data', (data) => stderr += data.toString());
            proc.on('close', (code) => {
                resolve({
                    code: code ?? 0,
                    stdout,
                    error: code !== 0 ? stderr : undefined
                });
            });
        });
    }
    async emitDiffsAndSnapshots(txId, pre, post, causes) {
        const touched = [];
        const snapshotFiles = [];
        let currentCauses = causes;
        for (const [relPath, postData] of post.entries()) {
            const preData = pre.get(relPath);
            if (!preData || preData.digest !== postData.digest) {
                touched.push(relPath);
                const diff = await this.kernel.log('fs.diff', 'kernel', {
                    txId,
                    path: relPath,
                    beforeDigest: preData?.digest || 'null',
                    afterDigest: postData.digest,
                    patch: { kind: 'unified', text: 'artifact_mutation' }
                }, currentCauses);
                currentCauses = [diff.id];
            }
            snapshotFiles.push({ path: relPath, digest: postData.digest, size: postData.size });
        }
        const workspaceHash = createHash('sha256')
            .update(JSON.stringify(snapshotFiles.sort((a, b) => a.path.localeCompare(b.path))))
            .digest('hex');
        const snap = await this.kernel.log('fs.snapshot', 'kernel', {
            workspaceHash,
            txId,
            files: snapshotFiles.filter(f => touched.includes(f.path))
        }, currentCauses);
        this.lastEventId = snap.id;
    }
    scanWorkspace(root) {
        const state = new Map();
        const scan = (dir) => {
            if (!fs.existsSync(dir))
                return;
            const list = fs.readdirSync(dir);
            for (const file of list) {
                if (['node_modules', '.git', 'dist'].includes(file))
                    continue;
                const fullPath = path.resolve(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory())
                    scan(fullPath);
                else {
                    const content = fs.readFileSync(fullPath);
                    const relPath = path.relative(this.workspaceRoot, fullPath);
                    state.set(relPath, { digest: createHash('sha256').update(content).digest('hex'), size: stat.size });
                }
            }
        };
        scan(root);
        return state;
    }
}
