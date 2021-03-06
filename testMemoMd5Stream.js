const fs = require('fs');
const crypto = require('crypto');
let memoizee = require('memoizee');

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

let promisifiedMemoizedMd5OnFilename = require('util').promisify(memoizedMd5OnFilename);

promisifiedMemoizedMd5OnFilename('g.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
promisifiedMemoizedMd5OnFilename('g.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
promisifiedMemoizedMd5OnFilename('merge.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
