const express = require('express');
let monitoring = require('./lib/monitoring.js');
let app = express();
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
let http = require('http');
let server = http.Server(app);
monitoring.gracefulShutdown(server, app);
const influxdb = require('./lib/influxdb');

app.get('/favicon.ico', (req, res) => {
    res.sendFile(`${__dirname}/web/img/favicon.png`);
});

app.use(monitoring.idmiddleware);
app.use(monitoring.statmiddleware);
app.use(monitoring.logmiddleware);
app.use(monitoring.timermiddleware);
app.use(monitoring.multerCleanMiddleware);

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
        let sql = `from(bucket: "bucket")
        |> range(start: -5m)
        |> filter(fn: (r) => r["_measurement"] == "dockerbackup")
        ${parseInt(req.query.error) ? '|> filter(fn: (r) => r["_field"] == "error" and r["_value"] == 1)' : ''}
        ${req.query.driver ? `|> filter(fn: (r) => r["driver"] == "${req.query.driver}")` : ''}
        |> filter(fn: (r) => r["hostname"] == "${process.env.HOSTNAME}")
        |> sort(columns:["_time"], desc: true)
        |> limit(n:1000)`;

        let data = await influxdb.query(sql);
        res.send(data);
    } catch (err) {
        next(err);
    }
});

app.get('/stats', (req, res, next) => {
    return res.send(monitoring.getStatsBy(req.query.field || 'avg'));
});

app.use(monitoring.notfoundmiddleware);
app.use(monitoring.errormiddleware(app));

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`ready to go on ${port}`);
});
