const moment = require('moment');
const path = require('path');
var util = require('util');
const glob = require('glob');
const globPromise = util.promisify(glob);
var execFile = require('child_process').execFile;

function execFilePromise(cmd, params) {
    return new Promise((resolve, reject) => {
        execFile(cmd, params, function (err, stdout, stderr) {
            if (err) return reject(err);
            if (stderr) return reject(stderr);

            resolve(stdout);
        });
    });
}

(async () => {
    // vide les vieux backups
    var dirs1 = await globPromise('/backup/*/all/*');
    var dirs2 = await globPromise('/backup/*/mysql/mysqldump/*');
    var dirs = [...dirs1, ...dirs2];

    for (let dir of dirs) {
        var basename = path.basename(dir);
        var m = basename.match(/^(\d+)-(\d+)-(\d+)--(\d+)/);
        if (!m) continue;

        var date = new Date(`${m[1]}-${m[2]}-${m[3]} ${m[4]}:00`);

        // if sql
        if (dirs2.includes(dir)) {
            if (date < moment().add(-1, 'year')) {
                console.log('deleting -1Y', dir);
                await execFilePromise('rm', ['-rf', dir]);
            } else if (m[3] != '01' && date < moment().add(-30, 'd')) {
                console.log('deleting -30D', dir);
                await execFilePromise('rm', ['-rf', dir]);
            }
        }
        // if rsync
        else {
            if (date < moment().add(-30, 'd')) {
                console.log('deleting -30D', dir);
                await execFilePromise('rm', ['-rf', dir]);
            }
        }

        if (m[4] != '01' && date < moment().add(-26, 'h')) {
            console.log('deleting -26H', dir);
            await execFilePromise('rm', ['-rf', dir]);
        }
    }

    // vide .tmp car si on lance clean c'est qu'on a fini de backuper
    var dirs3 = await globPromise('/backup/.tmp/*');
    for (let dir of dirs3) {
        console.log('deleting old failed backup', dir);

        await execFilePromise('rm', ['-rf', dir]);
    }
})();
