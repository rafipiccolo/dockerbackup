module.exports = function verbose(s) {
    if (process.env.VERBOSE == '1' || process.env.VERBOSE == 'true')
        console.log(s);
}
