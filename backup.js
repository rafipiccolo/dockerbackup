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

if (!user || !host) {
    console.error('please specify a user and a hostname');
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
        for (const container of containers) {
            if (container.driver == 'rsync') {
                const params = {
                    host: host,
                    user: user,
                    dir: '/root/docker/'+container.name+'/',
                    output: '/backup/'+host+'/'+container.name+'/rsync/'+now,
                    linkdest: await getLatestDir('/backup/'+host+'/'+container.name+'/rsync/'),
                    excludes: container.ignore,
                    dryrun: process.env.DRYRUN || 0,
                }
                const res = await rsync(params);
                console.log(`${container.driver}@${container.name} done ${res.ms}ms ${res.size}o`);
                influxdb({host: host, driver: container.driver, name: container.name, db:'-', ms: res.ms, size: res.size});
            }
            else if (container.driver == 'mysqldump') {
                var dbs = await getMysqlDbs({
                    host: host,
                    user: user,
                    docker: container.id,
                    mysqlUser: 'root',
                    mysqlPassword: container.env.MYSQL_ROOT_PASSWORD||'root',
                });
                // on retire les db ignorées
                container.ignore = container.ignore || [];
                var ignoredb = container.ignore.filter((ignore) => ignore.includes('.'))
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
                        ignoreTables: container.ignore.filter((ignore) => ignore.includes(db+'.')),
                    };
                    const res = await mysqldump(params);
                    console.log(`${container.driver}@${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                    influxdb({host: host, driver: container.driver, name: container.name, db:db, ms: res.ms, size: res.size});
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
                    const res = await mongodump(params);
                    console.log(`${container.driver}@${container.name}:${db} done ${res.ms}ms ${res.size}o`);
                    influxdb({host: host, driver: container.driver, name: container.name, db:db, ms: res.ms, size: res.size});
                }
            }
            else {
                throw new Error('no driver found for '+container.driver);
            }
        }
    }
    catch(e) {
        console.error(e);
    }
}


// INFLUXDB output
function influxdb(data) {
    if (!process.env.INFLUXDB) return;

    var body = 'dockerbackup,host='+data.host+',name='+data.name+',driver='+data.driver+',db='+data.db+' ms='+data.ms+',size='+data.size+' '+(Date.now()*1000000);
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
