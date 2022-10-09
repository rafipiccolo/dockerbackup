import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import assert from 'assert';
import { requestPromise, createJar } from './requestPromise.js';
import fs from 'fs';

const uniqid = Math.random() * 10000;
const jar = createJar();

describe('requestPromise2.js', () => {
    // it('should use keepalive', async () => {
    //     let firstDuration = null;
    //     for (let i = 0; i <= 1; i++) {
    //         const start = process.hrtime();
    //         const { response, body } = await requestPromise({
    //             method: 'GET',
    //             url: `https://httpbin.org/get`,
    //             json: true,
    //         });
    //         const duration = getDurationInMilliseconds(start);
    //         assert.equal(response.statusCode, 200);
    //         if (i == 0) {
    //             firstDuration = duration;
    //         } else {
    //             // c'est au moins 2x plus rapide si keep alive est activé
    //             assert.ok(duration < firstDuration * 0.6);
    //         }
    //     }
    // });

    it('should get slowly', async () => {
        // first hit
        const start = process.hrtime();
        const { response, body } = await requestPromise({
            method: 'GET',
            url: `https://httpbin.raphaelpiccolo.com/delay/1?uniqid=${uniqid}`,
            json: true,
            cacheMs: 60000,
        });
        const duration = getDurationInMilliseconds(start);
        assert.equal(response.statusCode, 200);
        assert.ok(duration > 1000);
    });

    it('should get fast from cache', async () => {
        // second hit
        const start = process.hrtime();
        const { response, body } = await requestPromise({
            method: 'GET',
            url: `https://httpbin.raphaelpiccolo.com/delay/1?uniqid=${uniqid}`,
            json: true,
            cacheMs: 60000,
        });
        const duration = getDurationInMilliseconds(start);
        assert.equal(response.statusCode, 200);
        assert.ok(duration < 1000);
    });

    it('should get', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/get?test=test',
        });
        assert.equal(response.statusCode, 200);
        assert.equal(typeof body, 'string');
    });

    it('should get json', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/get?test=test',
            json: true,
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(body.args, {
            test: 'test',
        });
    });

    it('should get with qs', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/get',
            json: true,
            qs: { test: 'test' },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(body.args, {
            test: 'test',
        });
    });

    it('should get with headers', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/get',
            json: true,
            headers: { 'User-Agent': 'rafi.piccolo' },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(body.headers['User-Agent'], 'rafi.piccolo');
    });

    it('should get with redirect (redirecting url is swallowed, we see only the last destination response)', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/redirect-to',
            qs: {
                url: 'https://httpbin.raphaelpiccolo.com/get',
            },
            json: true,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(body.url, 'https://httpbin.raphaelpiccolo.com/get');
    });

    it('should get image', async () => {
        const { response, body } = await requestPromise({
            url: 'https://httpbin.raphaelpiccolo.com/image/jpeg',
            encoding: null,
        });
        assert.equal(response.statusCode, 200);
        assert.ok(equalBuffer(body, await fs.promises.readFile(`${__dirname}/samples/httpbin.jpeg`)));
    });

    it('should post application/x-www-form-urlencoded', async () => {
        const { response, body } = await requestPromise({
            method: 'POST',
            url: 'https://httpbin.raphaelpiccolo.com/post?test=test',
            form: { testform: 'ok' },
            json: true,
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(body.args, {
            test: 'test',
        });
        assert.deepEqual(body.form, {
            testform: 'ok',
        });
    });

    it('should post json', async () => {
        const { response, body } = await requestPromise({
            method: 'POST',
            url: 'https://httpbin.raphaelpiccolo.com/post?test=test',
            json: { testjson: 'ok' },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(body.args, {
            test: 'test',
        });
        assert.deepEqual(body.json, {
            testjson: 'ok',
        });
    });

    // it('should post formdata', async () => {
    //     const { response, body } = await requestPromise({
    //         method: 'POST',
    //         url: 'https://httpbin.raphaelpiccolo.com/post?test=test',
    //         formData: { testform: 'ok' },
    //         json: true,
    //     });
    //     assert.equal(response.statusCode, 200);
    //     assert.deepEqual(body.args, {
    //         test: "test"
    //     });
    //     assert.deepEqual(body.form, {
    //         testform: 'ok'
    //     });
    // });

    // // curl -X POST -F 'image=@./lib/samples/pdf.pdf' -F test=test 'https://httpbin.raphaelpiccolo.com/post'
    // it('should post file using formdata', async () => {
    //     const { response, body } = await requestPromise({
    //         method: 'POST',
    //         url: 'https://httpbin.raphaelpiccolo.com/post',
    //         formData: { test: 'test', file: fs.createReadStream(`${__dirname}/samples/httpbin.jpeg`) },
    //         json: true,
    //     });
    //     assert.equal(response.statusCode, 200);
    //     assert.deepEqual(body.form, { test: 'test' });
    //     assert.ok(body.files.file.startsWith('data:image/jpeg;base64,'));
    // });

    it('should reach login', async () => {
        const { response, body } = await requestPromise({
            method: 'GET',
            url: 'https://httptest.raphaelpiccolo.com/login',
            jar,
        });
        assert.equal(response.statusCode, 200);
        assert.ok(jar.cookies);
    });
    it('should login', async () => {
        const { response, body } = await requestPromise({
            method: 'POST',
            url: 'https://httptest.raphaelpiccolo.com/login',
            json: { user: 'test', password: 'test' },
            jar,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(body.code, 'ok');
    });
    it('should see logged page', async () => {
        const { response, body } = await requestPromise({
            method: 'GET',
            url: 'https://httptest.raphaelpiccolo.com/logged',
            jar,
            json: true,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(body.code, 'ok');
    });
    it('should basic auth in url', async () => {
        const { response, body } = await requestPromise({
            method: 'GET',
            url: 'https://username:password@httpbin.raphaelpiccolo.com/basic-auth/username/password',
            json: true,
        });
        assert.equal(response.statusCode, 200);
        assert.equal(body.authenticated, true);
    });
    it('should basic auth as param', async () => {
        const { response, body } = await requestPromise({
            method: 'GET',
            url: 'https://httpbin.raphaelpiccolo.com/basic-auth/username/password',
            json: true,
            auth: {
                username: 'username',
                password: 'password',
            },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(body.authenticated, true);
    });
});

const getDurationInMilliseconds = (start) => {
    const NS_PER_SEC = 1e9;
    const NS_TO_MS = 1e6;
    const diff = process.hrtime(start);

    return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};

function equalBuffer(buf1, buf2) {
    if (buf1.byteLength != buf2.byteLength) return false;
    const dv1 = new Int8Array(buf1);
    const dv2 = new Int8Array(buf2);
    for (let i = 0; i != buf1.byteLength; i++) {
        if (dv1[i] != dv2[i]) return false;
    }
    return true;
}
