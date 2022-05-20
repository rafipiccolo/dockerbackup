import { execFile } from 'child_process';

function checkDf({ path }) {
    return new Promise((resolve, reject) => {
        execFile('/bin/df', ['-B1', '--output=target,size,used,avail,pcent'], (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                err.stdout = stdout;
                return reject(err);
            }
            if (stderr) return reject(new Error(stderr));

            const data = {};
            stdout.split('\n').forEach((line, i) => {
                if (i == 0) return;

                const m = line.match(/([\/a-z0-9]+) +(\d+) +(\d+) +(\d+) +(\d+%)/);
                if (!m) return;

                if (m[1] != path) return;

                data.path = m[1];
                data.size = m[2];
                data.used = m[3];
                data.available = m[4];
                data.percent = m[5].replace(/%/, '');
            });
            resolve(data);
        });
    });
}

export default checkDf;
