import util from 'util';
import fs from 'fs';
import { spawn } from 'child_process';
import shellescape from 'shell-escape';
import readline from 'readline';
import verbose from './verbose.js';

/*
 * save a remote server files at the specified path using rsync
 *
 * exemple :
 * const {size, sizeTransfert, ms, stats} = await callRsync({
 *     host: 'localhost',
 *     user: 'root',
 *     dir: '/home',
 *     excludes: ['logs', 'cache'], // optionnal
 *     dryrun: false,
 *     output: '/backup/suce.archive',
 * })
 */
export default async function callRsync(params) {
    verbose(JSON.stringify(params));

    const args = [];
    args.push('rsync');
    args.push('-azP');
    args.push('-e');
    args.push('ssh -oBatchMode=yes');
    args.push('--info=progress2,name0,flist0,stats2');
    if (params.linkdest) args.push(`--link-dest=${params.linkdest}`);
    args.push('--delete');
    args.push('--delete-excluded');
    (params.excludes || []).forEach((exclude) => {
        args.push('--exclude');
        args.push(exclude);
    });
    args.push(`${params.user}@${params.host}:${params.path}`);
    args.push(params.output);

    const cmd = shellescape(args);

    verbose(cmd);

    // dry run : does nothing
    if (params.dryrun) return {};

    return new Promise((resolve, reject) => {
        const hrstart = process.hrtime();
        const p = spawn(cmd, {
            encoding: 'utf8',
            shell: true,
        });

        const rl = readline.createInterface({
            input: p.stdout,
            output: null,
        });
        let stdout = '';
        let size = 0;
        let sizeTransfert = 0;
        let nbFiles = 0;
        rl.on('line', (line) => {
            // if ! progress && ! empty line => then it is stats
            const m = line.match(/\s*([0-9,]+)\s+(\d+%)/);
            if (m) verbose(`${params.user} ${params.host} ${params.path} ${line.trim()}`);
            else if (line.trim() == '');
            else {
                stdout += `${line}\n`;
                const m = line.match(/Total file size: ([0-9,]+) bytes/);
                if (m) size = parseInt(m[1].replace(/,/g, ''));
                const m2 = line.match(/Total transferred file size: ([0-9,]+) bytes/);
                if (m2) sizeTransfert = parseInt(m2[1].replace(/,/g, ''));
                const m3 = line.match(/Number of files: ([0-9,]+)/);
                if (m3) nbFiles = parseInt(m3[1].replace(/,/g, ''));
            }
        });
        let stderr = '';
        p.stderr.on('data', (data) => {
            stderr += data;
        });
        p.on('close', (code) => {
            const hrend = process.hrtime(hrstart);
            const ms = hrend[0] * 1000 + hrend[1] / 1_000_000;

            // file has vanished : it's ok
            if (code == 24) code = 0;

            if (code == 0) return resolve({ ms, size, sizeTransfert, nbFiles, stats: stdout });

            reject(new Error(`code ${code} != 0 : ${stderr}`));
        });
        p.on('error', (err) => {
            reject(err);
        });
    });
}
