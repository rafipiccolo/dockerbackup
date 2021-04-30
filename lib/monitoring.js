/* eslint no-console: "off" */
let uniqid = require('uniqid');
let prettyMs = require('pretty-ms');
let moment = require('moment');
let fs = require('fs');
let requestPromise = require('./requestPromise');
let influxdb = require('./influxdb');

const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();

let red = '\x1B[31m';
let green = '\x1B[32m';
let yellow = '\x1B[33m';
let blue = '\x1B[36m';
let reset = '\x1B[0m';

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
    let tmpqueue = queue;
    queue = [];
    while (tmpqueue.length > 0) {
        let data = tmpqueue.splice(0, max);
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
let routes = {};
function getStatsBy(field) {
    return Object.values(routes).sort((a, b) => b[field] - a[field]);
}
function statmiddleware(req, res, next) {
    let start = process.hrtime();

    let writeHead = res.writeHead;
    let writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        let end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        let route = req.route?.path;

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
    asyncLocalStorage.run(req.id, async () => {
        next();
    });
}

/*
 * when the request has ended, we delete the uploaded files
 * you need to save it in another path for it to stay on the server
 */
function multerCleanMiddleware(req, res, next) {
    let writeHead = res.writeHead;
    let writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // dont use await here, writeHead is suposed to be synchronous
        if (req.files) {
            for (let file of req.files) {
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
 * log express access to terminal and push data to the queue to remote log server
 */
function logmiddleware(req, res, next) {
    let start = process.hrtime();

    let writeHead = res.writeHead;
    let writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        let end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        // color status code
        let colorStatusCode = '';
        if (parseInt(statusCode / 100) == 2) colorStatusCode = `${green}${statusCode}${reset}`;
        else if (parseInt(statusCode / 100) == 3) colorStatusCode = `${yellow}${statusCode}${reset}`;
        else colorStatusCode = `${red}${statusCode}${reset}`;

        console.log(`${req.id} ${req.method} ${req.originalUrl} ${colorStatusCode} ${blue}${prettyMs(ms)}${reset}`);

        let json = {
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
        let json = {
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
        let bot = !req.get('user-agent') || req.get('user-agent').indexOf('curl/') != -1;
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
    let err = new Error('Page not found');
    err.status = 404;
    next(err);
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

        setTimeout(getBanLoop, 60000);
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
    let json = {
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
        influxdb.insert('ban', { hostname: process.env.HOSTNAME }, { nb: 1 });
        let fileName = require('path').resolve(`${__dirname}/../views/ban.html.twig`);
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

            res.redirect('/ban');
        };

        // si script dans les parametres
        if (req.originalUrl.indexOf('<script>') != -1) return req.ban("balise script dans l'url");

        // si cherche des fichiers chelou
        if (
            req.originalUrl.match(/^\/.*\.ini$/) ||
            req.originalUrl.match(/^\/.*\.do$/) ||
            req.originalUrl.match(/^\/.*\.aspx?$/) ||
            req.originalUrl.match(/^\/\.git/) ||
            req.originalUrl.match(/^\/.*\.jsp$/) ||
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
            req.originalUrl.match(/^\/wp-login/) ||
            req.originalUrl.match(/^\/wp-admin/) ||
            req.originalUrl.match(/^\/config\./)
        )
            return req.ban(`url interdite ${req.originalUrl}`);

        // if ip déjà banni
        if (isban(req.ip)) return res.redirect('/ban');

        next();
    };
}

function errorToObject(argument) {
    let obj = {};

    for (let i in argument) obj[i] = argument[i];
    obj.code = argument.code || null;
    obj.name = argument.name || null;
    obj.message = argument.message;
    obj.detail = argument.detail || null;
    if (Array.isArray(argument.stack)) obj.stack = argument.stack;
    else obj.stack = (argument.stack || '').split('\n');
    obj.err = argument.err ? errorToObject(argument.err) : null;
    return obj;
}

function getRequestId() {
    return asyncLocalStorage.getStore();
}

function log(level, key, message, obj) {
    const requestId = asyncLocalStorage.getStore();

    if (obj?.err) obj.err = errorToObject(obj.err);

    let json = {
        type: 'error',
        hostname: process.env.HOSTNAME,
        level,
        key,
        message,
        requestId,
        ...obj,
    };

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

            let traefikRefreshTimeout = 3000;
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

module.exports = {
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
};
