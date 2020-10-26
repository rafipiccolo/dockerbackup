const moment = require('moment');
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
const filter = process.argv[3];

if (process.argv.length > 4 || !userhosts) {
    console.error('please specify a user@hostname (separated by ",") and optionally a driver (mysqldump/mongodump/rsync)');
    process.exit(1);
}

const now = moment().format('YYYY-MM-DD--HH');

(async function() {
    userhosts = userhosts.split(',');
    for (var userhost of userhosts) {
        var m = userhost.match(/([a-z0-9\.\-]+)@([a-z0-9\.\-]+)/i)
        if (!m) {
            console.error('please specify a user@hostname (separated by ",")');
            process.exit(1);
        }
        const [_, user, host] = m;
        await main(user, host, filter, now);
    }
})()



async function main(user, host, filter, now) {
    try {
        // get and parse labels from remote docker
        var containers = await getDockerInspect({user, host});
        containers = containers.map(parseContainer).filter(container => container);
        
        verbose(`found ${containers.length} backup jobs`);

        if (!filter || filter == 'rsync') {
            // backup global using rsync
            var linkdest = await getLatestDir('/backup/' + host + '/all/')

            const params = {
                host: host,
                user: user,
                path: '/root/',
                output: '/backup/' + host + '/all/' + now + '/',
                linkdest: linkdest ? linkdest + '/': null,
                excludes: [
                    'node_modules/',
                    'docker/mysql/data',
                    'docker/mongo',
                    'docker/influxdb/data',
                    'docker/rtorrent/',
                    'docker/filebrowser/',
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
            }
            try {
                const res = await rsync(params);
                console.log(`rsync@${host}:all done ${res.ms}ms ${res.size}o`);
                await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: 'rsync', name: 'all', db: '-' }, { ms: res.ms, size: res.size, sizeTransfert: res.sizeTransfert, error: 0 });
            }
            catch(e) {
                console.error(`rsync@${host}:all FAIL`, e);
                await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: 'rsync', name: 'all', db: '-' }, { error: 1 });
            }
            
        }
        
        // backup by container
        for (const container of containers) {
            if (!filter || filter == container.driver) {
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
                    }
                    catch (e) {
                        console.error(`${container.driver}@${host}:${container.name} FAIL`, e);
                        await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: '-' }, { error: 1 });
                    }
                    
                    // on retire les db ignorées
                    container.ignore = container.ignore || [];
                    var ignoreTables = container.ignore.filter((ignore) => ignore.includes('.'))
                    dbs = dbs.filter((db) => !container.ignore.includes(db));
                    
                    for (var db of dbs) {
                        const params = {
                            host: host,
                            user: user,
                            docker: container.id,
                            mysqlUser: 'root',
                            mysqlPassword: container.env.MYSQL_ROOT_PASSWORD||'root',
                            dryrun: process.env.DRYRUN || 0,
                            db: db,
                            output: '/backup/'+host+'/'+container.name+'/mysqldump/'+now+'/'+db+'.sql.gz',
                            ignoreTables: ignoreTables,
                        };
                        try {
                            const res = await mysqldump(params);
                            console.log(`${container.driver}@${host}:${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                            await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db:db }, { ms: res.ms, size: res.size, error: 0});
                        }
                        catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db }, { error: 1 });
                        }
                    }
                }
                else if (container.driver == 'mongodump') {
                    var dbs = [];
                    try {
                        dbs = await getMongoDbs({
                            host: host,
                            user: user,
                            docker: container.id,
                        });
                    }
                    catch (e) {
                        console.error(`${container.driver}@${host}:${container.name} FAIL`, e);
                        await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: '-' }, { error: 1 });
                    }

                    // on retire les db ignorées
                    container.ignore = container.ignore || [];
                    for (var db of dbs) {
                        const params = {
                            host: host,
                            user: user,
                            docker: container.id,
                            dryrun: process.env.DRYRUN || 0,
                            db: db,
                            output: '/backup/'+host+'/'+container.name+'/mongodump/'+now+'/'+db+'.archive',
                        }
                        try {
                            const res = await mongodump(params);
                            console.log(`${container.driver}@${host}:${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                            await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db }, { ms: res.ms, size: res.size, error: 0 });
                        }
                        catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: container.driver, name: container.name, db: db }, { error: 1 });
                        }
                    }
                }
                else {
                    throw new Error('no driver found for '+container.driver);
                }
            }
        }
    }
    catch(e) {
        console.error(e);
        await influxdb.insert('dockerbackup', {backuphost: process.env.HOSTNAME, host: host, driver: 'getdocker', name: '-', db: '-'}, { error: 1 });
    }
}
