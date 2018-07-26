// the process name - for tracing

// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/auth.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);

//common variables
var secretKey = 'my-secret-key-01010101';

//required modules
var jwt = require('jsonwebtoken');
var promise = require('bluebird');

// projeect files
var cryptointernal = require ('./cryptointernal.js');

// this is not required //TODO
application_root = __dirname,
    express = require("express"),
    path = require("path");

trace.debug('__dirname:' + __dirname);

var app = express();

/*
var user = {};
user.generatedtime = new Date();
user.userid = '12345';
user.ownerid = '54321';
trace.info('userdata: ' + JSON.stringify(user));
*/


// In token formation it will be always having userid & accountid
function createWebToken (user){
    //user is user json -- > encryption --> encoding using jwt
	return new promise (function (fulfill, reject){
		if(user.userid && user.accountid){
			//user.generatedtime = new Date();
			var token = jwt.sign({t:cryptointernal.encrypt(JSON.stringify(user))}, secretKey, {"expiresInMinutes" : config.expiresInMinutes});
			//var token = jwt.sign(user, secretKey, {"expiresInMinutes" : config.expiresInMinutes});
			return fulfill(token);
		}
		else{
			return reject(null);
		}
	});
}



module.exports.auth = function (req, res, callback) {
    if(req.headers['x-auth-token']) {
        var reqToken = req.headers['x-auth-token'];
        jwt.verify(reqToken, secretKey, function (err, decoded) {
            //DETAILS : decoded contains t(required details), iat, exp
            if (err) {
                trace.debug('WebToken error: ' + err);
                if (err.name === 'TokenExpiredError') { // 'TokenExpiredError'
                    res.statusCode = 307;
                }
                else {
                    trace.error(err.name+' -- '+reqToken);
                    res.statusCode = 401; //error: JsonWebTokenError: invalid signature
                }
				
				if(req.tokenFlag){
					return res.send({
					  "result": {
						"response": {     
						  "errormessage": "Invalid x-auth-token ",
						  "respcode": 401
						}
					  },
					  "success": false,
					  "message": "Authentication failed"
					})
				}else{
					return res.send({error: err.name});
				}
               // return res.send({error: err.name});
            }else {
                var decodedData = JSON.parse(cryptointernal.decrypt(decoded.t));
                trace.info('token validated >>> regenerating token' + JSON.stringify(decodedData));
                issueRefreshToken(reqToken).then(function (refreshToken) {
                    req.headers['x-auth-token'] = refreshToken;
                    req.ownerId = decodedData.accountid;
					req.query.channelCode = decodedData.channelcode;
					req.query.languageCode = decodedData.locale;
                    req.userId = decodedData.userid;
                    if(decodedData.parentAccountId && decodedData.parentUserId) {
                        req.parentAccountId = decodedData.parentAccountId;
                        req.parentUserId = decodedData.parentUserId;
                    } 
					else if(decodedData.accountid && decodedData.userid) {
                        req.parentAccountId = decodedData.accountid;
                        req.parentUserId = decodedData.userid;
						trace.info("get account data @@@@@ " + req.parentAccountId)
						
                    }
                    return callback();
                }).catch(function onReject(err) {
                    trace.error(err);
                    res.statusCode = 400;
                    res.send(err);
                }).catch(function (error) {
                    trace.error(error);
                    res.statusCode = 500;
                    res.send(error);
                });
            }
        });
    }else if (config.isbypassAllowed === true && req.headers[config.bypassHeaderName] && req.headers['ownerid'] &&
        config [(req.headers[config.bypassHeaderName]).split(':')[0]] == (req.headers[config.bypassHeaderName]).split(':')[1]
    ){
		 trace.info('no token validate, without webtoken');
        //'cn-services-internal' : 'billing:26fba97f-e1b1-11e4-b9a8-000c29836967',
        // 'ownerId' : ''
        // req.headers['cn-services-internal'] = 'instance:26fba97f-e1b1-11e4-b9a8-000c29836967'
        req.ownerId = req.headers['ownerid'];
        return callback();
    }else{
        res.statusCode = 400;
        return res.send({});
    }
};

function refreshauth(token) {
	// token here is real token --> decode using jwt --> decryption
	return new promise (function (fulfill, reject){
        promise.delay(0000).then (function(){

            var reqToken = token; // x-auth-token
            //trace.info('Old Token : '+ reqToken);
            jwt.verify(reqToken, secretKey, function(err, decoded){
                if(err){
                    trace.info(err);
                    if (err.name === 'TokenExpiredError'){ // 'TokenExpiredError'
                        issueRefreshToken(reqToken).then (function(refreshToken){
                            return fulfill(refreshToken);
                        });
                    }
                    else{
                        return reject(err.name);
                    }
                }else{
                    issueRefreshToken(reqToken).then (function(refreshToken){
                        return fulfill(refreshToken);
                    });
                }
            });
        }).catch(function onReject(err) {
            trace.error(err);
            return reject ('TOKEN ERROR');
        }).catch(function (error) {
            trace.error('Error Occurred in : ' + error.stack);
            return reject('INTERNAL ERROR');
        });
	});
}

function decodeToken(token) {
    // token here is encrypted jwt token -- > decode --> decrypt
    return new promise (function (fulfill, reject){
        promise.delay(0000).then(function() {
            var reqToken = token; // x-auth-token
            trace.info('Parsing Token : ' + reqToken);
            jwt.verify(reqToken, secretKey, function (err, decoded) {
                if (err) {
                    return reject(err.name);
                }
                else {
                    var decrypted_decoded = JSON.parse(cryptointernal.decrypt(decoded.t));
                    // var decrypted_decoded = decoded;
                    return fulfill(decrypted_decoded.accountid);
                }
            });
        }).catch(function onReject(err) {
            trace.error(err);
            return reject ('TOKEN ERROR');
        }).catch(function (error) {
            trace.error('Error Occurred in : ' + error.stack);
            return reject('INTERNAL ERROR');
        });
    });
}

function issueRefreshToken (reqToken){
    //reqToken is real token --> decoding using jwt --> decryption
	return new promise (function (fulfill, reject){
        promise.delay(0000).then (function() {
            trace.debug('token validated >>> regenerating token');
            var dedoded = jwt.decode(reqToken);
            var decodedexp = JSON.parse(cryptointernal.decrypt(dedoded.t));

            delete decodedexp.generatedtime;
            delete decodedexp.iat;
            delete decodedexp.exp;
            return createWebToken(decodedexp);
            /*
        }).then(function (decodedexp){
            return createWebToken(decodedexp);
            */
        }).then(function (newToken) {
            return fulfill(newToken);
        }).catch(function onReject(err) {
            trace.error(err);
            return reject ('TOKEN ERROR');
        }).catch(function (error) {
            trace.error('Error Occurred in : ' + error.stack);
            return reject('INTERNAL ERROR');
        });
    });
}
module.exports.createWebToken = createWebToken;
module.exports.refreshauth = refreshauth;
module.exports.decodeToken = decodeToken;
