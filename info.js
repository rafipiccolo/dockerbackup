require('dotenv').config()
const request = require('request');
var Table = require('cli-table');

var sql = process.argv[2] || 'select * from dockerbackup where error = 1';

request({
    url: process.env.INFLUXDB.replace(/write/, 'query')+'&q='+sql,
}, function (err, response, body) {
    if (err) throw err;
    if (parseInt(response.statusCode / 100) >= 4) throw new Error('Status code = '+response.statusCode+' : '+body);

    body = JSON.parse(body);
    
    if (!body.results[0].series) process.exit(0);

    var columns = body.results[0].series[0].columns;
    var values = body.results[0].series[0].values;

    var objs = [];
    for (var value of values) {
        var obj = {};
        for (var i in columns) {
            obj[columns[i]] = value[i];
        }
        objs.push(obj);
    }
    // console.log(objs);
    console.table(objs)
});

