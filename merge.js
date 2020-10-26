const fs = require('fs');
const glob = require('util').promisify(require('glob'));
const crypto = require('crypto');
var getLatestDir = require('./lib/getLatestDir');
var memoizee = require('memoizee');

var memoizedMd5OnFilename = memoizee(function(oldfile) {
    return crypto.createHash('md5').update(fs.readFileSync(oldfile)).digest("hex")
}, {
    async: true,
    normalizer: function (args) {
        // args is arguments object as accessible in memoized function
        return JSON.stringify(args[0]);
    }
});

(async function() {
    
    // var path = '/backup/ideaz.world/all';
    var path = process.argv[2];
    if (!path) return console.log('please provide a path to check : eg /backup/ideaz.world/all');

    var latest = await getLatestDir(path)

    var globpath = latest+'/**';
    var oldspath = path+'/*/';

    var files = await glob(globpath, { nodir : true });
    
    console.log('found '+files.length+' files');

    var olddirs = await glob(oldspath);
    olddirs = olddirs.map(d => d.replace(/\/$/, ''));
    olddirs.sort((a, b) => b.localeCompare(a));

    for (var i in files) {
        var file = files[i]
        console.log(i+'/'+files.length+' files');

        var smallpath = file.replace(latest+'/', '');
        
        for (var olddir of olddirs) {
            if (olddir == latest) continue;

            var oldfile = olddir + '/' + smallpath;

            var oldstat = null;
            try {
                oldstat = await fs.promises.stat(oldfile);
            } catch(err) {
                // console.log(oldfile, file, 'nothing in old folder');
                continue;
            }

            var filestat = await fs.promises.stat(file);

            if (oldstat.ino == filestat.ino) {
                // console.log(oldfile, file, 'already merged');
                continue;
            }

            if (oldstat.size != filestat.size) {
                // console.log(oldfile, file, 'size differ');
                continue;
            }

            let oldhash = memoizedMd5OnFilename(oldfile);
            let filehash = memoizedMd5OnFilename(file);

            if (oldhash != filehash) {
                // console.log(oldfile, file, 'md5 differ');
                continue;
            }

            await fs.promises.unlink(oldfile);
            await fs.promises.link(file, oldfile);

            console.log(oldfile, file, 'merged');
        }
    }

})()
