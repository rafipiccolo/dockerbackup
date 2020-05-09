const util = require('util');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);
const spawn = require('child_process').spawn;
const path = require('path');
const { StringDecoder } = require('string_decoder');
const shellescape = require('shell-escape');
const verbose = require('./verbose');

/*
* save a remote mongodb database at the specified path using mongodump
* 
* exemple : 
* const {size, ms} = await callMongoDump({
*     host: 'localhost',
*     user: 'root',
*     mongoHost: 'localhost',
*     mongoPort: 27017,
*     mongoUser: 'root',
*     mongoPassword: 'root',
*     db: 'test',
*     dryrun: false,
*     output: '/backup/suce.archive',
* })
*/
module.exports = async function callMongoDump(params) {
    verbose(JSON.stringify(params));
    
    var mongoargs = [];
    if (params.docker) {
        mongoargs.push('docker');
        mongoargs.push('exec');
        mongoargs.push(params.docker);
    }
    mongoargs.push('mongodump');
    if (params.mongoHost) mongoargs.push('--host='+params.mongoHost);
    if (params.mongoPort) mongoargs.push('--port='+params.mongoPort);
    if (params.mongoUser) mongoargs.push('--user='+params.mongoUser);
    if (params.mongoPassword) mongoargs.push('--password='+params.mongoPassword);
    if (params.db) mongoargs.push('--db='+params.db);
    (params.ignoreCollections||[]).forEach(function(ignore) {
        mongoargs.push('--excludeCollection='+ignore);
    });
    mongoargs.push('--archive');
    mongoargs.push('--gzip');

    var args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(params.user+'@'+params.host);
    args.push(shellescape(mongoargs));

    const cmd = shellescape(args);

    verbose(cmd);

    // dry run : does nothing
    if (params.dryrun) return {};

    await mkdir(path.dirname(params.output), {recursive: true});

    return new Promise((resolve, reject) => {
        const hrstart = process.hrtime();
        var size = 0;
        const p = spawn(cmd, {
            shell: true,
        });
        p.stdout.on('data', (data) => {
            size += data.length;
        });
        p.stdout.pipe(fs.createWriteStream(params.output));
        const decoder = new StringDecoder('utf8');
        var stderr = '';
        p.stderr.on('data', (data) => {
            stderr += decoder.write(data);
        });
        p.on('close', (code) => {
            const hrend = process.hrtime(hrstart);
            const ms = hrend[0] * 1000 + hrend[1] / 1000000;

            if (code == 0) return resolve({size: size, ms: ms});

            fs.unlink(output, function(err) {
                if (err) return reject(err);

                reject(new Error(`code ${code} != 0 : ${stderr}`));
            })
        });
        p.on('error', function(err) {
            reject(err);
        });
    });
}