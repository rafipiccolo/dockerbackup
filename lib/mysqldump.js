const util = require('util');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);
const spawn = require('child_process').spawn;
const path = require('path');
const { StringDecoder } = require('string_decoder');
const shellescape = require('shell-escape');
const verbose = require('./verbose');
/*
* save a remote mysql database at the specified path using mysqldump
* 
* exemple : 
* const {size, ms} = await callMysqlDump({
*     host: 'localhost',
*     user: 'root',
*     mysqlHost: 'localhost',
*     mysqlPort: 3306,
*     mysqlUser: 'root',
*     mysqlPassword: 'root',
*     dryrun: false,
*     output: '/backup/suce.archive',
*     ignoreTables: ['gextra_prod.planning'],
* })
*/
module.exports = async function callMysqlDump(params) {
    verbose(JSON.stringify(params));

    var mysqlargs = [];
    if (params.docker) {
        mysqlargs.push('docker');
        mysqlargs.push('exec');
        if (params.mysqlPassword) {
            mysqlargs.push('-e');
            mysqlargs.push('MYSQL_PWD='+shellescape([params.mysqlPassword]));
        }
        mysqlargs.push(params.docker);
    }
    mysqlargs.push('mysqldump');
    if (params.mysqlUser) mysqlargs.push('--user='+params.mysqlUser);
    if (params.mysqlPort) mysqlargs.push('--port='+params.mysqlPort);
    if (params.mysqlHost) mysqlargs.push('--host='+params.mysqlHost);
    (params.ignoreTables || []).forEach(function(ignore) {
        mysqlargs.push('--ignore-table='+ignore);
    });
    mysqlargs.push('--default-character-set=utf8mb4');
    mysqlargs.push('--single-transaction');
    mysqlargs.push('--complete-insert');
    mysqlargs.push('--max_allowed_packet=16M');
    if (params.db)
        mysqlargs.push(params.db);
    else
        mysqlargs.push('--all-databases');

    var args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(params.user+'@'+params.host);
    args.push(shellescape(mysqlargs)+' | gzip');
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

            if (code == 0) return resolve({ms: ms, size: size});

            fs.unlink(params.output, function(err) {
                if (err) return reject(err);

                reject(new Error(`code ${code} != 0 : ${stderr}`));
            })
        });
        p.on('error', function(err) {
            reject(err);
        });
    });
}
