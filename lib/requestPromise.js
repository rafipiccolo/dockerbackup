import request from 'request';
import crypto from 'crypto';
import fs from 'fs';

export default async function requestPromise(params) {
    let cachefile = null;
    const cacheMs = params.cacheMs;
    delete params.cacheMs;

    if (cacheMs) {
        const hash = crypto.createHash('md5').update(params.url).digest('hex');
        cachefile = `/tmp/cacheMs-${hash}`;
        try {
            // if cacheFile exist and fresh
            const stat = await fs.promises.stat(cachefile);
            if (stat.ctimeMs + cacheMs > Date.now()) {
                let data = await fs.promises.readFile(cachefile);
                if (params.json) data = JSON.parse(data);
                return { response: { statusCode: 200 }, body: data };
            }

            await fs.promises.unlink(cachefile);
        } catch (err) {
            if (err.code != 'ENOENT') throw err;
        }
    }

    const result = await new Promise((resolve, reject) => {
        request(params, (err, response, body) => {
            if (err) return reject(err);

            resolve({ response, body });
        });
    });

    if (cacheMs && parseInt(result.response.statusCode) / 100 == 2) {
        await fs.promises.writeFile(cachefile, params.json ? JSON.stringify(result.body) : result.body);
    }

    return result;
}
