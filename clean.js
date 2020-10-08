const moment = require('moment');
const path = require('path');
const glob = require('util').promisify(require('glob'));
const rimraf = require('util').promisify(require('rimraf'));

(async () => {
    var dirs1 = await glob('/backup/*/all/*');
    var dirs2 = await glob('/backup/*/mysql/mysqldump/*');
    var dirs = [...dirs1, ...dirs2];

    for (var dir of dirs) {
        var basename = path.basename(dir);
        var m = basename.match(/(\d+-\d+-\d+)/);
        if (!m) continue;

        var date = new Date(m[1]);
        if (date < moment().add(-30, 'd')) {
            console.log('deleting', dir);
            await rimraf(dir, {glob: false});
        }
    }
})()
