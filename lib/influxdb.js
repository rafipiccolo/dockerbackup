const { InfluxDB, Point, HttpError, DEFAULT_WriteOptions } = require('@influxdata/influxdb-client');

let influxdb = null;
let writeApi = null;
let queryApi = null;

if (process.env.INFLUXDB_URL && process.env.INFLUXDB_TOKEN && process.env.INFLUXDB_ORG && process.env.INFLUXDB_BUCKET) {
    influxdb = new InfluxDB({
        url: process.env.INFLUXDB_URL,
        token: process.env.INFLUXDB_TOKEN,
    });

    writeApi = influxdb.getWriteApi(process.env.INFLUXDB_ORG, process.env.INFLUXDB_BUCKET, 'ns', {
        batchSize: 1000,
        flushInterval: 5000,
    });

    queryApi = influxdb.getQueryApi(process.env.INFLUXDB_ORG);
}

async function insert(table, tags, fields, time) {
    if (!process.env.INFLUXDB_URL) return;

    const point = new Point(table);

    for (let name in tags) {
        let tag = tags[name];
        point.tag(name, tag);
    }

    for (let name in fields) {
        let field = fields[name];
        if (typeof field === 'undefined' || field === null) continue;

        if (typeof field === 'number' || field.match('/^[0-9.,+-]+$/')) point.floatField(name, field);
        else point.stringField(name, field);
    }

    if (time) point.timestamp(time);

    return writeApi.writePoint(point);
}

async function query(fluxQuery) {
    if (!process.env.INFLUXDB_URL) return [];

    return await queryApi.collectRows(fluxQuery);
}

module.exports = {
    insert,
    query,
};
