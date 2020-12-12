const moment = require('moment');
const fs = require('fs');
const path = require('path');
const getDockerInspect = require('./lib/getDockerInspect');
const parseContainer = require('./lib/parseContainer');
const verbose = require('./lib/verbose');
const getLatestDir = require('./lib/getLatestDir');
const getMysqlDbs = require('./lib/getMysqlDbs');
const getMongoDbs = require('./lib/getMongoDbs');

const rsync = require('./lib/rsync');
const mysqldump = require('./lib/mysqldump');
const mongodump = require('./lib/mongodump');

const influxdb = require('./lib/influxdb');

var userhosts = process.argv[2];
var drivers = process.argv[3];
if (!drivers) drivers = 'rsync,rsynclive,mysqldump,mongodump';

if (process.argv.length > 4 || !userhosts) {
    console.error('please specify some user@hostname (separated by ",") and optionally some drivers (mysqldump/mongodump/rsync separated by ",")');
    process.exit(1);
}

const now = moment().format('YYYY-MM-DD--HH');

(async function () {
    userhosts = userhosts.split(',');
    drivers = drivers.split(',');
    for (var userhost of userhosts) {
        for (var driver of drivers) {
            var m = userhost.match(/([a-z0-9\.\-]+)@([a-z0-9\.\-]+)/i);
            if (!m) {
                console.error('please specify a user@hostname (separated by ",")');
                process.exit(1);
            }
            const [_, user, host] = m;
            await main(user, host, driver, now);
        }
    }

    console.log(`all done`);
})();

async function main(user, host, driver, now) {
    try {
        // get and parse labels from remote docker
        var containers = await getDockerInspect({ user, host });
        containers = containers.map(parseContainer).filter((container) => container);

        verbose(`found ${containers.length} backup jobs`);

        // rsync in append only
        if (driver == 'rsynclive') {
            const params = {
                host: host,
                user: user,
                path: '/root/',
                output: '/backup/' + host + '/rsynclive/',
                excludes: [
                    'node_modules/',
                    'docker/mysql/data',
                    'docker/mongo',
                    'docker/influxdb/data',
                    'docker/loki/data',
                    'docker/rtorrent/',
                    'docker/filebrowser/',
                    'docker/pdf/data/',
                    '.npm/',
                    '.cache/',
                    '.vscode-server-insiders',
                    'log/',
                    'logs/',
                    'cache/',
                    'uploads/tmp/',
                    'report.*.json',
                ],
                dryrun: process.env.DRYRUN || 0,
            };
            try {
                console.log(`${driver}@${host} start`);
                const res = await rsync(params);
                console.log(`${driver}@${host} done ${res.ms}ms ${res.size}o`);
                await influxdb.insert(
                    'dockerbackup',
                    { backuphost: process.env.HOSTNAME, host: host, driver: driver, name: 'all', db: '-' },
                    { ms: res.ms, size: res.size, sizeTransfert: res.sizeTransfert, error: 0 }
                );
            } catch (e) {
                console.error(`${driver}@${host} FAIL`, e);
                await influxdb.insert(
                    'dockerbackup',
                    { backuphost: process.env.HOSTNAME, host: host, driver: driver, name: 'all', db: '-' },
                    { error: 1 }
                );
            }
        }

        // incremental backup using rsync
        if (driver == 'rsync') {
            var linkdest = await getLatestDir('/backup/' + host + '/all/');
            var realoutput = '/backup/' + host + '/all/' + now + '/';
            var tmpoutput = '/backup/.tmp/' + host + '.all.' + now + '/';
            const params = {
                host: host,
                user: user,
                path: '/root/',
                output: tmpoutput,
                linkdest: linkdest ? linkdest + '/' : null,
                excludes: [
                    'node_modules/',
                    'docker/mysql/data',
                    'docker/mongo',
                    'docker/influxdb/data',
                    'docker/loki/data',
                    'docker/rtorrent/',
                    'docker/filebrowser/',
                    'docker/pdf/data/',
                    '.npm/',
                    '.cache/',
                    '.vscode-server-insiders',
                    'log/',
                    'logs/',
                    'cache/',
                    'uploads/tmp/',
                    'report.*.json',
                ],
                dryrun: process.env.DRYRUN || 0,
            };
            try {
                console.log(`${driver}@${host} start`);
                await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                const res = await rsync(params);
                await fs.promises.rename(tmpoutput, realoutput);
                console.log(`${driver}@${host}:all done ${res.ms}ms ${res.size}o`);
                await influxdb.insert(
                    'dockerbackup',
                    { backuphost: process.env.HOSTNAME, host: host, driver: driver, name: 'all', db: '-' },
                    { ms: res.ms, size: res.size, sizeTransfert: res.sizeTransfert, error: 0 }
                );
            } catch (e) {
                console.error(`${driver}@${host}:all FAIL`, e);
                await influxdb.insert(
                    'dockerbackup',
                    { backuphost: process.env.HOSTNAME, host: host, driver: driver, name: 'all', db: '-' },
                    { error: 1 }
                );
            }
        }

        // backup by container
        for (const container of containers) {
            if (driver == container.driver) {
                if (container.driver == 'mysqldump') {
                    var dbs = [];
                    try {
                        dbs = await getMysqlDbs({
                            host: host,
                            user: user,
                            docker: container.id,
                            mysqlUser: 'root',
                            mysqlPassword: container.env.MYSQL_ROOT_PASSWORD || 'root',
                        });
                    } catch (e) {
                        console.error(`${container.driver}@${host}:${container.name} FAIL`, e);
                        await influxdb.insert(
                            'dockerbackup',
                            { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: '-' },
                            { error: 1 }
                        );
                    }

                    // on retire les db ignorées
                    container.ignore = container.ignore || [];
                    var ignoreTables = container.ignore.filter((ignore) => ignore.includes('.'));
                    dbs = dbs.filter((db) => !container.ignore.includes(db));

                    for (var db of dbs) {
                        var realoutput = '/backup/' + host + '/' + container.name + '/mysqldump/' + now + '/' + db + '.sql.gz';
                        var tmpoutput = '/backup/.tmp/' + host + '.' + container.name + '.mysqldump.' + now + '.' + db + '.sql.gz';

                        const params = {
                            host: host,
                            user: user,
                            docker: container.id,
                            mysqlUser: 'root',
                            mysqlPassword: container.env.MYSQL_ROOT_PASSWORD || 'root',
                            dryrun: process.env.DRYRUN || 0,
                            db: db,
                            output: tmpoutput,
                            ignoreTables: ignoreTables,
                        };
                        try {
                            console.log(`${driver}@${host} start`);
                            await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                            await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                            const res = await mysqldump(params);
                            await fs.promises.rename(tmpoutput, realoutput);
                            console.log(`${container.driver}@${host}:${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                            await influxdb.insert(
                                'dockerbackup',
                                { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db },
                                { ms: res.ms, size: res.size, error: 0 }
                            );
                        } catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            await influxdb.insert(
                                'dockerbackup',
                                { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db },
                                { error: 1 }
                            );
                        }
                    }
                } else if (container.driver == 'mongodump') {
                    var dbs = [];
                    try {
                        dbs = await getMongoDbs({
                            host: host,
                            user: user,
                            docker: container.id,
                        });
                    } catch (e) {
                        console.error(`${container.driver}@${host}:${container.name} FAIL`, e);
                        await influxdb.insert(
                            'dockerbackup',
                            { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: '-' },
                            { error: 1 }
                        );
                    }

                    // on retire les db ignorées
                    container.ignore = container.ignore || [];
                    for (var db of dbs) {
                        var realoutput = '/backup/' + host + '/' + container.name + '/mysqldump/' + now + '/' + db + '.archive';
                        var tmpoutput = '/backup/.tmp/' + host + '.' + container.name + '.mysqldump.' + now + '.' + db + '.archive';

                        const params = {
                            host: host,
                            user: user,
                            docker: container.id,
                            dryrun: process.env.DRYRUN || 0,
                            db: db,
                            output: tmpoutput,
                        };
                        try {
                            await fs.promises.mkdir(path.dirname(realoutput), { recursive: true });
                            await fs.promises.mkdir(path.dirname(tmpoutput), { recursive: true });
                            const res = await mongodump(params);
                            await fs.promises.rename(tmpoutput, realoutput);
                            console.log(`${container.driver}@${host}:${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                            await influxdb.insert(
                                'dockerbackup',
                                { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db },
                                { ms: res.ms, size: res.size, error: 0 }
                            );
                        } catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            await influxdb.insert(
                                'dockerbackup',
                                { backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db },
                                { error: 1 }
                            );
                        }
                    }
                } else {
                    throw new Error('no driver found for ' + container.driver);
                }
            }
        }
    } catch (e) {
        console.error(e);
        await influxdb.insert(
            'dockerbackup',
            { backuphost: process.env.HOSTNAME, host: host, driver: 'getdocker', name: '-', db: '-' },
            { error: 1 }
        );
    }
}
