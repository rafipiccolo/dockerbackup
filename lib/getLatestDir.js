var fs = require('fs');

module.exports = async function getLatestdir(dir) {
    // create if not exists
    await fs.promises.mkdir(dir, {recursive: true});
    
    // list files
    var files = await fs.promises.readdir(dir);
    var res = null;
    
    // get the latest
    for (var file of files) {
        var path = dir+'/'+file;
        var s = await fs.promises.stat(path);
        s.path = path;
        if (s.isDirectory() && (res === null || s.mtime > res.mtime)) res = s;
    }

    // return only the file path
    return res ? res.path : null;
}
