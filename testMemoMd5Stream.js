'use strict';

const fs = require('fs');
const crypto = require('crypto');
var memoizee = require('memoizee');

var memoizedMd5OnFilename = memoizee(
    function (file, callback) {
        // return crypto.createHash('md5').update(fs.readFileSync(oldfile)).digest("hex")

        var s = fs.createReadStream(file);
        var hash = crypto.createHash('md5');
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

var promisifiedMemoizedMd5OnFilename = require('util').promisify(memoizedMd5OnFilename);

promisifiedMemoizedMd5OnFilename('g.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
promisifiedMemoizedMd5OnFilename('g.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
promisifiedMemoizedMd5OnFilename('merge.js')
    .then(console.log)
    .catch((err) => console.log('dead'));
