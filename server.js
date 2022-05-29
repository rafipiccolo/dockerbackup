import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import fs from 'fs';
import express from 'express';
import monitoring from './lib/monitoring.js';
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
import http from 'http';
const server = http.Server(app);
monitoring.gracefulShutdown(server, app);

app.use(monitoring.faviconmiddleware(app));
app.use(monitoring.banmiddleware(app));
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
        const str = await fs.promises.readFile(`${__dirname}/log/log.log`);
        let data = str
            .toString()
            .split('\n')
            .filter((s) => s)
            .map((s) => JSON.parse(s));
        if (req.query.error) data = data.filter((d) => d.error == req.query.error);
        if (req.query.driver) data = data.filter((d) => d.driver == req.query.driver);
        data = data.reverse();
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
