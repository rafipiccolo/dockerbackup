import { exec } from 'child_process';
import shellescape from 'shell-escape';
import verbose from './verbose.js';
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

export default function getMysqlDbs(params) {
    const mysqlargs = [];
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

    const args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${params.user}@${params.host}`);
    args.push(`echo show databases | ${shellescape(mysqlargs)}`);
    const cmd = shellescape(args);

    verbose(cmd);

    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            resolve(stdout.trim().split('\n'));
        });
    });
}
