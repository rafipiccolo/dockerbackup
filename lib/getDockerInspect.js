'use strict';

const exec = require('child_process').exec;
const shellescape = require('shell-escape');
const verbose = require('./verbose');

// mysqldump - P 3306 - h[ip_address] - u[uname] - p db_name > db_backup.sql

module.exports = function getDockerLabels(params) {
    const user = params.user;
    const host = params.host;

    var args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${user}@${host}`);
    args.push("docker inspect $(docker ps -aq) | jq '[.[] | { Id: .Id, Name: .Name, Labels: .Config.Labels, Env: .Config.Env }]'");
    var cmd = shellescape(args);

    verbose(cmd);

    return new Promise((resolve, reject) => {
        exec(cmd, function (err, stdout, stderr) {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            // parse
            var containers = JSON.parse(stdout.trim());

            // clean
            containers.forEach(function (container) {
                // .Env as array => .env as object
                container.env = container.Env.reduce((a, e) => {
                    var m = e.match(/([^=]+)=(.*)/i);
                    if (!m) {
                        // console.error('not parsable '+e);
                        return a;
                    }
                    var key = m[1];
                    var value = m[2];
                    a[key] = value;
                    return a;
                }, {});

                // .Name with / => .name clean
                container.name = container.Name.replace(/^\//, '');

                // .Id => .id
                container.id = container.Id;
            });

            resolve(containers);
        });
    });
};
