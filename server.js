const express = require('express')
const moment = require('moment')
const app = express()
const port = process.env.PORT||3000;
const influxdb = require('./lib/influxdb');
const checkDf = require('./lib/checkDf');
const sendMail = require('./lib/sendMail');

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

app.get('/cron/alert', async (req, res, next) => {
    try {
        var errors = await influxdb.query(`select * from dockerbackup where "backuphost" = '${process.env.HOSTNAME}' and error = 1 and time > now() - 1d order by time desc limit 1000`);
        var rsyncs = await influxdb.query(`select * from dockerbackup where "backuphost" = '${process.env.HOSTNAME}' and driver = 'rsync' and time > now() - 1d order by time desc limit 1000`);
        var df = await checkDf({ path: '/' });

        var html = '';
        var maxpercent = 90;
        if (df.percent > maxpercent) {
            html += `${process.env.HOSTNAME} Used disk space > ${maxpercent}\n`
        }
        
        html += `\n`
        if (errors.length) {
            html += 'Errors :\n'
            html += errors.map(error => `${moment(error.time).format('YYYY-MM-DD HH:mm:ss')} ${error.driver} ${error.host}\n`).join('');
        }
        
        html += `\n`
        rsyncs = rsyncs.filter(rsync => (rsync.sizeTransfert / rsync.size * 100) > 5)
        if (rsyncs.length) {
            html += 'RSYNC too much :\n'
            html += rsyncs.map(rsync => `${moment(rsync.time).format('YYYY-MM-DD HH:mm:ss')} ${rsync.host} ${(rsync.sizeTransfert / rsync.size) * 100}%\n`).join('');
        }

        if (html.trim() == '') return res.send('nothing to send');

        await sendMail({
            to: "rafi.piccolo@gmail.com, martin.wb.2015@gmail.com",
            subject: "dockerbackup " + process.env.HOSTNAME,
            text: html,
            html: html.replace(/\n/g, '<br />'),
        });

        res.send('ok');
    } catch (err) {
        next(err);
    }
})

app.get('/health', (req, res) => {
    res.send('ok')
})

app.listen(port, () => {
    console.log(`listening at http://localhost:${port}`)
})

