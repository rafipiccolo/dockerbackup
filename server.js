'use strict';

const express = require('express');
const moment = require('moment');
var app = express();
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
var http = require('http');
var server = http.Server(app);
const port = process.env.PORT || 3000;
const influxdb = require('./lib/influxdb');
const checkDf = require('./lib/checkDf');

var expresslib = require('./lib/expresslib.js')
app.use(expresslib.statmiddleware);
app.use(expresslib.logmiddleware);

app.get('/', async (req, res, next) => {
    res.sendFile(`${__dirname}/index.html`);
});

app.get('/stat', async (req, res, next) => {
    try {
        res.sendFile('/backup/stat.txt');
    } catch (err) {
        next(err);
    }
});

app.get('/data', async (req, res, next) => {
    try {
        var sql = '';

        var wheres = [];
        if (parseInt(req.query.error)) wheres.push(`"error" = 1`);
        if (req.query.driver) wheres.push(`"driver" = '${req.query.driver}'`);
        wheres.push(`"backuphost" = '${process.env.HOSTNAME}'`);
        sql = `select * from dockerbackup where ${wheres.join(' and ')} order by time desc limit 1000`;
        var data = await influxdb.query(sql);
        res.send(data);
    } catch (err) {
        next(err);
    }
});

app.get('/health', (req, res) => {
    res.send('ok');
});

server.listen(port, function () {
    console.log(`ready to go on ${port}`);
});

app.get('/stats', function (req, res, next) {
    return res.send(expresslib.getStatsBy(req.query.field || 'avg'));
});

app.use(expresslib.notfoundmiddleware);
app.use(expresslib.errormiddleware);
