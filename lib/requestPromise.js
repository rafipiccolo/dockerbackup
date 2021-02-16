'use strict';

var request = require('request');

function requestPromise(params) {
    return new Promise((resolve, reject) => {
        request(params, function (err, response, body) {
            if (err) return reject(err);

            resolve({ response, body });
        });
    });
}

module.exports = requestPromise;
