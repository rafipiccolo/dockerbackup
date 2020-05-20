var inquirer = require('inquirer');
var fs = require('fs'); 
var util = require('util'); 
const getDockerInspect = require('./lib/getDockerInspect');
var readdir = util.promisify(fs.readdir);
var stat = util.promisify(fs.stat);

(async function() {

    // get args
    var remoteUser = process.argv[2]
    var remoteHost = process.argv[3]
    var remoteContainer = process.argv[4]
    var paths = [];
    for (var i in process.argv) {
        if (i < 5) continue;
        paths.push(process.argv[i])
    }

    if (!remoteUser) {
        console.log('Usage');
        console.log('');
        console.log('Automatic mode : inquire will ask questions');
        console.log('    node restore.js');
        console.log('');
        console.log('Manual mode :');
        console.log('    node restore.js remoteUser remoteHost remoteContainer filesToRestore');
        console.log('    node restore.js root old2.gextra.net mysql /backup/flatbay.fr/mysql/mysqldump/2020-05-20--01/flatbay_prod.sql.gz');
        console.log('');
        remoteUser = await askText('Remote user ?');
    }

    if (!remoteHost) {
        remoteHost = await askText('Remote host ?');
    }

    // ask for the remote Container
    var containers = await getDockerInspect({ user: remoteUser, host: remoteHost });

    if (!remoteContainer) {
        containerNames = containers.map(c => c.name);
        remoteContainer = await askList(containerNames, 'Destination container ?');
    }

    remoteContainer = containers.filter(c => c.name == remoteContainer);
    remoteContainer = remoteContainer[0];

    // if there is no path specified, ask for it
    if (paths.length == 0) {
        var path = '/backup';

        var server = await ask(path, 'Server ?');
        path += '/'+server;

        var container = await ask(path, 'Container ?');
        path += '/'+container;

        var driver = await ask(path, 'Driver ?');
        path += '/'+driver;

        var time = await ask(path, 'time ?');
        path += '/'+time;

        paths.push(path)
    }

    // we restore every path
    for (var path of paths)
        await restore({ path, remoteHost, remoteContainer});

    console.log('Done');
})()

async function restore(options) {

    var m = options.path.match(/\/backup\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)\/([0-9a-zA-z_\-\.]+)/);

    if (!m) throw('bad path');
    var [_, server,container,driver,time] = m;

    if (driver == 'rsync') {
        if ((await stat(options.path)).isDirectory() && options.path[options.path.length - 1] != '/')
            options.path = options.path + '/';
        var file = options.path.replace('/backup/'+server+'/'+container+'/'+driver+'/'+time+'/', '');
        console.log('rsync -azP ' + options.path + ' '+options.remoteHost+':/root/docker/'+options.remoteContainer.name+'/'+file);
    }
    else if (driver == 'mysqldump') {
        var m = options.path.match(/([0-9a-zA-z_\-\.]+)\.sql\.gz$/);
        var database = '';
        if (!m){
            database = await ask(options.path, 'Database ?');
            options.path += '/'+database;
            database = database.replace('.sql.gz', '');
        }
        else
            database = m[1];

        console.log("echo 'create database if not exists "+database+"' | ssh "+options.remoteHost+" 'docker exec -i "+options.remoteContainer.name+" mysql -u root -p"+options.remoteContainer.env.MYSQL_ROOT_PASSWORD+"'");
        console.log("cat "+options.path+" | gunzip | ssh "+options.remoteHost+" 'docker exec -i "+options.remoteContainer.name+" mysql -u root -p"+options.remoteContainer.env.MYSQL_ROOT_PASSWORD+" "+database+"'");
    }
    else if (driver == 'mongodump') {
        var m = options.path.match(/([0-9a-zA-z_\-\.]+)\.archive$/);
        var database = '';
        if (!m){
            database = await ask(options.path, 'Database ?');
            options.path += '/'+database;
            database = database.replace('.archive', '');
        }
        else
            database = m[1];
        
        console.log("cat "+options.path+" | ssh "+options.remoteHost+" 'docker exec -i "+options.remoteContainer.name+" mongorestore --gzip --archive'");
    }
    else {
        throw 'bad driver';
    }
}


async function ask(path, question) {
    var files =  await readdir(path);
    var question = [
        {
            type: 'list',
            name: 'answer',
            message: question,
            choices: files,
        }
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
        }
    ];
    var answer = await inquirer.prompt(question);
    return answer.answer;
}

async function askList(choices, question) {
    var question = [
        {
            type: 'list',
            name: 'answer',
            choices: choices,
            message: question,
        }
    ];
    var answer = await inquirer.prompt(question);
    return answer.answer;
}
