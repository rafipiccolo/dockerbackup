import crypto, { constants } from 'crypto';
import fs from 'fs';
// import FormData from 'form-data';
import fetch, { FormData, File, fileFrom } from 'node-fetch';
import path from 'path';
import http from 'http';
import https from 'https';

/*
requestPromise({
    url: process.env.JO_TOKENURL,
    method: 'POST',
    headers: { 'User-Agent': 'rafi.piccolo' },
    cacheMs: 60000,
    followAllRedirects: true,
    jar,

    // enctype=application/x-www-form-urlencoded
    form: {
        grant_type: 'client_credentials',
        client_id: process.env.JO_CLIENTID,
        client_secret: process.env.JO_CLIENTSECRET,
        scope: 'openid',
    },

    // enctype=application/form-data
    formData: { file: fs.createReadStream(input) },

    // accept json / parse response json
    json: true,

    // return binary data
    encoding: null,

    // query string
    qs: {
        address: `${obj.address || ''} ${obj.cp || ''} ${obj.city || ''}`.trim(),
        sensor: 'true',
        key,
    },
});
*/

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const agent = (_parsedURL) => (_parsedURL.protocol == 'http:' ? httpAgent : httpsAgent);

export async function requestPromise(params) {
    if (typeof params == 'string') params = { url: params };

    params.headers ||= {};
    params.method ||= 'GET';

    // extract basic auth from url
    /*
    new URL('https://xxx:yyy@gfg.com:444/test?test2=4#8')
    {
        hash: "#8"
        host: "gfg.com:444"
        hostname: "gfg.com"
        href: "https://xxx:yyy@gfg.com:444/test?test2=4#8"
        origin: "https://gfg.com:444"
        password: "yyy"
        pathname: "/test"
        port: "444"
        protocol: "https:"
        search: "?test2=4"
        searchParams: URLSearchParams
        username: "xxx"
    }
    */
    const x = new URL(params.url);
    let username = null;
    let password = null;
    if (params.auth?.username && params.auth?.password) {
        username = params.auth.username;
        password = params.auth.password;
    }
    if (x.username && x.password) {
        username = x.username;
        password = x.password;
    }
    if (username && password) {
        if (btoa) params.headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
        else params.headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        params.url = x.origin + x.pathname + x.search + x.hash;
    }

    // qs
    if (params.qs) {
        params.url += `${params.url.includes('?') ? '&' : '?'}${new URLSearchParams(params.qs)}`;
    }

    // local caching mecanism
    // since we only rely on params.url for caching, this code must be after qs
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

    // application/x-www-form-urlencoded
    let body = null;
    if (params.form) {
        body = new URLSearchParams(params.form);
        params.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    // multipart/form-data
    if (params.formData) {
        const formData = new FormData();
        for (const key in params.formData) {
            // si c'est un stream
            if (params.formData[key].pipe) {
                const stream = params.formData[key];
                const filename = path.basename(stream.path);

                const binary = await new Promise((resolve, reject) => {
                    let data = '';

                    stream.setEncoding('binary');
                    stream.once('error', reject);
                    stream.on('data', (chunk) => {
                        data += chunk;
                    });
                    stream.on('end', () => {
                        resolve(Buffer.from(data, 'binary'));
                    });
                });

                let mimetype = 'application/octet-stream';
                if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) mimetype = 'image/jpg';
                if (filename.endsWith('.png')) mimetype = 'image/png';
                if (filename.endsWith('.pdf')) mimetype = 'application/pdf';
                const fileObject = new File([binary], filename, { type: mimetype });
                formData.set(key, fileObject, filename);
            } else {
                formData.set(key, params.formData[key]);
            }
        }
        body = formData;
    }

    // application/json :
    if (params.json) {
        if (params.json !== true) {
            body = JSON.stringify(params.json);
        }
        // do not override form's special headers
        if (!params.form && !params.formData) params.headers['Content-Type'] = 'application/json';
        params.headers.Accept = 'application/json';
    }

    if (params.jar) {
        params.headers.cookie = params.jar.cookies;
    }

    const response = await fetch(params.url, {
        method: params.method,
        headers: params.headers,
        body,
        redirect: 'follow',
        cache: 'default',
        agent,
    });

    const rawheaders = response.headers.raw();
    for (const key in rawheaders) {
        rawheaders[key] = rawheaders[key].join(';');
    }

    let output = null;
    if (params.encoding === null) {
        output = Buffer.from(await response.arrayBuffer());
    } else if (params.json && rawheaders['content-type']?.includes('application/json')) {
        output = await response.json();
    } else {
        output = await response.text();
    }

    if (params.jar) {
        const newcookies = parseCookies(response);
        if (newcookies) params.jar.cookies = newcookies;
    }

    // avec request c'était statusCode, fetch utilise status
    response.statusCode = response.status;
    if (cacheMs && parseInt(response.status) / 100 == 2) {
        await fs.promises.writeFile(cachefile, params.json ? JSON.stringify(output) : output);
    }

    return {
        response: {
            statusCode: response.status,
            headers: rawheaders,
        },
        body: output,
    };
}

function parseCookies(response) {
    const raw = response.headers.raw();
    if (!raw['set-cookie']) return null;

    return raw['set-cookie']
        .map((entry) => {
            const parts = entry.split(';');
            const cookiePart = parts[0];
            return cookiePart;
        })
        .join(';');
}

export function createJar() {
    return {
        cookies: '',
    };
}

export default {
    createJar,
    requestPromise,
};
