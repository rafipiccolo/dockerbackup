const exec = require('child_process').exec;
const shellescape = require('shell-escape');
const verbose = require('./verbose');

/*
* returns an array containing the database list from a remote mongodb server
* 
* exemple : 
* const dbs = await getMongoDbs({
*     host: 'localhost',
*     user: 'root',
*     mongoHost: 'localhost',
*     mongoPort: 27017,
*     mongoUser: 'root',
*     mongoPassword: 'root',
* })
* // equals : dbs = ['admin', 'test']
*/

module.exports = function getMongoDbs(params) {
    var mongoargs = [];
    if (params.docker) {
        mongoargs.push('docker');
        mongoargs.push('exec');
        mongoargs.push('-i');
        mongoargs.push(params.docker);
    }
    mongoargs.push('mongo');
    mongoargs.push('--quiet');
    if (params.mongoHost) mongoargs.push('--host='+params.mongoHost);
    if (params.mongoPort) mongoargs.push('--port='+params.mongoPort);
    if (params.mongoUser) mongoargs.push('--user='+params.mongoUser);
    if (params.mongoPassword) mongoargs.push('--password='+params.mongoPassword);
    
    var args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(params.user+'@'+params.host);
    args.push('echo show dbs | '+shellescape(mongoargs)+' | cut -f 1 -d " "');
    var cmd = shellescape(args);
    
    verbose(cmd);
    
    return new Promise((resolve, reject) => {
        exec(cmd, function(err, stdout, stderr) {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            resolve(stdout.trim().split('\n'));
        });
    });
}