var fs = require('fs');
var readdir = require('util').promisify(fs.readdir);
var stat = require('util').promisify(fs.stat);
var mkdir = require('util').promisify(fs.mkdir);

module.exports = async function getLatestdir(dir) {
    // create if not exists
    await mkdir(dir, {recursive: true});
    
    // list files
    var files = await readdir(dir);
    var res = null;
    
    // get the latest
    for (var file of files) {
        var path = dir+'/'+file;
        var s = await stat(path);
        s.path = path;
        if (s.isDirectory() && (res === null || s.mtime > res.mtime)) res = s;
    }

    // return only the file path
    return res ? res.path : null;
}
