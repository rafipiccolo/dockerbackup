const express = require('express')
const app = express()
const port = process.env.PORT||3000;
const influxdb = require('./lib/influxdb');

app.get('/', async (req, res, next) => {
    res.sendFile(__dirname+'/index.html')
});

app.get('/data', async (req, res, next) => {
    try {
        var sql = '';

        var wheres = [];
        if (parseInt(req.query.error))
            wheres.push(`"error" = 1`);
        if (req.query.driver)
            wheres.push(`"driver" = '${req.query.driver}'`);
        wheres.push(`"backuphost" = '${process.env.HOSTNAME}'`)
        sql = `select * from dockerbackup where ${wheres.join(' and ')} order by time desc limit 1000`;
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
    console.log(`listening at http://localhost:${port}`)
})

