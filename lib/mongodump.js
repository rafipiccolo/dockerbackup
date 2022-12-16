import util from 'util';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import shellescape from 'shell-escape';
import verbose from './verbose.js';

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
export default async function callMongoDump(params) {
    verbose(JSON.stringify(params));

    const mongoargs = [];
    if (params.docker) {
        mongoargs.push('docker');
        mongoargs.push('exec');
        mongoargs.push(params.docker);
    }
    mongoargs.push('mongodump');
    if (params.mongoHost) mongoargs.push(`--host=${params.mongoHost}`);
    if (params.mongoPort) mongoargs.push(`--port=${params.mongoPort}`);
    if (params.mongoUser) mongoargs.push(`--user=${params.mongoUser}`);
    if (params.mongoPassword) mongoargs.push(`--password=${params.mongoPassword}`);
    if (params.db) mongoargs.push(`--db=${params.db}`);
    (params.ignoreCollections || []).forEach((ignore) => {
        mongoargs.push(`--excludeCollection=${ignore}`);
    });
    mongoargs.push('--archive');
    mongoargs.push('--gzip');

    const args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${params.user}@${params.host}`);
    args.push(shellescape(mongoargs));

    const cmd = shellescape(args);

    verbose(cmd);

    // dry run : does nothing
    if (params.dryrun) return {};

    return new Promise((resolve, reject) => {
        const hrstart = process.hrtime();
        let size = 0;
        const p = spawn(cmd, {
            shell: true,
        });
        p.stdout.on('data', (data) => {
            size += data.length;
        });
        p.stdout.pipe(fs.createWriteStream(params.output));
        const decoder = new StringDecoder('utf8');
        let stderr = '';
        p.stderr.on('data', (data) => {
            stderr += decoder.write(data);
        });
        p.on('close', (code) => {
            const hrend = process.hrtime(hrstart);
            const ms = hrend[0] * 1000 + hrend[1] / 1_000_000;

            if (code == 0) return resolve({ size, ms });

            fs.unlink(params.output, (err) => {
                if (err) return reject(err);

                reject(new Error(`code ${code} != 0 : ${stderr}`));
            });
        });
        p.on('error', (err) => {
            reject(err);
        });
    });
}
