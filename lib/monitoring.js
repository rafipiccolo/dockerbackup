import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import path from 'path';
/* eslint no-console: "off" */
import uniqid from 'uniqid';
import prettyMs from 'pretty-ms';
import moment from 'moment';
import fs from 'fs';
import requestPromise from './requestPromise.js';
import influxdb from './influxdb.js';

const red = '\x1B[31m';
const green = '\x1B[32m';
const yellow = '\x1B[33m';
const blue = '\x1B[36m';
const reset = '\x1B[0m';

/*
 * efficiently group and push data to the monitoring server
 *
 * group data to push into the "queue" array
 * it then makes a request with max 10000 data on each call
 * the queue is checked every 1000ms
 */
let queue = [];
const max = 10000;
const timeoutMs = 1000;
let timeout = null;

function startQueue() {
    timeout = setTimeout(flushqueue, timeoutMs);

    // while the queue is inactive the program can stop
    timeout.unref();
}
async function flushqueue() {
    clearTimeout(timeout);

    if (!process.env.MONITORING_URL) return;
    // while there is data to push
    // extract from the array, the first "max" data
    // this data is removed from the original array
    // we call request with the data
    const tmpqueue = queue;
    queue = [];
    while (tmpqueue.length > 0) {
        const data = tmpqueue.splice(0, max);
        try {
            const { response, body } = await requestPromise({
                url: `${process.env.MONITORING_URL}/push`,
                method: 'POST',
                json: data,
                forever: true,
            });
            if (parseInt(response.statusCode / 100) != 2) throw new Error(`Status code = ${response.statusCode} : ${JSON.stringify(body, null, 4)}`);
        } catch (err) {
            console.error('MONITORING_URL request error', JSON.stringify(errorToObject(err), null, 4));
        }
    }
    startQueue();
}

startQueue();

/*
 * push a log in the queue, to be pushed to the log server
 */
function pushData(json) {
    // while the queue is active the program wont stop
    timeout.ref();

    if (!process.env.MONITORING_URL) return;

    json.time = moment(new Date()).format('YYYY-MM-DD HH:mm:ss.SSS');
    queue.push(json);
}

/*
 * calculate access log stats in memory
 */
const routes = {};
function getStatsBy(field) {
    return Object.values(routes).sort((a, b) => b[field] - a[field]);
}
function statmiddleware(req, res, next) {
    const start = process.hrtime();

    const writeHead = res.writeHead;
    const writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        const end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        const route = req.route?.path;

        routes[route] = routes[route] || {
            route,
            avg: null,
            nb: 0,
            min: null,
            max: null,
        };

        routes[route].avg = (routes[route].avg * routes[route].nb + ms) / (routes[route].nb + 1);

        if (routes[route].min === null || routes[route].min > ms) routes[route].min = ms;

        if (routes[route].max === null || routes[route].max < ms) routes[route].max = ms;

        routes[route].nb++;

        writeHeadbound(statusCode, statusMessage, headers);
    };

    next();
}

function idmiddleware(req, res, next) {
    req.id = req.get('X-Request-Id') || uniqid();
    // asyncLocalStorage.run(req.id, async () => {
    //     next();
    // });
    next();
}

/*
 * when the request has ended, we delete the uploaded files
 * you need to save it in another path for it to stay on the server
 */
function multerCleanMiddleware(req, res, next) {
    const writeHead = res.writeHead;
    const writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // dont use await here, writeHead is suposed to be synchronous
        if (req.files) {
            for (const file of req.files) {
                fs.unlink(file.path, (err) => {
                    if (err) console.error(err);
                });
            }
        }

        writeHeadbound(statusCode, statusMessage, headers);
    };

    next();
}

/*
 * profiling routes
 */
function timermiddleware(req, res, next) {
    req.startTimer = function (name) {
        req.timer = performance.now();
    };
    req.sendTimer = function (name) {
        const newtime = performance.now();
        console.log(`timer: ${req.route?.path} : ${name} : ${prettyMs(newtime - req.timer)}`);
        req.timer = newtime;
    };
    next();
}

/*
 * log express access to terminal and push data to the queue to remote log server
 */
function logmiddleware(req, res, next) {
    const start = process.hrtime();

    const writeHead = res.writeHead;
    const writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        const end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        // color status code
        let colorStatusCode = '';
        if (parseInt(statusCode / 100) == 2) colorStatusCode = `${green}${statusCode}${reset}`;
        else if (parseInt(statusCode / 100) == 3) colorStatusCode = `${yellow}${statusCode}${reset}`;
        else colorStatusCode = `${red}${statusCode}${reset}`;

        console.log(`${req.id} ${req.method} ${req.originalUrl} ${colorStatusCode} ${blue}${prettyMs(ms)}${reset}`);

        const json = {
            type: 'access',
            hostname: process.env.HOSTNAME,
            method: req.method,
            url: req.originalUrl,
            route: req.route?.path,
            statusCode,
            ms,
            userId: req.session?.user?.id,
            userEmail: req.session?.user?.email,
            userName: `${req.session?.user?.firstName || ''} ${req.session?.user?.lastName || ''}`,
            userAgent: req.get('user-agent'),
            referrer: req.get('referrer'),
            accept: req.get('Accept'),
            forwardedFor: req.get('x-forwarded-for'),
            ip: req.ip,
            requestId: req.id,
        };
        pushData(json);

        writeHeadbound(statusCode, statusMessage, headers);
    };

    next();
}

/*
 * handle express errors :
 * - show complete error in terminal
 * - return html or json depending on client being a bot or a browser
 */
function errormiddleware(app) {
    return function errormiddleware(err, req, res, next) {
        // display the error and nested errors
        err = errorToObject(err);
        console.log(JSON.stringify(err, null, 4));

        // send the error to the monitoring server
        const statusCode = err.status || 500;
        const json = {
            type: 'error',
            hostname: process.env.HOSTNAME,
            method: req.method,
            url: req.originalUrl,
            route: req.route?.path,
            statusCode,
            userId: req.session?.user?.id,
            userEmail: req.session?.user?.email,
            userName: `${req.session?.user?.firstName || ''} ${req.session?.user?.lastName || ''}`,
            userAgent: req.get('user-agent'),
            referrer: req.get('referrer'),
            accept: req.get('Accept'),
            forwardedFor: req.get('x-forwarded-for'),
            ip: req.ip,
            requestId: req.id,
            err,
        };
        pushData(json);

        // set error status code
        res.status(statusCode);

        // if it's a nodejs request => no user agent
        // or user agent is curl
        // => it's a bot
        // => we return json, else html/text
        const bot = !req.get('user-agent') || req.get('user-agent').indexOf('curl/') != -1;
        if (bot || req.query.format == 'json')
            return res.send({
                error: {
                    message: err.message,
                    stack: err.stack,
                },
            });

        // if project has a render engine
        if (app.get('view engine')) {
            res.render('error', { error: err }, (newerr, html) => {
                if (!newerr) return res.send(html);

                res.send({
                    err,
                    newerr: errorToObject(newerr),
                });
            });
            return;
        }

        // we send raw text
        res.send(`${err.message}`);
    };
}

/*
 * returns a 404 error
 */
function notfoundmiddleware(req, res, next) {
    const err = new Error('Page not found');
    err.status = 404;
    next(err);
}

/*
 * automatically deal with favicon and well-known files
 */
function faviconmiddleware(app) {
    // favicons
    const favicon = path.resolve(`${__dirname}/../web/img/favicon.png`);
    app.get('/favicon.ico', (req, res) => {
        res.sendFile(favicon);
    });
    app.get('/favicon.jpg', (req, res) => {
        res.sendFile(favicon);
    });
    app.get('/favicon.png', (req, res) => {
        res.sendFile(favicon);
    });
    app.get('/apple-touch-icon.png', (req, res) => {
        res.sendFile(favicon);
    });

    // tell robots which pages they should scan
    app.get('/robots.txt', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send('User-agent: *\nDisallow:\n');
    });

    // tell good hackers who they can write reports to
    app.get('/.well-known/security.txt', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send(`Contact: mailto:${process.env.MAIL_CONTACT}\nEncryption:\nAcknowledgements:\nPolicy:\nSignature:\nHiring:\n`);
    });

    // ie 11 (deprecate)
    app.get('/browserconfig.xml', (req, res) => {
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="utf-8"?><browserconfig><msapplication></msapplication></browserconfig>`);
    });

    // open urls directly in android app
    app.get('/.well-known/assetlinks.json', (req, res) => {
        res.send([
            // {
            //     "relation": ["delegate_permission/common.handle_all_urls"],
            //     "target": {
            //         "namespace": "android_app",
            //         "package_name": "com.example",
            //         "sha256_cert_fingerprints":
            //             ["14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"]
            //     }
            // }
        ]);
    });

    // open urls directly in ios app
    app.get('/.well-known/apple-app-site-association', (req, res) => {
        res.send({
            applinks: {
                apps: [],
                details: [
                    // {
                    //     "appID": "ABCD1234.com.apple.wwdc",
                    //     "paths": ["*"]
                    // }
                ],
            },
        });
    });

    return function (req, res, next) {
        next();
    };
}

/*
 * banmiddleware
 */
// refresh local ban list
let bans = [];
let bansrefresh = null;
async function getBanLoop() {
    try {
        const { response, body } = await requestPromise({
            url: `${process.env.MONITORING_URL}/getBans`,
            json: true,
            forever: true,
        });
        if (parseInt(response.statusCode / 100) != 2) throw new Error(`Status code = ${response.statusCode} : ${JSON.stringify(body, null, 4)}`);

        if (body && Array.isArray(body)) {
            bans = body;
            bansrefresh = new Date();
        }

        setTimeout(getBanLoop, 60000).unref();
    } catch (err) {
        console.error('getbanloop', JSON.stringify(err, null, 4));
    }
}
if (process.env.MONITORING_URL) getBanLoop();

function isban(ip) {
    return bans.includes(ip);
}

async function banip(ip, reason, req) {
    // on banni l'ip
    const json = {
        type: 'ban',
        reason,
        hostname: process.env.HOSTNAME,
        ip,
    };

    if (req) {
        json.method = req.method;
        json.url = req.originalUrl;
        json.route = req.route?.path;
        json.userId = req.session?.user?.id;
        json.userEmail = req.session?.user?.email;
        json.userName = `${req.session?.user?.firstName || ''} ${req.session?.user?.lastName || ''}`;
        json.userAgent = req.get('user-agent');
        json.referrer = req.get('referrer');
        json.accept = req.get('Accept');
        json.forwardedFor = req.get('x-forwarded-for');
        json.requestId = req.id;
    }

    bans.push(ip);

    pushData(json);
}

function banmiddleware(app) {
    // routes par defaut
    app.get('/ban', async (req, res, next) => {
        const fileName = path.resolve(`${__dirname}/../views/ban.html.twig`);
        res.type('html');
        res.send(await fs.promises.readFile(fileName));
    });
    app.get('/ip', (req, res, next) => {
        res.send((req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(',')[0].trim());
    });
    app.get('/ban.jpg', (req, res, next) => {
        res.sendFile(`${__dirname}/../web/img/ban.jpg`);
    });
    app.get('/bans', (req, res, next) => {
        res.send({ bans, bansrefresh });
    });

    // banni automatiquement les gens
    return function (req, res, next) {
        // crée une fonction qui sert à bannir
        // que l'on pourra appeller à partir de req
        req.ban = function (reason) {
            banip(req.ip, reason, req);

            logBanEvent();
            res.redirect('/ban');
        };

        if (req.originalUrl.match(/(\$|\%24)(\{|\%7b).*j.*n.*d.*i.*(\:|\%3a)/i)) return req.ban('Log4Shell');
        if (req.originalUrl.match(/%3C(%20)*script(%20)*%3E/i)) return req.ban("balise script dans l'url");

        // for (let i in req.body) {
        //     if (`${req.body[i]}`.match(/<\s*script\s*>/i)) {
        //         return req.ban("balise script dans le body");
        //     }
        // }

        // whitelist
        if (req.originalUrl.match(/sitemap\.xml/)) {
            // do nothing
        }
        // si cherche des fichiers chelou
        else if (
            // extensions chelou
            req.originalUrl.match(/\.env$/) ||
            req.originalUrl.match(/\.ini$/) ||
            req.originalUrl.match(/\.do$/) ||
            req.originalUrl.match(/\.aspx?$/) ||
            req.originalUrl.match(/^\/\.git/) ||
            req.originalUrl.match(/\.jsp$/) ||
            req.originalUrl.match(/\.sql$/) ||
            req.originalUrl.match(/\.rar$/) ||
            req.originalUrl.match(/\.tar\.gz$/) ||
            req.originalUrl.match(/\.tgz$/) ||
            req.originalUrl.match(/\.gz$/) ||
            // path racine
            req.originalUrl.match(/^\/cgi-bin$/) ||
            req.originalUrl.match(/^\/joomla/) ||
            req.originalUrl.match(/^\/phpmyadmin/) ||
            req.originalUrl.match(/^\/pma/) ||
            req.originalUrl.match(/^\/sqlite/) ||
            req.originalUrl.match(/^\/webdav/) ||
            req.originalUrl.match(/^\/drupal/) ||
            req.originalUrl.match(/^\/administrator/) ||
            req.originalUrl.match(/^\/cms/) ||
            req.originalUrl.match(/^\/sql/) ||
            req.originalUrl.match(/^\/mysql/) ||
            req.originalUrl.match(/^\/wp(\d)?/) ||
            req.originalUrl.match(/^\/style.php/) ||
            req.originalUrl.match(/^\/wp-commentin.php/) ||
            // path anywhere
            req.originalUrl.match(/\/wp-login/) ||
            req.originalUrl.match(/\/wp-admin/) ||
            req.originalUrl.match(/\/wp-includes/) ||
            req.originalUrl.match(/\/wp-content/) ||
            req.originalUrl.match(/\/xmlrpc.php/) ||
            req.originalUrl.match(/\/config\./)
        )
            return req.ban(`url interdite ${req.originalUrl}`);

        // if ip déjà banni
        if (isban(req.ip)) {
            logBanEvent();
            return res.redirect('/ban');
        }

        next();
    };
}

function logBanEvent() {
    influxdb.insert('ban', { hostname: process.env.HOSTNAME }, { nb: 1 });
}

function errorToObject(argument) {
    const obj = {};

    for (const i in argument) obj[i] = argument[i];
    obj.code = argument.code || null;
    obj.name = argument.name || null;
    obj.message = argument.message;
    obj.detail = argument.detail || null;
    obj.cause = argument.cause ? errorToObject(argument.cause) : null;

    if (Array.isArray(argument.stack)) obj.stack = argument.stack;
    else obj.stack = (argument.stack || '').split('\n');
    obj.err = argument.err ? errorToObject(argument.err) : null;
    return obj;
}

function getRequestId() {
    // return asyncLocalStorage.getStore();
    return '-';
}

function log(level, key, message, obj) {
    const requestId = getRequestId();

    if (obj?.err) obj.err = errorToObject(obj.err);

    const json = {
        type: 'error',
        hostname: process.env.HOSTNAME,
        level,
        key,
        message,
        requestId,
        ...obj,
    };

    if (process.env.SILENT != 1)
        console.log(`${requestId} ${level == 'error' ? red : blue}${key}${reset} ${message} ${obj ? JSON.stringify(obj, null, 4) : ''}`);

    if (level != 'info') pushData(json);
}

// when we want to kill the process we call docker stop
// we catch SIGTERM
// we make the /health route return 'ko' so that docker knows the cntainer is dying
// docker tells traefik the container is dead and remove this container form load balencing
//
// on first call to /health it will do a server.close and wait for it to finish
// later calls just return ko
// the server will then close itself as soon as express has ended every requests
function gracefulShutdown(server, app) {
    let onhealth = function (req, res, next) {
        res.send('ok');
    };
    if (app)
        app.get('/health', (req, res, next) => {
            onhealth(req, res, next);
        });

    let dying = false;
    process.on('SIGTERM', () => {
        console.info('got SIGTERM');

        onhealth = function (req, res, next) {
            console.log('send /health KO');
            res.status(500).send('ko');

            if (dying) return;
            dying = true;

            const traefikRefreshTimeout = 3000;
            setTimeout(() => {
                console.log('closing server');
                server.close(() => {
                    console.log('server closed');
                    process.exit(0);
                });
            }, traefikRefreshTimeout);
        };
    });
}

process.on('uncaughtException', async (err) => {
    console.log('err', err);
    err = err ?? {};
    log('error', 'fk:server:exit', `uncaughtException ${err.message}`, { err });
    await flushqueue();
    /* eslint-disable no-process-exit */
    process.exit(1);
});

process.on('unhandledRejection', async (reason, p) => {
    reason = reason ?? {};
    log('error', 'fk:server:exit', `unhandledRejection ${reason}`, { err: reason || {} });
    await flushqueue();
    /* eslint-disable no-process-exit */
    process.exit(1);
});

process.on('warning', async (warning) => {
    log('error', 'fk:server:warning', warning.message, { err: warning });
    await flushqueue();
});

export default {
    getRequestId,
    idmiddleware,
    statmiddleware,
    logmiddleware,
    errormiddleware,
    notfoundmiddleware,
    getStatsBy,
    pushData,
    log,
    banmiddleware,
    gracefulShutdown,
    errorToObject,
    multerCleanMiddleware,
    isban,
    banip,
    logBanEvent,
    timermiddleware,
    faviconmiddleware,
};
