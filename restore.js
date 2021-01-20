var inquirer = require('inquirer');
var fs = require('fs');
var util = require('util');
const getDockerInspect = require('./lib/getDockerInspect');
const { exec } = require('child_process');
const verbose = require('./lib/verbose');
const rsync = require('./lib/rsync');

(async function () {
    // get args
    var remoteUser = process.argv[2];
    var remoteHost = process.argv[3];
    var remoteContainer = process.argv[4];
    var paths = [];
    for (var i in process.argv) {
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
    var containers = await getDockerInspect({ user: remoteUser, host: remoteHost });

    if (!remoteContainer) {
        var containerNames = containers.map((c) => c.name);
        remoteContainer = await askList(containerNames, 'Destination container ?');
    }

    remoteContainer = containers.filter((c) => c.name == remoteContainer);
    remoteContainer = remoteContainer[0];

    // if there is no path specified, ask for it
    if (paths.length == 0) {
        var path = '/backup';

        var files = await fs.promises.readdir(path);
        files.filter((file) => file != '/backup/.tmp');
        var server = await ask(files, 'Server ?');
        path += '/' + server;

        var files = await fs.promises.readdir(path);
        var container = await ask(files, 'Container ?');
        path += '/' + container;

        var files = await fs.promises.readdir(path);
        var driver = await ask(files, 'Driver ?');
        path += '/' + driver;

        var files = await fs.promises.readdir(path);
        var time = await ask(files, 'time ?');
        path += '/' + time;

        paths.push(path);
    }

    // we restore every path
    for (var path of paths) await restore({ path, remoteHost, remoteContainer });

    console.log('Done');
})();

async function restore(options) {
    var m = options.path.match(/\/backup\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)/);

    if (!m) throw 'bad path';
    var [_, server, container, driver, time] = m;

    if (driver == 'rsync') {
        if ((await fs.promises.stat(options.path)).isDirectory() && options.path[options.path.length - 1] != '/') options.path = options.path + '/';
        var file = options.path.replace('/backup/' + server + '/' + driver + '/' + time + '/', '');
        const params = {
            host: options.remoteHost,
            user: options.remoteUser,
            path: options.path,
            output: '/root/docker/' + options.remoteContainer.name + '/' + file,
            dryrun: process.env.DRYRUN || 0,
        };
        const res = await rsync(params);
        console.log(`${container.driver}@${container.name} done ${res.ms}ms ${res.size}o`);
    } else if (driver == 'mysqldump') {
        var m = options.path.match(/([0-9a-zA-z_\-\.]+)\.sql\.gz$/);
        var database = '';
        if (!m) {
            let files = await fs.promises.readdir(options.path);
            database = await ask(files, 'Database ?');
            options.path += '/' + database;
            database = database.replace('.sql.gz', '');
        } else database = m[1];

        await execCommand(
            "echo 'create database if not exists " +
                database +
                "' | ssh " +
                options.remoteHost +
                " 'docker exec -i " +
                options.remoteContainer.name +
                ' mysql -u root -p' +
                options.remoteContainer.env.MYSQL_ROOT_PASSWORD +
                "'"
        );
        await execCommand(
            'cat ' +
                options.path +
                ' | gunzip | ssh ' +
                options.remoteHost +
                " 'docker exec -i " +
                options.remoteContainer.name +
                ' mysql -u root -p' +
                options.remoteContainer.env.MYSQL_ROOT_PASSWORD +
                ' ' +
                database +
                "'"
        );
    } else if (driver == 'mongodump') {
        var m = options.path.match(/([0-9a-zA-z_\-\.]+)\.archive$/);
        var database = '';
        if (!m) {
            let files = await fs.promises.readdir(options.path);
            database = await ask(files, 'Database ?');
            options.path += '/' + database;
            database = database.replace('.archive', '');
        } else database = m[1];

        await execCommand(
            'cat ' +
                options.path +
                ' | ssh ' +
                options.remoteHost +
                " 'docker exec -i " +
                options.remoteContainer.name +
                " mongorestore --gzip --archive'"
        );
    } else {
        throw 'bad driver';
    }
}

async function ask(files, question) {
    var question = [
        {
            type: 'list',
            name: 'answer',
            message: question,
            choices: files,
        },
    ];
    var answer = await inquirer.prompt(question);
    return answer.answer;
}

async function askText(question) {
    var question = [
        {
            type: 'input',
            name: 'answer',
            message: question,
        },
    ];
    var answer = await inquirer.prompt(question);
    return answer.answer;
}

async function askList(choices, question) {
    var question = [
        {
            type: 'list',
            name: 'answer',
            choices,
            message: question,
        },
    ];
    var answer = await inquirer.prompt(question);
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
