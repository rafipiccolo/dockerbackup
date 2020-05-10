const moment = require('moment');
const getDockerLabels = require('./lib/getDockerLabels');
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

main();

async function main() {
    try {
        // get and parse labels from remote docker
        var containers = await getDockerLabels({user, host});
        containers = JSON.parse(containers);
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
