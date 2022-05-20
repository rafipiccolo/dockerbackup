import inquirer from 'inquirer';
import fs from 'fs';
import util from 'util';
import getDockerInspect from './lib/getDockerInspect.js';
import { exec } from 'child_process';
import verbose from './lib/verbose.js';
import rsync from './lib/rsync.js';

// get args
let remoteUser = process.argv[2];
let remoteHost = process.argv[3];
let remoteContainer = process.argv[4];
const paths = [];
for (const i in process.argv) {
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
const containers = await getDockerInspect({ user: remoteUser, host: remoteHost });

if (!remoteContainer) {
    const containerNames = containers.map((c) => c.name);
    remoteContainer = await askList(containerNames, 'Destination container ?');
}

remoteContainer = containers.filter((c) => c.name == remoteContainer);
remoteContainer = remoteContainer[0];

// if there is no path specified, ask for it
if (paths.length == 0) {
    let path = '/backup';

    {
        const files = await fs.promises.readdir(path);
        files.filter((file) => file != '/backup/.tmp');
        const server = await ask(files, 'Server ?');
        path += `/${server}`;
    }

    {
        const files = await fs.promises.readdir(path);
        const container = await ask(files, 'Container ?');
        path += `/${container}`;
    }

    {
        const files = await fs.promises.readdir(path);
        const driver = await ask(files, 'Driver ?');
        path += `/${driver}`;
    }

    {
        const files = await fs.promises.readdir(path);
        const time = await ask(files, 'time ?');
        path += `/${time}`;
    }

    paths.push(path);
}

// we restore every path
for (const path of paths) await restore({ path, remoteHost, remoteContainer });

console.log('Done');

async function restore(options) {
    const m = options.path.match(/\/backup\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)/);

    if (!m) throw new Error('bad path');
    const [_, server, container, driver, time] = m;

    if (driver == 'rsync') {
        if ((await fs.promises.stat(options.path)).isDirectory() && options.path[options.path.length - 1] != '/') options.path = `${options.path}/`;
        const file = options.path.replace(`/backup/${server}/${driver}/${time}/`, '');
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
        const m = options.path.match(/([0-9a-zA-z_\-\.]+)\.sql\.gz$/);
        let database = '';
        if (!m) {
            const files = await fs.promises.readdir(options.path);
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
        const m = options.path.match(/([0-9a-zA-z_\-\.]+)\.archive$/);
        let database = '';
        if (!m) {
            const files = await fs.promises.readdir(options.path);
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
    const params = [
        {
            type: 'list',
            name: 'answer',
            message: question,
            choices: files,
        },
    ];
    const answer = await inquirer.prompt(params);
    return answer.answer;
}

async function askText(question) {
    const params = [
        {
            type: 'input',
            name: 'answer',
            message: question,
        },
    ];
    const answer = await inquirer.prompt(params);
    return answer.answer;
}

async function askList(choices, question) {
    const params = [
        {
            type: 'list',
            name: 'answer',
            choices,
            message: question,
        },
    ];
    const answer = await inquirer.prompt(params);
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
