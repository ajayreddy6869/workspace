'use strict';

// Copyright (c) 2013 ComputeNext Inc, Bellevue, WA. All rights reserved.



// packages
var async = require("async");
var string = require("string");
var promise = require('bluebird');
var Db = require('mongodb').Db;

// project files
var errorInfoCode = require('../common/errorInfo');
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/openMongo.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);

//common
var READ_LIMIT = 2500;



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

function createCommon(collectionName, query) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: createCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

//			trace.debug('query: ' + JSON.stringify(query, null, 2));

            // the "safe" option is required to get the correct error returned on duplicates

            return collection.insert(query, { safe: true }, function (err,documents) {

                if (err) {

                    trace.warn('err: ' + JSON.stringify(err, null, 2));

                    var errorInfo;

                    if (string(err.err).contains('E11000')) {

                        errorInfo = errorInfoCode.getErrorInfo(400, 'the record already exists');

                        // user error
                        trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                    }
                    else {

                        errorInfo = errorInfoCode.getErrorInfo(500, 'internal error');

                        trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                    }
                    return reject(errorInfo);

                }
                return fulfill(documents);
            });
        });
    });
}

function upsertCommon(collectionName, query, set) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: updateCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            trace.debug('set: ' + JSON.stringify(set, null, 2));

            return collection.update(query, set, { safe: true, upsert: true, multi: true }, function (err, numberUpdated) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);
                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message + ' doc details : '+ JSON.stringify(set) + ' query details : '+ JSON.stringify(query));
                    return reject(errorInfo);
                }

                trace.debug('numberUpdated: ' + numberUpdated);

                return fulfill(numberUpdated);
            });
        });
    });
}

function retrieveCommon(collectionName, query) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.find(query, null, { limit: READ_LIMIT }).toArray(function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill(results);
            });
        });
    });
}

function retrieveSortCommon(collectionName, query, optattib) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: retrieveSortCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.find(query, optattib).toArray(function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill(results);
            });
        });
    });

}

function retrieveLimitFields(collectionName, query, fields) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.find(query, fields, { limit: READ_LIMIT }).toArray(function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message + ' doc details : '+ JSON.stringify(fields) + ' query details : '+ JSON.stringify(query));

                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill(results);
            });
        });
    });

}

function retrieveLimitFieldsPagination(collectionName, query, fields,options) {

    return new promise (function (fulfill, reject) {

        trace.info('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.find(query, fields, options).toArray(function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill(results);
            });
        });
    });

}

function retrieveOneLimitFields(collectionName, query, fields) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.findOne(query, fields,function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                return fulfill(results);
            });
        });
    });

}

function updateCommon(collectionName, query, set) {

    return new promise (function (fulfill, reject) {

        trace.debug('enter: updateCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            trace.debug('set: ' + JSON.stringify(set, null, 2));

            return collection.update(query, set, { safe: true, multi: true }, function (err, numberUpdated) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                trace.debug('numberUpdated: ' + numberUpdated);

                return fulfill(numberUpdated);
            });
        });
    });
}

function saveCommon(collectionName, query, set) {

    return new promise (function (fulfill, reject) {

        trace.info('enter: saveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            trace.debug('set: ' + JSON.stringify(set, null, 2));

            return collection.save(query, set, function (err, numberUpdated) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }
                trace.debug('numberSaved: ' + numberUpdated);

                return fulfill(numberUpdated);
            });
        });
    });
}

function deleteCommon(collectionName, query, callback) {

    trace.debug('enter: deleteCommon: collectionName: ' + collectionName);

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

function deleteMultiple(collectionName, query) {

    return new promise (function (fulfill, reject) {

        trace.info('enter: deleteCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            // 'single' => remove only one document, 'safe' is required to get the correct value back for numberOfRemovedDocs

            return collection.remove(query, { safe: true}, function (err, numberOfRemovedDocs) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return reject(errorInfo);
                }

                trace.debug('numberOfRemovedDocs: ' + numberOfRemovedDocs);

                return fulfill( numberOfRemovedDocs);
            });
        });
    });
}

function retrieveDistinct(collectionName, propertyName, query, callback) {

    trace.debug('enter: retrieveDistinct: collectionName: ' + collectionName + ': propertyName: ' + propertyName);

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

function retrieveDistinctValues(collectionName, propertyName, query, callback) {
    return new promise (function (fulfill, reject) {

        trace.info('enter: retrieveDistinctValues: collectionName: ' + collectionName + ': propertyName: ' + propertyName);

        return db.collection(collectionName, function (err, collection) {
            if (err) {
                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);
                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                return reject(errorInfo);
            }

            trace.debug('distinct: query: ' + JSON.stringify(query, null, 2));

            return collection.distinct(propertyName, query, function (err, results) {
                if (err) {
                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);
                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill (results);
            });
        });
    });
}

function retrieveAggregateFields(collectionName, query, fields) {

    return new promise (function (fulfill, reject) {

        trace.info('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return reject(errorInfo);
            }

            //query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.aggregate(query, {readPreference: null},function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message + ' doc details : '+ JSON.stringify(fields) + ' query details : '+ JSON.stringify(query));

                    return reject(errorInfo);
                }

                trace.debug('results.length: ' + results.length);

                return fulfill(results);
            });
        });
    });

}
function retrieveCommonLimitedAll(collectionName, query,feilds,callback) {   

     

        trace.debug('enter: retrieveCommon: collectionName: ' + collectionName);

        return db.collection(collectionName, function (err, collection) {

            if (err) {

                var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return callback(errorInfo,null);
            }

            query = { $query: query };

            trace.debug('query: ' + JSON.stringify(query, null, 2));

            return collection.find(query, feilds).toArray(function (err, results) {

                if (err) {

                    var errorInfo = errorInfoCode.getErrorInfo(500, err.err);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return callback(errorInfo,null);
                }

                trace.debug('results.length: ' + results.length);

                return callback(null,results);
            });
        });
  
  
}
// END: COMMON functions

// EXPORTS


exports.createCollections = createCollections;
exports.createCommon = createCommon;
exports.upsertCommon = upsertCommon;
exports.retrieveCommon = retrieveCommon;
exports.retrieveSortCommon = retrieveSortCommon;
exports.updateCommon = updateCommon;
exports.saveCommon = saveCommon;
exports.deleteCommon = deleteCommon;
exports.deleteMultiple = deleteMultiple;
exports.retrieveDistinct = retrieveDistinct;
exports.retrieveDistinctValues = retrieveDistinctValues;
exports.retrieveLimitFields = retrieveLimitFields;
exports.retrieveOneLimitFields = retrieveOneLimitFields;
exports.retrieveLimitFieldsPagination = retrieveLimitFieldsPagination;
exports.retrieveAggregateFields = retrieveAggregateFields;
exports.retrieveCommonLimitedAll = retrieveCommonLimitedAll ;