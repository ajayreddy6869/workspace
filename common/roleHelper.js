// Copyright (c) 2013 ComputeNext Inc, Bellevue, WA. All rights reserved.

// roleHelper.js
// Helper for V2 roles.
// stevejam 6/5/2013

// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/roleHelper.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
// END: initialize tracing

// packages
var cjson = require('cjson');
var request = require("request");
var promise = require('bluebird');

// VARIABLES
var SYSTEM_USER_ID = 'cccccccc-cccc-cccc-0000-cccccccccccc';

// dependent files
var tokenCreation = require('../common/auth').createWebToken;
var restservices = require('../common/rest-client.js');




// key is role length, value is roleInfo
var roleTable = {};

// key is ownerId, value is roleEntry
// NOTE: this does not expire. The process will probably restart quite frequently.
var roleCache = {};

// initialization

var roles = cjson.load(process.cwd() + '/data/roles.json');

trace.info('before initialization: roles.length: ' + roles.length);

for (var index in roles) {

    var role = roles[index];

    //trace.debug('role: ' + role);

    var roleLength = role.split('.').length;

    trace.info('roleLength: ' + roleLength+' : '+role );

    if (roleLength in roleTable) {

        var roleInfo = roleTable[roleLength];

        if (role in roleInfo) {

            trace.warn('DUPLICATE: role: ' + role);

            continue;
        }

        //trace.debug('add new role: role: ' + role);

        roleInfo[role] = role;

        continue;
    }

    //trace.debug('add new roleInfo: role: ' + role);

    var roleInfo = {};

    roleInfo[role] = role;

    roleTable[roleLength] = roleInfo;
}

trace.debug('roleTable: ' + JSON.stringify(roleTable, null, 2));

var initialized = true;

trace.info('after initialization: roles.length: ' + roles.length);

roles = null;   // no longer needed - free memory

// get the role that corresponds to this request
function getRoleForRequest(req) {
    trace.debug('enter: getRoleForRequest: method: ' + req.route.method + ': path: ' + req.path);

    if (!initialized) {
        // a bit hokey but it works...
        var initializeIntervalInMSec = 1000;
        return setTimeout(getRoleForRequest, initializeIntervalInMSec, req);
    }

    var method = req.route.method.toLowerCase();
    var parts = req.path.toLowerCase().split('/');

    //trace.debug('before: parts.length: ' + parts.length );

    // cleanup - some parts may be empty
    var newParts = [];
    for (var index in parts) {
        //trace.debug('index: ' + index + ': parts[index].length: ' + parts[index].length + ': parts[index]: ' + parts[index]);
        if (parts[index].length > 0) {
            newParts.push(parts[index].replace('.', '-'));
        }
    }

    parts = newParts;
    //trace.debug('after: parts.length: ' + parts.length + parts);

    var roleLength = parts.length+1;  // add 1 for the method

    //trace.debug('ROLELENGTH' + roleLength);

    if (!(roleLength in roleTable)) return null;

    var roleInfo = roleTable[roleLength];

    var role = null;

    for (var candidate in roleInfo) {
       // trace.debug('candidate: ' + candidate);
        var candidateParts = candidate.split('.');
        if (candidateParts[0] != method) continue;

        var match = true;

        for (var i = 1; i < candidateParts.length; i++) {
            var candidatePart = candidateParts[i];
            var pathPart = parts[i - 1];
            //trace.debug('i: ' + i + ': candidatePart: ' + candidatePart + ': pathPart: ' + pathPart + ': pathPart.length: ' + pathPart.length);

            // ignore if id
            if (candidatePart === 'id') continue;

            // if guid then length must be 36 for match
            if (candidatePart === 'guid') {
                if (pathPart.length === 36) continue;
                match = false;
                break;
            }

            if (candidatePart != pathPart) {
                match = false;
                break;
            }
        }

        //trace.debug('match: ' + match);

        if (match) {
            trace.debug('found match');
            role = candidate;
            break;
        }
    }

    trace.info('role: ' + role);
    return role;
}

// for GCM model auth purpose
// TODO check the config bypassUserId before deploying in server.
function getAdminUser(req){
    return new promise(function(fulfill,reject){
        if(typeof req.userId === 'undefined' && config.bypassUserId === true) {
/*
            var headers = {
                "Content-Type": "application/json"
            };
            var optionsget = {
                host : 'localhost',
                port : 8000,
                path: '/api/authentication/getAdminUser/'+req.ownerId,
                method: 'GET',
              --  headers: headers
            };
            restservices.getCall(optionsget).then(function (adminUserId) {
                req.userId = adminUserId._id;
                req.IsBypassed = true;
                return fulfill(req);
            }).catch(function onReject(err) {
                return fulfill(null);
            }).catch(function(error){
                return fulfill(null);
            });
            */
            req.userId = SYSTEM_USER_ID;
            req.IsBypassed = true;
            return fulfill(req);
        }
        else{
            req.IsBypassed = false;
            return fulfill(req);
        }
    });
}

function authorizeRequest(req, res, callback) {

    getAdminUser(req).then(function(req) {
        try {
            var parameters = {
                method: req.route.method,
                path: req.path,
                ownerId: req.ownerId,
                UserId: req.parentUserId || req.userId
            };
        }
        catch(e){
            return res.send(403);
        }

        if(req.IsBypassed === true || req.ownerId === SYSTEM_USER_ID){
            trace.info('role check: bypassing the role check : internal service call: admin userid appended || role check: SYSTEM_USER_ID: is in all roles');
            return callback();
        }

        //trace.info('enter: authorizeRequest: parameters: ' + JSON.stringify(parameters, null, 2));
        var role = getRoleForRequest(req);
        if (!role) {
            // common error
            trace.debug('authorization failed: no role was matched: parameters: ' + JSON.stringify(parameters, null, 2));
            return res.send(403);
        }

        parameters.role = role;



        // BEGIN: check role cache
        if (req.ownerId + ':' + parameters.UserId in roleCache) {
            var roleEntry = roleCache[req.ownerId + ':' + parameters.UserId];
            if (role in roleEntry) {
                var inrole = roleEntry[role];

                trace.debug('cache hit: inrole: ' + inrole);
                if (inrole) {
                    trace.debug('cache: in role OK: parameters: ' + JSON.stringify(parameters, null, 2));
                    return callback();
                }
                else {
                    trace.warn('cache: authorization failed: role: ' + parameters.role + ': ownerId: ' + parameters.ownerId + ': parameters: ' + JSON.stringify(parameters, null, 2));
                    return res.send(403);    // "Forbidden"
                }
            }
        }
        // END: check role cache

        var headers = {
            "Content-Type": "application/json"
            //"x-auth-token": req.headers['x-auth-token'] //token is must for user/userid?role='' , to get the ownerId
        };

        //TODO : change the localhost to config.authorizationEndPoint

        var options = {
            method: 'get',
            url: 'http://localhost:8001/api/authorization/user/' + parameters.UserId + '?role=' + role+'&ownerId='+parameters.ownerId,
            headers: headers
        };
        trace.debug('cache miss: options: ' + JSON.stringify(options, null, 2));
        return request(options, function (err, response, body) {

            if (err) {
                parameters.err = err;
                trace.warn('err: authorization failed: role: ' + parameters.role + ': ownerId: ' + parameters.ownerId + ': parameters: ' + JSON.stringify(parameters, null, 2));
                return res.send(403);    // "Forbidden"
            }

            if (response && response.statusCode === 200) {
                var result = {};

                if (body) {
                    try {
                        result = JSON.parse(body);
                    }
                    catch (e) {
                        result = body;
                    }
                }
                if (result.inrole) {
                    trace.info('in role OK: parameters: ' + JSON.stringify(parameters, null, 2));
                    callback();
                }else {
                    parameters.result = result;
                    trace.warn('authorization failed: not in role: ' + parameters.role + ': ownerId: ' + parameters.ownerId + ': parameters: ' + JSON.stringify(parameters, null, 2));
                    res.send(403);    // "Forbidden"
                }

                // BEGIN: add to cache
                var roleEntry = {};
                if (req.ownerId + ':' + parameters.UserId in roleCache) {
                    trace.info('existing entry in roleCache');
                    roleEntry = roleCache[req.ownerId + ':' + parameters.UserId];
                }
                else {
                    trace.info('new entry for roleCache');
                    roleCache[req.ownerId + ':' + parameters.UserId] = roleEntry;
                }
                roleEntry[role] = result.inrole;
                // END: add to cache

            } else {
                parameters.statusCode = response.statusCode;
                trace.warn('statusCode: authorization failed: role: ' + parameters.role + ': ownerId: ' + parameters.ownerId + ': parameters: ' + JSON.stringify(parameters, null, 2));
                return res.send(403);    // "Forbidden"
            }
        });

    });
}

// EXPORTS

exports.getRoleForRequest = getRoleForRequest;
exports.authorizeRequest = authorizeRequest;
