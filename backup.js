require('dotenv').config()

const moment = require('moment');
const request = require('request');
const getDockerInspect = require('./lib/getDockerInspect');
const parseContainer = require('./lib/parseContainer');
const verbose = require('./lib/verbose');
const getLatestDir = require('./lib/getLatestDir');
const getMysqlDbs = require('./lib/getMysqlDbs');
const getMongoDbs = require('./lib/getMongoDbs');

const rsync = require('./lib/rsync');
const mysqldump = require('./lib/mysqldump');
const mongodump = require('./lib/mongodump');

const user = process.argv[2];
const host = process.argv[3];
const filter = process.argv[4];

if (!user || !host) {
    console.error('please specify a user and a hostname and optionally a driver (mysqldump/mongodump)');
    process.exit(1);
}

main();

async function main() {
    try {
        // get and parse labels from remote docker
        var containers = await getDockerInspect({user, host});
        containers = containers.map(parseContainer).filter(container => container);
        
        verbose(`found ${containers.length} backup jobs`);
        
        // for each container remaining we execute backup
        const now = moment().format('YYYY-MM-DD--HH');

        if (!filter || filter == 'rsync') {
            // backup global using rsync
            const params = {
                host: host,
                user: user,
                dir: '/root/',
                output: '/backup/' + host + '/all/' + now,
                linkdest: await getLatestDir('/backup/' + host + '/all/'),
                excludes: [
                    'node_modules/',
                    'docker/mysql/',
                    'docker/mongo',
                    'docker/influxdb',
                    'docker/rtorrent/',
                    '.npm/',
                    '.cache/',
                    '.vscode-server-insiders',
                    'log/',
                    'logs/',
                ],
                dryrun: process.env.DRYRUN || 0,
            }
            try {
                const res = await rsync(params);
                console.log(`rsync@${host}:all done ${res.ms}ms ${res.size}o`);
                influxdb({ host: host, driver: 'rsync', name: 'all', db: '-', ms: res.ms, size: res.size, error: 0 });
            }
            catch(e) {
                console.error(`rsync@${host}:${container.name}:${db} FAIL`, e);
                influxdb({ host: host, driver: 'rsync', name: 'all', db: '-', error: 1 });
            }
            
        }
        
        // backup by container
        for (const container of containers) {
            if (!filter || filter == container.driver) {
                if (container.driver == 'mysqldump') {
                    var dbs = await getMysqlDbs({
                        host: host,
                        user: user,
                        docker: container.id,
                        mysqlUser: 'root',
                        mysqlPassword: container.env.MYSQL_ROOT_PASSWORD||'root',
                    });
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
                            influxdb({host: host, driver: container.driver, name: container.name, db:db, ms: res.ms, size: res.size, error: 0});
                        }
                        catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            influxdb({ host: host, driver: container.driver, name: container.name, db: db, error: 1 });
                        }
                    }
                }
                else if (container.driver == 'mongodump') {
                    var dbs = await getMongoDbs({
                        host: host,
                        user: user,
                        docker: container.id,
                    });
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
                            influxdb({ host: host, driver: container.driver, name: container.name, db: db, ms: res.ms, size: res.size, error: 0 });
                        }
                        catch (e) {
                            console.error(`${container.driver}@${host}:${container.name}:${db} FAIL`, e);
                            influxdb({ host: host, driver: container.driver, name: container.name, db: db, error: 1 });
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
        influxdb({ host: host, driver: 'getdocker', name: '-', db: '-', error: 1 });
    }
}


// INFLUXDB output
function influxdb(data) {
    if (!process.env.INFLUXDB) return;

    var body = 'dockerbackup,host='+data.host+',name='+data.name+',driver='+data.driver+',db='+data.db+' ms='+data.ms+',size='+data.size+',error='+data.error+' '+(Date.now()*1000000);
    verbose('curl -XPOST '+process.env.INFLUXDB+' --data-binary '+"'"+body+"'");

    request({
        method: 'POST',
        url: process.env.INFLUXDB,
        body: body,
        forever: true,
    }, function(err, response, body) {
        if (err) return console.error('Influxdb error', err);
        if (parseInt(response.statusCode / 100) != 2) return console.error('influxdb statuscode error', { statusCode: response.statusCode, body });
        
        verbose('INFLUXDB OK');
    });
}
