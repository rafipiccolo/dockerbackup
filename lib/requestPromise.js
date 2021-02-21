//var monitoring = require('./monitoring.js');
var request = require('request');

function requestPromise(params) {
//    if (typeof params == 'string')
//        params = {url: params};
//    params.headers = params.headers || {};
//    params.headers.requestId = monitoring.getRequestId();

//    monitoring.log('info', 'request', params.url);

    return new Promise((resolve, reject) => {
        request(params, function (err, response, body) {
            if (err) return reject(err);

            resolve({ response, body });
        });
    });
}

module.exports = requestPromise;
