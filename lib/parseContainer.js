module.exports = function parseContainer(container) {
    var backup = {};

    // if no driver specified => no job
    if (!container.Labels['backup.driver']) return null;

    // convert labels into variables
    for (let name in container.Labels) {
        var m = name.match(/backup.(\w+)/)

        if (m) {
            var option = m[1];
            backup[option] = container.Labels[name];
        }
    }
    backup.ignore = backup.ignore ? backup.ignore.split(',') : null;

    // parse env
    backup.env = container.Env.reduce((a, e) => {
        var m = e.match(/([a-z0-9_]+)=(.+)/i)
        var key = m[1];
        var value = m[2];
        a[key] = value;
        return a;
    }, {});

    // add other variables
    backup.name = container.Name.replace(/^\//, '');
    backup.id = container.Id;

    return backup;
}
