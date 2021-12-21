import util from 'util';
import fs from 'fs';
import glob from 'glob';
const globPromise = util.promisify(glob);
import crypto from 'crypto';
import getLatestDir from './lib/getLatestDir.js';
import memoizee from 'memoizee';

let memoizedMd5OnFilename = memoizee(
    (file, callback) => {
        // return crypto.createHash('md5').update(fs.readFileSync(oldfile)).digest("hex")

        let s = fs.createReadStream(file);
        let hash = crypto.createHash('md5');
        s.on('data', (data) => {
            hash.update(data);
        });
        s.on('end', (data) => {
            callback(null, hash.digest('hex'));
        });
        s.on('error', (err) => {
            callback(err);
        });
    },
    { async: true }
);

let promisifiedMemoizedMd5OnFilename = util.promisify(memoizedMd5OnFilename);

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

// let path = '/backup/ideaz.world/all';
let path = process.argv[2];
if (!path) throw new Error('please provide a path to check : eg /backup/ideaz.world/all');

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
