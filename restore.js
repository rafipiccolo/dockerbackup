let inquirer = require('inquirer');
let fs = require('fs');
let util = require('util');
const getDockerInspect = require('./lib/getDockerInspect');
const { exec } = require('child_process');
const verbose = require('./lib/verbose');
const rsync = require('./lib/rsync');

(async function () {
    // get args
    let remoteUser = process.argv[2];
    let remoteHost = process.argv[3];
    let remoteContainer = process.argv[4];
    let paths = [];
    for (let i in process.argv) {
        if (i < 5) continue;
        paths.push(process.argv[i]);
    }

    if (!remoteUser) {
        console.log('Usage');
        console.log('');
        console.log('Automatic mode : inquire will ask questions');
        console.log('    node restore.js');
        console.log('');
        console.log('Manual mode :');
        console.log('    node restore.js remoteUser remoteHost remoteContainer filesToRestore');
        console.log('    node restore.js root exemple.net mysql /backup/exemple.net/mysql/mysqldump/2020-05-20--01/exemple.sql.gz');
        console.log('');
        remoteUser = await askText('Remote user ?');
    }

    if (!remoteHost) {
        remoteHost = await askText('Remote host ?');
    }

    // ask for the remote Container
    let containers = await getDockerInspect({ user: remoteUser, host: remoteHost });

    if (!remoteContainer) {
        let containerNames = containers.map((c) => c.name);
        remoteContainer = await askList(containerNames, 'Destination container ?');
    }

    remoteContainer = containers.filter((c) => c.name == remoteContainer);
    remoteContainer = remoteContainer[0];

    // if there is no path specified, ask for it
    if (paths.length == 0) {
        let path = '/backup';

        {
            let files = await fs.promises.readdir(path);
            files.filter((file) => file != '/backup/.tmp');
            let server = await ask(files, 'Server ?');
            path += `/${server}`;
        }

        {
            let files = await fs.promises.readdir(path);
            let container = await ask(files, 'Container ?');
            path += `/${container}`;
        }

        {
            let files = await fs.promises.readdir(path);
            let driver = await ask(files, 'Driver ?');
            path += `/${driver}`;
        }

        {
            let files = await fs.promises.readdir(path);
            let time = await ask(files, 'time ?');
            path += `/${time}`;
        }

        paths.push(path);
    }

    // we restore every path
    for (let path of paths) await restore({ path, remoteHost, remoteContainer });

    console.log('Done');
}());

async function restore(options) {
    let m = options.path.match(/\/backup\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)/);

    if (!m) throw new Error('bad path');
    let [_, server, container, driver, time] = m;

    if (driver == 'rsync') {
        if ((await fs.promises.stat(options.path)).isDirectory() && options.path[options.path.length - 1] != '/') options.path = `${options.path}/`;
        let file = options.path.replace(`/backup/${server}/${driver}/${time}/`, '');
        const params = {
            host: options.remoteHost,
            user: options.remoteUser,
            path: options.path,
            output: `/root/docker/${options.remoteContainer.name}/${file}`,
            dryrun: process.env.DRYRUN || 0,
        };
        const res = await rsync(params);
        console.log(`${container.driver}@${container.name} done ${res.ms}ms ${res.size}o`);
    } else if (driver == 'mysqldump') {
        let m = options.path.match(/([0-9a-zA-z_\-\.]+)\.sql\.gz$/);
        let database = '';
        if (!m) {
            let files = await fs.promises.readdir(options.path);
            database = await ask(files, 'Database ?');
            options.path += `/${database}`;
            database = database.replace('.sql.gz', '');
        } else database = m[1];

        await execCommand(
            `echo 'create database if not exists ${database}' | ssh ${options.remoteHost} 'docker exec -i ${options.remoteContainer.name} mysql -u root -p${options.remoteContainer.env.MYSQL_ROOT_PASSWORD}'`
        );
        await execCommand(
            `cat ${options.path} | gunzip | ssh ${options.remoteHost} 'docker exec -i ${options.remoteContainer.name} mysql -u root -p${options.remoteContainer.env.MYSQL_ROOT_PASSWORD} ${database}'`
        );
    } else if (driver == 'mongodump') {
        let m = options.path.match(/([0-9a-zA-z_\-\.]+)\.archive$/);
        let database = '';
        if (!m) {
            let files = await fs.promises.readdir(options.path);
            database = await ask(files, 'Database ?');
            options.path += `/${database}`;
            database = database.replace('.archive', '');
        } else database = m[1];

        await execCommand(
            `cat ${options.path} | ssh ${options.remoteHost} 'docker exec -i ${options.remoteContainer.name} mongorestore --gzip --archive'`
        );
    } else {
        throw new Error('bad driver');
    }
}

async function ask(files, question) {
    let params = [
        {
            type: 'list',
            name: 'answer',
            message: question,
            choices: files,
        },
    ];
    let answer = await inquirer.prompt(params);
    return answer.answer;
}

async function askText(question) {
    let params = [
        {
            type: 'input',
            name: 'answer',
            message: question,
        },
    ];
    let answer = await inquirer.prompt(params);
    return answer.answer;
}

async function askList(choices, question) {
    let params = [
        {
            type: 'list',
            name: 'answer',
            choices,
            message: question,
        },
    ];
    let answer = await inquirer.prompt(params);
    return answer.answer;
}

function execCommand(cmd) {
    verbose(cmd);
    if (process.env.DRYRUN) return;

    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) return reject(new error(`exec error: ${error}`));

            resolve(stdout);
        });
    });
}
