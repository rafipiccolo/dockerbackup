import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import moment from 'moment';
import fs from 'fs';
import prettyMs from 'pretty-ms';
import prettyBytes from 'pretty-bytes';
import getDockerInspectAll from './lib/getDockerInspectAll.js';
import parseContainer from './lib/parseContainer.js';
import verbose from './lib/verbose.js';
import getLatestDir from './lib/getLatestDir.js';
import getMysqlDbs from './lib/getMysqlDbs.js';
import getMongoDbs from './lib/getMongoDbs.js';

import rsync from './lib/rsync.js';
import mysqldump from './lib/mysqldump.js';
import mongodump from './lib/mongodump.js';

import influxdb from './lib/influxdb.js';

let userhosts = process.argv[2];
let drivers = process.argv[3];
if (!drivers) drivers = 'rsync,rsynclive,mysqldump,mongodump,gitea';

if (process.argv.length > 4 || !userhosts) {
    console.error('please specify some user@hostname (separated by ",") and optionally some drivers (mysqldump/mongodump/rsync separated by ",")');
    process.exit(1);
}

const now = moment().format('YYYY-MM-DD--HH');
const rsyncExcludes = [
    'dockerdata/mysql',
    'dockerdata/mongo',
    'dockerdata/influxdb',
    'dockerdata/pdf',
    'dockerdata/convert',
    'dockerdata/gitea',
    'dockerlog/',
    'node_modules/',
    'docker/mysql/data',
    'docker/redis',
    'docker/mongo',
    'docker/influxdb',
    'docker/loki/data',
    'docker/rtorrent/',
    'docker/flood/rtorrent',
    'docker/filebrowser/srv',
    'docker/pdf/data/',
    'docker/convert/data/',
    'docker/registry/',
    'docker/gitea/',
    '.npm/',
    '.cache/',
    '.vscode-server-insiders',
    'log/',
    'logs/',
    '*.log',
    'cache/',
    'uploads/tmp/',
    'report.*.json',
];

userhosts = userhosts.split(',');
drivers = drivers.split(',');
const hrstart = process.hrtime();
for (const userhost of userhosts) {
    for (const driver of drivers) {
        const m = userhost.match(/([a-z0-9\.\-]+)@([a-z0-9\.\-]+)/i);
        if (!m) {
            console.error('please specify a user@hostname (separated by ",")');
            process.exit(1);
        }
        const [_, user, host] = m;
        await main(user, host, driver, now);
    }
}
const hrend = process.hrtime(hrstart);
const ms = hrend[0] * 1000 + hrend[1] / 1_000_000;
await saveStat({ backuphost: '-', driver: '-', name: '-', db: '-', ms, error: 0 });
console.log(`all done`);

async function saveStat(stats, e) {
    stats.now = moment().format('YYYY-MM-DD HH:mm:ss.SSS');

    // log stats on terminal
    let s = `${stats.now} ${stats.driver}@${stats.backuphost}:${stats.name}:${stats.db} ${stats.error ? 'FAIL' : 'OK'}`;
    if (stats.ms) s += ` ${prettyMs(stats.ms)}`;
    if (stats.size) s += ` ${prettyBytes(stats.size)}`;
    if (stats.error) console.error(s, e);
    else console.log(s);

    // save in file
    await fs.promises.mkdir(`${__dirname}/log/`, { recursive: true });
    await fs.promises.appendFile(`${__dirname}/log/log.log`, `${JSON.stringify(stats)}\n`);

    // save to influx
    const fields = { error: stats.error };
    if (stats.ms !== undefined) fields.ms = stats.ms;
    if (stats.size !== undefined) fields.size = stats.size;
    if (stats.sizeTransfert !== undefined) fields.sizeTransfert = stats.sizeTransfert;

    influxdb.insert(
        'dockerbackup',
        { backuphost: stats.backuphost, hostname: process.env.HOSTNAME, driver: stats.driver, name: stats.name, db: stats.db },
        fields
    );
}

async function main(user, host, driver, now) {
    try {
        // get and parse labels from remote docker
        let containers = await getDockerInspectAll({ user, host });
        containers = containers.map((container) => parseContainer(container)).filter((container) => container);

        verbose(`found ${containers.length} backup jobs`);

        // rsync in append only
        if (driver == 'rsynclive') {
            try {
                const params = {
                    host,
                    user,
                    path: '/root/',
                    output: `/backup/${host}/rsynclive/`,
                    excludes: rsyncExcludes,
                    dryrun: process.env.DRYRUN || 0,
                };
                console.log(`${driver}@${host} start`);
                const res = await rsync(params);
                await saveStat({
                    backuphost: host,
                    driver,
                    ms: res.ms,
                    size: res.size,
                    sizeTransfert: res.sizeTransfert,
                    name: 'all',
                    db: '-',
                    error: 0,
                });
            } catch (e) {
                await saveStat({ backuphost: host, driver, name: 'all', db: '-', error: 1 }, e);
            }
        }

        // // gitea backup using rsync
        // if (driver == 'gitea') {
        //     try {
        //         const linkdest = await getLatestDir(`/backup/${host}/gitea/`);
        //         const realoutput = `/backup/${host}/gitea/${now}/`;
        //         const tmpoutput = `/backup/.tmp/${host}.gitea.${now}/`;
        //         const params = {
        //             host,
        //             user,
        //             path: '/root/docker/gitea/',
        //             output: tmpoutput,
        //             linkdest: linkdest ? `${linkdest}/` : null,
        //             excludes: rsyncExcludes,
        //             dryrun: process.env.DRYRUN || 0,
        //         };
        //         console.log(`${driver}@${host} start`);
        //         await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
        //         await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
        //         const res = await rsync(params);
        //         await fs.promises.rename(tmpoutput, realoutput);
        //         await saveStat({
        //             backuphost: host,
        //             driver,
        //             ms: res.ms,
        //             size: res.size,
        //             sizeTransfert: res.sizeTransfert,
        //             name: 'gitea',
        //             db: '-',
        //             error: 0,
        //         });
        //     } catch (e) {
        //         await saveStat({ backuphost: host, driver, name: 'gitea', db: '-', error: 1 }, e);
        //     }
        // }

        // incremental backup using rsync
        if (driver == 'rsync') {
            try {
                const linkdest = await getLatestDir(`/backup/${host}/all/`);
                const realoutput = `/backup/${host}/all/${now}/`;
                const tmpoutput = `/backup/.tmp/${host}.all.${now}/`;
                const params = {
                    host,
                    user,
                    path: '/root/',
                    output: tmpoutput,
                    linkdest: linkdest ? `${linkdest}/` : null,
                    excludes: rsyncExcludes,
                    dryrun: process.env.DRYRUN || 0,
                };
                console.log(`${driver}@${host} start`);
                await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                const res = await rsync(params);
                await fs.promises.rename(tmpoutput, realoutput);
                await saveStat({
                    backuphost: host,
                    driver,
                    ms: res.ms,
                    size: res.size,
                    sizeTransfert: res.sizeTransfert,
                    name: 'all',
                    db: '-',
                    error: 0,
                });
            } catch (e) {
                await saveStat({ backuphost: host, driver, name: 'all', db: '-', error: 1 }, e);
            }
        }

        // backup by container
        for (const container of containers) {
            if (driver == container.driver) {
                if (container.driver == 'mysqldump') {
                    let dbs = [];
                    try {
                        dbs = await getMysqlDbs({
                            host,
                            user,
                            docker: container.id,
                            mysqlUser: 'root',
                            mysqlPassword: container.env.MYSQL_ROOT_PASSWORD || 'root',
                        });
                    } catch (e) {
                        await saveStat({ backuphost: host, driver: container.driver, name: container.name, db: '-', error: 1 }, e);
                    }

                    // on retire les db ignorées
                    container.ignore ||= [];
                    const ignoreTables = container.ignore.filter((ignore) => ignore.includes('.'));
                    dbs = dbs.filter((db) => !container.ignore.includes(db));

                    for (const db of dbs) {
                        try {
                            const realoutput = `/backup/${host}/${container.name}/mysqldump/${now}/${db}.sql.gz`;
                            const tmpoutput = `/backup/.tmp/${host}.${container.name}.mysqldump.${now}.${db}.sql.gz`;

                            const params = {
                                host,
                                user,
                                docker: container.id,
                                mysqlUser: 'root',
                                mysqlPassword: container.env.MYSQL_ROOT_PASSWORD || 'root',
                                dryrun: process.env.DRYRUN || 0,
                                db,
                                output: tmpoutput,
                                ignoreTables,
                            };
                            console.log(`${driver}@${host} start`);
                            await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                            await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                            const res = await mysqldump(params);
                            await fs.promises.rename(tmpoutput, realoutput);
                            await saveStat({
                                backuphost: host,
                                driver: container.driver,
                                name: container.name,
                                db,
                                ms: res.ms,
                                size: res.size,
                                error: 0,
                            });
                        } catch (e) {
                            await saveStat({ backuphost: host, driver: container.driver, name: container.name, db, error: 1 }, e);
                        }
                    }
                } else if (container.driver == 'mongodump') {
                    let dbs = [];
                    try {
                        dbs = await getMongoDbs({
                            host,
                            user,
                            docker: container.id,
                        });
                    } catch (e) {
                        await saveStat({ backuphost: host, driver: container.driver, name: container.name, db: '-', error: 1 }, e);
                    }

                    // on retire les db ignorées
                    container.ignore ||= [];
                    for (const db of dbs) {
                        try {
                            const realoutput = `/backup/${host}/${container.name}/mysqldump/${now}/${db}.archive`;
                            const tmpoutput = `/backup/.tmp/${host}.${container.name}.mysqldump.${now}.${db}.archive`;

                            const params = {
                                host,
                                user,
                                docker: container.id,
                                dryrun: process.env.DRYRUN || 0,
                                db,
                                output: tmpoutput,
                            };
                            await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                            await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                            const res = await mongodump(params);
                            await fs.promises.rename(tmpoutput, realoutput);
                            await saveStat({
                                backuphost: host,
                                driver: container.driver,
                                name: container.name,
                                db,
                                ms: res.ms,
                                size: res.size,
                                error: 0,
                            });
                        } catch (e) {
                            await saveStat({ backuphost: host, driver: container.driver, name: container.name, db, error: 1 }, e);
                        }
                    }
                } else {
                    throw new Error(`no driver found for ${container.driver}`);
                }
            }
        }
    } catch (e) {
        await saveStat({ backuphost: host, driver: 'getDocker', name: '-', db: '-', error: 1 }, e);
    }
}
