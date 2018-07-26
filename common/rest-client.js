// Copyright (c) 2013 ComputeNext Inc, Bellevue, WA. All rights reserved.
//process.env.NAME = "rest-client";     // the process name - for tracing

//Script Details
/*
 Author : Sundar.N
 Creation Date : 19 Mar
 */


// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/roleHelper.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
// END: initialize tracing





var async = require("async");
var cjson = require('cjson');
application_root 	= __dirname,
    express 			= require("express"),
    path 				= require("path");
var http = require('http');
var promise = require('bluebird');



var statusCount = 0;


//function -- common functionality for all the GET/PUT/DELETE Api calls
function getCall(optionsget){
    return new promise(function(fulfill,reject) {
        var reqGet = http.request(optionsget, function (res) {
            var data = '';
            trace.info('API Call details: ' + JSON.stringify(optionsget));
            //the listener that handles the response chunks
            res.addListener('data', function (chunk) {
                data += chunk.toString();
            });
            res.addListener('end', function (err, result) {
                if (err) {
                    return reject(err);
                }

                else {
                    try {
                        return fulfill( JSON.parse(data));
                    }
                    catch (e) {
                        trace.error(e.message+ data);
                        return reject(e.message);
                    }
                }
            });
        });

        reqGet.end();
        reqGet.on('error', function (e) {
            trace.error(e);
            return reject(e);
        });
    });
}

//function -- common functionality for all the POST Api calls
function postCall(optionspost,body){
    return new promise(function(fulfill,reject) {
        var reqPost = http.request(optionspost, function (res) {
            var data = '';
            trace.debug('API request body : ' + body);
            trace.info('API Call details: ' + JSON.stringify(optionspost));
            //the listener that handles the response chunks
            res.addListener('data', function (chunk) {
                data += chunk.toString();
            });
            res.addListener('end', function (err, result) {
                if (err) {
                    return reject(err);
                }

                else {
                    try {
                        //trace.info(JSON.stringify(data));
                        return fulfill(JSON.parse(data));
                    }
                    catch (e) {
                        trace.error(e.message);
                        return reject(e.message);

                    }
                }
            });
        });
        if (body != '') {
            reqPost.write(body);
        }
        reqPost.end();
        reqPost.on('error', function (e) {
            trace.error(e);
            return reject(e);
        });
    });
}

function putCall(optionspost,body){
    return new promise(function(fulfill,reject) {
        var reqPost = http.request(optionspost, function (res) {
            var data = '';
            trace.debug('API request body : ' + body);
            trace.info('API Call details: ' + JSON.stringify(optionspost));
            //the listener that handles the response chunks
            res.addListener('data', function (chunk) {
                data += chunk.toString();
            });
            res.addListener('end', function (err, result) {
                if (err) {
                    return reject(err);
                }

                else {
                    try {
                        //trace.info(JSON.stringify(data));
                        if(res.statusCode === 200) {
                            return fulfill(JSON.parse(data));
                        }else{
                            return reject(JSON.parse(data));
                        }
                    }
                    catch (e) {
                        trace.error(e.message);
                        return reject(e.message);

                    }
                }
            });
        });
        if (body != '') {
            reqPost.write(body);
        }
        reqPost.end();
        reqPost.on('error', function (e) {
            trace.error(e);
            return reject(e);
        });
    });
}

//function -- common functionality for all the GET/PUT/DELETE Api calls
function getCall_notrace(optionsget){
    return new promise(function(fulfill,reject) {
        var reqGet = http.request(optionsget, function (res) {
            var data = '';
            trace.debug('API Call details: ' + JSON.stringify(optionsget));
            //the listener that handles the response chunks
            res.addListener('data', function (chunk) {
                data += chunk.toString();
            });
            res.addListener('end', function (err, result) {
                if (err) {
                    return reject(err);
                }

                else {
                    try {
                        return fulfill( JSON.parse(data));
                    }
                    catch (e) {
                        trace.error(e.message+ data);
                        return reject(e.message);
                    }
                }
            });
        });

        reqGet.end();
        reqGet.on('error', function (e) {
            trace.error(e);
            return reject(e);
        });
    });
}

//function -- common functionality for all the POST Api calls
function postCall_notrace(optionspost,body){
    return new promise(function(fulfill,reject) {
        var reqPost = http.request(optionspost, function (res) {
            var data = '';
            trace.debug('API Call details: ' + JSON.stringify(optionspost));
            //the listener that handles the response chunks
            res.addListener('data', function (chunk) {
                data += chunk.toString();
            });
            res.addListener('end', function (err, result) {
                if (err) {
                    return reject(err);
                }

                else {
                    try {
                        //trace.info(JSON.stringify(data));
                        return fulfill(JSON.parse(data));
                    }
                    catch (e) {
                        trace.error(e.message);
                        return reject(e.message);

                    }
                }
            });
        });
        if (body != '') {
            reqPost.write(body);
        }
        reqPost.end();
        reqPost.on('error', function (e) {
            trace.error(e);
            return reject(e);
        });
    });
}

exports.getCall = getCall;
exports.postCall = postCall;
exports.putCall = putCall;
exports.postCall_notrace = postCall_notrace;
exports.getCall_notrace = getCall_notrace;