import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import assert from 'assert';
import execFilePromise from './execFilePromise.js';

describe('execFilePromise.js', () => {
    it('should execute a command', async () => {
        const { stdout } = await execFilePromise('echo', ['hello']);
        assert.equal(stdout, 'hello\n');
    });
    it('should fail to execute unknown command', async () => {
        assert.rejects(async () => {
            await execFilePromise('zob');
        });
    });
    it('should use stdin', async () => {
        const { stdout } = await execFilePromise('cat', ['-'], { stdin: 'hello' });
        assert.equal(stdout, 'hello');
    });
    it('should ignoreexitcode and not throw', async () => {
        const { stdout } = await execFilePromise('bash', ['-c', 'false'], { ignoreExitCode: true });
    });
});
