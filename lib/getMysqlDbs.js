'use strict';

const exec = require('child_process').exec;
const shellescape = require('shell-escape');
const verbose = require('./verbose');
/*
 * returns an array containing the database list from a remote mysqldb server
 *
 * exemple :
 * const dbs = await getMysqlDbs({
 *     host: 'localhost',
 *     user: 'root',
 *     mysqlHost: 'localhost',
 *     mysqlPort: 3306,
 *     mysqlUser: 'root',
 *     mysqlPassword: 'root',
 * })
 * // equals : dbs = ['mysql', 'test']
 */

module.exports = function getMysqlDbs(params) {
    var mysqlargs = [];
    if (params.docker) {
        mysqlargs.push('docker');
        mysqlargs.push('exec');
        mysqlargs.push('-i');
        if (params.mysqlPassword) {
            mysqlargs.push('-e');
            mysqlargs.push(`MYSQL_PWD=${shellescape([params.mysqlPassword])}`);
        }
        mysqlargs.push(params.docker);
    }
    mysqlargs.push('mysql');
    mysqlargs.push('--skip-column-names');
    if (params.mysqlHost) mysqlargs.push(`--host=${params.mysqlHost}`);
    if (params.mysqlPort) mysqlargs.push(`--port=${params.mysqlPort}`);
    if (params.mysqlUser) mysqlargs.push(`--user=${params.mysqlUser}`);

    var args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${params.user}@${params.host}`);
    args.push(`echo show databases | ${shellescape(mysqlargs)}`);
    var cmd = shellescape(args);

    verbose(cmd);

    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            resolve(stdout.trim().split('\n'));
        });
    });
};
