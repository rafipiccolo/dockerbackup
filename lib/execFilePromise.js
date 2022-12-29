import { execFile } from 'child_process';
import stream from 'stream';

function execFilePromise(cmd, args, options) {
    return new Promise((resolve, reject) => {
        const child = execFile(cmd, args, options, (err, stdout, stderr) => {
            if (options && options.ignoreExitCode && err && parseInt(err.code) == err.code && err.code != 0) resolve({ stdout, stderr });

            if (err) return reject(err);

            resolve({ stdout, stderr });
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
