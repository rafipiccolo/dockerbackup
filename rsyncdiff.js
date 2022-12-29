import fs from 'fs';
import path from 'path';
import execFilePromise from './lib/execFilePromise.js';
import stream from 'stream';

if (process.argv.length != 4) {
    console.log('please provide a "src" and a "dst" folder to compare');
    process.exit(1);
}

const src = process.argv[2];
const dst = process.argv[3];

// get inodes and size from src
const { stdout: srcStdoutFiles } = await execFilePromise('bash', ['-c', `find ${src} -type f -exec stat -c '%n|%i|%s' {} +`], {
    maxBuffer: 200 * 1024 * 1024,
});
const srcfiles = srcStdoutFiles.split('\n').filter((x) => x);
const statsrc = {};
for (const file of srcfiles) {
    const data = file.split('|');
    const name = data[0].replace(src, '');
    statsrc[name] = {
        ino: data[1],
        size: data[2],
    };
}

// get inodes and size from dst
const { stdout: dstStdoutFiles } = await execFilePromise('bash', ['-c', `find ${dst} -type f -exec stat -c '%n|%i|%s' {} +`], {
    maxBuffer: 200 * 1024 * 1024,
});
const dstfiles = dstStdoutFiles.split('\n').filter((x) => x);
const statdst = {};
for (const file of dstfiles) {
    const data = file.split('|');
    const name = data[0].replace(dst, '');
    statdst[name] = {
        ino: data[1],
        size: data[2],
    };
}

// count added and deleted bytes
// and notify about hardlinks that should have been made
let added = 0;
let deleted = 0;
for (const keysrc in statsrc) {
    // exist in both
    if (statdst[keysrc]) {
        // failed hardlink
        // we should really compare file content, but comparing size and ino is fair enough
        if (statsrc[keysrc].size == statdst[keysrc].size && statsrc[keysrc].ino != statdst[keysrc].ino) {
            deleted += parseInt(statsrc[keysrc].size);
            added += parseInt(statdst[keysrc].size);
            console.log(`failed hardlink on ${keysrc}`);
        }
        // file is different
        if (statsrc[keysrc].size != statdst[keysrc].size) {
            deleted += parseInt(statsrc[keysrc].size);
            added += parseInt(statdst[keysrc].size);
        }
    }
    // supprimé
    if (!statdst[keysrc]) {
        // console.log('deleted', keysrc);
        deleted += parseInt(statsrc[keysrc].size);
    }
}

for (const keydst in statdst) {
    // ajouté
    if (!statsrc[keydst]) {
        added += parseInt(statdst[keydst].size);
    }
}

console.log({ deleted, added });
