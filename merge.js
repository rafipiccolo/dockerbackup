const fs = require('fs');
const glob = require('util').promisify(require('glob'));
const crypto = require('crypto');
var getLatestDir = require('./lib/getLatestDir');
var memoizee = require('memoizee');

var memoizedMd5OnFilename = memoizee(function(file, callback) {
    // return crypto.createHash('md5').update(fs.readFileSync(oldfile)).digest("hex")

    var s = fs.createReadStream(file);
    var hash = crypto.createHash('md5');
    s.on('data', function (data) {
        hash.update(data);
    })
    s.on('end', function (data) {
        callback(null, hash.digest("hex"));
    });
    s.on('error', function (err) {
        callback(err);
    });
}, {async: true});

var promisifiedMemoizedMd5OnFilename = require('util').promisify(memoizedMd5OnFilename);


/*
node merge.js /backup/ideaz.world/all
du -chs /backup/ideaz.world/all/*

node merge.js /backup/backup.clinalliance.fr/all
du -chs /backup/backup.clinalliance.fr/all/*

node merge.js /backup/2i.raphaelpiccolo.com/all
du -chs /backup/2i.raphaelpiccolo.com/all/*

node merge.js /backup/flatbay.fr/all
du -chs /backup/flatbay.fr/all/*

node merge.js /backup/raphaelpiccolo.com/all
du -chs /backup/raphaelpiccolo.com/all/*

node merge.js /backup/gextra.net/all
du -chs /backup/gextra.net/all/*
*/

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

            let oldhash = await promisifiedMemoizedMd5OnFilename(oldfile);
            let filehash = await promisifiedMemoizedMd5OnFilename(file);

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
