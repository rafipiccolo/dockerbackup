const express = require('express');
var monitoring = require('./lib/monitoring.js');
var app = express();
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
var http = require('http');
var server = http.Server(app);
monitoring.gracefulShutdown(server, app);
const influxdb = require('./lib/influxdb');

app.use(monitoring.idmiddleware);
app.use(monitoring.statmiddleware);
app.use(monitoring.logmiddleware);

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

app.get('/stats', function (req, res, next) {
    return res.send(monitoring.getStatsBy(req.query.field || 'avg'));
});

app.use(monitoring.notfoundmiddleware);
app.use(monitoring.errormiddleware(app));

const port = process.env.PORT || 3000;
server.listen(port, function () {
    console.log(`ready to go on ${port}`);
});
