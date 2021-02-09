'use strict';

var prettyMs = require('pretty-ms');

function statmiddleware(req, res, next) {
    var start = process.hrtime();

    var writeHead = res.writeHead;
    var writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        var end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        var route = req.route?.path;

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

function logmiddleware(req, res, next) {
    var start = process.hrtime();

    var writeHead = res.writeHead;
    var writeHeadbound = writeHead.bind(res);
    res.writeHead = function (statusCode, statusMessage, headers) {
        // end[0] is in seconds, end[1] is in nanoseconds
        var end = process.hrtime(start);
        // convert first to ns then to ms
        const ms = (end[0] * 1000000000 + end[1]) / 1000000;

        // color status code
        var red = '\x1B[31m';
        var green = '\x1B[32m';
        var yellow = '\x1B[33m';
        var blue = '\x1B[36m';
        var reset = '\x1B[0m';
        var colorStatusCode = '';
        if (parseInt(statusCode / 100) == 2) colorStatusCode = `${green}${statusCode}${reset}`;
        else if (parseInt(statusCode / 100) == 3) colorStatusCode = `${yellow}${statusCode}${reset}`;
        else colorStatusCode = `${red}${statusCode}${reset}`;

        console.log(`${req.method} ${req.originalUrl} ${colorStatusCode} ${blue}${prettyMs(ms)}${reset}`);

        // console.log(JSON.stringify({
        //     method: req.method,
        //     url: req.originalUrl,
        //     route: req.route?.path,
        //     statusCode: statusCode,
        //     ms: ms,
        //     userId: req.session?.user?.id,
        //     userName: req.session?.user?.firstName+' '+req.session?.user?.lastName,
        //     userAgent: req.get('user-agent'),
        //     referrer: req.get('referrer'),
        //     accept: req.get('Accept'),
        //     forwardedFor: req.get('x-forwarded-for'),
        //     ip: req.ip,
        //     ips: req.ips,
        // }));

        writeHeadbound(statusCode, statusMessage, headers);
    };

    next();
}

function errormiddleware(err, req, res, next) {
    console.error(err);
    var currenterr = err;
    while (currenterr.err) {
        console.error('Nested Error : ');
        console.error(currenterr.err);
        currenterr = currenterr.err;
    }

    // set error status code
    res.status(err.status || 500);

    // if it's a nodejs request => no user agent
    // or user agent is curl
    // => it's a bot
    // => we return json, else html/text
    var bot = !req.get('user-agent') || req.get('user-agent').indexOf('curl/') != -1;
    if (bot || req.accepts('json'))
        return res.send({
            error: {
                message: err.message,
                stack: err.stack,
            },
        });

    // we send raw text
    res.send(err.message);
}

function notfoundmiddleware(req, res, next) {
    var err = new Error('Page not found');
    err.status = 404;
    next(err);
}

var routes = {};

function getStatsBy(field) {
    return Object.values(routes).sort((a, b) => b[field] - a[field]);
}

module.exports = {
    statmiddleware,
    logmiddleware,
    errormiddleware,
    notfoundmiddleware,
    getStatsBy,
};
