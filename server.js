const express = require('express')
const app = express()
const port = process.env.PORT||3000;
const influxdb = require('./lib/influxdb');

app.get('/', async (req, res, next) => {
    try {
        var sql = '';
        if (req.query.error)
            sql = `select * from dockerbackup where "error" = 1 and "backuphost" = '${process.env.HOSTNAME}' order by time desc limit 100`;
        else
            sql = `select * from dockerbackup where "backuphost" = '${process.env.HOSTNAME}' order by time desc limit 100`;
        var data = await influxdb.query(sql);
        res.send(data);
    } catch(err) {
        next(err);
    }
})

app.get('/health', (req, res) => {
    res.send('ok')
})

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})

