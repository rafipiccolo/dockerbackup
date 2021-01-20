const request = require('request');
const now = require('nano-time');

// efficiently insert data into influxdb
//
// group data to push to influx into the "queue" array
// it then calls influxdb with max 10000 data on each call
// the queue is checked every 1000ms
var queue = [];
const max = 10000;
const timeoutMs = 1000;
var timeout = null;

function callRequest(data) {
    return new Promise((resolve, reject) => {
        // console.log('pushing ' + data.length + ' data to influxdb');

        // verbose('curl -XPOST ' + process.env.INFLUXDB + ' --data-binary ' + "'" + str + "'");

        request(
            {
                url: process.env.INFLUXDB,
                method: 'POST',
                body: data.join('\n'),
                forever: true,
            },
            function (err, res, body) {
                if (err) return reject(err);
                if (parseInt(res.statusCode / 100) != 2) return reject(new Error(body));

                return resolve();
            }
        );
    });
}

function startQueue() {
    timeout = setTimeout(async function () {
        // while there is data to push
        // extract from the array, the first "max" data
        // this data is removed from the original array
        // we call request with the data
        var tmpqueue = queue;
        queue = [];
        while (tmpqueue.length > 0) {
            var data = tmpqueue.splice(0, max);
            try {
                await callRequest(data);
            } catch (err) {
                console.error('INFLUXDB request error', err);
            }
        }
        startQueue();
    }, timeoutMs);

    // while the queue is inactive the program can stop
    timeout.unref();
}

startQueue();

async function influxdbInsert(table, tags, fields, time) {
    // while the queue is active the program wont stop
    timeout.ref();

    if (!process.env.INFLUXDB) return;

    tags = Object.entries(tags)
        .filter((t) => t[1] !== null)
        .map((t) => t[0] + '=' + t[1]);
    fields = Object.entries(fields)
        .filter((t) => t[1] !== null)
        .map((f) => {
            // if boolean or numbers, else quote
            if (typeof f[1] === 'undefined') return '';
            else if (f[1] === false) return f[0] + '=0';
            else if (f[1] === true) return f[0] + '=1';
            else if ((f[1] + '').match(/^[\-0-9\.,]*$/)) return f[0] + '=' + f[1];
            else return f[0] + '=' + '"' + f[1] + '"';
        })
        .filter((s) => s);

    var str = table;
    if (tags.length) str += ',' + tags.join(',');
    if (fields.length) str += ' ' + fields.join(',');
    str += ' ' + (time ? time : now());
    queue.push(str);
}

async function influxdbQuery(sql) {
    return new Promise((resolve, reject) => {
        request(
            {
                url: process.env.INFLUXDB.replace(/write/, 'query') + '&q=' + sql,
            },
            function (err, response, body) {
                if (err) return reject(err);
                if (parseInt(response.statusCode / 100) >= 4) return reject(new Error('Status code = ' + response.statusCode + ' : ' + body));

                body = JSON.parse(body);

                if (body.results[0].error) throw new Error(body.results[0].error);
                if (!body.results[0].series) return resolve([]);

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

                resolve(objs);
            }
        );
    });
}

module.exports = {
    insert: influxdbInsert,
    query: influxdbQuery,
    queue,
};
