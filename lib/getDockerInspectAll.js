import { exec } from 'child_process';
import shellescape from 'shell-escape';
import verbose from './verbose.js';

function getDockerInspectService(params, serviceId) {
    const user = params.user;
    const host = params.host;

    const args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${user}@${host}`);
    args.push(`docker inspect ${serviceId}`);
    const cmd = shellescape(args);

    verbose(cmd);

    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            // parse
            const containers = JSON.parse(stdout.trim());

            resolve(containers);
        });
    });
}

function getDockerInspect(params) {
    const user = params.user;
    const host = params.host;

    const args = [];
    args.push('ssh');
    args.push('-oBatchMode=yes');
    args.push(`${user}@${host}`);
    args.push("docker inspect $(docker ps -q) | jq '[.[] | { Id: .Id, Name: .Name, Labels: .Config.Labels, Env: .Config.Env }]'");
    const cmd = shellescape(args);

    verbose(cmd);

    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (stderr) return reject(stderr);
            if (err) return reject(err);

            // parse
            const containers = JSON.parse(stdout.trim());

            // clean
            containers.forEach((container) => {
                // .Env as array => .env as object
                container.env = container.Env.reduce((a, e) => {
                    const m = e.match(/([^=]+)=(.*)/i);
                    if (!m) {
                        // console.error('not parsable '+e);
                        return a;
                    }
                    const key = m[1];
                    const value = m[2];
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
}

export default async function (params) {
    // prends la liste des conteneurs running
    const data = await getDockerInspect(params);

    // debug
    // data = data.filter(x => x.Name.match(/swarm_mysql/))

    // si c'est dans un swarm (serviceId) on prend les labels du service
    for (const d of data)
        if (d.Labels['com.docker.swarm.service.id']) {
            // remove shit arround containername
            d.name = d.name.replace(/swarm[-_]([0-9a-z_\-]+)\.\d+\.\w+/i, '$1');

            const tasks = await getDockerInspectService(params, d.Labels['com.docker.swarm.service.id']);

            d.Labels ||= {};
            d.Labels = {
                ...d.Labels,
                ...tasks[0].Spec.Labels,
            };
        }

    return data;
}
