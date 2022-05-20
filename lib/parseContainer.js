export default function parseContainer(container) {
    const backup = {};

    // if no driver specified => no job
    if (!container.Labels['backup.driver']) return null;

    // convert labels into variables
    for (const name in container.Labels) {
        const m = name.match(/backup.(\w+)/);

        if (m) {
            const option = m[1];
            backup[option] = container.Labels[name];
        }
    }
    backup.ignore = backup.ignore ? backup.ignore.split(',') : null;

    backup.env = container.env;
    backup.name = container.name;
    backup.id = container.id;

    return backup;
}
