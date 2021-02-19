const requestPromise = require('./requestPromise.js');
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
                const { response, body } = await requestPromise({
                    url: process.env.INFLUXDB,
                    method: 'POST',
                    body: data.join('\n'),
                    forever: true,
                });
                if (parseInt(response.statusCode / 100) != 2) throw new Error(`Status code = ${response.statusCode} : ${body}`);
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

async function insert(table, tags, fields, time) {
    // while the queue is active the program wont stop
    timeout.ref();

    if (!process.env.INFLUXDB) return;

    tags = Object.entries(tags)
        .filter((t) => t[1] !== null)
        .map((t) => `${t[0]}=${t[1]}`);
    fields = Object.entries(fields)
        .filter((t) => t[1] !== null)
        .map((f) => {
            // if boolean or numbers, else quote
            if (typeof f[1] === 'undefined') return '';
            if (f[1] === false) return `${f[0]}=0`;
            if (f[1] === true) return `${f[0]}=1`;
            if (`${f[1]}`.match(/^[\-0-9\.,]*$/)) return `${f[0]}=${f[1]}`;
            return `${f[0]}="${f[1]}"`;
        })
        .filter((s) => s);

    var str = table;
    if (tags.length) str += `,${tags.join(',')}`;
    if (fields.length) str += ` ${fields.join(',')}`;
    str += ` ${time || now()}`;
    queue.push(str);
}

async function query(sql) {
    var { response, body } = await requestPromise({
        url: `${process.env.INFLUXDB.replace(/write/, 'query')}&q=${sql}`,
    });
    if (parseInt(response.statusCode / 100) >= 4) throw new Error(`Status code = ${response.statusCode} : ${body}`);

    body = JSON.parse(body);

    if (body.results[0].error) throw new Error(body.results[0].error);
    if (!body.results[0].series) return [];

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

    return objs;
}

module.exports = {
    insert,
    query,
    queue,
};
