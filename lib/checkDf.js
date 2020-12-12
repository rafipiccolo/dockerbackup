var execFile = require('child_process').execFile;

function checkDf({ path }) {
    return new Promise((resolve, reject) => {
        execFile('/bin/df', ['-B1', '--output=target,size,used,avail,pcent'], function (err, stdout, stderr) {
            if (err) return reject({ err: err, stderr: stderr, stdout: stdout });
            if (stderr) return reject({ err: new Error(stderr) });

            var data = {};
            stdout.split('\n').forEach((line, i) => {
                if (i == 0) return;

                var m = line.match(/([\/a-z0-9]+) +(\d+) +(\d+) +(\d+) +(\d+%)/);
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

module.exports = checkDf;
