var Phantom = require("phantom-workers"),
    fs = require("fs"),
    _ = require("lodash");

var phantoms = new Map([]);

function ensurePhantom(phantom, cb) {
    if (phantom.started)
        return cb();

    phantom.startCb = phantom.startCb || [];
    phantom.startCb.push(cb);

    if (phantom.starting)
        return;

    phantom.starting = true;

    phantom.start(function(startErr) {
        phantom.started = true;
        phantom.starting = false;
        phantom.startCb.forEach(function(cb) { cb(startErr); })
    });
}

module.exports = function(options, requestOptions, id, cb) {
    var phantomInstanceId = requestOptions.phantomPath || options.phantomPath || "default";

    if (!phantoms.has(phantomInstanceId)) {
        var opts = _.extend({}, options);
        opts.workerEnv = {
            'PHANTON_MAX_LOG_ENTRY_SIZE': options.maxLogEntrySize || 1000
        }
        opts.phantomPath = requestOptions.phantomPath || options.phantomPath;
        phantoms.set(phantomInstanceId, Phantom(opts));
    }

    var phantom = phantoms.get(phantomInstanceId);

    ensurePhantom(phantom, function(err) {
        if (err)
            return cb(err);

        phantom.execute(requestOptions, function (err, res) {
            if (err) {
                // if the error is a timeout from phantom-workers
                if (err.message === "Timeout") {
                    err.phantomTimeout = true;
                }

                return cb(err);
            }

            if (res.isError) {
                var error = new Error(res.message);
                error.stack = res.stack;
                return cb(error);
            }

            res.logs.forEach(function(m) {
                m.timestamp = new Date(m.timestamp)
            })

            cb(null, {
                stream: fs.createReadStream(requestOptions.output),
                numberOfPages: res.numberOfPages,
                logs: res.logs,
                kill: function () {
                    if (!phantom.started)
                        return;

                    phantom.started = false;
                    phantom.startCb = [];

                    phantoms.delete(phantomInstanceId);

                    return phantom.kill();
                }
            });
        });
    })
};

module.exports.kill = function() {
    phantoms.forEach(function (phantom, key) {
        var phantom = phantoms[key]
        if (!phantom.started)
            return;

        phantom.started = false;
        phantom.startCb = [];
        return phantom.kill();
    })

    phantoms.clear();
}
