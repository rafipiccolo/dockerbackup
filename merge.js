const fs = require('fs');
let util = require('util');
const glob = require('glob');
const globPromise = util.promisify(glob);
const crypto = require('crypto');
let getLatestDir = require('./lib/getLatestDir');
let memoizee = require('memoizee');

let memoizedMd5OnFilename = memoizee(
    function (file, callback) {
        // return crypto.createHash('md5').update(fs.readFileSync(oldfile)).digest("hex")

        let s = fs.createReadStream(file);
        let hash = crypto.createHash('md5');
        s.on('data', function (data) {
            hash.update(data);
        });
        s.on('end', function (data) {
            callback(null, hash.digest('hex'));
        });
        s.on('error', function (err) {
            callback(err);
        });
    },
    { async: true }
);

let promisifiedMemoizedMd5OnFilename = require('util').promisify(memoizedMd5OnFilename);

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

(async function () {
    // let path = '/backup/ideaz.world/all';
    let path = process.argv[2];
    if (!path) return console.log('please provide a path to check : eg /backup/ideaz.world/all');

    let latest = await getLatestDir(path);

    let globpath = `${latest}/**`;
    let oldspath = `${path}/*/`;

    let files = await globPromise(globpath, { nodir: true });

    console.log(`found ${files.length} files`);

    let olddirs = await globPromise(oldspath);
    olddirs = olddirs.map((d) => d.replace(/\/$/, ''));
    olddirs.sort((a, b) => b.localeCompare(a));

    for (let i in files) {
        let file = files[i];
        console.log(`${i}/${files.length} files`);

        let smallpath = file.replace(`${latest}/`, '');

        for (let olddir of olddirs) {
            if (olddir == latest) continue;

            let oldfile = `${olddir}/${smallpath}`;

            let oldstat = null;
            try {
                oldstat = await fs.promises.stat(oldfile);
            } catch (err) {
                // console.log(oldfile, file, 'nothing in old folder');
                continue;
            }

            let filestat = await fs.promises.stat(file);

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
})();
