import { execFile } from 'child_process';
import stream from 'stream';

function execFilePromise(cmd, args, options) {
    return new Promise((resolve, reject) => {
        const child = execFile(cmd, args, options, (err, stdout, stderr) => {
            const code = err?.code ?? 0;
            const ignoreExitCode = options?.ignoreExitCode ?? 0;

            if (err && !ignoreExitCode) return reject(err);

            resolve({ stdout, stderr, code });
        });

        if (options?.stdin) {
            const stdinStream = new stream.Readable();
            stdinStream.push(options.stdin);
            stdinStream.push(null);
            stdinStream.pipe(child.stdin);
        }
    });
}

export default execFilePromise;
