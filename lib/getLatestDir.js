import fs from 'fs';

export default async function getLatestdir(dir) {
    // remove trailing /
    if (dir != '/' && dir.substr(-1) == '/') dir = dir.substr(0, dir.length - 1);

    // create if not exists
    await fs.promises.mkdir(dir, { recursive: true });

    // list files
    const files = await fs.promises.readdir(dir);
    let res = null;

    // get the latest
    for (const file of files) {
        const path = `${dir}/${file}`;
        const s = await fs.promises.stat(path);
        s.path = path;
        if (s.isDirectory() && (res === null || s.birthtime > res.birthtime)) res = s;
    }

    // return only the file path
    return res?.path;
}
