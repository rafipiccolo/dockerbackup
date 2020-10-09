const moment = require('moment');
const path = require('path');
const glob = require('util').promisify(require('glob'));
var execFile = require('child_process').execFile;

function execFilePromise(cmd, params) {
    return new Promise((resolve, reject) => {
        execFile(cmd, params, function (err, stdout, stderr) {
            if (err) return reject(err);
            if (stderr) return reject(stderr);

            resolve(stdout);
        });
    })
}

(async () => {
    var dirs1 = await glob('/backup/*/all/*');
    var dirs2 = await glob('/backup/*/mysql/mysqldump/*');
    var dirs = [...dirs1, ...dirs2];

    for (var dir of dirs) {
        var basename = path.basename(dir);
        var m = basename.match(/^(\d+-\d+-\d+)/);
        if (!m) continue;

        var date = new Date(m[1]);
        if (date < moment().add(-30, 'd')) {
            console.log('deleting', dir);
            await execFilePromise('rm', ['-rf', dir]);
        }
    }
})()
