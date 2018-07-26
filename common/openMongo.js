'use strict';

// Copyright (c) 2013 ComputeNext Inc, Bellevue, WA. All rights reserved.

// openMongo.js
// CFM-3675
// opens one MongoDB database (global "db") -
// - either single or replica set
// - either with or without authentication
// stevejam 9/27/2013
// stevejam 4/21/2014: updated to add more common functions: CFM-7163

// NODE_ENV: development | test | production

// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/openMongo.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
// END: initialize tracing

// packages
var async = require("async");
var string = require("string");

// project files
var errorInfoCode = require('./errorInfo');
var archiveClientCode = require('./archiveClient');   // TODO:

trace.info('config: ' + JSON.stringify(config, null, 2));

var Db = require('mongodb').Db;
var Server = require('mongodb').Server;
var ReplSetServers = require('mongodb').ReplSetServers;

function openMongo(database, callback) {

    trace.info('enter: openMongo: database: ' + database);

    if (config.replicas) {

        var servers = [];

        for (var index in config.replicas) {

            var replica = config.replicas[index];

            trace.info('replica: ' + JSON.stringify(replica, null, 2));

            // NOTE: the first server (index 0) is the primary server
            // all others are secondary servers

            var server = new Server(replica.host, replica.port);

            servers.push(server);
        }

        trace.info('servers.length: ' + servers.length);

        var replicaSet = new ReplSetServers(servers);

        // GLOBAL
        global.db = new Db(database, replicaSet, { w: 0 });
    }
    else {

        // GLOBAL
        global.db = new Db(database, new Server(config.host, config.port, { auto_reconnect: true }, {}), { safe: true });
    }

    return db.open(function (err) {

        if (err) return callback(err);

        trace.info('db.open OK: database: ' + database);

        if (config.username && config.password) {

            trace.info('authentication required: username: ' + config.username);

            return db.admin().authenticate(config.username, config.password, function (err) {

                if (err) return callback(err);

                trace.info('authentication OK');

                return callback();
            });
        }

        return callback();
    });
}

function createCollections(collectionSpecs, callback) {

    trace.info('enter: createCollections: collectionSpecs.length: ' + collectionSpecs.length);

    return async.forEachSeries(collectionSpecs, initializeCollection, function (err) {

        return callback(err);
    });
}

// async iterator
function initializeCollection(collectionSpec, callback) {

    var collectionName = collectionSpec.collectionName;
    var index = collectionSpec.index;

    trace.info('initializeCollection: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        trace.info('collection created: collectionName: ' + collectionName + ': err: ' + err);

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        if (!index) return callback();

        return db.ensureIndex(collectionName, index, { unique: true }, function (err, collection) {

            trace.info('return: ensureIndex: collectionName: ' + collectionName + ': err: ' + err);

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            return callback();
        });
    });
}

// BEGIN: COMMON functions

function createCommon(collectionName, query, callback) {

    trace.info('enter: createCommon: collectionName: ' + collectionName);

    delete query._id;   // in case it still has an _id

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        trace.debug('query: ' + JSON.stringify(query, null, 2));

        // the "safe" option is required to get the correct error returned on duplicates

        return collection.insert(query, { safe: true }, function (err) {

            if (err) {

                trace.info('err: ' + JSON.stringify(err, null, 2));

                var errorInfo;

                if (string(err.err).contains('E11000')) {

                    errorInfo = errorInfoCode.getErrorInfo(400, 'the record already exists');

                    // user error
                    trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                }
                else {

                    errorInfo = errorInfoCode.getErrorInfo(500, 'internal error');

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                }

                return callback(errorInfo);
            }

            return callback();
        });
    });
}

function retrieveCommon(collectionName, query, readLimit, callback) {

    trace.info('enter: retrieveCommon: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        // add "orderby" to query
        if(!query.$orderby){
			trace.info('in ifff:::::');
			query = { $query: query, $orderby: { 'created': 1 } };
		}

        trace.debug('query: ' + JSON.stringify(query, null, 2));

        return collection.find(query, null, { limit: readLimit }).toArray(function (err, results) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('results.length: ' + results.length);

            return callback(null, results);
        });
    });
}

function retrieveCommonLimitFields(collectionName, query, set, callback) {

    trace.info('enter: retrieveCommon: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        // add "orderby" to query

        query = { $query: query, $orderby: { 'created': 1 } };

        trace.debug('query: ' + JSON.stringify(query, null, 2));

        return collection.find(query, set).toArray(function (err, results) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('results.length: ' + results.length);

            return callback(null, results);
        });
    });
}

function updateCommon(collectionName, query, set, callback) {

    trace.info('enter: updateCommon: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        trace.debug('query: ' + JSON.stringify(query, null, 2));
		if(query.resourceUri){
			query.resourceUri=query.resourceUri.toLowerCase();
		}
		if(query.currencyCode){
			query.currencyCode=query.currencyCode.toLowerCase();
		}

        trace.debug('set: ' + JSON.stringify(set, null, 2));

        return collection.update(query, set, { safe: true, multi: true }, function (err, numberUpdated) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('numberUpdated: ' + numberUpdated);

            return callback(null, numberUpdated);
        });
    });
}



function upsertCommon(collectionName, query, set,callback) {

       trace.debug('enter: updateCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            trace.debug('set: ' + JSON.stringify(set, null, 2));

            return collection.update(query, set, { safe: true, upsert: true, multi: true }, function (err, numberUpdated) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);
                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message + ' doc details : '+ JSON.stringify(set) + ' query details : '+ JSON.stringify(query));
                    return callback(errorInfo);
                }

                trace.debug('numberUpdated: ' + numberUpdated);

                return callback(null,numberUpdated);
            });
        });
   
}




function deleteCommon(collectionName, query, callback) {

    trace.info('enter: deleteCommon: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        trace.debug('query: ' + JSON.stringify(query, null, 2));

        // 'single' => remove only one document, 'safe' is required to get the correct value back for numberOfRemovedDocs

        return collection.remove(query, { single: true, safe: true }, function (err, numberOfRemovedDocs) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('numberOfRemovedDocs: ' + numberOfRemovedDocs);

            return callback(null, numberOfRemovedDocs);
        });
    });
}

function deleteCommonMultiple(collectionName, query, callback) {

    trace.info('enter: deleteCommon: collectionName: ' + collectionName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        trace.debug('query: ' + JSON.stringify(query, null, 2));

        // 'single' => remove only one document, 'safe' is required to get the correct value back for numberOfRemovedDocs

        return collection.remove(query, { single: false, safe: true }, function (err, numberOfRemovedDocs) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('numberOfRemovedDocs: ' + numberOfRemovedDocs);

            return callback(null, numberOfRemovedDocs);
        });
    });
}

function retrieveDistinct(collectionName, propertyName, query, callback) {

    trace.info('enter: retrieveDistinct: collectionName: ' + collectionName + ': propertyName: ' + propertyName);

    return db.collection(collectionName, function (err, collection) {

        if (err) {

            var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        trace.debug('distinct: query: ' + JSON.stringify(query, null, 2));

        return collection.distinct(propertyName, query, function (err, results) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo);
            }

            trace.debug('results.length: ' + results.length);

            return callback(null, results);
        });
    });
}

// END: COMMON functions

// EXPORTS
exports.upsertCommon = upsertCommon ;
exports.openMongo = openMongo;
exports.createCollections = createCollections;
exports.createCommon = createCommon;
exports.retrieveCommon = retrieveCommon;
exports.updateCommon = updateCommon;
exports.deleteCommon = deleteCommon;
exports.retrieveDistinct = retrieveDistinct;
exports.deleteCommonMultiple = deleteCommonMultiple;
exports.retrieveCommonLimitFields = retrieveCommonLimitFields;