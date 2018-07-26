/* jshint node:true */
'use strict';

// Copyright (c) 2014 ComputeNext Inc, Bellevue, WA. All rights reserved.

// resourcesv2.js
// New resource service for V2.
// stevejam 4/8/2014.

process.env.NAME = "resourcesv2";     // the process name - for tracing

// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var config = yaml_config.load(__dirname + '/resourcesv2.yaml');
var cjson = require('cjson');
var vpaconfig = yaml_config.load(__dirname + '/vpabackgroundjob.yaml');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
var validate = require("json-schema").validate;
var resourceSchema = cjson.load(__dirname + '/data/schemas/resource.json');
var languageSchema = cjson.load(__dirname + '/data/schemas/language.json');
var subscriptionSchema = cjson.load(__dirname + '/data/schemas/subscription.json');
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
// END: initialize tracing

// packages
var async = require("async");
var string = require("string");
var uuid = require('node-uuid');
//var mongoose = require("mongoose");
//var datejs = require('datejs');  // extends Date: see: https://code.google.com/p/datejs/
// NOTE: if we need to use datejs the "Date.parse" behavior is different - check below (retrieve multiple resources)
var NodeCache = require("node-cache");
var cjson = require('cjson');
var _ = require('underscore');
var traverse = require('traverse');
var fs = require("fs");
var request = require("request");
var http = require('http');
var fork = require('child_process').fork;

var auth = require('../common/auth').auth;
var authConfig = yaml_config.load('../common/auth.yaml');

// project files
var errorInfoCode = require('../common/errorInfo');
var openMongoCode = require('../common/openMongo');
var roleHelperCode = require('../common/roleHelper');
//var commonreg = require('../common/loadRegistry');
var getResourceCode = require('../common/getResource');
var resSaasScript = require('./resSaasScript.js');
var publishScript = require('./publishScript.js');
// BEGIN: VARIABLES

// for /status
var startTime = new Date();

var port;

var resourcesCollectionName = 'resources';
var regionsCollectionName = 'regions';
var subscriptionCollectionName = 'subscription';
var languageCollectionName = 'language';
var READ_LIMIT = 300;
var resourceAttributes = config.resourceAttributes;
var languageAttributes = config.languageAttributes;
var subscriptionAttributes = config.subscriptionAttributes;
var commonAttributes = config.commonAttributes;

var SYSTEM_USER_ID = config.ownerId;
trace.info("SYSTEM_USER_ID"+SYSTEM_USER_ID);
trace.info('config.stdTTLInSec: ' + config.stdTTLInSec);
trace.info('config.checkperiodInSec: ' + config.checkperiodInSec);

// resource cache: key: resourceUri
var resourceCache = new NodeCache({ stdTTL: config.stdTTLInSec, checkperiod: config.checkperiodInSec });
// TODO: resourceCache is not actually used anywhere yet!

// region cache: key: regionUri
var regionCache = new NodeCache({ stdTTL: config.stdTTLInSec, checkperiod: config.checkperiodInSec });

// GCM-1627: user cache: key: ownerId
var userCache = new NodeCache({ stdTTL: config.stdTTLInSec, checkperiod: config.checkperiodInSec });

// GCM-1627: definition of channels
var channels = {};

// CMP-785 CRUD Operation Changes
var languageCode="";
var channelCode="";
var currencyCode="";
var collectionName="resources";
var defLanguage = config.defaultLanguage.toLowerCase();
var defChannel = config.defaultChannel.toLowerCase();
var defCurrency = config.defaultCurrency.toLowerCase();
// conversions (from V2 to V1 format)
var messagesJson = cjson.load(__dirname + '/messages.json');
var resourceMsg=JSON.parse(JSON.stringify(messagesJson));

// resourceQuery/query
var rqRegionProperties = {};
var rqResourceProperties = {};

// resourceQuery/region
var regionConversionProperties = {};

var conversions = cjson.load('conversions.json');

trace.info('conversions.region.length: ' + conversions.region.length);
trace.info('conversions.resource.length: ' + conversions.resource.length);
trace.info('conversions.regionForRegion.length: ' + conversions.regionForRegion.length);

function setupConversion(fromArray, toObject) {

    for (var index in fromArray) {

        var entry = fromArray[index];

        var parts = entry.split('/');

        if (parts.length > 1) {

            toObject[parts[0]] = { target: parts[1] };

            continue;
        }

        toObject[entry] = { target: entry };
    }
}

setupConversion(conversions.region, rqRegionProperties);
setupConversion(conversions.resource, rqResourceProperties);
setupConversion(conversions.regionForRegion, regionConversionProperties);

trace.info('rqRegionProperties: ' + JSON.stringify(rqRegionProperties, null, 2));
trace.info('rqResourceProperties: ' + JSON.stringify(rqResourceProperties, null, 2));
trace.info('regionConversionProperties: ' + JSON.stringify(regionConversionProperties, null, 2));

// for resourceQuery/action
var stateMachinesTop = cjson.load('data/V1_state_machines.json');

// GCM-1429: resourcesv2 metrics (for this process instance)
var metrics = {

    startDateUtc: new Date(),
    startDate: new Date().toLocaleString(),

    // counts the REST calls to this resourcesv2 process
    // key is "call name" - for example, "post.resource"
    calls: {}
};

function countCall(callName) {

    if (!(callName in metrics.calls)) {

        metrics.calls[callName] = 0;
    }

    metrics.calls[callName]++;
}

// 2014-06-13T17:19:43.441Z
var iso = metrics.startDateUtc.toISOString();
var parts = iso.split('T');
var dateParts = parts[0].split('-');
var timeParts = parts[1].split(':');
var lastTimeParts = timeParts[2].split('.');

var timestamp = dateParts[0] + dateParts[1] + dateParts[2] + '-' + timeParts[0] + timeParts[1] + lastTimeParts[0];

var metricsFilename = 'metrics/MT-' + process.env.COMPUTERNAME + '-' + timestamp + 'Z-resourcesv2[' + process.pid + '].json';

trace.info('metricsFilename: ' + metricsFilename);

var metricsIntervalInMsec = 30 * 1000;    // 30 seconds
var vpaIntervalInMsec;

// END: VARIABLES

// BEGIN: configuration parameters

trace.info('config.port: ' + config.port);

// the oldest possible date a record could exist in the "resourcesv2" database
var baseDate = new Date(config.baseDate);

trace.info('baseDate: ' + baseDate);

// END: configuration parameters

// GCM-1627
// CMP-821
/*function loadChannels() {

    var channelFiles = fs.readdirSync(__dirname + '/data/channels');

    trace.info('enter: loadChannels: channelFiles.length: ' + channelFiles.length);

    for (var index in channelFiles) {

        var fileName = channelFiles[index];

        if (!string(fileName).endsWith('.json')) continue;

        if (string(fileName).startsWith('debug')) continue;

        var channelcode = fileName.replace('.json', '').toLowerCase();

        trace.debug('fileName: ' + fileName + ': channelcode: ' + channelcode);

        var channel = cjson.load(__dirname + '/data/channels/' + fileName);

        trace.debug('channel.length: ' + channel.length);

        channels[channelcode] = {};

        for (var index2 in channel) {

            var regionUri = channel[index2];

            channels[channelcode][regionUri] = true;
        }
    }

    // for debug only

    var debug_file = __dirname + '/data/channels/debug_resourcev2_channels.json';

    fs.writeFileSync(debug_file, JSON.stringify(channels, null, 2));

    trace.info('exit: loadChannels: debug_file: ' + debug_file);
}*/
// CMP-821
/*trace.info('start fork: rv2fixup.js');

var child = fork('rv2fixup.js');

if (child) {

    trace.info('fork: rv2fixup.js: child.pid: ' + child.pid);
}
else {

    trace.warn('fork: rv2fixup.js: failed');
}*/
//CMP-821
//loadChannels();

// BEGIN: express app for REST service

var application_root = __dirname,
    express = require("express"),
    path = require("path");

var app = express();

// express initialization

app.configure(function () {
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(app.router);
    app.use(express.static(path.join(application_root, "public")));
    //app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    app.use(errorHandler);
});

// BEGIN: REST API

// Basic authentication

// See: http://blog.modulus.io/nodejs-and-express-basic-authentication
/*var auth = express.basicAuth(function(user, pass, callback) {

     trace.debug('enter: auth: basic authentication: user: ' + user + ': pass: ' + pass);

    // SECURITY: OK to trace password, it is not actually a password here

    // resourcesv2 is an INTERNAL service only, it does not do any authentication.
    // authentication of EXTERNAL API requests is done by the gateway service and then the call is forwarded to resourcesv2.
    // for INTERNAL requests, the Basic authentication user parameter here is the user id (Guid).
    // TODO: pass(word) is not currently used. Impersonation?

    return callback(null, user);
});
*/
// STATUS

// CFM-6577
var statusCount = 0;

// GET service status
app.get('/resources/status', function (req, res) {

    if (statusCount < 20 || !(statusCount % 100)) {
        trace.info('enter: /resources/status: ' + statusCount++);
    }
    else {
        trace.debug('enter: /resources/status: ' + statusCount++);
    }

    // cache control

    if (req.query.flushResourceCache) {

        trace.info('flushResourceCache');

        resourceCache.flushAll();
    }

    if (req.query.flushRegionCache) {

        trace.info('flushRegionCache');

        regionCache.flushAll();
    }

    // GCM-1627

    if (req.query.flushUserCache) {

        trace.info('flushUserCache');

        userCache.flushAll();
    }

    if (req.query.cacheStats) {

        trace.info('resourceCache.getStats: ' + JSON.stringify(resourceCache.getStats(), null, 2));
        trace.info('regionCache.getStats: ' + JSON.stringify(regionCache.getStats(), null, 2));
        trace.info('userCache.getStats: ' + JSON.stringify(userCache.getStats(), null, 2));
    }

    // status

    var status = {};

    status.Name = 'resourcesv2';
    status.Description = 'ComputeNext Resource Service (V2)';
    status.UtcCurrentTime = new Date();
    status.CurrentTime = status.UtcCurrentTime.toString();
    status.Port = port;
    status.UtcStartTime = startTime;
    status.StartTime = status.UtcStartTime.toString();
		return res.send(status);
    
});

// ALL

app.all('/*', auth, function (req, res, next) {
	if(req.query.transient === 'true') {
		resourcesCollectionName = 'resourcestransient';
	}
	else {
		if(req.query.collectionName=='resource'){
			resourcesCollectionName = 'resources';
		}
	    if(req.query.collectionName=='language'){
			resourcesCollectionName = 'language';
		}
		if(req.query.collectionName=='subscription'){
			resourcesCollectionName = 'subscription';
		}
	}
	trace.info("In app.all Collection Name==>"+resourcesCollectionName+' query channelcode:'+req.query.channelCode);

    languageCode = typeof req.query.languageCode != "undefined" ? req.query.languageCode.toLowerCase(): defLanguage;
    channelCode = typeof req.query.channelCode != "undefined" ? req.query.channelCode.toLowerCase(): defChannel;
    currencyCode = typeof req.query.currencyCode != "undefined" ? req.query.currencyCode.toLowerCase(): defCurrency;
	req.query.currencyCode = typeof req.query.currencyCode != "undefined" ? req.query.currencyCode.toLowerCase(): defCurrency;	

	trace.info("In app.all::Language:"+languageCode+"Channel:"+channelCode+"Currency:"+currencyCode);

	//req.ownerId = req.remoteUser.toLowerCase();

    trace.debug('enter: all.resource: ownerId: ' + req.ownerId);
	
	/*commonreg.getRegistry({channelcode:channelCode, servicename:"resource"},function(err,data){
	
		if (err) 
			return trace.info(err);
		else
			{
				//trace.info('getRegistry data:::::::::::::::::::::::' + JSON.stringify(data));
				cjson.extend(true,config, data);		
			}
			// return next();	
		});*/
     

    // GCM-1627: get channel code for the user

    var result = userCache.get(req.ownerId);

    //trace.debug('result: ' + JSON.stringify(result, null, 2));

    if (result[req.ownerId] && result[req.ownerId].channelCode) {

        trace.debug('user cache hit: channelcode: ' + result[req.ownerId].channelCode);

        return next();
    }

    trace.info('user cache miss: ownerId: ' + req.ownerId);

    // GCM-1627: call authentication service to get channel code for the user

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = req.ownerId;

    var options = {

        method: 'get',
		url: 'http://localhost:8000/api/authentication/account/' + req.ownerId + '?params=accountproperties&params=account&source=resourcesv2',
		headers:headers
    };

    //trace.debug('options: ' + JSON.stringify(options, null, 2));

    return request.get(options, function (err, response, body) {

        var userInfo={
			channelcode:"bbss"
		};

       /*  if (body) {

            try {

                userInfo = JSON.parse(body);
                userInfo.channelcode="bbss";
            }
            catch (exception) {

                trace.info('exception: ' + JSON.stringify(exception, null, 2));

                trace.info('body: ' + body);
            }
        } */

		if(!userInfo.channelcode){
			userInfo.channelcode="bbss";
		}
        if (userInfo && userInfo.channelcode) {

            trace.info('set user cache: ownerId: ' + req.ownerId + ': channelcode: ' + userInfo.channelcode);

            userCache.set(req.ownerId, { channelCode: userInfo.channelcode });

            // authorization

            if (config.skipAuthorization) {

                trace.warn('===== TESTING: authorization is turned OFF =====');

                return next();
            }

            return roleHelperCode.authorizeRequest(req, res, next);
        }

        if (err) {

            trace.info('err: ' + JSON.stringify(err, null, 2));
        }

        if (response) {

            trace.info('response.statusCode: ' + response.statusCode);
        }

        // NOTE: authentication service just returns "{}" if user not found - no err, no 404

        // return generic error

        //var extra = ': userid not found by authentication service: ownerId: ' + req.ownerId;
        var extra = resourceMsg['0000'][languageCode] + req.ownerId;

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'internal error');
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0028'][languageCode]);

        trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message + extra);

        return res.send(errorInfo, errorInfo.code);
    });
});

// CFM-2428: express "catch-all" error handler
// See: http://expressjs.com/guide.html#error-handling
function errorHandler(err, req, res, next) {

    trace.warn('express: errorHandler: err: ' + err);

    //var errorInfo = errorInfoCode.getErrorInfo(400, 'invalid input');
    var errorInfo = errorInfoCode.getErrorInfo(400, resourceMsg['0029'][languageCode]);

    trace.warn('express: errorHandler: errorInfo: ' + JSON.stringify(errorInfo, null, 2));

    return res.send(errorInfo, errorInfo.code);
}

// BEGIN: /resource CRUD

function makeResourceUri(resource) {

    // this makes a URI for the resource - fully V1 compatible
    // NOTE: the generated URI is not guaranteed to be a valid filename
    // see: providerManager/resourcePost.js

    // TODO: we do not check whether 'provider.region' exists in the region database?

    resource.provider = string(resource.provider).collapseWhitespace().s;
    resource.region = string(resource.region).collapseWhitespace().s;

    resource.provider = resource.provider.toLowerCase();
    resource.region = resource.region.toLowerCase();

    if (resource.resourceType == 'vs' && (!(resource.options))) {

        // special case for VS

        resource.resourceUri = resource.resourceType + '/' + resource.provider + '/' + resource.region + '/' + resource.providerResourceId + '.' + resource.size;
    }
    else {

        // "\s" means replace whitespace
        resource.resourceUri = resource.resourceType + '/' + resource.provider + '/' + resource.region + '/' + resource.providerResourceId.replace(/[\s]/g, '-');
    }

    resource.resourceUri = resource.resourceUri.toLowerCase();
}

function makeRegionUri(region) {

    // this makes a URI for the region - same as V1

    region.provider = string(region.provider).collapseWhitespace().s;
    region.region = string(region.region).collapseWhitespace().s;

    region.provider = region.provider.replace(/[\s]/g, '');
    region.region = region.region.replace(/[\s]/g, '');
    
    region.provider = region.provider.toLowerCase();
    region.region = region.region.toLowerCase();

    region.regionUri = region.provider + '/' + region.region;
}

// CMP-785
// create a new resource
// static data of the resource will be stored in resource collection, language specific data will be stored in
// language collection and subscription data in subscription collection.
app.post('/resource', function (req, res) {
	//trace.info('checking post resource');
	var ownerId = req.ownerId;
	//trace.info('ownerId ::' + req.ownerId);
    trace.info('enter: post.resource (create a new resource): ownerId: ' + req.ownerId + ': source: ' + req.query.source);
    console.log(req.query.staging);

    countCall('post.resource');

    var InputData = req.body;
	InputData.channelCode=InputData.channelCodes[0];
	InputData.languageCode=InputData.languageCodes[0];
	InputData.currencyCode=InputData.currencyCodes[0];
	trace.info('The input in post data::'+JSON.stringify(InputData));
	var resourceInput={};
	var languageInput={};
	var subscriptionInput={};
	var response={};
	var finalResource={};
	var finalLanguage={};
	var finalSubscription={};
	var resourceDataLength = 0;
	var langDataLength = 0;
	var subscriptionDataLength = 0;

	// InputData is iterated and checked and moved to different jsons(resourceInput,languageInput,subscriptionInput)
    // based on the attributes set
	for(var data in InputData){

		//If iterated data is present in resourceAttributes it will return true
		// and we store that attribute in resourceInput and increment the resourceDataLength.
		//same with languageInput and subscriptionInput.
		var resourceCheck = _.contains(resourceAttributes,data);
		if(resourceCheck === true){
			resourceInput[data] = InputData[data];
			resourceDataLength++;
		}

		var languageCheck = _.contains(languageAttributes,data);
		if(languageCheck === true){
			languageInput[data] = InputData[data];
			langDataLength++;
		}

		var subscriptionCheck = _.contains(subscriptionAttributes,data);
		if(subscriptionCheck === true){
			subscriptionInput[data] = InputData[data];
			subscriptionDataLength++;
		}
		// If the iterated data is found in commonAttributes we need to add them in 3 input jsons.
		var commonCheck = _.contains(commonAttributes,data);
		if(commonCheck === true){
			resourceInput[data] = InputData[data];
			languageInput[data] = InputData[data];
			subscriptionInput[data] = InputData[data];

		}
	}
	trace.info('Resource Input:'+JSON.stringify(resourceInput));
	trace.info('Resource Length Before adding common attributes:'+resourceDataLength);

	trace.info('Language Input:'+JSON.stringify(languageInput));
	trace.info('Language Length Before adding common attributes:'+langDataLength);

	trace.info('Subscription Input:'+JSON.stringify(subscriptionInput));
	trace.info('Subscription Length Before adding common attributes::'+subscriptionDataLength);

	var resourceValidation = validate(resourceInput, resourceSchema);
	trace.info('resourceValidation Status: ' + JSON.stringify(resourceValidation, null, 2));

	var languageValidation = validate(languageInput, languageSchema);
	trace.info('languageValidation Status: ' + JSON.stringify(languageValidation, null, 2));

	var subscriptionValidation = validate(subscriptionInput, subscriptionSchema);
	trace.info('subscriptionValidation Status: ' + JSON.stringify(subscriptionValidation, null, 2));

	// When all data is not valid (resources,language,subscription)
	var invalidInputError = errorInfoCode.getErrorInfo(400, 'Invalid input');
	if((resourceValidation.valid === false) && (languageValidation.valid === false) && (subscriptionValidation.valid === false)) {

        res.send(invalidInputError, errorInfo.code);
	}

	else {
			// Given input resources data,language data and subscription data and if for any one of
			// the input data validation rules fail send error message as response.
			//(channelCode is common in language and subscription so while check condition for lang/subscritpion gave 1)
			trace.info('Checking when all(resource/lang/subscription) data are present');
		   if((resourceDataLength > 0) && (langDataLength > 1)&& (subscriptionDataLength > 1)){
			   trace.info('Checking validation when all data is given');
			    if((resourceValidation.valid === false) || (languageValidation.valid === false) ||
			  (subscriptionValidation.valid === false)){
					trace.info('inside when all data is available and anyone validation false');
					 res.send(invalidInputError, errorInfo.code);
				}
		   }
		    // Given input resources data,language data and no subscription data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength > 0) &&(langDataLength > 1) && (subscriptionDataLength <= 1)){
			   trace.info('Checking when resource/lang data are present');
			    if((resourceValidation.valid === false) || (languageValidation.valid === false)){
					trace.info('inside when resource/lang data are present and any validation is false');
					 res.send(invalidInputError, errorInfo.code);
				}
		   }
		    // Given input resources data, no language data and  subscription data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength > 0) && (langDataLength < 1 ) && (subscriptionDataLength > 1)){
			   trace.info('Checking when resource/subscription data are present');
			    if((resourceValidation.valid === false) ||  (subscriptionValidation.valid === false)){
					 trace.info('inside when resource/subscription data are present and any validation is false');
					 res.send(invalidInputError, errorInfo.code);
				}
		   }
		   // Given input language data , subscription data and no resource data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength < 1) &&(langDataLength > 0) && (subscriptionDataLength > 0)){
			    trace.info('Checking when lang/subscription data are present');
			    if((languageValidation.valid === false) && (subscriptionValidation.valid === false)){
					 trace.info('inside when lang/subscription data are present and any validation is false');
					 res.send(invalidInputError, errorInfo.code);
				}
		   }

		if((resourceValidation.valid === false) || (resourceDataLength < 1)){
	       	 finalResource={};
		}

		resourceInput.ownerId= req.ownerId;
		languageInput.ownerId = req.ownerId;
		subscriptionInput.ownerId = req.ownerId;

		resourceInput.created = new Date();
		resourceInput.updated = resourceInput.created;

    // GCM-1627: always add regionUri and channelcodes

		if (resourceInput.provider && resourceInput.region) {
			resourceInput.regionUri = resourceInput.provider + '/' + resourceInput.region;

			resourceInput.regionUri = resourceInput.regionUri.toLowerCase();
		}

		if((resourceValidation.valid === true) && (resourceDataLength > 0)){
			trace.info('inside the resourceValidation else');
			if (resourceInput.resourceUri) {
			trace.info('existing: resourceUri: ' + resourceInput.resourceUri);
			}
			else {
			 	makeResourceUri(resourceInput);
			}

		// To store in resources(static) collection
	    postResource(ownerId,resourceInput,resourcesCollectionName,function(err,resourceData){
			trace.info(':::::Inside postResource for resources:::::');
			if(err){
				return res.send(err);
			}
			else{
			response.resourceStoredStatus=resourceData;
			finalResource = resourceData;
				//only valid resource data (no lang data given and no subscription data given)send the resources data.
				if((langDataLength < 1)  && (subscriptionDataLength<1)){
					// trace.info('Resources Stored:OK:'+JSON.stringify(finalResource));
					return res.send(finalResource);
				}
			}
			trace.info('resourceStoredStatus in static resources:'+JSON.stringify(response));

		});
	 }
	// Checking valid language data and subscription data
  if(((languageValidation.valid === true) && (langDataLength >1)) || ((subscriptionValidation.valid === true) && (subscriptionDataLength > 1))) {
	languageInput.created = new Date();
    languageInput.updated = languageInput.created;

	subscriptionInput.created = new Date();
    subscriptionInput.updated = subscriptionInput.created;

	 // To store in language/subscription, first we need to check whether the resourceUri exists in
	 // parent resources collection, if exists then only we should store in the input json to language/subscription.

	 var notFound = false;
	// var query = {resourceUri: resourceInput.resourceUri + '&channelCode=' + channelCode + '&currencyCode=' + currencyCode};
	 var query = {resourceUri: resourceInput.resourceUri};
	 var error;
	 var errorInfo;
	 var length;
	 trace.info("Query:::" + JSON.stringify(query));
	 //checking in parent "resources" collection before inserting in language or subscription collection
	 openMongoCode.retrieveCommon('resources', query, READ_LIMIT, function (err, results) {
		  trace.info("The results length from resources are ::" + results.length);
		  length = results.length;
		  trace.info('The length inside is:'+ length);
            if (err) {
                response.languageStoredStatus = err;
			    response.susbcriptionStoredStatus = err;
            }

            if (results.length <= 0) {
				trace.info('Checking resourceUri exists in parent resources collection');
                notFound = true;
				error = 'The resource ' + resourceInput.resourceUri + ' does not exist in parent resource collection';
                errorInfo = errorInfoCode.getErrorInfo(404, error);
				if(langDataLength > 1){
				response= errorInfo;
				}
				if(subscriptionDataLength > 1){
			    response = errorInfo;
				}
				// trace.info('The Response:'+JSON.stringify(response));
			    return res.send(response);
            }

	if(languageValidation.valid === false){
	      response.languageStoredStatus = languageValidation.errors;
	}
	// If resourceUri is present in parent resources collection and also language validations
	// are true then only insert into language collection.
	if((languageValidation.valid === true) && (langDataLength > 1) && (length > 0)){

		 // to insert into language collection
		 postResource(ownerId,languageInput,languageCollectionName,function(err,languageData){
				if(err) {

				  return res.send(err);

				}
				else{

  				   response.languageStoredStatus=languageData;
				   finalLanguage = languageData;

				   //If only valid language data is given and no resource/subscription so return only
				   //the language data which is stored.
				   if((resourceDataLength < 1) && (resourceValidation.valid === false) && (subscriptionDataLength<=1) ){

					   return res.send(finalLanguage);
				   }
				   trace.info('Language Stored Status :OK'+JSON.stringify(languageData));
				   //If only valid language data and valid resource is given and no subscription so return
				   //the resource and language data which is stored.
				   if(((resourceDataLength > 0) && (resourceValidation.valid === true)) && (subscriptionDataLength<=1) ){

					   var resLangData = cjson.extend(true,finalResource, finalLanguage);
					  //  trace.info('resource and language data :'+JSON.stringify(resLangData));
					   return res.send(resLangData);
				   }

				}

		});
	 }

	 // If valid resource and valid languange send the response
	 if((resourceDataLength > 0) && (langDataLength >1) && (subscriptionDataLength<1)){
		  var responseLang = cjson.extend(true,finalResource, finalLanguage);
		  return res.send(responseLang);
		}

	// If resourceUri is present in parent resources collection and also subscription validations
	// are true then insert into subscription collection.
	trace.info('Under subscriptionValidation' +subscriptionDataLength);
	 if((subscriptionValidation.valid === true) && (subscriptionDataLength > 0)){

		  //trace.info('Under subscriptionValidation.valid' +subscriptionDataLength);
		  postResource(ownerId,subscriptionInput,subscriptionCollectionName,function(err,subscriptionData){

			  trace.info('Under postResource' +subscriptionDataLength);
			if(err){
				return res.send(err);

			}
			else{
				response.subscriptionStoredStatus=subscriptionData;
				finalSubscription = subscriptionData;
			//	trace.info('Subscription stored:OK'+JSON.stringify(subscriptionData));
				// If only valid subscription data is given and no resource/language
				// return the stored subscription.
				if(resourceDataLength <0 && langDataLength <0){
					return res.send(finalSubscription);
				}

			}

			var resourceNew = cjson.extend(true,finalResource, finalLanguage,finalSubscription);
			return res.send(resourceNew);
		}); // close of subscription
	} // close of subscription if
}); //close of resources if
} // close of if resource valid
} //close of else
}); //close of main post


// Data is posted in specified based on given input collectionName(resources/language/subscription)
function postResource(ownerId,resource,collectionName,callback){

	if(resource.resourceUri){
		resource.resourceUri=resource.resourceUri.toLowerCase();
	}
	if(resource.currencyCode){
		resource.currencyCode=resource.currencyCode.toLowerCase();
	}
	//var data = req.ownerId;
	//trace.info('data :>>>>>>'+ data);
	trace.info('The data will be stored in collection :'+ collectionName);
    openMongoCode.createCommon(collectionName, resource, function (err, result) {

           // if (err) return res.send(err, err.code);
		     if (err) return callback(err);
			//updating vpa in billing
            if((resource.resourceType == 'vpa') && (collectionName === 'resources')) {
                var vpaData=[];
                vpaData.push(resource);
                postVPABilling(vpaData,function(err, result){
                  //  trace.info('result:'+result);
                });
            }

            // Subscription push from magento  && req.query.magento === 'true'
            // GCM-6459 Need to restrict the resource types during the Subscriptionpush
            if(resource.resourceType != 'vx' && resource.resourceType != 'st'&& resource.resourceType != 'package'&& resource.resourceType != 'vpa'&& resource.resourceType != 'ma'&& resource.resourceType != 'mt' && collectionName === 'subscription') {

                getSubscriptionDetails(ownerId,'subscription',resource.resourceUri,resource.channelCode,resource.currencyCode,function(err,result){


                    //datalength++;
                    var res=[];
                    res.push(result);

                    postSubscription(res,function(err, result){

						trace.info('postResource result:@@'+result);

                     //   trace.info('result:'+result);

                        //if (datalength == data.length) {

                        //return callback(null,result);

                        //}
                    });

                });

            }

			delete resource._id;

		 return callback(err,resource);

});
}

// update Resource

function updateResource(collectionName,query,resource,callback){
	trace.info('The Data will be stored in collection:'+ collectionName);


	if(resource.resourceUri){
		resource.resourceUri=resource.resourceUri.toLowerCase();
	}
	if(resource.currencyCode){
		resource.currencyCode=resource.currencyCode.toLowerCase();
	}

	delete resource.created;
	  var set ={ $set : resource };
	  //trace.info('The Resource :'+ JSON.stringify(set));
	    //trace.info('The query :'+ JSON.stringify(query));
		  //trace.info('The collectionName :'+ JSON.stringify(collectionName));
	   return openMongoCode.updateCommon(collectionName, query, set, function (err,numberUpdated) {
		    //trace.info('The numberUpdated >>'+ JSON.stringify(numberUpdated));
	      if (err) return callback(err);

		   trace.info('Inside updateResource::'+JSON.stringify(numberUpdated) + ' The related Resource :' + JSON.stringify(set));

		   if(numberUpdated){
			  //trace.info('The numberUpdated >'+ JSON.stringify(numberUpdated));
			//updating vpa in billing
            if((resource.resourceType == 'vpa') && (collectionName === 'resources')) {
				trace.info('Ttest');
                var vpaData=[];
                vpaData.push(resource);
                postVPABilling(vpaData,function(err, result){
                    //trace.info('result:'+result);
                });
            }
            // Subscription push from magento  && req.query.magento === 'true'
            // GCM-6459 Need to restrict the resource types during the Subscriptionpush
            if(resource.resourceType != 'vx' && resource.resourceType != 'st'&& resource.resourceType != 'package'&& resource.resourceType != 'vpa'&& resource.resourceType != 'ma'&& resource.resourceType != 'mt' && collectionName === 'subscription') {
                //getSubscription(resource.resourceUri,function(err,result){

				getSubscriptionDetails(config.ownerId,'subscription',resource.resourceUri,resource.channelCode,resource.currencyCode,function(err,result){
					trace.info('inside getSubscriptionDetails');
                    var res=[];
                    res.push(result);
					//trace.info('inside res :'+JSON.stringify(res));
                    postSubscription(res,function(err, result){

                        //trace.info('result >:'+result);

                    });

                });
            }

			delete resource._id;

		   //trace.info('The result from updateResource:'+JSON.stringify(resource));
		   return callback(err,resource);
		}
		/*else
		{
			trace.info('You are trying to store a new records,but using update resource,instead of create resource');
		}*/

	    else{
		trace.info(collectionName + 'data not found: create new data: resourceUri: ' + resource.resourceUri +','+ resource.channelCode + ',' + resource.currencyCode);



        return openMongoCode.createCommon(collectionName, resource, function (err, result) {
				trace.info('Inside creating data : createCommon');
				//trace.info('CollectionName>>' + collectionName);
				//trace.info('resource>>' + JSON.stringify(resource));
				//trace.info('result>>'+JSON.stringify(result));
		     if (err) return callback(err);
			//updating vpa in billing
            if((resource.resourceType == 'vpa') && (collectionName === 'resources')) {
				//trace.info('Inside UpdateResource.createCommon.resources');
                var vpaData=[];
                vpaData.push(resource);
                postVPABilling(vpaData,function(err, result){
                    trace.info('result:'+result);
                });
            }
            // Subscription push from magento  && req.query.magento === 'true'
            // GCM-6459 Need to restrict the resource types during the Subscriptionpush
            if(resource.resourceType != 'vx' && resource.resourceType != 'st'&& resource.resourceType != 'package'&& resource.resourceType != 'vpa'&& resource.resourceType != 'ma'&& resource.resourceType != 'mt' && collectionName === 'subscription') {
                //getSubscription(resource.resourceUri,function(err,result){
				getSubscriptionDetails(config.ownerId,'subscription',resource.resourceUri,resource.channelCode,resource.currencyCode,function(err,result){


                    //datalength++;
                    var res=[];
                    res.push(result);
					//trace.info('getSubscription result::'+JSON.stringify(result));

                    postSubscription(res,function(err, result){

                       // if (datalength == data.length) {

                       // return callback(null,result);

                       //}
                    });

                });
            }

			delete resource._id;
			return callback(err,result);
		});
	}
});
}

//uplift flow

//upsert - update an existing uplift or create a new resource for uplift
app.put('/uplift', function (req, res) {
	
    var resource = req.body;
	
	var query = {     
		ownerId: req.ownerId,
        channelCode : (req.query.channelCode).toLowerCase(),
        resourceType : "uplift"
    };
   if (req.ownerId === SYSTEM_USER_ID) {

        // every record must have an ownerId

        if (!resource.ownerId) {

            resource.ownerId = SYSTEM_USER_ID;
        }
    }
    else {

        resource.ownerId = req.ownerId;
    }
    delete resource.created; 
    delete resource._id;// cannot update 'created'
    resource.updated = new Date();
    var set = { $set: resource };
	resource.channelCode = (req.query.channelCode).toLowerCase();
    trace.info('updating uplift: resourceUri: ' + resource.resourceUri);
		
    return openMongoCode.updateCommon(resourcesCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        trace.info('numberUpdated: ' + numberUpdated);

        if (numberUpdated) {

            trace.info('uplift updated OK: resourceUri: ' + resource.resourceUri);	
			
            return res.send(resource);
        }

        // it was not updated because it is not there - so create it

       trace.info('uplift not found: create new uplift: resourceUri: ' + resource.resourceUri);

        resource.created = resource.updated;

        return openMongoCode.createCommon(resourcesCollectionName, resource, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('new uplift created OK: resourceUri: ' + resource.resourceUri);
			
            return res.send(resource);
        });
    });
	
});

app.get('/vpa/all', function (req, res) {
	
	trace.info('get /vpa/all::: ' + JSON.stringify(req.query));
	var reqquery = {};
	reqquery.resourceType = req.query.resourceType;
	reqquery.channelCode = (req.query.channelCode).toLowerCase();
	trace.info('get vpas reqquery::: ' + JSON.stringify(reqquery));
	var readLimit = 999;
	return openMongoCode.retrieveCommon(resourcesCollectionName, reqquery, readLimit, function (err, results) {
		trace.info('get vpas:::results ' + JSON.stringify(results));
				
        if (err) return res.send(err, err.code);

        res.send(results);
	});
	
});

app.get('/uplift', function (req, res) {
	
	trace.info(req.ownerId+'get /uplift::: ' + JSON.stringify(req.query));
	var reqquery = {};
	reqquery.ownerId = req.query.ownerId;
	reqquery.resourceType = req.query.resourceType;
	reqquery.channelCode = (req.query.channelCode).toLowerCase();
	trace.info('get uplifts reqquery::: ' + JSON.stringify(reqquery));
	return openMongoCode.retrieveCommon(resourcesCollectionName, reqquery, 1, function (err, results) {
		trace.info('get /resource/getupliftobj:::results ' + JSON.stringify(results));
				
        if (err) return res.send(err, err.code);
        
        var upliftObj = results[0];
	

        res.send(results[0]);
	});
	
});

app.put('/vpa/uplift', function (req, res) {
	trace.info('put /vpa/uplift::: ' + JSON.stringify(req.body));
	var obj = req.body;
	var accountId = req.ownerId;
	var provider = obj.provider;
	var channelcodes = req.query.channelCode;
	var readLimit = 999;
	var uriJsonArray  = {};
    var admquery = {};
	admquery.ownerId=accountId;
	admquery.vpacode=obj.admcode;
	var vpaaccounts = [];
	var resellerArray = [];
	getVpaAccounts(admquery, function(accountserr,accounts){
		if (accountserr) return res.send(accountserr, accountserr.code);
		
		trace.info('Vpa Accounts ::'+JSON.stringify(accounts));
		if(accounts && accounts!="")
			vpaaccounts =accounts.split(","); 
		trace.info('Vpa Accounts length::'+vpaaccounts.length);
		if(vpaaccounts.length>0)	{
			var query = {};
			query.resourceType = { $in: ['saas','bundle'] };
		    query.provider = provider;
		    query.channelCodes = channelcodes.toLowerCase();
			return retrieveResellerResources(accountId, query, readLimit, function (err, results) {
				trace.info('retrive resources results::' + results.length);
				//trace.info('results json b4:'+JSON.stringify(results));		
						
			    if (err) return res.send(err, err.code);
			    
			    async.forEachSeries(results, function(resourObj, next){
						      
					  if(resourObj.resourceUri && resourObj.currencyCodes && resourObj.subscriptionServiceTerm && resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges){
						  
						  var tempobj = {
								  "resourceURI" : resourObj.resourceUri,
								  "listprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount,
								  "costprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount,
								  "onetime_listprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0,
								  "onetime_costprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0
						  }
						  uriJsonArray[resourObj.resourceUri]=tempobj;
						  next();	
									    
					  }else{
						  next();
					  }
					}, function(err) {						
							if (err){ 
								trace.error('Error occured at async.forEachSeries: error :'+err);
								var errorInfo = errorInfoCode.getErrorInfo(400, err);
								return res.send(errorInfo, errorInfo.code);		        	
							}else{
								trace.info('uriJsonArray :: '+JSON.stringify(uriJsonArray));
								getreseller(accountId, 'reseller', channelcodes, function(error,totalResellers){
									
									async.forEachSeries(totalResellers, function(resellerObj, next1){
										if(vpaaccounts.indexOf(resellerObj.accountid) != -1){
											resellerArray.push(resellerObj);
											next1();
										}else{
											next1();
										}
									}, function(err) {
								    	trace.info("Final block");
								    	if (err){ 
								    		trace.error('Error occured at async.forEachSeries: error :'+err);
								    		var errorInfo = errorInfoCode.getErrorInfo(400, err);
								    		return res.send(errorInfo, errorInfo.code);			        	
								    	}else{
								    		trace.info('vpa resellerArray :: '+JSON.stringify(resellerArray));
								    		query.provider = provider;
								    		getResellerResources(query,accountId,resellerArray,uriJsonArray, function(error,resellerObj){
												 
												 trace.info('getreseller 1>>>>>>>>>>>>>>>>'+JSON.stringify(resellerObj));									
												 return res.send(resellerObj);
											});		        
								    	}
								    });
																		
								});
								 									        
							}
					});	

				   // if we are at the readLimit mark the last record with "atReadLimit"	
					if (results.length >= readLimit) {

						results[results.length - 1].atReadLimit = readLimit;
					}

					return res.send(results);	
			});						 
		}else{
			return res.send({"status":"No vpa assigned"});
		}	 
	});		
});

app.put('/uplift/savereselleraccount', function (req, res) {
	trace.info('put /uplift/savereselleraccount::: ' + JSON.stringify(req.body));
	var obj = req.body;
	var accountId = req.ownerId;
	var vpacode = obj.vpacode;
	var resellerId = obj.resellerId;
	var channelcodes = req.query.channelCode;
	var readLimit = 999;
	var uriJsonArray = {};
	var resellerArray = [];
	var query = {};
	query.resourceType = { $in: ['saas','bundle'] };
	query.channelCodes = channelcodes.toLowerCase();
	var vpaquery = {};
	vpaquery.ownerId = accountId;
	vpaquery.channelCode = channelcodes;
	vpaquery.vpaid = vpacode;
    
    getVpaObj(vpaquery, function(vpaerror,vpaObj){
    	if (vpaerror) return res.send(vpaerror, vpaerror.code);
    	if(vpaObj && vpaObj.length>0 && vpaObj[0].entries && vpaObj[0].entries.providerList && vpaObj[0].entries.providerList.length>0){    		
    		async.forEachSeries(vpaObj[0].entries.providerList, function(providerList, next){
        		query.provider = providerList.provider.toLowerCase();
    			return retrieveResellerResources(accountId, query, readLimit, function (err, results) {
    	    		trace.info('retrive resources results::' + results.length);
    	    		//trace.info('results json b4:'+JSON.stringify(results));		
    	    				
    	    	    if (err) return res.send(err, err.code);
    	    	    
    	    	    async.forEachSeries(results, function(resourObj, next1){
    	    				      
    	    			  if(resourObj.resourceUri && resourObj.currencyCodes && resourObj.subscriptionServiceTerm && resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges){    	    				  
    	    				  var tempobj = {
    	    						  "resourceURI" : resourObj.resourceUri,
    	    						  "listprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount,
    	    						  "costprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount,
    								  "onetime_listprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0,
    								  "onetime_costprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0
    	    				  }
    	    				  uriJsonArray[resourObj.resourceUri]=tempobj;
    	    				  next1();	
    	    							    
    	    			  }else{
    	    				  next1();
    	    			  }
    	    			}, function(err) {						
    	    					if (err){ 
    	    						trace.error('Error occured at async.forEachSeries: error :'+err);
    	    						var errorInfo = errorInfoCode.getErrorInfo(400, err);
    	    						return res.send(errorInfo, errorInfo.code);		        	
    	    					}else{
    	    						getreseller(accountId, 'reseller', channelcodes, function(error,totalResellers){
    	    							
    	    							async.forEachSeries(totalResellers, function(resellerObj, next2){
    	    								if(resellerId == resellerObj.accountid){
    	    									resellerArray.push(resellerObj);
    	    									next2();
    	    								}else{
    	    									next2();
    	    								}
    	    							}, function(err) {
    	    						    	trace.info("Final block");
    	    						    	if (err){ 
    	    						    		trace.error('Error occured at async.forEachSeries: error :'+err);
    	    						    		var errorInfo = errorInfoCode.getErrorInfo(400, err);
    	    						    		return res.send(errorInfo, errorInfo.code);			        	
    	    						    	}else{
    	    						    		trace.info('savereselleraccount resellerArray:'+JSON.stringify(resellerArray));	
    	    						    		query.provider = providerList.provider.toLowerCase();
    	    						    		getResellerResources(query,accountId,resellerArray,uriJsonArray, function(error,resellerObj){
    	    										 
    	    										 trace.info('getreseller 1>>>>>>>>>>>>>>>>'+JSON.stringify(resellerObj));									
    	    										 return res.send(resellerObj);
    	    									});		        
    	    						    	}
    	    						    });
    	    																
    	    						});
    	    						 									        
    	    					}
    	    			});	

    	    		   // if we are at the readLimit mark the last record with "atReadLimit"	
    	    			if (results.length >= readLimit) {

    	    				results[results.length - 1].atReadLimit = readLimit;
    	    			}

    	    			return res.send(results);	
    	    	});	
    		}, function(err) {						
				if (err){ 
					trace.error('Error occured at async.forEachSeries: error :'+err);
					var errorInfo = errorInfoCode.getErrorInfo(400, err);
					return res.send(errorInfo, errorInfo.code);		        	
				}else{
					return res.send({"status":'success'});	
				}
    		});
    	}else{
    		return res.send({"status":"No vpa rules applied"});
    	}
    	
    });				
});


function getVpaObj(query,callback){

	var headers = {
	        "Accept": 'application/json',
	        "Content-Type": 'application/json'
	    };

		headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
		headers['ownerId'] = query.ownerId;

	    var options = {

	        method: 'get',
			url: 'http://resources.computenext.com:5902/vpa?ownerId='+query.ownerId+'&vpaid=' + query.vpaid + '&channelCode='+query.channelCode,
			headers:headers
	    };

	    return request.get(options, function (err, response, body) {	        

	        if (err) {

	            trace.info('err: ' + JSON.stringify(err, null, 2));
	            return callback(err,null)
	        }
	        try {
				var obj = JSON.parse(body);				
				trace.info('retrived vpaobj'+JSON.stringify(obj));
				if (obj !=null) {
					return callback('',obj);				
				}
			}catch (exception) {
				trace.info('exception:vpaobj ' + JSON.stringify(exception, null, 2));

				trace.info('body: vpaobj ' );
				return callback(JSON.stringify(exception, null, 2),'');
			}	             

	        return callback(null, '');
	    });
 }

function getVpaAccounts(query,callback){

	var headers = {
	        "Accept": 'application/json',
	        "Content-Type": 'application/json'
	    };

		headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
		headers['ownerId'] = query.ownerId;

	    var options = {

	        method: 'get',
			url: 'http://billing.computenext.com:8120/billing/getvpaaccounts?ownerid='+query.ownerId+'&vpacode=' + query.vpacode ,
			headers:headers
	    };

	    return request.get(options, function (err, response, body) {	        

	        if (err) {

	            trace.info('err: ' + JSON.stringify(err, null, 2));
	            return callback(err,null)
	        }
	        try {
				var obj = JSON.parse(body);				
				trace.info('retrived VpaAccounts'+JSON.stringify(obj));
				if (obj !=null && obj.length>0 && obj[0].accountids) {
					return callback('',obj[0].accountids);				
				}
			}catch (exception) {
				trace.info('exception:getVpaAccounts ' + JSON.stringify(exception, null, 2));

				trace.info('body: getVpaAccounts ' );
				return callback(JSON.stringify(exception, null, 2),'');
			}	             

	        return callback(null, '');
	    });
 }

app.put('/resource/uplift', function (req, res) {	
	
	trace.info('put /resource/uplift::: ' + JSON.stringify(req.body));
	var obj = req.body;
	var accountId = req.ownerId;
	var provider = obj.provider;
	var accountType = obj.accountType;
	var basis = obj.basis;
	var upliftValue = obj.upliftvalue;
	var channelcodes = req.query.channelCode;
	var baseurl = obj.baseurl;
	var readLimit = 999;
	var uriJsonArray = {};	
	// get resources by channelcode,providerName - there 
	var query = {};
	query.resourceType = { $in: ['saas','bundle'] };
    query.provider = provider;
    query.channelCodes = channelcodes.toLowerCase();
	return retrieveResellerResources(accountId, query, readLimit, function (err, resources) {
		
		trace.info('retrive resources results::' + resources.length);
		//trace.info('results json b4:'+JSON.stringify(resources));		
		
	    if (err) return res.send(err, err.code);
	    
	    if(resources.length==0)	return res.send({"status":"No resources found"});
	    
	    async.forEachSeries(resources, function(resourObj, next){
	    	
	    	resourObj.channelCodes = [channelcodes.toLowerCase()];
	    	resourObj.ownerId = accountId;
	    	if(resourObj.resourceUri && resourObj.currencyCodes && resourObj.subscriptionServiceTerm && resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges){
                
                //trace.info('res json:'+JSON.stringify(resourObj));
				
				var providerCost = resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
				if(providerCost && providerCost !="" && providerCost !="null"){
					trace.info('providerCost:::'+providerCost);
					var costPriceObj = {};
					costPriceObj['costprice'] = providerCost;
					var onetime_costprice = (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount : 0;
					costPriceObj['onetime_costprice'] = onetime_costprice;
					getUpliftedPrice(obj,resourObj.resourceUri,costPriceObj,function(err,upliftpriceobj){
						trace.info('For distributor/reseller upliftedpriceobj::: ' + JSON.stringify(upliftpriceobj));
						
						if(upliftpriceobj.costprice && upliftpriceobj.costprice != "" && upliftpriceobj.costprice !="null"){
							resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount = upliftpriceobj.costprice;
						}
						
						if(typeof resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1] !='undefined'){
							resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount = upliftpriceobj.onetime_costprice;
						}
						return updateSubscription(resourObj , function(err, subscriptionResult){
							  
							trace.info('updateResult'+JSON.stringify(subscriptionResult));
							  var tempobj = {
								  "resourceURI" : resourObj.resourceUri,
								  "listprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount,
								  "costprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount,
								  "kioskpath" : baseurl,
								  "onetime_listprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0,
								  "onetime_costprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0
							  }
							  uriJsonArray[resourObj.resourceUri]=tempobj;
							  if(tempobj.kioskpath != "" && tempobj.resourceURI != "" && tempobj.listprice != "" && tempobj.costprice != ""){
									 resSaasScript.executescript(tempobj,function(resu){
										 next();
									 });							       	 
							  }else{								 
								  next();
							  }
								           
						});	
					});
				}else{
					next();
				}
	    	}else{
	    		next();
			}
	    	
	    }, function(err) {
	    	if (err){ 
				trace.error('Error occured at async.forEachSeries: error :'+err);
				var errorInfo = errorInfoCode.getErrorInfo(400, err);
				return res.send(errorInfo, errorInfo.code);		        	
			}else{
				 trace.info('outside get resellers function');	
                 trace.info('final prepared array'+JSON.stringify(uriJsonArray));                         
                 if(accountType == 'distributor'){
						trace.info('Inside=================');
                   	 getreseller(accountId, 'reseller', channelcodes, function(error,resellerArray){
							 //trace.info('resellerArray >>>>>>>>>>>>>>>>'+JSON.stringify(resellerArray));
							 trace.info('accountId >>>>>>>>>>>>>>>>'+accountId);
							 query.provider = provider;
							 getResellerResources(query,accountId,resellerArray,uriJsonArray, function(error,resellerObj){
								 
								 trace.info('getreseller >>>>>>>>>>>>>>>>'+JSON.stringify(resellerObj));
								 return res.send(resources);
                               
							});
							
						});	        								
				}else{
					return res.send(resources);
				}
 						
			}
	    });
		   // if we are at the readLimit mark the last record with "atReadLimit"	
			if (resources.length >= readLimit) {

				resources[resources.length - 1].atReadLimit = readLimit;
			}

			return res.send(resources);
				
	}); 	
	
});

app.put('/uplift/resourcedelete', function (req, res) {
	trace.info('put /uplift/resourcedelete::: ' + JSON.stringify(req.body));
	var resourceQuery = {};
	var obj = req.body;
	var ownerId = req.ownerId;
	var channelcodes = req.query.channelCode;
	var accountType = obj.accountType;
	var readLimit = 999;
	var uriJsonArray = {};
	var provider = obj.provider;
	var query = {};
	var baseurl = obj.baseurl;
	resourceQuery.channelCodes =  channelcodes.toLowerCase();
	resourceQuery.resourceUri = obj.uri;
	retrieveResellerResources(ownerId, resourceQuery, readLimit, function (err, resourObj) {
		if(resourObj.length > 0 && resourObj[0].subscriptionServiceTerm && resourObj[0].subscriptionServiceTerm.SubscriptionServiceTermCharges){
			resourObj=resourObj[0];
			var providerCost = resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
			if(providerCost && providerCost !="" && providerCost !="null"){
				var costPriceObj = {};
				costPriceObj['costprice'] = providerCost;
				var onetime_costprice = (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount : 0;
				costPriceObj['onetime_costprice'] = onetime_costprice;
				getUpliftedPrice(obj,resourObj.resourceUri,costPriceObj,function(err,upliftpriceobj){
					trace.info('For distributor/reseller upliftedpriceobj::: ' + JSON.stringify(upliftpriceobj));
					
					if(upliftpriceobj.costprice && upliftpriceobj.costprice != "" && upliftpriceobj.costprice !="null"){
						resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount = upliftpriceobj.costprice;
					}
					if(resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]){
						resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount = upliftpriceobj.onetime_costprice;
					}
					
					updateSubscription(resourObj , function(err, subscriptionResult){
						  
						trace.info('updateResult'+JSON.stringify(subscriptionResult));
						  var tempobj = {
							  "resourceURI" : resourObj.resourceUri,
							  "listprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount,
							  "costprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount,
							  "kioskpath" : baseurl,
							  "onetime_listprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0,
							  "onetime_costprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0
						  }
						  uriJsonArray[resourObj.resourceUri]=tempobj;
						  if(tempobj.kioskpath != "" && tempobj.resourceURI != "" && tempobj.listprice != "" && tempobj.costprice != ""){
								 resSaasScript.executescript(tempobj,function(resu){
									    if(accountType == 'distributor'){
				 							trace.info('Inside=================');
				                          	 getreseller(ownerId, 'reseller', channelcodes, function(error,resellerArray){
				  								// trace.info('resellerArray >>>>>>>>>>>>>>>>'+JSON.stringify(resellerArray));
				  								 query.provider = provider;
				  								 getResellerResources(query,ownerId,resellerArray,uriJsonArray, function(error,resellerObj){
				  									 
				  									 trace.info('getreseller >>>>>>>>>>>>>>>>'+JSON.stringify(resellerObj));
				  									 return res.send(resourObj);
				                                      
				  								});
				  								
				  							});	        								
										   }else{
											   return res.send(resourObj);
										   }
									});							       	 
						   }else{
							   return res.send(resourObj);
						   }
					});	
				});
			}else{
				return res.send(resourObj);
			}
		}else{
			trace.info('put /uplift/resourcedelete::: No resource found');
			return res.send({"status":"No resource found"});
		}
				
	});
});

function getUpliftObj(req,callback){
	trace.info('get /resource/getupliftobj::: ' + JSON.stringify(req));
	var reqquery = {};
	reqquery.ownerId = req.ownerId;
	reqquery.resourceType = req.resourceType;
	var provider = req.provider;
	var providerObj = {};
	trace.info('reqquery::: ' + JSON.stringify(reqquery));
	return openMongoCode.retrieveCommon(resourcesCollectionName, reqquery, 1, function (err, results) {
		trace.info('get /resource/getupliftobj:::results ' + JSON.stringify(results));
				
        if (err) return res.send(err, err.code);
        
		if(results.length > 0 && results[0].entries.providerList && results[0].entries.providerList.length > 0){
			var providerListObj = results[0].entries.providerList;
			trace.info('get providerListObj:::results ' + JSON.stringify(providerListObj));
			for(var key in providerListObj){
				var providerList = providerListObj[key];		
				trace.info('get providerList>>>>>>>>>>>:::results ' + JSON.stringify(providerList));
				if((providerList.provider).toLowerCase() == provider.toLowerCase()){
					providerObj.provider = provider.toLowerCase();
					providerObj.basis = providerList.basis;
					providerObj.upliftvalue = providerList.upliftvalue;
					providerObj.products = [];
					for(var key in providerList.products){
						var item = providerList.products[key];
						if(item.resourceUri != "all")
							providerObj.products.push(item);
					}
					return callback('',providerObj);
				}
			}
		}else{
			trace.info('No uplift applied ');
		}

		return callback('',providerObj);
	})
};	

function updateSubscription(resourObj,callback){
	var subscriptionInput={};
	for(var data in resourObj){
		var subscriptionCheck = _.contains(subscriptionAttributes,data);
		if(subscriptionCheck === true){
			subscriptionInput[data] = resourObj[data];
		}
		// If the iterated data is found in commonAttributes we need to add them in 3 input jsons.
		var commonCheck = _.contains(commonAttributes,data);
		if(commonCheck === true){
			subscriptionInput[data] = resourObj[data];
		}
	}
	subscriptionInput.ownerId = resourObj.ownerId;
	subscriptionInput.created = new Date();
    subscriptionInput.updated = subscriptionInput.created;
    subscriptionInput.channelCode = resourObj.channelCodes[0];
    subscriptionInput.currencyCode = (resourObj.currencyCodes[0]).toLowerCase();
//	trace.info('final subscription obj: ' + JSON.stringify(subscriptionInput, null, 2));
	var query = { resourceUri: subscriptionInput.resourceUri,
					channelCode: subscriptionInput.channelCode,
					currencyCode: subscriptionInput.currencyCode
			      };
	updateResource(subscriptionCollectionName,query,subscriptionInput,function(err,subUpdated){
		  trace.info(':::Call to updateResource function for subscription:::');
		if(err){
			return callback(err,'');

		}
		else{	
			trace.info('Subscription stored:OK');
			return callback('',subscriptionInput);
		}

	}); 
}

function getUpliftedPrice(obj,uri,costpriceobj,callback){
	var costprice = parseFloat(costpriceobj.costprice);
	var onetime_costprice = parseFloat(costpriceobj.onetime_costprice);
	var upliftpriceobj = {
			'costprice':'',
			'onetime_costprice':0
	};
	if(obj.basis && obj.upliftvalue){
		var products = obj.products;
		trace.info('productslength::: ' + products.length);		
		var upliftvalue = "";
		if(products.length > 0){
			var flag = 0;
			for(var key in products){
				var keyobj = products[key];
				if(keyobj.resourceUri==uri){
					flag++;
					upliftvalue = parseFloat(keyobj.upliftvalue);
					if(keyobj.basis=="percentage"){
						upliftpriceobj.costprice = (1 + upliftvalue/100) * costprice;
						upliftpriceobj.onetime_costprice = (1 + upliftvalue/100) * onetime_costprice;
					}						
					else{
						upliftpriceobj.costprice = upliftvalue + costprice;
						upliftpriceobj.onetime_costprice = upliftvalue + onetime_costprice;
					}						
					break;
				}				
			}
			if(flag==0){
				upliftvalue = parseFloat(obj.upliftvalue);
				if(obj.basis=="percentage"){
					upliftpriceobj.costprice = (1 + upliftvalue/100) * costprice;
					upliftpriceobj.onetime_costprice = (1 + upliftvalue/100) * onetime_costprice;
				}					
				else{
					upliftpriceobj.costprice = upliftvalue + costprice;
					upliftpriceobj.onetime_costprice = upliftvalue + onetime_costprice;
				}					
			}
		}else{
			upliftvalue = parseFloat(obj.upliftvalue);
			if(obj.basis=="percentage"){
				upliftpriceobj.costprice = (1 + upliftvalue/100) * costprice;
				upliftpriceobj.onetime_costprice = (1 + upliftvalue/100) * onetime_costprice;
			}				
			else{
				upliftpriceobj.costprice = upliftvalue + costprice;
				upliftpriceobj.onetime_costprice = upliftvalue + onetime_costprice;
			}				
		 }	
	}
	if(parseInt(onetime_costprice)==0){
		upliftpriceobj.onetime_costprice=0;
	}
	if(upliftpriceobj.costprice && upliftpriceobj.costprice !="")
		upliftpriceobj.costprice = Math.floor(upliftpriceobj.costprice);
	if(upliftpriceobj.onetime_costprice && upliftpriceobj.onetime_costprice !="")
		upliftpriceobj.onetime_costprice = Math.floor(upliftpriceobj.onetime_costprice);
	return callback('',upliftpriceobj) ;	
};

function getreseller(accountId, accountType,channelcodes, callback){
	trace.info('INSIDE>>>>>>>>>>>> getreseller>>>>>>>>>>>>>');
	if(accountId==null) {
		 return callback('No Resource Found');
		  trace.info('No Resource Found');
		}

	var headers = {
	    "Accept": 'application/json',
	    "Content-Type": 'application/json'
	};
	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

	var options = {		
	    method: 'GET',
	    url: config.Keysv2Endpoint+'/api/authentication/useraccounts/'+accountId +'?list=allcustomers&accounttype='+accountType+'&channelcode='+channelcodes,
		headers: headers
	};	

	trace.info('options getreseller>>>>>>>>>'+JSON.stringify(options));
	return request.get(options, function (err, response, body) {
		try {
			trace.info('res> getreseller>>>>>>>>>>>>>');
			var obj = JSON.parse(body);
			//trace.info('retrived account name getreseller'+JSON.stringify(obj));
			if (obj !=null) {
				trace.info('list of users');
				return callback(null,obj);				
			}else{
				return callback({'code':'No resellers found'},[]);
			}	
		}catch (exception) {
			trace.info('exception:getreseller ' + JSON.stringify(exception, null, 2));

			trace.info('body: getreseller ' );
			callback(JSON.stringify(exception, null, 2),'');
		}			
		trace.info('END >>>>>>>>>');
	});
	
}

function getResellerResources(query,accountId,resellerArray,uriJsonArray,callback){
	trace.info('Entered getResellerResources >>>>>>>>>>>>>>>>');
	var readLimit = 999;
	async.forEachSeries(resellerArray, function(resellerObj, next1){
		if(resellerObj && resellerObj.channelcode && resellerObj.accountid)	{	
			
			var resellerChannelcode = resellerObj.channelcode.toLowerCase();			   
		    getResellerDetails(resellerObj.accountid,function(kiosksettingserr,kiosksettings){
		    	if(kiosksettings && kiosksettings.length > 0 && kiosksettings[0].URL && kiosksettings[0].URL!=""){
		    		var upliftquery = {};
					upliftquery.ownerId = resellerObj.accountid;
					upliftquery.resourceType = 'uplift';
					upliftquery.provider = query.provider;
					getUpliftObj(upliftquery,function(err,upliftObj){
						trace.info('resellerChannelcode >>>>>>>>>>>>>>>>'+resellerChannelcode);
						var resellerReqQuery = {};
						resellerReqQuery.channelCodes =  resellerChannelcode ;
						resellerReqQuery.provider = query.provider;
						resellerReqQuery.resourceType = { $in: ['saas','bundle'] };
				    	trace.info(' inside resellerReqQuery >>>>>>>>>>>>>>>>'+JSON.stringify(resellerReqQuery));
						retrieveResellerResources(accountId, resellerReqQuery, readLimit, function (err, resources) {
							
							trace.info('retrive reseller resources results::' + resources.length);
							
						    if (err) setTimeout(next1, 3);
						    
						    if(resources && resources.length>0)	{
								 trace.info(resellerChannelcode+'reseller results json b4:'+JSON.stringify(resources));		
								 async.forEachSeries(resources, function(resourObj, next2){
									 if(resourObj && resourObj.resourceUri && resourObj.subscriptionServiceTerm && resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges && uriJsonArray[resourObj.resourceUri]){
										
										 var jsonResourcelistprice = uriJsonArray[resourObj.resourceUri].listprice;
								    	 var jsonResourcecostprice = uriJsonArray[resourObj.resourceUri].costprice;
									       	var vpaquery = {};
											vpaquery.ownerId = resellerObj.accountid;
											vpaquery.resourceUri = resourObj.resourceUri;
											vpaquery.listPrice = jsonResourcelistprice;
											vpaquery.costPrice = jsonResourcecostprice;
											vpaquery.onetime_listPrice = (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1])?resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0;
											vpaquery.onetime_costPrice = (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1])?resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0;
											calculateVpaPrice(vpaquery,function(err,vparesult){
												trace.info('=======VPA PRICE::: ==========' +JSON.stringify(vparesult));
												if(vparesult && vparesult.price && vparesult.price !="null")
													var resellerCostprice = vparesult.price;
												else
													var resellerCostprice = jsonResourcelistprice;
												if(vparesult && vparesult.onetime_costPrice && vparesult.onetime_costPrice !="null")
													var resellerOnetimeCostprice = vparesult.onetime_costPrice;
												else
													var resellerOnetimeCostprice = vpaquery.onetime_listPrice;
												resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount = resellerCostprice;	//Add vpa for list price
												if(typeof resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1] != "undefined"){
													resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount = resellerOnetimeCostprice; //Add vpa for onetime_list price
												}												
												var costPriceObj = {};
												costPriceObj['costprice'] = resellerCostprice;
												//var onetime_costprice = (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount : 0;
												costPriceObj['onetime_costprice'] = resellerOnetimeCostprice;
												getUpliftedPrice(upliftObj,resourObj.resourceUri,costPriceObj,function(err,upliftpriceobj){
													trace.info('=======Uplift PRICEOBJ::: ==========' +JSON.stringify(upliftpriceobj));
													
													if(upliftpriceobj.costprice && upliftpriceobj.costprice != "" && upliftpriceobj.costprice !="null"){
														resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount = upliftpriceobj.costprice; //Add uplift
													}		
													if(typeof resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1] != "undefined"){
														resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount = upliftpriceobj.onetime_costprice;
													}
													
											    	// update reseller product prices in magento and resource collection
													resourObj.channelCodes = [resellerChannelcode];
													updateSubscription(resourObj, function(err, updateResult){
													
														trace.info('updateResult=================='+JSON.stringify(updateResult));
														 var updatedresObj = {
																 "resourceURI" : resourObj.resourceUri,
																 "listprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount,
																 "costprice" : resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount,	
																 "kioskpath" : kiosksettings[0].URL,
																 "onetime_listprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0,
																 "onetime_costprice" : (resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? resourObj.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0
														 };
														 if(updatedresObj.resourceURI != "" && updatedresObj.listprice != "" && updatedresObj.costprice != ""){
															 resSaasScript.executescript(updatedresObj,function(resu){
																 setTimeout(next2, 0);	
																});
														 }else{
															 setTimeout(next2, 0);
														 }											 
														//next();	           
													});	
												});
											});
										 }else{
											 setTimeout(next2, 2);
										 }
								 }, function(err) {
								    	if (err){ 
											trace.error('Error occured at async.forEachSeries: error :'+err);
											setTimeout(next1, 3);	        	
										}else{
											setTimeout(next1, 3); 								 						
										}
								    });
							     
						    }else{
						    	trace.info('No resources found for::'+resellerChannelcode);
						    	setTimeout(next1, 3);
						    }	 
							 
						 });     
					});
		    	}else{
		    		setTimeout(next1, 2);
		    	}		    	
		    
			});
			    
	    }else{
	    	setTimeout(next1, 0);
	    }
	    }, function(err) {
	    	trace.info("Final block");
	    	if (err){ 
	    		trace.error('Error occured at async.forEachSeries: error :'+err);
	    		var errorInfo = errorInfoCode.getErrorInfo(400, err);
	    		callback(errorInfo, errorInfo.code);		        	
	    	}else{
	    		trace.info('outside get resellers function');	
                //trace.info('final prepared array'+JSON.stringify(jsonArray));				
				
	    		callback(null,{'status':'success'});			        
	    	}
	    });
	
}

function retrieveResellerResources(ownerId, query, readLimit, callback) {
    var resourcesArray  = [];
	trace.info('retrieveResellerResources query at end:' + JSON.stringify(query));
	var staticQuery = { $query: query, $orderby: { 'resourceUri': 1 } };
    return openMongoCode.retrieveCommon(resourcesCollectionName, staticQuery, readLimit, function (err, results) {
    	if (err) return callback(err,[]);
    	
    	trace.info('resourcesCollectionName:' + results.length);
    	if(results.length==0) return callback('',[]);
    	
    	query.channelCode = query.channelCodes;
    	delete	query.channelCodes
    	delete query.provider;
    	delete query.resourceType;
    	async.forEachSeries(results, function(resourObj, next){
    		if(resourObj.resourceUri){
    			query.resourceUri = resourObj.resourceUri;
    			query.languageCode = languageCode;
    			delete query.currencyCode;
    			trace.info('static query ::' + JSON.stringify(query));
        		staticQuery = { $query: query, $orderby: { 'resourceUri': 1 } };
        		return openMongoCode.retrieveCommon(languageCollectionName, staticQuery, 1, function (err, results1) {
        			trace.info('languageCollectionName:' + results1.length);
        			if (err) return callback(err,[]);

        			delete query.languageCode;
        			query.currencyCode = (currencyCode).toLowerCase();
        			staticQuery = { $query: query, $orderby: { 'resourceUri': 1 } };
        			return openMongoCode.retrieveCommon(subscriptionCollectionName, staticQuery, 1, function (err, results2) {
        					trace.info('subscriptionCollectionName:' + results2.length);
        					if (err) return callback(err,[]);

        						var resourceNew = cjson.extend(true,[resourObj], results1,results2);
        						trace.debug("Final Response:$$$$@@@@"+resourceNew);

        						resourcesArray.push(resourceNew[0]);
        						return next();	        						
        			});
        		});
        		next();	
    		}else{
    			next();	
    		}			
    		
    	}, function(err) {	
    		if (err) return callback(err,[]);
    		
    		return callback('',resourcesArray);
    	});	
    });
}

function calculateVpaPrice(query,callback){

	var headers = {
	        "Accept": 'application/json',
	        "Content-Type": 'application/json'
	    };

		headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
		headers['ownerId'] = query.ownerId;

	    var options = {

	        method: 'get',
			url: 'http://billing.computenext.com:8120/billing/calculatevpaprice?ownerid='+query.ownerId+'&resourceUri=' + query.resourceUri + '&listPrice='+query.listPrice+'&costPrice='+query.costPrice + '&onetime_listPrice='+query.onetime_listPrice+'&onetime_costPrice='+query.onetime_costPrice,
			headers:headers
	    };

	    return request.get(options, function (err, response, body) {	        

	        if (err) {

	            trace.info('err: ' + JSON.stringify(err, null, 2));
	            return callback(err,null)
	        }
	        try {
				var obj = JSON.parse(body);				
				trace.info('retrived resellerd'+JSON.stringify(obj));
				if (obj !=null) {
					return callback('',obj);				
				}
			}catch (exception) {
				trace.info('exception:getreseller ' + JSON.stringify(exception, null, 2));

				trace.info('body: getreseller ' );
				return callback(JSON.stringify(exception, null, 2),'');
			}	             

	        return callback(null, '');
	    });
 }

app.put('/uplift/updateresellerproduct', function (req, res) {
	
	trace.info('put /resource/updatedistributordetails::: ' + JSON.stringify(req.body));
	var resource = req.body;
	var ownerId = req.ownerId;
	var channelcodes = req.query.channelCode;
	var uriJsonArray = {};
	var query = {};
	query.provider = resource.provider;
	var tempobj = {
			  "resourceURI" : resource.uri,
			  "listprice" : resource.listprice,
			  "costprice" : resource.costprice,
			  "onetime_listprice" : resource.onetime_listprice,
			  "onetime_costprice" : resource.onetime_costprice
	    };
	uriJsonArray[resource.uri]=tempobj;
	 getreseller(ownerId, 'reseller', channelcodes, function(err,resellerArray){
		 if (err) return res.send(err, err.code);
		 //trace.info('resellerArray >>>>>>>>>>>>>>>>'+JSON.stringify(resellerArray));
		
		 getResellerResources(query,ownerId,resellerArray,uriJsonArray, function(error,resellerObj){
			 if (error) return res.send(error, error.code);
			 
			 trace.info('getreseller 1>>>>>>>>>>>>>>>>'+JSON.stringify(resellerObj));									
			 return res.send(resellerObj);
		});
		
	});				
			
});

function getResellerDetails(accountId,callback){
    var headers = {
	    "Accept": 'application/json',
	    "Content-Type": 'application/json'
	};
	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;
	
	var options = {		
	    method: 'GET',
	    url: "http://localhost:2201/registry/store/detail/"+accountId,
		headers: headers
	};	

	trace.info('options getreseller>>>>>>>>>'+JSON.stringify(options));
	return request.get(options, function (err, response, body) {
		if (err) {
            trace.info('err: ' + JSON.stringify(err, null, 2));
            callback(err,null)
        }
		try {
			var obj = JSON.parse(body);				
			trace.info('retrived resellerd'+JSON.stringify(obj));
			if (obj !=null) {
				trace.info('list of reselles');
				callback('',obj);				
			}else
				callback('','');
		}catch (exception) {
			trace.info('exception:getreseller ' + JSON.stringify(exception, null, 2));

			trace.info('body: getreseller ' );
			callback(JSON.stringify(exception, null, 2),'');
		}
				
	});
}

app.post('/vpa', function (req, res) {
	
	var resource = req.body;
	trace.info('post /vpa resource::: ' + JSON.stringify(req.body));

    resource.ownerId = req.ownerId;
	
	    if (resource.resourceUri) {

        trace.info('existing: resourceUri: ' + resource.resourceUri);
    }
    else {

        var errorInfo = checkProperties(resource, ['resourceType', 'provider', 'region', 'providerResourceId', 'resourceStatus']);

        if (errorInfo) return res.send(errorInfo, errorInfo.code);

        makeResourceUri(resource);

        trace.info('new: resourceUri: ' + resource.resourceUri);
    }
	
	resource.created = new Date();
    resource.updated = resource.created;
	resource.channelCode = req.query.channelCode.toLowerCase();	
	trace.info('resource: ' + JSON.stringify(resource, null, 2));
	
	var query = {resourceUri: resource.resourceUri};
	trace.info("Query:::" + JSON.stringify(query));
	return openMongoCode.retrieveCommon('resources', query, READ_LIMIT, function (err, results) {
		if (err) {
                response.Status = err;
				return res.send(response);
            }

            if (results.length <= 0) {
				return openMongoCode.createCommon(resourcesCollectionName, resource, function (err) {

					if (err) return res.send(err, err.code);

					trace.info('new resource created OK: resourceUri: ' + resource.resourceUri);
					
					//updating vpa in billing
					if(resource.resourceType == 'vpa') {
						var vpaData=[];
						vpaData.push(resource);
						postVPABilling(vpaData,function(result){			
									trace.info('result:'+result);
							});
					}

					return res.send(resource);
				})
			}else{
				return res.send({message:"the record already exists"});
			}
	});	
});

app.get('/commision/all', function (req, res) {
	
	trace.info('get /commision/all::: ' + JSON.stringify(req.query));
	var reqquery = {};
	reqquery.resourceType = req.query.resourceType;
	reqquery.channelCode = (req.query.channelCode).toLowerCase();
	trace.info('get commisions reqquery::: ' + JSON.stringify(reqquery));
	var readLimit = 999;
	return openMongoCode.retrieveCommon(resourcesCollectionName, reqquery, readLimit, function (err, results) {
		trace.info('get commisions:::results ' + JSON.stringify(results));
				
        if (err) return res.send(err, err.code);

        res.send(results);
	});
	
});

app.post('/commision', function (req, res) {
	
	var resource = req.body;
	trace.info('post /commision resource::: ' + JSON.stringify(req.body));

    resource.ownerId = req.ownerId;
	
	    if (resource.resourceUri) {

        trace.info('existing: resourceUri: ' + resource.resourceUri);
    }
    else {

        var errorInfo = checkProperties(resource, ['resourceType', 'provider', 'region', 'providerResourceId', 'resourceStatus']);

        if (errorInfo) return res.send(errorInfo, errorInfo.code);

        makeResourceUri(resource);

        trace.info('new: resourceUri: ' + resource.resourceUri);
    }
	
	resource.created = new Date();
    resource.updated = resource.created;
	resource.channelCode = req.query.channelCode.toLowerCase();	
	trace.info('resource: ' + JSON.stringify(resource, null, 2));
	
	var query = {resourceUri: resource.resourceUri};
	trace.info("Query:::" + JSON.stringify(query));
	return openMongoCode.retrieveCommon('resources', query, READ_LIMIT, function (err, results) {
		if (err) {
                response.Status = err;
				return res.send(response);
            }

            if (results.length <= 0) {
				return openMongoCode.createCommon(resourcesCollectionName, resource, function (err) {

					if (err) return res.send(err, err.code);

					trace.info('new resource created OK: resourceUri: ' + resource.resourceUri);
					
					//updating vpa in billing
					if(resource.resourceType == 'commision') {
						var commisionData=[];
						commisionData.push(resource);
						postCommisionBilling(commisionData,function(result){			
									trace.info('result:'+result);
							});
					}

					return res.send(resource);
				})
			}else{
				return res.send({message:"the record already exists"});
			}
	});	
});

//upsert - update an existing commision or create a new resource for commision
app.put('/commision', function (req, res) {
	
	
    var resource = req.body;

    if (resource.resourceUri) {

        trace.info('existing: resourceUri: ' + resource.resourceUri);
    }
    else {

        var errorInfo = checkProperties(resource, ['resourceType', 'provider', 'region', 'providerResourceId', 'resourceStatus']);

        if (errorInfo) return res.send(errorInfo, errorInfo.code);

        makeResourceUri(resource);

        trace.info('new: resourceUri: ' + resource.resourceUri);
    }

    resource.updated = new Date();
	
	var query = { 
    
        resourceUri: resource.resourceUri,
        resourceStatus: { $ne: 'deleted' }
    };
   if (req.ownerId === SYSTEM_USER_ID) {

        // every record must have an ownerId

        if (!resource.ownerId) {

            resource.ownerId = SYSTEM_USER_ID;
        }
    }
    else {

        //query.ownerId = req.ownerId;

        resource.ownerId = req.ownerId;
    }
    delete resource.created;    // cannot update 'created'
    delete resource._id;// cannot update 'created'
    var set = { $set: resource };
	resource.channelCode = req.query.channelCode.toLowerCase();
    trace.info('updating resource: resourceUri: ' + resource.resourceUri);
		
    return openMongoCode.updateCommon(resourcesCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        trace.info('numberUpdated: ' + numberUpdated);

        if (numberUpdated) {

            trace.info('resource updated OK: resourceUri: ' + resource.resourceUri);			
			//updating vpa in billing
			if(resource.resourceType == 'commision') {
				var vpaData=[];
				vpaData.push(resource);
				postCommisionBilling(vpaData,function(result){			
							trace.info('result:'+result);
					});
			}
            return res.send(resource);
        }

        // it was not updated because it is not there - so create it

       trace.info('resource not found: create new resource: resourceUri: ' + resource.resourceUri);

        resource.created = resource.updated;

        return openMongoCode.createCommon(resourcesCollectionName, resource, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('new resource created OK: resourceUri: ' + resource.resourceUri);
			//updating vpa in billing
			if(resource.resourceType == 'commision') {
				var vpaData=[];
				vpaData.push(resource);
				postCommisionBilling(vpaData,function(result){			
							trace.info('result:'+result);
					});
			}

            return res.send(resource);
        });
    });
	
});

//Commision billing post
var postCommisionBilling = function (result,callback) {
	trace.info('postCommisionBilling::: ' + JSON.stringify(result));
	if(result.length == 0) {
		 return  callback('No Resource Found');
		}

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {
        host: 'billing.computenext.com',
        port: '8120',
        path: '/billing/commision',
        method: 'POST',
		headers: headers
    };
	//console.log(options);
    var request = http.request(options, function (response) {

        if (response.statusCode === 204) {
        }
        else {
            var content = '';
            response.setEncoding('utf8');
            response.on('data', function (chunk) {
                content += chunk;
            });
            response.on('end', function () {
                if (response.statusCode === 200 || response.statusCode === 201) {
                   var result = JSON.parse(content);
				  // console.log(content);
					if(result.msg === 'processed') {
					 callback('Commision Billing Completed');
					}
					else {
					 //updateFile(result.data);
					 callback('Commision Billing Failed');
					}
                }
            });
        }
    });

    request.on('error', function(e) {
	console.log('Error : '+e.message);
    });

	request.write(JSON.stringify(result));
    request.end();
}

// GCM-1627: set the correct channel codes on a resource
// (based on the regionUri)
// returns errorInfo if problem, null if OK
function setChannelCodes(resource) {

    var channelCount = 0;

    resource.channels = {};

    var uri = resource.resourceUri;

    // could also be a region, not a resource

    if (!uri) {

        uri = resource.regionUri;
    }

    for (var channelcode in channels) {

        if (resource.regionUri in channels[channelcode]) {

            resource.channels[channelcode] = true;

            channelCount++;
        }
    }

    if (channelCount) {

        trace.info('setChannelCodes: uri: ' + uri + ': channels: ' + JSON.stringify(resource.channels, null, 2));

        return null;
    }

    //var errorInfo = errorInfoCode.getErrorInfo(500, 'no channel is defined for the region: ' + uri);
    var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0001'][languageCode] + uri);

    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

    return errorInfo;
}

// upsert - update an existing resource or create a new resource


app.put('/resource', function (req, res) {

    //trace.info('Enter: put.resource (upsert - update an existing resource or create a new resource): ownerId: ' + req.ownerId + ': source: ' + req.query.source);
	trace.info("Put >> In app.all::Language:"+languageCode+"Channel:"+channelCode+"Currency:"+currencyCode);
    countCall('put.resource');
    
    resourceCache.flushAll();
    getResourceCode.flushCaches();

    var InputData = req.body;

	trace.info('InputData :::'+JSON.stringify(InputData));
	trace.info('InputData :::>>'+JSON.stringify(req.query.channelCode));

	var resourceInput={};
	var languageInput={};
	var subscriptionInput={};
	var response={};
	var finalResource={};
	var finalLanguage={};
	var finalSubscription={};


	var resourceDataLength = 0;
	var langDataLength = 0;
	var subscriptionDataLength = 0;

	// InputData is iterated and checked and moved to different jsons(resourceInput,languageInput,subscriptionInput)
    // based on the attributes set

	for(var data in InputData){

		//If iterated data is present in resourceAttributes it will return true
		// and we store that attribute in resourceInput and increment the resourceDataLength.
		//same with languageInput and subscriptionInput.
		var resourceCheck = _.contains(resourceAttributes,data);
		if(resourceCheck === true){
			resourceInput[data] = InputData[data];
			resourceDataLength++;
		}

		var languageCheck = _.contains(languageAttributes,data);
		if(languageCheck === true){
			languageInput[data] = InputData[data];
			langDataLength++;
		}

		var subscriptionCheck = _.contains(subscriptionAttributes,data);
		if(subscriptionCheck === true){
			subscriptionInput[data] = InputData[data];
			subscriptionDataLength++;
		}
		// If the iterated data is found in commonAttributes we need to add them in 3 input jsons.
		var commonCheck = _.contains(commonAttributes,data);
		if(commonCheck === true){
			resourceInput[data] = InputData[data];
			languageInput[data] = InputData[data];
			subscriptionInput[data] = InputData[data];

		}
	}

	var channels = [];
	var languages = [];
	var currencys = [];
	var channel = [];
	var language = [];
	var currency = [];
	//trace.info('source>>>' + req.query.source);
	var uri = InputData.resourceUri.toLowerCase();
	getResourceByUri(req.ownerId, uri,channelCode, function (err, resource) {

    if (err){
	trace.info('no resource exists previously..create a new one');
      // return res.send(err, err.code);
    }

     trace.info('resource:::::::::'+JSON.stringify(resource));
	if(resource===undefined || resource.length==0){
     trace.info('resource inside:::::::::'+JSON.stringify(resource));

	trace.info('This info will not be displayed during loadResoruces');
	//This will be called for API/UI when resource is not available.
 if (req.query.source !== 'loadResourcesV2'){
     InputData.channelCode=InputData.channelCodes[0];
	InputData.languageCode = InputData.languageCodes[0]
	InputData.currencyCode= InputData.currencyCodes[0];

	languageInput.languageCode = InputData.languageCode ;
	langDataLength++;
	languageInput.channelCode =InputData.channelCode;
	langDataLength++;
	subscriptionInput.channelCode=InputData.channelCode;
	subscriptionDataLength++;
	subscriptionInput.currencyCode=  InputData.currencyCode;
	subscriptionDataLength++;
	}
}
else{
	trace.info('in else This info will not be displayed during loadResoruces');
//This will be called for API/UI when resource is available. So we need to update it
   if (req.query.source !== 'loadResourcesV2'){
	trace.info('This info will not be displayed during loadResoruces');
    InputData.channelCode=InputData.channelCodes[0];
	InputData.languageCode = InputData.languageCodes[0]
	InputData.currencyCode= InputData.currencyCodes[0];

		channels = resource.channelCodes;
		resourceInput.channelCodes=channels;
		channel = InputData.channelCodes[0];
		var exists=_.contains(resource.channelCodes,channel);
		trace.debug('The channel exists:::' +exists);
		if(!exists){
			//trace.info('inside if');
			channels.push(channel);

		}
		trace.debug('The channels:::'+channels);

		languages = resource.languageCodes;
		resourceInput.languageCodes=languages;
		language = InputData.languageCodes[0];
		var exists=_.contains(resource.languageCodes,language);
		trace.debug('The language exists:::' +exists);
		if(!exists){
			//trace.info('inside if');
			languages.push(language);

		}
		trace.debug('The languages:::'+languages);

		currencys = resource.currencyCodes;
		resourceInput.currencyCodes=currencys;
		currency = InputData.currencyCodes[0];
		var exists=_.contains(resource.currencyCodes,currency);
		trace.debug('The currency exists:::' +exists);
		if(!exists){
			//trace.info('inside if');
			currencys.push(currency);

		}
		trace.debug('The currencys:::'+currencys);




	var languagechanelCodeCheck = _.contains(languageInput, InputData.channelCode);
	trace.debug('languagechanelCodeCheck :'+languagechanelCodeCheck);
	if(languagechanelCodeCheck == false){

		languageInput.channelCode = InputData.channelCodes[0];
		langDataLength++;
		var languagechanelCode = _.contains(languageInput, InputData.channelCode);
		trace.debug('languagechanelCode >>>'+languagechanelCode);
	}

	var languageCodeCheck = _.contains(languageInput,languageCode);
	trace.debug('languageCodeCheck :'+languageCodeCheck);
	if(languageCodeCheck == false) {

		languageInput.languageCode = InputData.languageCodes[0];
		langDataLength++;
		var languagechanel = _.contains(languageInput, InputData.channelCode);
		trace.debug('languagechanel >>>'+languagechanel);
	}

	var subscriptionchanelCodeCheck = _.contains(subscriptionInput, InputData.channelCode);
	//trace.info('subscriptionchanelCodeCheck :'+subscriptionchanelCodeCheck);
	if(subscriptionchanelCodeCheck == false) {

		subscriptionInput.channelCode = InputData.channelCodes[0];
		subscriptionDataLength++;
		var subscriptionchanelCode = _.contains(subscriptionInput, InputData.channelCode);
		//trace.info('subscriptionchanelCode >>>'+subscriptionchanelCode);

	}

	var subscriptioncurrencyCodeCheck = _.contains(subscriptionInput, InputData.currencyCode);
	//trace.info('subscriptioncurrencyCodeCheck :'+subscriptioncurrencyCodeCheck);
	if(subscriptioncurrencyCodeCheck == false) {

		subscriptionInput.currencyCode = InputData.currencyCodes[0];
		subscriptionDataLength++;
		var subscriptioncurrencyCode = _.contains(subscriptionInput,InputData.currencyCode);
		//trace.info('subscriptioncurrencyCode >>>'+subscriptioncurrencyCode);
	}
	}
}

	//trace.info('Resource Input:'+JSON.stringify(resourceInput));
	//trace.info('Resource Length Before adding common attributes:'+resourceDataLength);

	//trace.info('Language Input:'+JSON.stringify(languageInput));
	//trace.info('Language Length Before adding common attributes:'+langDataLength);

	//trace.info('Subscription Input:'+JSON.stringify(subscriptionInput));
	//trace.info('Subscription Length Before adding common attributes::'+subscriptionDataLength);

	//trace.info('The channelcodes:'+ JSON.stringify(InputData.channelCodes));
	//trace.info('The lang codes:'+ JSON.stringify(InputData.languageCodes));
	//trace.info('The currcodes:'+ JSON.stringify(InputData.currencyCodes));
	//trace.info('The channelcode:'+ JSON.stringify(InputData.channelCode));
	//trace.info('Thelang code:'+ JSON.stringify(InputData.languageCode));
	//trace.info('The curry codes:'+ JSON.stringify(InputData.currencyCode));

	//trace.info('The subscriptionInput currcodes:'+ JSON.stringify(subscriptionInput.currencyCode));
	//trace.info('The subscriptionInput  channelcode:'+ JSON.stringify(subscriptionInput.channelCode));
	//trace.info('ThellanguageInput ang code:'+ JSON.stringify(languageInput.languageCode));
	//trace.info('The languageInput curry codes:'+ JSON.stringify(languageInput.currencyCode));

	var resourceValidation = validate(resourceInput, resourceSchema);
	trace.info('resourceValidation Status: ' + JSON.stringify(resourceValidation, null, 2));

	var languageValidation = validate(languageInput, languageSchema);
	trace.info('languageValidation Status: ' + JSON.stringify(languageValidation, null, 2));

	var subscriptionValidation = validate(subscriptionInput, subscriptionSchema);
	trace.info('subscriptionValidation Status: ' + JSON.stringify(subscriptionValidation, null, 2));

	// When all data is not valid (resources,language,subscription)
	var invalidInputError = errorInfoCode.getErrorInfo(400, 'Invalid input');
	if((resourceValidation.valid === false) && (languageValidation.valid === false) && (subscriptionValidation.valid === false)) {

        res.send(invalidInputError, errorInfo);
	}

	else {
			// Given input resources data,language data and subscription data and if for any one of
			// the input data validation rules fail send error message as response.
			//(channelCode is common in language and subscription so while check condition for lang/subscritpion gave 1)
			trace.info('Check when all(resource/lang/subscription) data is present');
		   if((resourceDataLength > 0) && (langDataLength > 1)&& (subscriptionDataLength > 1)){
			   trace.info('inside all(resource/lang/subscription) data is present');
			   trace.info('Check when all(resource/lang/subscription) data is present');
			    if((resourceValidation.valid === false) || (languageValidation.valid === false) ||
			  (subscriptionValidation.valid === false)){
					trace.info('inside all data available and any one validation is false');
					 res.send(invalidInputError, errorInfo);
				}
		   }
		    // Given input resources data,language data and no subscription data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength > 0) &&(langDataLength > 1) && (subscriptionDataLength <= 1)){
			   trace.info('inside resource/lang data available');
			    if((resourceValidation.valid === false) || (languageValidation.valid === false)){
					trace.info('inside resource/lang data and any one data validation is false');
					 res.send(invalidInputError, errorInfo);
				}
		   }
		    // Given input resources data, no language data and  subscription data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength > 0) && (langDataLength < 1 ) && (subscriptionDataLength > 1)){
			   trace.info('inside when resource/subscription data present');
			    if((resourceValidation.valid === false) ||  (subscriptionValidation.valid === false)){
					 trace.info('resource/subscription data present and any of resource/subscription validation is false');
					 res.send(invalidInputError, errorInfo);
				}
		   }
		   // Given input language data , subscription data and no resource data and if for any one of
		   // the input data validation rules fail send error message as response
		   if((resourceDataLength < 1) &&(langDataLength > 0) && (subscriptionDataLength > 0)){
			    trace.info('inside lang/subscription data present');
			    if((languageValidation.valid === false) && (subscriptionValidation.valid === false)){
					 trace.info('inside lang/subscription data present and any one data validation false');
					 res.send(invalidInputError, errorInfo);
				}
		   }

		if((resourceValidation.valid === false) || (resourceDataLength < 1)){
	       	 finalResource={};
		}

		resourceInput.ownerId= req.ownerId;
		languageInput.ownerId = req.ownerId;
		subscriptionInput.ownerId = req.ownerId;


    // GCM-1627: always add regionUri and channelcodes

		if (resourceInput.provider && resourceInput.region) {
			resourceInput.regionUri = resourceInput.provider + '/' + resourceInput.region;

			resourceInput.regionUri = resourceInput.regionUri.toLowerCase();
		}


		if(((resourceValidation.valid === true) && (resourceDataLength > 0)) || ((languageValidation.valid === true) && (langDataLength >1)) || ((subscriptionValidation.valid === true) && (subscriptionDataLength > 1))){

		if((resourceValidation.valid === true) && (resourceDataLength > 0)){


		if (req.ownerId === SYSTEM_USER_ID) {

				// every record must have an ownerId

			if (!resourceInput.ownerId) {

				resourceInput.ownerId = SYSTEM_USER_ID;
			}
		}
		else {

			//query.ownerId = req.ownerId;

			resourceInput.ownerId = req.ownerId;
		}

		resourceInput.updated =  new Date();

		 var query = {
            resourceUri: resourceInput.resourceUri,
			resourceStatus: { $ne: 'deleted' }
        };

		// Call to update resource data
	    updateResource(resourcesCollectionName,query,resourceInput,function(err,numberUpdated){
			trace.info(':::::Inside updateResource for resources:::::');
			if(err){
				trace.info(':::::inside if condition:::');
				return res.send(err);

			}

            trace.info('resource updated OK: resourceUri: ' + resourceInput.resourceUri);
			trace.info('the final Resource updated:'+JSON.stringify(resourceInput));
			 finalResource = resourceInput;

			 if((langDataLength < 1)  && (subscriptionDataLength<1)){
					trace.info('Resources Stored:OK:'+JSON.stringify(finalResource));
					return res.send(finalResource);
				}

		});
		}

	// Checking valid language data and subscription data
  if(((languageValidation.valid === true) && (langDataLength >1)) || ((subscriptionValidation.valid === true) && (subscriptionDataLength > 1))) {
	languageInput.created = new Date();
    languageInput.updated = languageInput.created;

	subscriptionInput.created = new Date();
    subscriptionInput.updated = subscriptionInput.created;

	 // To store in language/subscription, first we need to check whether the resourceUri exists in
	 // parent resources collection, if exists then only we should store in the input json to language/subscription.

	 var notFound = false;
	 var query = {resourceUri: resourceInput.resourceUri};
	 var error;
	 var errorInfo;
	 var length;

	 //checking in parent "resources" collection before inserting in language or subscription collection
	 openMongoCode.retrieveCommon('resources', query, READ_LIMIT, function (err, results) {

		  //length = results.length;
		  //trace.info('The length inside is:'+ length);
            if (err) {
                response.languageStoredStatus = err;
			    response.susbcriptionStoredStatus = err;
            }

            /* if (results.length <= 0) {
				trace.info('Checking resourceUri exists in parent resources collection');
                notFound = true;
				error = 'The resource ' + resourceInput.resourceUri + ' does not exist in parent resource collection';
                errorInfo = errorInfoCode.getErrorInfo(404, error);
				if(langDataLength > 1){
				response= errorInfo;
				}
				if(subscriptionDataLength > 1){
			    response = errorInfo;
				}
				trace.info('The Response:'+JSON.stringify(response));
			    return res.send(response);
            } */

	if(languageValidation.valid === false){
	      response.languageStoredStatus = languageValidation.errors;
	}
	// If resourceUri is present in parent resources collection and also language validations
	// are true then only insert into language collection.
		if((languageValidation.valid === true) && (langDataLength > 1)){

		trace.info(':::LanguageValidation:::');

		 var langQuery = { resourceUri: languageInput.resourceUri,
						   languageCode: languageInput.languageCode,
						   channelCode: languageInput.channelCode};

		if (req.ownerId === SYSTEM_USER_ID) {

				// every record must have an ownerId

			if (!languageInput.ownerId) {

				languageInput.ownerId = SYSTEM_USER_ID;
			}
		}
		else {

			//query.ownerId = req.ownerId;

			languageInput.ownerId = req.ownerId;
		}

		 // call to update for language data
		 updateResource(languageCollectionName,langQuery,languageInput,function(err,langNumberUpdated){
			 trace.info(':::Call to updateResource function for language:::');
				if(err) {

				  return res.send(err);

				}
				else{

  				   response.languageStoredStatus=langNumberUpdated;
				   finalLanguage = languageInput;

				   //If only valid language data is given and no resource/subscription so return only
				   //the language data which is stored.
				   if((resourceDataLength < 1) && (resourceValidation.valid === false) && (subscriptionDataLength<=1) ){

					   return res.send(finalLanguage);
				   }
				   trace.info('Language Stored Status :OK'+JSON.stringify(langNumberUpdated));
				   //If only valid language data and valid resource is given and no subscription so return
				   //the resource and language data which is stored.
				   if(((resourceDataLength > 0) && (resourceValidation.valid === true)) && (subscriptionDataLength<=1) ){

					   var resLangData = cjson.extend(true,finalResource, finalLanguage);
					   //trace.info('resource and language updated data :'+JSON.stringify(resLangData));
					   return res.send(resLangData);
				   }

				}

		});
	 }

	 // If valid resource and valid languange send the response
	 if((resourceDataLength > 0) && (langDataLength >1) && (subscriptionDataLength<1)){
		  var responseLang = cjson.extend(true,finalResource, finalLanguage);
		  //return res.send(responseLang);
		}

	// If resourceUri is present in parent resources collection and also subscription validations
	// are true then insert into subscription collection.
		if((subscriptionValidation.valid === true) && (subscriptionDataLength > 1)){


		  var subQuery = { resourceUri: subscriptionInput.resourceUri,
						   channelCode: subscriptionInput.channelCode,
						   currencyCode: subscriptionInput.currencyCode};

			if (req.ownerId === SYSTEM_USER_ID) {

				// every record must have an ownerId

				if (!subscriptionInput.ownerId) {

					subscriptionInput.ownerId = SYSTEM_USER_ID;
				}
			}
			else {

				subscriptionInput.ownerId = req.ownerId;
			}
		  if(InputData.resellerId){ // For reseller publish
			  var vpaquery = {};
			  vpaquery.ownerId = InputData.resellerId;
			  vpaquery.resourceUri = subscriptionInput.resourceUri;
			  vpaquery.listPrice = subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount;
			  vpaquery.costPrice = subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
			  vpaquery.onetime_listPrice = (subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1])?subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount:0;
			  vpaquery.onetime_costPrice = (subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1])?subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount:0;
			  calculateVpaPrice(vpaquery,function(err,vparesult){
				  if(vparesult && vparesult.price && vparesult.price!=null){
						var resellerCostprice = vparesult.price;
				  }
				  else{
					  var resellerCostprice = vpaquery.listPrice;
						
				  }
				  if(vparesult && vparesult.onetime_costPrice && vparesult.onetime_costPrice !="null")
					 var resellerOnetimeCostprice = vparesult.onetime_costPrice;
				  else
					 var resellerOnetimeCostprice = vpaquery.onetime_listPrice;
				  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount = Math.round(resellerCostprice); //Add vpa for list price
				  if(typeof subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1] != "undefined"){
					  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount = Math.round(resellerOnetimeCostprice); //Add vpa for onetime_list price
				  }
				  var upliftquery = {};
				  upliftquery.ownerId = InputData.resellerId;
				  upliftquery.resourceType = 'uplift';
				  upliftquery.provider = InputData.provider;
				  getUpliftObj(upliftquery,function(err,upliftObj){
					  var costPriceObj = {};
					  costPriceObj['costprice'] = resellerCostprice;
					 // var onetime_costprice = (subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1]) ? subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[1].ChargeAmount : 0;
					  costPriceObj['onetime_costprice'] = resellerOnetimeCostprice;
					  getUpliftedPrice(upliftObj,subscriptionInput.resourceUri,costPriceObj,function(err,upliftpriceobj){
						  if(upliftpriceobj.costprice && upliftpriceobj.costprice != "" && upliftpriceobj.costprice !=null){
							  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount = upliftpriceobj.costprice; //Add uplift
						  }else{
							  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount = subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.displayCost.Tierpricing[0].ChargeAmount; //If no uplift created 
						  }
						  if(upliftpriceobj.onetime_costprice && typeof subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1] != "undefined"){
							  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount = upliftpriceobj.onetime_costprice;
						  }else{
							  subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[1].ChargeAmount = subscriptionInput.subscriptionServiceTerm.SubscriptionServiceTermCharges.displayCost.Tierpricing[1].ChargeAmount; //If no uplift created
						  }
						  // To update the subscription collection for reseller
						  subscriptionInput.currencyCode=subscriptionInput.currencyCode.toLowerCase();
						  updateResource(subscriptionCollectionName,subQuery,subscriptionInput,function(err,subUpdated){
							  trace.info(':::Call to updateResource function for subscription:::');
								if(err){
									return res.send(err);

								}
								else{
									response.subscriptionStoredStatus=subscriptionInput;
									finalSubscription = subscriptionInput;
									trace.info('Subscription stored:OK'+JSON.stringify(finalSubscription));
									// If only valid subscription data is given and no resource/language
									// return the stored subscription.
									if(resourceDataLength <0 && langDataLength <0){
										return res.send(finalSubscription);
									}
								}
trace.info("--------------->");
								var resourceNew = cjson.extend(true,finalResource, finalLanguage,finalSubscription);
								getResellerDetails(InputData.resellerId,function(kiosksettingserr,kiosksettings){
									trace.info('kiosksettings[0].URL:::::'+kiosksettings[0].URL);
									publishScript.executescript(resourceNew,kiosksettings[0].URL,function(err,resu){
										return res.send(resourceNew);
									});	   	
								
								});
								
						  }); // close of subscription
					  }); // close of uplift price
				  }); // close of uplift object
			  }); // close of vpa price					  
			  
		  }else{
			  // To update the subscription collection
			  updateResource(subscriptionCollectionName,subQuery,subscriptionInput,function(err,subUpdated){
				  trace.info(':::Call to updateResource function for subscription:::');
				if(err){
					return res.send(err);

				}
				else{
					response.subscriptionStoredStatus=subscriptionInput;
					finalSubscription = subscriptionInput;
					trace.info('Subscription stored:OK'+JSON.stringify(finalSubscription));
					// If only valid subscription data is given and no resource/language
					// return the stored subscription.
					if(resourceDataLength <0 && langDataLength <0){
						return res.send(finalSubscription);
					}

				}

				var resourceNew = cjson.extend(true,finalResource, finalLanguage,finalSubscription);
				return res.send(resourceNew);    	  
				
			}); // close of subscription
		  }		 
	} // close of subscription if
}); //close of resources if
}

} // close of if resource valid
} //close of else

});

});





/*function magentopush(resource, callback) {

	var magentopush = require('../resourcesv2/updateVPA.js');

	magentopush.updateVPA(resource, function (err, result) {
	//console.log('testeeupdateVPAeree');
		if (err)
			return callback(err, '');

		return callback('', result);

	});
}*/

// subcription get
var getSubscription = function (result,callback) {

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {
        host: 'resources.computenext.com',
        port: config.port,
        path: '/apiv1.0/resourceQuery/subscription?uri='+result + '&channelCode=' + channelCode + '&currencyCode=' + currencyCode,
        method: 'GET',
		headers: headers
    };
	//trace.info('options :'+JSON.stringify(options));
    var request = http.request(options, function (response) {
        var content = '';
        response.setEncoding('utf8');
        response.on('data', function (chunk) {
            content += chunk;
        });
        response.on('end', function () {
            if (response.statusCode === 200 || response.statusCode === 201) {
				var result = JSON.parse(content);
				if(result.length)
				//console.log('Available Resources in Server :' +result.length);
				callback(null,result);
            }
        });
    });
	trace.info('The response from getSubscription:'+JSON.stringify(response));
    request.end();
}
// subscription post
var postSubscription = function (result,callback) {
	trace.info('under postSubscription');

	if(result.length == 0) {


		 return  callback('No Resource Found');

		}

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {
        host: 'billing.computenext.com',
        port: '8120',
        path: '/billing/subscriptiondata',
        method: 'POST',
		headers: headers
    };
	//trace.info('options under billing api call:'+JSON.stringify(options));
    var request = http.request(options, function (response) {

	//trace.info('subscription response :' +JSON.stringify(response.statusCode));
        if (response.statusCode === 204) {
        }
        else {
            var content = '';
            response.setEncoding('utf8');
            response.on('data', function (chunk) {
                content += chunk;
				//trace.info('subscription content' +JSON.stringify(content));
            });
            response.on('end', function () {
                if (response.statusCode === 200 || response.statusCode === 201) {

                   var result = JSON.parse(content);

					if(result.status === 'Completed') {
					 callback('Subcription Completed');

					}
					else {
					 //updateFile(result.data);

					 callback('Subcription Failed');

					}
                }
            });
        }
    });

    request.on('error', function(e) {
	console.log('Error : '+e.message);
    });

	request.write(JSON.stringify(result));
	//trace.info('postSubscription result:' +JSON.stringify(result));
    request.end();
}

// VPA billing post
var postVPABilling = function (result,callback) {

	if(result.length == 0) {
		 return  callback('No Resource Found');
		}

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {
        host: 'billing.computenext.com',
        port: '8120',
        path: '/billing/vpa',
        method: 'POST',
		headers: headers
    };
	//console.log(options);
    var request = http.request(options, function (response) {

        if (response.statusCode === 204) {
        }
        else {
            var content = '';
            response.setEncoding('utf8');
            response.on('data', function (chunk) {
                content += chunk;
            });
            response.on('end', function () {
                if (response.statusCode === 200 || response.statusCode === 201) {
                   var result = JSON.parse(content);
				  // console.log(content);
					if(result.msg === 'processed') {
					 callback('VPA Billing Completed');
					}
					else {
					 //updateFile(result.data);
					 callback('VPA Billing Failed');
					}
                }
            });
        }
    });

    request.on('error', function(e) {
	console.log('Error : '+e.message);
    });

	request.write(JSON.stringify(result));
    request.end();
}

// metadata for the properties
// NOTE: needs to be above/before GET /resource
app.get('/resource/distinct/:propertyName', function (req, res) {

    var propertyName = req.params.propertyName;

    trace.info('enter: get.resource.distinct.id (get distinct values for a property): propertyName: ' + propertyName + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.resource.distinct.id');

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.resource.distinct.id: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var query = {};

    // GCM-2631: use different property name!

    var propertyNameChannel = 'channels.' + channelcode;

    query[propertyNameChannel] = true;

    return openMongoCode.retrieveDistinct(resourcesCollectionName, propertyName, query, function (err, results) {

        if (err) return res.send(err, err.code);

        return res.send(results);
    });
});

// clone an existing resource
// (used to create private image resources)
// NOTE: needs to be above/before GET /resource
app.get('/resource/clone/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: get.resource.clone.id.id.id.id (clone an existing resource): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.resource.clone.id.id.id.id');

    var query = {

        ownerId: req.ownerId,
        resourceUri: resourceUri,
	};

    var errorInfo = checkProperties(req.query, ['providerResourceId']);

    if (errorInfo) return res.send(errorInfo, errorInfo.code);

     getResourceByUri(req.ownerId, resourceUri,channelCode, function (err, resource) {

        if (err) return res.send(err, err.code);

        var clonedResource = _.clone(resource);

        clonedResource.isPrivate = true;

        clonedResource.ownerId = req.ownerId;

        clonedResource.providerResourceId = req.query.providerResourceId;

        makeResourceUri(clonedResource);

   	    var langFound = true;
		var subFound = true;
        // NOTES:
        // 1/ we only update providerResourceId and resourceUri - all other fields can be modified by "update"
        // 2/ we do not restrict the resourceType - anything can be cloned
        // 3/ "standard" resources can be cloned, we do not restrict this
		 getLanguageDetailsByUri(req.ownerId, languageCollectionName, resourceUri, languageCode, channelCode, function (err, langData) {

            if (err) {
				langFound = false;
                trace.log("error in retrieving language information");
		    }

		var clonedLanguage = _.clone(langData);

        clonedLanguage.isPrivate = true;

        clonedLanguage.ownerId = req.ownerId;

        clonedLanguage.resourceUri = clonedResource.resourceUri;

        return getSubscriptionDetails(req.ownerId, subscriptionCollectionName, resourceUri,channelCode, currencyCode, function (err, subscriptionData) {

                if (err) {
					subFound = false;
                    trace.error("error in retrieving subscription data"+err);

                }
		var clonedSubscription = _.clone(subscriptionData);

        clonedSubscription.isPrivate = true;

        clonedSubscription.ownerId = req.ownerId;

        clonedSubscription.resourceUri = clonedResource.resourceUri;

      //  var resourceNew = cjson.extend(true,resource, langData,subscriptionData);

		//    trace.info("The  new Response==>"+JSON.stringify(resourceNew));


        openMongoCode.createCommon(resourcesCollectionName, clonedResource, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('resource cloned OK: resourceUri: ' + clonedResource.resourceUri);

            tidyResource(clonedResource);

        });
		//if( langFound === true){
		openMongoCode.createCommon(languageCollectionName, clonedLanguage, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('language cloned OK: resourceUri: ' + clonedLanguage.resourceUri);

            tidyResource(clonedResource);

        });
	//	}
		//if(subFound === true){
		openMongoCode.createCommon(subscriptionCollectionName, clonedSubscription, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('subscription cloned OK: resourceUri: ' + clonedSubscription.resourceUri);

            tidyResource(clonedSubscription);
		 });
	//	}

	  return getResourceByUri(req.ownerId,clonedResource.resourceUri ,channelCode, function (err, resource1) {

        if (err) return res.send(err, err.code);

        var tidyOptions = {

            noText: (req.query.noText == 'true'),
            noPrice: (req.query.noPrice == 'true')
        };

        tidyResource(resource1, tidyOptions);

       var resourceNew = {};

        return getLanguageDetailsByUri(req.ownerId, languageCollectionName, clonedLanguage.resourceUri, languageCode, channelCode, function (err, langData1) {

            if (err) {

                trace.log("error in retrieving language information");

            }

        return getSubscriptionDetails(req.ownerId, subscriptionCollectionName, clonedSubscription.resourceUri,channelCode, currencyCode, function (err, subscriptionData1) {

                if (err) {

                    trace.error("error in retrieving subscription data"+err);
                }

		    var resourceNew = cjson.extend(true,resource1, langData1,subscriptionData1);

		    trace.info("The Final created and return Response==>"+JSON.stringify(resourceNew));
                return res.send(resourceNew);

            });
        });
	});
  });
});
});
});

/*
Get Regions/Providers based on below query parametes 
req.query:{param:provider/region,channelcode:""}
*/
app.get('/resource/region/all',function(req,res){
	
	trace.info('enter: get./resource/region: req.query.param:'+req.query.param+': req.query.channelcode: ' +req.query.channelcode);
	var Query = null ;
	var set = null ;
	var channelcode = null ;	
	var finalresult = [];
	var providerQuery = {};
	
	if(req.query.channelcode){	
		channelcode = req.query.channelcode; 
		providerQuery = {"channels.channelCode":channelcode.toLowerCase()}; 	
	}else{
		res.statusCode = 400;
		return res.send({"error":"Channel code is required"});	
	}
	
	if(req.query.param){	
		
	}else{
		res.statusCode = 400;
		return res.send({"error":"Param value is required as provider or region"});	
	}
		
	if(req.query.channelcode && req.query.param && req.query.param == 'provider'){
		set = {"provider":1};  
		Query =  providerQuery;	
	
	}else if(req.query.channelcode && req.query.param && req.query.param == 'region'){
		if(req.query.provider){
			providerQuery.provider = req.query.provider;
		}
		set = {"region":1};  
		Query =  providerQuery;
	}else if(req.query.channelcode && req.query.param && req.query.param == 'all'){		  
	    set = {};  
		Query =  providerQuery;
	}   
	
	   
	openMongoCode.retrieveCommonLimitFields(regionsCollectionName, Query, set, function(err, result){

        if(err){
        	res.statusCode= 400;
            return res.send(err);
        }
        res.statusCode = 200;
        
        if(req.query.param === 'provider'){
        	   
        	   for(var i in result){
        	  
        	   finalresult[i] = result[i].provider;
        	  
        	   } 
        	    
        }else if(req.query.param == 'region'){
        	   
        	   for(var i in result){
        	  
        		   finalresult[i] = result[i].region ;
        	   }
        	  
        }else if(req.query.param == 'all'){
     	   
     	   return  res.send(result);
     	  
        } 
        
        var result = finalresult.reduce(function(a,b){
        				if (a.indexOf(b) < 0 ) a.push(b);
        					return a;
        	    	    },[]);

       
        	    	   
        return res.send(result);

    });

});


// retrieve a single resource
app.get('/resource/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: get.resource.id.id.id.id (retrieve a single resource): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.resource.id.id.id.id');

    return getResourceByUri(req.ownerId, resourceUri,channelCode, function (err, resource) {

        if (err) return res.send(err, err.code);

        var tidyOptions = {

            noText: (req.query.noText == 'true'),
            noPrice: (req.query.noPrice == 'true')
        };

        tidyResource(resource, tidyOptions);

       var resourceNew = {};

        return getLanguageDetailsByUri(req.ownerId, languageCollectionName, resourceUri, languageCode, channelCode, function (err, langData) {

            if (err) {

                trace.log("error in retrieving language information");

            }

           // trace.info("After lang details call==" + JSON.stringify(langData));

            return getSubscriptionDetails(req.ownerId, subscriptionCollectionName, resourceUri,channelCode, currencyCode, function (err, subscriptionData) {

                if (err) {

                    trace.error("error in retrieving subscription data"+err);
                }

		    var resourceNew = cjson.extend(true,resource, langData,subscriptionData);

		    trace.info("The Response==>"+JSON.stringify(resourceNew));
                return res.send(resourceNew);

            });
        });
    });
});

app.put('/resource/updatechannel', function (req, res) {

    trace.info('enter: updatechannel : channelCode: ' + req.query.channelCode + ' update channel: ' + req.query.newchannelCode);

    var query = {'resourceType': 'saas', 'provider':'microsoft'};

   // addQueryOptions(req, [ 'resourceType', 'provider', 'region', 'resourceStatus' ], query);
	query.channelCodes = req.query.channelCode.toLowerCase();
	var readLimit = 999;
	trace.info('query '+JSON.stringify(query));

	var query2 = {"masterProviderAccessKeypair" : "true"};
	var channeldata = [];
		var channelInfo={};

		var Benefit ={};
		Benefit['en_us'] = '<p>avnet</p>';
		Benefit['ja_jp'] = '<p>avnet</p>';
		var description = {};
		description['en_us'] = '<p>avnet was</p>';
		description['ja_jp'] = '<p>avnet was</p>';

		channelInfo.channelCode = req.query.newchannelCode;
		channelInfo.Benefits=Benefit;
		channelInfo.DetailedDescription=description;

		channeldata.push(channelInfo);
		var regionJson = {};
		regionJson.channels = channelInfo;
	var set = {$push:regionJson};

	return openMongoCode.updateCommon(regionsCollectionName, query2, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        trace.debug('numberUpdated: ' + numberUpdated);
/*    

	return retrieveResources(req.ownerId, query, readLimit, function (err, results) {
		trace.info('retrive resources results::' + results.length);
		
        if (err) return res.send(err, err.code);

        for (var index in results) {
			var resourObj = results[index];
			resourObj.channelCodes = [req.query.newchannelCode];
			trace.info('res json:'+JSON.stringify(resourObj));
			updateChannlCode(resourObj);
           // tidyResource(results[index], tidyOptions);
        }

        // if we are at the readLimit mark the last record with "atReadLimit"

        if (results.length >= readLimit) {

            results[results.length - 1].atReadLimit = readLimit;
        }

        return res.send(results);
	  }); */

	});
});

function updateChannlCode(resourceJson){
	if(resourceJson.length == 0) {
		 return  callback('No Resource Found');
		}

	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {
        host: 'resources.computenext.com',
        port: config.port,
        path: '/resource',
        method: 'PUT',
		headers: headers
    };
	//console.log(options);
    var request = http.request(options, function (response) {

        if (response.statusCode === 204) {
        }
        else {
            var content = '';
            response.setEncoding('utf8');
            response.on('data', function (chunk) {
                content += chunk;
            });
            response.on('end', function () {
                if (response.statusCode === 200 || response.statusCode === 201) {
                   var result = JSON.parse(content);
				  trace.info('resource updated with new channelcode' + result);
                }
            });
        }
    });

    request.on('error', function(e) {
	console.log('Error : '+e.message);
    });

	request.write(JSON.stringify(resourceJson));
    request.end();
}

// retrieve multiple resources
app.get('/resource', function (req, res) {

    trace.info('enter: get.resource (retrieve multiple resources): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.resource');

    var query = {};

    addQueryOptions(req, [ 'resourceType', 'provider', 'region', 'resourceStatus' ], query);
	query.channelCode = req.query.channelCode;
	//query.languageCode = req.query.languageCode;
	query.languageCode = (req.query.languageCode) ? req.query.languageCode.toLowerCase(): defLanguage;
	query.currencyCode = req.query.currencyCode;
	if(req.query.resellerChannelCode){
		query.channelCode = req.query.resellerChannelCode;
		//query.languageCode = req.query.resellerLanguageCode;
		//query.currencyCode = req.query.resellerCurrencyCode;		
		
	}
	trace.info('after options merge:' + JSON.stringify(query));
    // BEGIN: process the "scope"

    var scope = 'all-public-plus-my-private';    // default

    if ('scope' in req.query) {

        scope = req.query.scope;
    }

    scope = scope.toLowerCase();    // case independent

    trace.info('scope: ' + scope + ': ownerId: ' + req.ownerId);

    switch (scope) {

        case 'my-private':

            // my private resources only

            query.ownerId = req.ownerId;
            query.isPrivate = true;

            break;

        case 'my-public':

            // my public resources only

            query.ownerId = req.ownerId;
            query.isPrivate = { $ne: true };

            break;

        case 'my-both':

            // my private resources plus my public resources

            query.ownerId = req.ownerId;

            break;

        case 'all-private':

            // all private resources

            // admin only

            if (req.ownerId !== SYSTEM_USER_ID) {

                //var error = 'admin only: ' + scope + ': ownerId: ' + req.ownerId;
                var error = resourceMsg['0002'][languageCode] + scope + resourceMsg['0003'][languageCode] + req.ownerId;

                var errorInfo = errorInfoCode.getErrorInfo(400, error);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return res.send(errorInfo, errorInfo.code);
            }

            query.isPrivate = true;

            break;

        case 'all-public':

            // all public resources

            query.isPrivate = { $ne: true };

            break;

        case 'all-both':

            // all public resources plus all private resources

            // admin only

            if (req.ownerId !== SYSTEM_USER_ID) {

                //var error = 'admin only: ' + scope + ': ownerId: ' + req.ownerId;
                var error = resourceMsg['0002'][languageCode] + scope + resourceMsg['0003'][languageCode] + req.ownerId;

                var errorInfo = errorInfoCode.getErrorInfo(400, error);

                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return res.send(errorInfo, errorInfo.code);
            }

            break;

        //case 'all-public-plus-my-private':
        default:

            // all public resources plus my private resources
            // (this is all the resources a user has access to)

            // all-public:
            // query.isPrivate = { $ne: true };

            // my-private:
            //query.ownerId = req.ownerId;
            //query.isPrivate = true;

            query.$or = [ { isPrivate: { $ne: true} }, { ownerId: req.ownerId, isPrivate: true } ];

            break;
    }

    // END: process the "scope"

    // BEGIN: process "standard"

    var standard = 'none';    // default

    if ('standard' in req.query) {

        standard = req.query.standard;
    }

    standard = standard.toLowerCase();    // case independent

    trace.info('standard: ' + standard);

    switch (standard) {

        case 'both':

            break;

        case 'only':

            // standard resources only

            query.isStandard = true;

            break;

        //case 'none':
        default:

            // no standard resources

            query.isStandard = { $ne: true };

            break;
    }

    // END: process "standard"

    /* var errorInfo = addDateRanges(req, query);

    if (errorInfo) {

        trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    } */

    // BEGIN: output options

    // noText - removes text properties from output
    // noPrice - removes pricing information (SST) from output

    var tidyOptions = {

        noText: (req.query.noText == 'true'),
        noPrice: (req.query.noPrice == 'true')
    };

    // countOnly - returns only the count, not the records

    var readLimit = READ_LIMIT;

    // GCM-1736: need to be able to read *one* resource

    if ('readLimit' in req.query) {

        var newReadLimit = parseInt(req.query.readLimit, 10);

        if (!isNaN(newReadLimit) && (newReadLimit > 0) && (newReadLimit <= READ_LIMIT)) {

            readLimit = newReadLimit;

            trace.info('readLimit: ' + readLimit);
        }
    }

    if (req.query.countOnly) {

        // TODO: maybe not the best way to do this?
        // this way we will still read all records - maybe should use MongoDB count function?

        readLimit = 9999;   // any more than this and the Node.js process will most likely crash
    }

    // END: output options

    trace.debug('readLimit: ' + readLimit);

    return retrieveResources(req.ownerId, query, readLimit, function (err, results) {
		trace.info('retrive resources results::' + results.length);
		
        if (err) return res.send(err, err.code);

        if (req.query.countOnly == 'true') {

            // TODO: fix this for $ne

            query.from = query.created.$gte;
            query.to = query.created.$lte;

            delete query.created;

            query.count = results.length;

            return res.send(query);
        }

        for (var index in results) {

            tidyResource(results[index], tidyOptions);
        }

        // if we are at the readLimit mark the last record with "atReadLimit"

        if (results.length >= readLimit) {

            results[results.length - 1].atReadLimit = readLimit;
        }

        return res.send(results);
    });
});

// GCM-1627: get the channel code for the user (from the userCache)
// returns null if channelcode not found (should not be possible)
function getChannelCodeForUser(ownerId) {

    trace.debug('enter: getChannelCodeForUser: ownerId: ' + ownerId);

    // GCM-1627: add channelcode

    var channelcode;

    var result = userCache.get(ownerId);

    if (result[ownerId] && result[ownerId].channelCode) {

        channelcode = result[ownerId].channelCode.toLowerCase();

        trace.info('exit: getChannelCodeForUser: ownerId: ' + ownerId + ': channelcode: ' + channelcode);

        return channelcode;
    }

    // channelcode was not found

    trace.warn('exit: getChannelCodeForUser: ownerId: ' + ownerId + ': result: ' + JSON.stringify(result, null, 2));

    return null;
}

function retrieveResources(ownerId, query, readLimit, callback) {

    // GCM-1627: add channelcode

   /*  var channelcode = getChannelCodeForUser(ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + ownerId);

        trace.error('exit: retrieveResources: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return callback(errorInfo);
    } */

   /*  var propertyName = 'channels.' + channelcode;

    query[propertyName] = true;
 */
    // CMP-785
	//query.channelCode=query.channelCode.toLowerCase();
	//query.channelCodes=query.channelCodes.toLowerCase();
	trace.info('query at end:' + JSON.stringify(query));
	var staticQuery=query;
	if(resourcesCollectionName==='resources'){
		delete	staticQuery.languageCode;
		delete	staticQuery.currencyCode;
		//
	trace.info('query.channelCode at end:' + query.channelCode);
	if(query.channelCode){
		query.channelCode=query.channelCode.toLowerCase();
	}
		staticQuery.channelCodes=query.channelCode;
		delete	staticQuery.channelCode;
	}
	trace.info('readLimit>>>>>>>>>..:' + readLimit);
 	trace.info('staticQuery at end:' + JSON.stringify(staticQuery));
 	trace.info('query.source at end:' + query.source);
	if(query.source==='magentopush'){
		staticQuery = {"resourceType": "saas"};
		staticQuery = { $query: staticQuery, $orderby: { 'resourceUri': 1 } };
	}
	else{
		staticQuery = { $query: staticQuery, $orderby: { 'resourceUri': 1 } };

	}
	
  return openMongoCode.retrieveCommon(resourcesCollectionName, staticQuery, readLimit, function (err, results) {
	trace.info('resourcesCollectionName:' + results.length);
	trace.info('query:' + JSON.stringify(query));
	query.languageCode = (languageCode).toLowerCase();
	query.channelCode = query.channelCodes;
	delete	query.channelCodes
	delete query.provider;
	if(query.source==='magentopush'){
		query = {"resourceType": "saas","channelCode":defChannel,"languageCode":defLanguage};
		query = { $query: query, $orderby: { 'resourceUri': 1 },"source":"magentopush" };
	}
	else{
		query = { $query: query, $orderby: { 'resourceUri': 1 } };

	}
	return openMongoCode.retrieveCommon(languageCollectionName, query, READ_LIMIT, function (err, results1) {
		trace.info('languageCollectionName:' + results1.length);
			if (err) return callback(err);

		delete query.languageCode;
		delete query.$query.languageCode;
		query.currencyCode = (currencyCode).toLowerCase();
	if(query.source==='magentopush'){
		trace.info('in magentopush ifff:::::');
		query = {"resourceType": "saas","channelCode":defChannel,"currencyCode":defCurrency};
		query.currencyCode=(currencyCode).toLowerCase();
		query = { $query: query, $orderby: { 'resourceUri': 1 } };
		delete query.$query.languageCode;
	}
	
		return openMongoCode.retrieveCommon(subscriptionCollectionName, query, READ_LIMIT, function (err, results2) {
				trace.info('subscriptionCollectionName:' + results2.length);
				if (err) return callback(err);

					var resourceNew = cjson.extend(true,results, results1,results2);
					trace.info("Final Response:$$$$@@@@"+JSON.stringify(resourceNew));
						if(query.$query.resourceType==='uplift' || query.$query.resourceType==='vpa'){
							delete	query.$query.channelCodes
							delete query.$query.provider;
							delete query.$query.languageCode;
							//delete query.channelCode;
							delete query.$query.currencyCode;
							delete query.currencyCode;
								return openMongoCode.retrieveCommon(resourcesCollectionName, query, READ_LIMIT, function (err, results1) {
					trace.info("results1::::::::::::::"+JSON.stringify(results1));
														resourceNew=results1;
					trace.info("resourceNew::::::::::::::"+JSON.stringify(resourceNew));
							return callback(err,resourceNew);
								});						
						}
						else{
							return callback(err,resourceNew);
						}

					//
				});
			});
    });
}

function getLanguageDetailsByUri(ownerId,languageCollectionName, resourceUri, languageCode,channelCode,callback) {

    trace.debug('enter: getLanguageDetailsByUri: resourceUri: ' + resourceUri);

    var query = {

        //ownerId: ownerId,         // ### SECURITY: CHECK LATER ###
        resourceUri: resourceUri,
		languageCode: languageCode ,
	    channelCode: channelCode

    };
    trace.info("Inside getResourceUri:query:"+query);


    return openMongoCode.retrieveCommon(languageCollectionName, query, READ_LIMIT, function (err, results) {

        if (err) return callback(err);

        // SECURITY: check that the user has access to this resource
		 trace.info("The results from lang table:"+JSON.stringify(results));
        var notFound = false;
        var accessDenied = false;
		trace.info("Before if:"+ownerId);

        if (results.length <= 0) {

            notFound = true;
        }
        else if (ownerId !== SYSTEM_USER_ID) {
			trace.info("after if:"+ownerId);
            // system user has access to everything

            // other users have access to all public (non-private) resources

            if (results[0].isPrivate) {

                accessDenied = (ownerId !== results[0].ownerId);

                if (accessDenied) {

                    trace.info('access denied: private resource: resourceUri: ' + resourceUri + ': ownerId: ' + ownerId);
                }
            }
        }

        if (notFound || accessDenied) {

            var error = 'resource not found: resourceUri: ' + resourceUri;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

     return callback(null, results[0]);
    });
}

// subscription data

function getSubscriptionDetails(ownerId,subcriptionCollectionName, resourceUri,channelCode,currencyCode,callback) {
	trace.info('Theee getSubscriptionDetails');
    trace.debug('enter: getSubscriptionDetails: resourceUri: ' + resourceUri);

    var query = {

        //ownerId: ownerId,         // ### SECURITY: CHECK LATER ###
        resourceUri: resourceUri,
		currencyCode: currencyCode ,
        channelCode: channelCode
    };

    //trace.info("Inside getSubscriptionDetails:query:"+query);


    return openMongoCode.retrieveCommon(subcriptionCollectionName, query, READ_LIMIT, function (err, results) {

        if (err) return callback(err);

        // SECURITY: check that the user has access to this resource

        var notFound = false;
        var accessDenied = false;

        if (results.length <= 0) {

            notFound = true;
        }
        else if (ownerId !== SYSTEM_USER_ID) {

            // system user has access to everything

            // other users have access to all public (non-private) resources

            if (results[0].isPrivate) {

                accessDenied = (ownerId !== results[0].ownerId);

                if (accessDenied) {

                    trace.info('access denied: private resource: resourceUri: ' + resourceUri + ': ownerId: ' + ownerId);
                }
            }
        }

        if (notFound || accessDenied) {

            var error = 'resource not found: resourceUri: ' + resourceUri;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

    return callback(null, results[0]);
    });
}

// delete an existing resource
app.delete('/resource/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: delete.resource.id.id.id.id (delete an existing resource): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('delete.resource.id.id.id.id');

    var query = {

        resourceUri: resourceUri
    };

    // the system user can delete anything

    if (req.ownerId !== SYSTEM_USER_ID) {

        //query.ownerId = req.ownerId;
    }

    var hardDelete = (req.query.hardDelete == 'true');

    trace.info('hardDelete: ' + hardDelete);

    if (hardDelete) {

        return openMongoCode.deleteCommonMultiple(subscriptionCollectionName, query, function (err, numberOfRemovedDocs) {

           if (err){
					 trace.log("Unable to delete from subscriptionCollectionName collection:"+subscriptionCollectionName);
				   }

            var result = {
				subscriptionCollectionName: subscriptionCollectionName,
                resourceUri: query,
                hardDeleteSubscription: hardDelete,
				numberOfRemovedDocs: numberOfRemovedDocs,
                deletedSubscription: (numberOfRemovedDocs > 0)
            };
			trace.info("The no of deleted entries from subscription are:" + numberOfRemovedDocs);
			trace.info("The subscriptionCollection del response:=>" + JSON.stringify(result));

			return openMongoCode.deleteCommonMultiple(languageCollectionName, query, function (err, numberOfRemovedDocs1) {
                   if (err){
					    trace.log("Unable to delete from collection"+languageCollectionName);
						return res.send(err, err.code);
				   }
			var result1 = {
				languagecollectionName: languageCollectionName,
                resourceUri: query,
                hardDeleteStatus: hardDelete,
				removedDocs: numberOfRemovedDocs1,
                deletedLang: (numberOfRemovedDocs1 > 0)
            };
			trace.info("The no of deleted entries from language are:" + numberOfRemovedDocs1);

			return openMongoCode.deleteCommon(resourcesCollectionName, query, function (err, numberOfRemovedDocs2) {
				 if (err){
					  trace.log("Unable to delete from resources:" + resourcesCollectionName);
				     return res.send(err, err.code);
				 }

			  var result2 = {
                collectionName: resourcesCollectionName,
                resourceUri: query,
                hardDelete: hardDelete,
				deletedDocs:numberOfRemovedDocs2,
                deletedResource: (numberOfRemovedDocs2 > 0)
            };
			trace.info("The no of deleted entries from resource are:"+numberOfRemovedDocs2);

		    var deleteResponse = cjson.extend(true,result, result1,result2);
		    trace.info("The final response from hardDelete:=>"+JSON.stringify(deleteResponse));

			return res.send(deleteResponse);
        });
	  });
	});
   }
    // soft delete (the usual case)

    var set = { $set: { resourceStatus: 'deleted' } };

     return openMongoCode.updateCommon(resourcesCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        var result = {

            resourceUri: query,
            hardDelete: hardDelete,
            deleted: (numberUpdated > 0)
        };

		return openMongoCode.updateCommon(languageCollectionName, query, set, function (err, numberUpdated1) {

        if (err) {
			trace.log("Unable to update language collection");
			return res.send(err);
		}
		 var result1 = {
            collectionName: languageCollectionName,
            resourceUri: query,
            hardDelete: hardDelete,
            deleted: (numberUpdated1 > 0)
        };

		return openMongoCode.updateCommon(subscriptionCollectionName, query, set, function (err, numberUpdated2) {

        if (err) {
			trace.log("Unable to update subscription collection");
			return res.send(err);
		}
		 var result2 = {
            collectionName: subscriptionCollectionName,
            resourceUri: query,
            hardDelete: hardDelete,
            deleted: (numberUpdated2 > 0)
        };
		trace.info("update subscription===>"+JSON.stringify(result2));

	 var softDelete = cjson.extend(false,result, result1,result2);
	 trace.info("Soft Delete Status=>"+JSON.stringify(softDelete));

	 return res.send(softDelete);
    });
    });
	});
});

// to "tidy-up" the returned resource
function tidyResource(resource, tidyOptions) {

    var resourceTypeMap = {

        vm: 'InstanceType',
        vs: 'VolumeStorage',
        image: 'Image',
        lb: 'LoadBalancer',
        sg: 'SecurityGroup',
        kp: 'KeyPair',
        ip: 'IpAddress',
        mp: 'MediaPaasService',
        snap: 'Snapshot',
        vx: 'VirtualMachine',
        st: 'SoftwareType',
		saas:'saas'
    };

    // backwards compatibility (with V1 resource type names)

    resource.type = resource.resourceType;

    if (resource.resourceType in resourceTypeMap) {

        resource.type = resourceTypeMap[resource.resourceType];
    }

    delete resource._id;

    if (tidyOptions && tidyOptions.noText) {

        delete resource.DetailedDescription;
        delete resource.ShortDescription;
        delete resource.Benefits;
        delete resource.usageInstructions;

        if (resource.softwareType) {

            for (var index in resource.softwareType) {

                delete resource.softwareType[index].DetailedDescription;
                delete resource.softwareType[index].ShortDescription;
                delete resource.softwareType[index].Benefits;
            }
        }
    }

    if (tidyOptions && tidyOptions.noPrice) {

        delete resource.subscriptionServiceTerm;
    }
}

// END: /resource CRUD

// BEGIN: /region CRUD

// create a new region
app.post('/region', function (req, res) {

	regionCache.flushAll();

    trace.info('enter: post.region (create a new region): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('post.region');

    var region = req.body;
	trace.info('before checkproperties: ');
    var errorInfo = checkProperties(region, ['provider', 'region', 'regionStatus']);
	trace.info('after checkproperties: ');
    if (errorInfo) return res.send(errorInfo, errorInfo.code);

    region.ownerId = req.ownerId;

    region.created = new Date();

    if (region.regionUri) {

        trace.info('existing: regionUri: ' + region.regionUri);
    }
    else {

        makeRegionUri(region);

        trace.info('new: regionUri: ' + region.regionUri);
    }

    // GCM-1627: always add channelcode

    // returns errorInfo if error
    /* var errorInfo = setChannelCodes(region); */

    /* if (errorInfo) {

        return res.send(errorInfo, errorInfo.code);
    } */

    trace.debug('enter Region: ' + JSON.stringify(region, null, 2));
	var postKeysData={};
	postKeysData.provider = region.provider;
	postKeysData.providerName = region.providerName;
	postKeysData.region = region.region;
	postKeysData.regionUri = region.regionUri;
	postKeysData.regionStatus = 'available';
	postKeysData.masterProviderAccessKeypair = region.masterProviderAccessKeypair;
	var channels = region.channels;
	for(var index in channels){
		var postKeyInfo = {};
		postKeyInfo = postKeysData;
		postKeyInfo.channelCode = channels[index].channelCode;
		postKeyInfo.endpoint = channels[index].endpoint;

	trace.debug('before postkeys:@@@@'+JSON.stringify(postKeyInfo));
	 postKeys(postKeyInfo,function(err,results){
		if (err) return res.send(err, err.code)
		return results;
		});
	}

	var data = region.channels;
	for(var index in data){
		delete data[index].endpoint;
	}
	trace.debug('channels data after removing endpoint:'+JSON.stringify(data));
	region.channels=data;

     return openMongoCode.createCommon(regionsCollectionName, region, function (err) {
		if (err) return res.send(err, err.code);

    trace.info('new region created OK: regionUri: ' + region.regionUri);
		delete region._id;
        return res.send(region);
    });
});

function postKeys(regionKeyData, callback) {
	trace.debug('inside function postKeys');
	var headers = {
        "Accept": 'application/json',
        "Content-Type": 'application/json'
    };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = config.ownerId;

    var options = {

        url: config.Keysv2Endpoint + '/api/authentication/addkeys',
        method: 'post',
        json: regionKeyData,
		headers: headers

    };

    trace.info('options: ' + JSON.stringify(options, null, 2));

    return request(options, function (err, response, body) {

        if (err) {

            trace.info('##### postRegion: err: ' + JSON.stringify(err, null, 2));

        }
		trace.debug('The response status:' + response.statusCode);
		if (response) {

            if (response.statusCode != 200) {

                trace.info('##### postKeys: response.statusCode: ' + response.statusCode);
            }
        }

        return callback(err, body);
    });
}

// upsert - update an existing region or create a new region
app.put('/region', function (req, res) {

	regionCache.flushAll();

    trace.info('enter: put.region (upsert - update an existing region or create a new region): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('put.region');

    var region = req.body;

    var errorInfo = checkProperties(region, ['provider', 'region', 'regionStatus']);

    if (errorInfo) return res.send(errorInfo, errorInfo.code);

    region.ownerId = req.ownerId;

    if (region.regionUri) {

        trace.info('existing: regionUri: ' + region.regionUri);
    }
    else {

        makeRegionUri(region);

        trace.info('new: regionUri: ' + region.regionUri);
    }

    region.updated = new Date();

    var query = {

        ownerId: req.ownerId,
        regionUri: region.regionUri
    };

    delete region.created;    // cannot update 'created'

    // GCM-1627: always add channelcode

    // returns errorInfo if error
   /*  var errorInfo = setChannelCodes(region);

    if (errorInfo) {

        return res.send(errorInfo, errorInfo.code);
    } */

	 trace.debug('enter Region: ' + JSON.stringify(region, null, 2));
	var postKeysData={};
	postKeysData.provider = region.provider;
	postKeysData.providerName = region.providerName;
	postKeysData.region = region.region;
	postKeysData.regionUri = region.regionUri;
	postKeysData.regionStatus = 'available';
	postKeysData.masterProviderAccessKeypair = region.masterProviderAccessKeypair;

	var channels = region.channels;
	for(var index in channels){
		var postKeyInfo = {};
		postKeyInfo = postKeysData;
		postKeyInfo.channelCode = channels[index].channelCode;
		postKeyInfo.endpoint = channels[index].endpoint;

	postKeys(postKeyInfo,function(err,results){
		if (err) return res.send(err, err.code)
		return results;
		});
	}

	var data = region.channels;
	for(var index in data){
		delete data[index].endpoint;
	}
	trace.debug('channels data after removing endpoint:'+JSON.stringify(data));
	region.channels=data;
    var set = { $set: region };

    trace.info('update region: regionUri: ' + region.regionUri);

    return openMongoCode.updateCommon(regionsCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        trace.debug('numberUpdated: ' + numberUpdated);

        if (numberUpdated) {

            trace.info('region updated OK: regionUri: ' + region.regionUri);

            return res.send(region);
        }

        // it was not updated because it is not there - so create it

        trace.info('region not found: create new region: regionUri: ' + region.regionUri);

        region.created = region.updated;

        return openMongoCode.createCommon(regionsCollectionName, region, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('new region created OK: regionUri: ' + region.regionUri);

            return res.send(region);
        });
    });
});


//getAccountandAddressdetails
function getAccountandAddressdetails(ownerId, accountId, param,callback) {

	trace.info('getUserandAccountdetails.ownerId:'+ ownerId);

	var path = '/api/authentication/account/'+accountId+'?params='+param+'&source=workloadsv2';
	var headers = {
      "Accept": 'application/json',
      "Content-Type": 'application/json'
  };

	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
	headers['ownerId'] = ownerId;

  var options = {

      url: 'http://localhost:' + '8000' + path,
      ownerId: ownerId,
		headers : headers
  };

	trace.debug('options.url: ' + options.url);

  return request.get(options, function(err, response, body) {

      var userInfo = {};

      // if anything goes wrong we use the default user limits

      if (err) {

          trace.warn('err: ' + JSON.stringify(err, null, 2));
      }

      if (response && response.statusCode != 200) {

          trace.warn('response.statusCode: ' + response.statusCode);
      }
      if (body) {

          try {

              userInfo = JSON.parse(body);

          }
          catch (e) {

              trace.warn('body: JSON.parse failed: e.message: ' + e.message);
          }
      }
      return callback(null,response.statusCode,userInfo);
  });
};


//getResellerChannelcodeList
function getResellerChannelcodeList(ownerId,callback) {

	trace.info('getResellerChannelcodeList.ownerId:'+ ownerId);
	var channelCodeList = [];
	
	return getAccountandAddressdetails(ownerId, ownerId, 'account',function(err,accountResCode,accountInfo){
		trace.info('getResellerChannelcodeList: after getAccountandAddressdetails.err:'+err);
		trace.info('getResellerChannelcodeList: after getAccountandAddressdetails.accountInfo:'+JSON.stringify(accountInfo,null,2));
	
		if(err) return callback(channelCodeList);
		
		if(accountResCode == 200 && accountInfo && accountInfo.accounttype === "distributor"){
	
			var path = '/registry/kiosksetting';
	
			var headers = {
	          "Accept": 'application/json',
	          "Content-Type": 'application/json'
			};
	
		  	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
		  	headers['ownerId'] = ownerId;
	
		    var options = {
	
		        url: 'http://localhost:' + '2201' + path,
		        ownerId: ownerId,
				headers : headers
		    };
	
			trace.debug('options.url: ' + options.url);
	
		    return request.get(options, function(err, response, body) {	        
	
		        // if anything goes wrong we use the default user limits
	
		        if (err) {
	
		            trace.warn('err: ' + JSON.stringify(err, null, 2));	            
		        }
	
		        if (response && response.statusCode != 200) {
	
		            trace.warn('response.statusCode: ' + response.statusCode);
		        }
		        if (body) {
	
		            try {
	
		            	channelCodeList = JSON.parse(body);
	
		            }
		            catch (e) {
	
		                trace.warn('body: JSON.parse failed: e.message: ' + e.message);
		            }
		        }
		        return callback(channelCodeList);
		    });
	
		}else{
			return callback(channelCodeList);
		}
	});
};

//create a new cnsp region
app.post('/cnsp/region', function (req, res) {

	regionCache.flushAll();

    trace.info('enter: post.cnsp region (create a new region): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('post.region');

    var ownerId = req.ownerId;
    
    var region = req.body;
    
    trace.info('enter: post.cnsp region req.body: ' + JSON.stringify(req.body, null, 2));    
    
    return getAccountandAddressdetails(ownerId, region.providerName,'account',function(err,accountResCode,accountInfo){
		trace.info('/cnsp/region: after getAccountandAddressdetails.err:'+err);
		trace.info('/cnsp/region: after getAccountandAddressdetails.accountInfo:'+JSON.stringify(accountInfo,null,2));
	
		if(err) res.send(err);
		
		if(accountResCode == 200 && accountInfo){

		    region.regionid = uuid.v4();
		
		    region.region = region.endpointname;
		
		    region.provider = accountInfo.accountname;
		    
		    region.providerName = accountInfo.accountname;
		
		    region.regionStatus = "available";
		
		    region.regionType = "cnsp";
		
		    var errorInfo = checkProperties(region, ['provider', 'region', 'regionStatus']);
		
		    if (errorInfo) return res.send(errorInfo);		    
		
		    region.ownerId = accountInfo.accountid;
		
		    region.created = new Date();   
		
		    makeRegionUri(region);
		
		    trace.info('new: regionUri: ' + region.regionUri);
		
			region.Benefits = "<p>"+region.provider+"</p>";
		
			region.CloudPlatformType = "saas";
		
			region.ConnectorClassname = "cnspconnector";
		
			region.DetailedDescription = "<p>"+region.provider+" product</p>";
		
			region.Name = region.region;
		
			region.Zone = region.region;
		
			region.accountSubscriptionType = "API";
		
			region.isAccountCreatedPerRegion = "false";
		
			region.masterProviderAccessKeypair = "false";
		
			region.location = "North America, Central Europe, Asia Pacific, Development";
		
			region.supportedActions = [
		        "suspend",
		        "reactivate"
		    ];
		
			var cjson = require('cjson');
		
			var fs = require("fs");
		
			var usersFile = __dirname + '/data/channels/gcm.json';
			var usersFileData = cjson.load(usersFile);
		
			var str = region.regionUri;
		
			//console.log(usersFileData.indexOf(str));
		
			if(usersFileData.indexOf(str) < 0){
			  usersFileData.push(str);
			  var temp=JSON.stringify(usersFileData);
			 // console.log("usersFileData******"+JSON.stringify(usersFileData));
		
			  var resultFile = __dirname + '/data/channels/gcm.json';
			  fs.writeFileSync(resultFile, temp);
			}
			
		    delete region.handledUserId;
		    delete region.channelCode;
			
		    var channelCodesArr = [];
			var channeldata = [];
			var channelInfo={};
			
			var Benefit ={};
			Benefit[languageCode] = '<p>'+channelCode+'</p>';
			
			var description = {};
			description[languageCode] = '<p>'+channelCode+' was</p>';
			
		
			channelInfo.channelCode=channelCode;
			
			channelInfo.Benefits=Benefit;
				
			channelInfo.DetailedDescription=description;
			
			channelCodesArr.push(channelCode);
			channeldata.push(channelInfo);
		
			//region.channels = channeldata;   
				
			trace.info('/cnsp/region: channeldata: ' + JSON.stringify(channeldata, null, 2));
			
			return getResellerChannelcodeList(ownerId, function (storeFrontArr) {
				
				trace.info('/cnsp/region: storeFrontArr: ' + JSON.stringify(storeFrontArr, null, 2));
				
				if(storeFrontArr && storeFrontArr.length > 0){
					for (var index in storeFrontArr) {
			        	var storeFront = storeFrontArr[index];
			        	
			        	if(storeFront.ChannelCode){
			        		channelInfo={};
				        	var Benefit ={};
				        	Benefit[languageCode] = '<p>'+storeFront.ChannelCode.toLowerCase()+'</p>';	        	
				        	var description = {};
				        	description[languageCode] = '<p>'+storeFront.ChannelCode.toLowerCase()+' was</p>';	        	
			
				        	channelInfo.channelCode=storeFront.ChannelCode.toLowerCase();	        	
				        	channelInfo.Benefits=Benefit;	        		
				        	channelInfo.DetailedDescription=description;
				        	
				        	channeldata.push(channelInfo);
				        	channelCodesArr.push(storeFront.ChannelCode.toLowerCase());
			        	}
			        }
				}
				
				region.channels = channeldata;		
				trace.info('/cnsp/region: region: ' + JSON.stringify(region, null, 2));
				
			    return openMongoCode.createCommon(regionsCollectionName, region, function (err) {
			
			        if (err) return res.send(err);
			
			        trace.info('/cnsp/region: new region created OK: regionUri: ' + region.regionUri);
			    
			    //Need to check this code    
			        var cusResource = {			            
			            "resourceUri" : "subscription/"+region.regionUri+"/standard",
			            "channelCodes" : channelCodesArr,
			            "currencyCodes" : ["usd"],
			            "languageCodes" : ["en_us"],
			            "resourceType" : "subscription",
			            "provider" : region.provider,
			            "region" : region.region,
			            "providerResourceId" : "standard",
			            "isStandard" : true,
			            "ownerId" : region.ownerId,
		                        "regionUri" : region.regionUri ,
		                        "subscriptionServiceTerm":{
		                            "Term": "Monthly",
		                            "Yearly": "Rearly"
		                        },
		                        "description":"standard resource"
			        };
			
			        var resourcesv2Endpoint = "http://localhost:5902";
			
			        var headers = {
		                "Accept": 'application/json',
		                "Content-Type": 'application/json'
		            };
		
		        	headers[authConfig.bypassHeaderName] = 'resource'+':'+authConfig.resource;
		        	headers['ownerId'] = ownerId;
		
		            var options = {
		
		                url: resourcesv2Endpoint + '/resource',
		                method: 'post',
		               // method: 'put',          // NOTE: will do "upsert"
		                json: cusResource,
		        		headers: headers
		            };
			
		            request(options, function (err, response, body) {
		
                        if (err) return res.send(err, err.code);
                                        
                           return res.send(region);

		            });
		        //Need to check above code       
			
			       return res.send(region);
			    });
			});
		
    	}else{
    		var errorInfo = errorInfoCode.getErrorInfo(400, "Vendor account is not available");
    		res.send(errorInfo);
    	}
	
	});
});

//upsert - update an existing cnsp region
app.put('/cnsp/region', function (req, res) {

	regionCache.flushAll();
	
	resourceCache.flushAll();
	
	getResourceCode.flushCaches();

    trace.info('enter: put.cnsp.region:regionid (update an existing region)');

    countCall('put.region');

    var region = req.body;
     if(!region.regionid){

        var errorInfo = errorInfoCode.getErrorInfo(400, "regionId is required");
        return res.send(errorInfo);
        
    }
	var regionid = region.regionid;

    var regionJson = {};
    
    regionJson.endpointurl = region.endpointurl;
    regionJson.requestpath = region.requestpath;    
    regionJson.username = region.username;    
    regionJson.updated = new Date();
    
    if(region.password && region.password!=null && region.password!=undefined && region.password!=''){

        regionJson.password = region.password;
    
    }
    
    var query = {
        regionid: regionid
    };   

    var set = { $set: regionJson };

    trace.info('put.cnsp.region: update region: set: ' + JSON.stringify(set, null, 2));

    return openMongoCode.updateCommon(regionsCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err);

        trace.debug('put.cnsp.region: numberUpdated: ' + numberUpdated);

        if (numberUpdated) {

            trace.info('put.cnsp.region: updated OK: regionUri: ' + regionJson.regionUri);
            return res.send(regionJson);
        }
        
    });
});

// Deleting a region based on the region Id 
app.delete('/cnsp/region/:id',function(req,res){
	
	var regionid = req.params.id ;
	
	var query  = {regionid:regionid} ; 
	
	return openMongoCode.deleteCommon(regionsCollectionName, query, function (err, numberdeleted) {
		
		if(err){
			
			res.statusCode = 500 ;
			return res.send(err);
				
		}
		regionCache.flushAll();	
		res.statusCode = 200;
		return res.send({"Region id":regionid,"Status":"Deleted Successfully "});
		
		
	});
	
})


//retrieve multiple regions
app.get('/cnsp/region', function (req, res) {

	trace.info('enter: get.cnsp.region(retrieve multiple regions): ownerId: ' + req.ownerId + ': role: ' + req.query.role);

    countCall('get.region');

    var query = {
    	"regionType": "cnsp",
    	"regionStatus" : "available"
    };

    if(req.query.role && 'vendor' === req.query.role){
	    if(req.ownerId){
	    	query.ownerId = req.ownerId;
	    }
    }    

    if(channelCode){
    	query['channels.channelCode'] = channelCode;
    }

    var readLimit = READ_LIMIT;

    if (req.query.countOnly) {

        readLimit = 9999;   // any more than this and the Node.js process will most likely crash
    }

    // END: output options

    trace.debug('readLimit: ' + readLimit);
    
    trace.info('/cnsp/region: query:' + JSON.stringify(query, null, 2));

    return openMongoCode.retrieveCommon(regionsCollectionName, query, readLimit, function (err, results) {

        if (err) return res.send(err, err.code);

        if (req.query.countOnly == 'true') {

            query.from = query.created.$gte;
            query.to = query.created.$lte;

            delete query.created;

            query.count = results.length;

            return res.send(query);
        }

        for (var index in results) {
        	var region = results[index];
        	region.type = "Cnsp Region";
        	delete region.DetailedDescription;
            delete region.Benefits;
            delete region.SlaSummary;
        }

        // if we are at the readLimit mark the last record with "atReadLimit"

        if (results.length >= readLimit) {

            results[results.length - 1].atReadLimit = readLimit;
        }

        return res.send(results);
    });
});


app.get('/cnsp/region/:provider', function (req, res) {

    trace.info('enter: get./cnsp/region/:provider:'+req.params.provider+': ownerId: ' + req.ownerId + ': role: ' + req.query.role);

    countCall('get.region');

    var query = {
        	"regionType": "cnsp",
        	"regionStatus" : "available"
        };

    if(req.query.role && 'vendor' === req.query.role){
	    if(req.ownerId){
	    	query.ownerId = req.ownerId;
	    }
    }

    
    if (req.params.provider) {
        var provider = req.params.provider.replace(/[\s]/g, '');
        query.provider = provider.toLowerCase();
    }
    
    if(channelCode){
    	query['channels.channelCode'] = channelCode;
    }
    
    var readLimit = READ_LIMIT;

    if (req.query.countOnly) {

        readLimit = 9999;   // any more than this and the Node.js process will most likely crash
    }

    // END: output options

    trace.debug('readLimit: ' + readLimit);

    trace.info('/cnsp/region/:provider: query:' + JSON.stringify(query, null, 2));
    
    return openMongoCode.retrieveCommon(regionsCollectionName, query, readLimit, function (err, results) {

        if (err) return res.send(err, err.code);

        if (req.query.countOnly == 'true') {

            query.from = query.created.$gte;
            query.to = query.created.$lte;

            delete query.created;

            query.count = results.length;

            return res.send(query);
        }

        for (var index in results) {
        	var region = results[index];
        	region.type = "Cnsp Region";
        	delete region.DetailedDescription;
            delete region.Benefits;
            delete region.SlaSummary;
        }

        // if we are at the readLimit mark the last record with "atReadLimit"

        if (results.length >= readLimit) {

            results[results.length - 1].atReadLimit = readLimit;
        }

        return res.send(results);
    });
});




// upsert - update an existing vpa or create a new resource for vpa
app.put('/vpa', function (req, res) {
	
	
    var resource = req.body;

    if (resource.resourceUri) {

        trace.info('existing: resourceUri: ' + resource.resourceUri);
    }
    else {

        var errorInfo = checkProperties(resource, ['resourceType', 'provider', 'region', 'providerResourceId', 'resourceStatus']);

        if (errorInfo) return res.send(errorInfo, errorInfo.code);

        makeResourceUri(resource);

        trace.info('new: resourceUri: ' + resource.resourceUri);
    }

    resource.updated = new Date();
	
	var query = { 
    
        resourceUri: resource.resourceUri,
        resourceStatus: { $ne: 'deleted' }
    };
   if (req.ownerId === SYSTEM_USER_ID) {

        // every record must have an ownerId

        if (!resource.ownerId) {

            resource.ownerId = SYSTEM_USER_ID;
        }
    }
    else {

        //query.ownerId = req.ownerId;

        resource.ownerId = req.ownerId;
    }
    delete resource.created;    // cannot update 'created'
    delete resource._id;// cannot update 'created'
    var set = { $set: resource };
	resource.channelCode = req.query.channelCode.toLowerCase();
    trace.info('updating resource: resourceUri: ' + resource.resourceUri);
		
    return openMongoCode.updateCommon(resourcesCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        trace.info('numberUpdated: ' + numberUpdated);

        if (numberUpdated) {

            trace.info('resource updated OK: resourceUri: ' + resource.resourceUri);			
			//updating vpa in billing
			if(resource.resourceType == 'vpa') {
				var vpaData=[];
				vpaData.push(resource);
				postVPABilling(vpaData,function(result){			
							trace.info('result:'+result);
					});
			}
            return res.send(resource);
        }

        // it was not updated because it is not there - so create it

       trace.info('resource not found: create new resource: resourceUri: ' + resource.resourceUri);

        resource.created = resource.updated;

        return openMongoCode.createCommon(resourcesCollectionName, resource, function (err) {

            if (err) return res.send(err, err.code);

            trace.info('new resource created OK: resourceUri: ' + resource.resourceUri);
			//updating vpa in billing
			if(resource.resourceType == 'vpa') {
				var vpaData=[];
				vpaData.push(resource);
				postVPABilling(vpaData,function(result){			
							trace.info('result:'+result);
					});
			}

            return res.send(resource);
        });
    });
	
});


// metadata for the properties
// NOTE: needs to be above/before GET /region
app.get('/region/distinct/:propertyName', function (req, res) {

    var propertyName = req.params.propertyName;

    trace.info('enter: get.region.distinct.id (get distinct values for a property): propertyName: ' + propertyName + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.region.distinct.id');

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.region.distinct.id: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var query = {};

    // GCM-2631: use different property name!

    //var propertyNameChannel = 'channels.' + channelcode; // Old Code (Before I18N)
	
	var propertyNameChannel = 'channels.channelCode';
	
	trace.info('propertyNameChannel :' + propertyNameChannel);

    //query[propertyNameChannel] = true; // Old Code (Before I18N)
	
	query[propertyNameChannel] = channelCode;

    return openMongoCode.retrieveDistinct(regionsCollectionName, propertyName, query, function (err, results) {

        if (err) return res.send(err, err.code);

        return res.send(results);
    });
});


// Get for VPA loading with vpaid
app.get('/vpa', function (req, res) {

    var vpaid = req.query.vpaid;

    trace.info('Get /vpa ' + vpaid + ': ownerId: ' + req.ownerId + ': channelCode: ' + req.query.source);

    countCall('get.vpa');

    // GCM-1627: add channelcode

    var channelcode = req.query.channelCode;

    if (!channelcode) {
		channelcode = getChannelCodeForUser(req.ownerId);
		 if (!channelcode) {
			//var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
			var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

			trace.error('get.vpa: message: ' + errorInfo.message);

			return res.send(errorInfo, errorInfo.code);
		 }
    }

    var query = {};
    query.channelCode = channelcode.toLowerCase();
	query.name = vpaid;
	query.resourceType = "vpa";
   return openMongoCode.retrieveCommon(resourcesCollectionName, query, 50, function (err, results) {

        if (err) return res.send(err, err.code);

        return res.send(results);
    });
});

// GCM-5658 :Exposing the API for retrieving region details and provider details
app.get('/apiv1.0/resourceQuery/region/distinct/:propertyName', function (req, res) {

    var propertyName = req.params.propertyName;

    trace.info('enter: get.region.distinct.id (get distinct values for a property): propertyName: ' + propertyName + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.region.distinct.id');

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
		var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.region.distinct.id: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var query = {};

    // GCM-2631: use different property name!

    var propertyNameChannel = 'channels.' + channelcode;

    query[propertyNameChannel] = true;

    return openMongoCode.retrieveDistinct(regionsCollectionName, propertyName, query, function (err, results) {

        if (err) return res.send(err, err.code);

        return res.send(results);
    });
});

// retrieve a single region
app.get('/region/*', function (req, res) {

    var regionUri = req.params[0].toLowerCase();

    trace.info('enter: get.region.id.id (retrieve a single region): regionUri: ' + regionUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.region.id.id');

    var query = {

        //ownerId: req.ownerId,
        regionUri: regionUri
    };

    var tidyOptions = {

        noText: (req.query.noText == 'true')
    };

    return getRegion(req.ownerId, query, function (err, result) {

        if (err) return res.send(err, err.code);

        tidyRegion(result, tidyOptions);

        return res.send(result);
    });
});

app.put('/resellerregion', function (req, res){
	
	var query ={
		"regionStatus" : "available"
	};
	trace.info("ownerId"+req.ownerId);
	//trace.info("ownerId"+JSON.stringify(req.body));
	trace.info("query"+JSON.stringify(query));
	
	 return openMongoCode.retrieveCommon(regionsCollectionName, query, READ_LIMIT, function (err, results) {
		
		trace.info("req.length:::::::::::::::::::::::::"+results.length);
		
		var channeldata = [];
		var channelInfo={};

		var Benefit ={};
		Benefit['en_us'] = '<p>'+req.query.channelCode+'</p>';
		Benefit['ja_jp'] = '<p>'+req.query.channelCode+'</p>';
		var description = {};
		description['en_us'] = '<p>'+req.query.channelCode+'was</p>';
		description['ja_jp'] = '<p>'+req.query.channelCode+'was</p>';

		channelInfo.channelCode =req.query.channelCode;
		channelInfo.Benefits=Benefit;
		channelInfo.DetailedDescription=description;
		channeldata.push(channelInfo);
		var regionJson = {};
		regionJson.channels = channelInfo;
		var set = {$push:regionJson};

	return openMongoCode.updateCommon(regionsCollectionName, query, set, function (err, numberUpdated) {
		
		trace.info("updated"+numberUpdated);
		
	
		});
		
	});
	
});
// with cache
function getRegion(ownerId, query, callback) {
		trace.debug('in getRegion: query@@@@@'+query);
    // GCM-1627: add channelcode

    /* var channelcode = getChannelCodeForUser(ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + ownerId);
		var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + ownerId);

        trace.error('exit: getRegion: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return callback(errorInfo);
    }
 */
    // try cache first

    var result = regionCache.get(query.regionUri);

    //trace.debug('getRegion: result: ' + JSON.stringify(result, null, 2));

    if (result[query.regionUri]) {

        trace.debug('getRegion: regionCache: hit: regionUri: ' + query.regionUri);

        var region = result[query.regionUri];

        if (!region.channels || !region.channels[channelcode]) {

            // region is actually there - but not in this channel

           /*  trace.info('region was found in the region cache but is not in the callers channel: regionUri: ' + query.regionUri + ': channelcode: ' + channelcode + ': ownerId: ' + ownerId); */

            //var error = 'region not found: regionUri: ' + query.regionUri;
			var error = resourceMsg['0005'][languageCode] + query.regionUri;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        return callback(null, region);
    }



    trace.debug('getRegion: regionCache: miss: regionUri: ' + query.regionUri);

    // GCM-1627: add channelcode

   /*  var propertyName = 'channels.' + channelcode;

    query[propertyName] = true; */


    return openMongoCode.retrieveCommon(regionsCollectionName, query, READ_LIMIT, function (err, results) {

        if (err) return callback(err);

        if (results.length <= 0) {

            //var error = 'region not found: regionUri: ' + query.regionUri;
            var error = resourceMsg['0005'][languageCode] + query.regionUri;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }
		trace.info('Data from db:'+JSON.stringify(results));
		var regionData ={};

		regionData=JSON.parse(JSON.stringify(results[0]));
		trace.info('Region Details:'+JSON.stringify(regionData.channels));
	    //var channelsData = _.findWhere(regionData.channels, {channelCode: channelCode});
		var channelsData = _.findWhere(regionData.channels, {channelCode: (channelCode)});
		trace.info('Region Details with specified channel status:'+JSON.stringify(channelsData));

	if (channelsData === undefined){
		var errorInfoMesg = 'channel: '+ channelCode + ' is not supported for region :'+regionData.regionUri;
		var errorInfo = errorInfoCode.getErrorInfo(404, errorInfoMesg);
		return callback(errorInfo);
	}
	else{

		var languageSupport = _.some(channelsData, languageCode);
		trace.info('Region:' + regionData.regionUri + ' supports language:' + languageCode + ' status:'+languageSupport);
		if(languageSupport === false){
			var errorInfoMessage = 'Language: '+ languageCode + ' is not supported by region '+regionData.regionUri + ' for channel:'+channelCode;
			var errorInfo = errorInfoCode.getErrorInfo(404, errorInfoMessage);
			return callback(errorInfo);
		}
		else{
			var filter_language = function(language, obj) {
			var resultData = traverse(obj).map(function(item) {
			   if (this.key === language) {
			      this.parent.update(item);
			    }
		    });
			return resultData;
       };

var finalData = filter_language(languageCode, channelsData);
trace.info('Final Region Data:'+finalData);

var result = delete regionData.channels;
//result.channels=finalData;
var finalResult = cjson.extend(true,regionData,finalData);
finalResult.languageCode = languageCode;
trace.info('The Final Region Data returned json:'+JSON.stringify(finalResult));
}
}
      //  regionCache.set(query.regionUri, finalResult);

        return callback(null, finalResult);
    });
}

// retrieve multiple regions
app.get('/region', function (req, res) {

    trace.info('enter: get.region (retrieve multiple regions): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.region');

    var query = {

        //ownerId: req.ownerId
    };

    addQueryOptions(req, [ 'provider', 'regionStatus' ], query);

    /* var errorInfo = addDateRanges(req, query);

    if (errorInfo) {

        trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    } */

    // BEGIN: output options

    // noText - removes text properties from output

    var tidyOptions = {

        noText: (req.query.noText == 'true')
    };

    // countOnly - returns only the count, not the records

    var readLimit = READ_LIMIT;

    if (req.query.countOnly) {

        // TODO: maybe not the best way to do this?
        // this way we will still read all records - maybe should use MongoDB count function?

        readLimit = 9999;   // any more than this and the Node.js process will most likely crash
    }

    // END: output options

    trace.debug('readLimit: ' + readLimit);

    // GCM-1627: add channelcode

   /*  var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.region: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var propertyName = 'channels.' + channelcode;

    query[propertyName] = true; */

    return openMongoCode.retrieveCommon(regionsCollectionName, query, readLimit, function (err, results) {

        if (err) return res.send(err, err.code);

        if (req.query.countOnly == 'true') {

            // TODO: fix this for $ne

            query.from = query.created.$gte;
            query.to = query.created.$lte;

            delete query.created;

            query.count = results.length;

            return res.send(query);
        }
	var allRegions =[];
	for( var index in results){

		trace.info('inside for loop');

		var regionData ={};

		regionData=JSON.parse(JSON.stringify(results[index]));
		trace.info('Region Details:'+JSON.stringify(regionData.channels));

		var channelsData = _.findWhere(regionData.channels, {channelCode: channelCode});

		var noChannel =false;
		var noLanguage = false;

		if (channelsData === undefined){
			trace.info('Region:'+regionData.regionUri+'does not support channel:'+channelCode);
			noChannel = true;
		}
		else{

			var languageSupport = _.some(channelsData, languageCode);
			trace.info('Region:' + regionData.regionUri + ' supports language:' + languageCode + ' status:'+languageSupport);
				if(languageSupport === false){
					trace.info('Language: '+ languageCode + ' is not supported by region '+regionData.regionUri + ' for channel:'+channelCode);
					noLanguage=true;
				}
				else{
					var filter_language = function(language, obj) {
					var resultData = traverse(obj).map(function(item) {
					if (this.key === language) {
						this.parent.update(item);
					}
					});
					return resultData;
				};

			var finalData = filter_language(languageCode, channelsData);
			trace.info('Final Single Region Data:'+JSON.stringify(finalData));

			var result = delete regionData.channels;
			result.channels=finalData;
			var finalResult = cjson.extend(true,regionData,finalData);
			finalResult.languageCode = languageCode;

			// if given channelCode and languageCode is supported by region then add to allRegions
			if((noChannel==false) && (noLanguage==false)){
				allRegions.push(finalResult);
			}
		}
	}
}

        for (var index in allRegions) {

            tidyRegion(allRegions[index], tidyOptions);
        }

        // if we are at the readLimit mark the last record with "atReadLimit"

        if (allRegions.length >= readLimit) {

            allRegions[allRegions.length - 1].atReadLimit = readLimit;
        }

        return res.send(allRegions);
    });
});
//reseller 



// delete an existing region
app.delete('/region/*', function (req, res) {

    var regionUri = req.params[0].toLowerCase();

    trace.info('enter: delete.region.id.id (delete an existing region): regionUri: ' + regionUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('delete.region.id.id');

    // TODO: should we delete all the resources for the region?

    var query = {

        regionUri: regionUri
    };

    // the system user can delete anything

    if (req.ownerId !== SYSTEM_USER_ID) {

        query.ownerId = req.ownerId;
    }

    var hardDelete = (req.query.hardDelete == 'true');

    trace.info('hardDelete: ' + hardDelete);

    if (hardDelete) {

        return openMongoCode.deleteCommon(regionsCollectionName, query, function (err, numberOfRemovedDocs) {

            if (err) return res.send(err, err.code);

            var result = {

                regionUri: regionUri,
                hardDelete: hardDelete,
                deleted: (numberOfRemovedDocs > 0)
            };

            return res.send(result);
        });
    }

    // soft delete (the usual case)

    var set = { $set: { regionStatus: 'deleted' } };

    return openMongoCode.updateCommon(regionsCollectionName, query, set, function (err, numberUpdated) {

        if (err) return res.send(err, err.code);

        var result = {

            regionUri: regionUri,
            hardDelete: hardDelete,
            deleted: (numberUpdated > 0)
        };

        return res.send(result);
    });
});

// to "tidy-up" the returned region
function tidyRegion(region, tidyOptions) {

    // backwards compatibility
    region.type = 'Region';
    // TODO: move this?

    delete region._id;

    if (tidyOptions && tidyOptions.noText) {

        delete region.DetailedDescription;
        delete region.Benefits;
        delete region.SlaSummary;
    }
}

// END: /region CRUD

// BEGIN: V1 compatibility layer

app.get('/apiv1.0/resourceQuery/metadata', function (req, res) {

    trace.info('enter: get.apiv1-0.resourcequery.metadata (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.metadata');

    // TODO: not sure if we need to implement this one...

    return res.send({ request: 'get.metadata' });
});

app.get('/apiv1.0/resourceQuery/query/:type', function (req, res) {

    trace.info('enter: get.apiv1-0.resourcequery.query.id (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.query.id');

    // map V1 resource type to V2 resourceType

    var resourceTypeMap = {


        instanceType: 'vm',
        image: 'image',
        volumeStorage: 'vs',
        securityGroup: 'sg',
        keyPair: 'kp',
        ipAddress: 'ip',
        loadBalancer: 'lb',
        mediaPaasAddon: 'mp',
        mediaPaasService: 'mp',
        virtualMachine: 'vx',
        softwareType: 'st',
		saas:'saas',
		channel:'channel'
    };

    var query = {};

    if (req.params.type in resourceTypeMap) {

        query.resourceType = resourceTypeMap[req.params.type];
    }
    else {

        query.resourceType = req.params.type;
    }

    trace.info('req.params.type: ' + req.params.type + ': query.resourceType: ' + query.resourceType);

    // GCM-1292: do not return standard resources for for some resource types

    if (query.resourceType === 'image' || query.resourceType === 'vs') {

        query.isStandard = { $ne: true };
    }

    // query parameters

    if ('provider' in req.query) {

        query.provider = req.query.provider.toLowerCase();
    }

    if ('region' in req.query) {

        query.region = req.query.region.toLowerCase();
    }
	if(req.query.source && req.query.source==='magentopush'){
		query.source = req.query.source;
		
	}

    // BEGIN: GCM-2062: support paging

    /* var errorInfo = addDateRanges(req, query);

    if (errorInfo) {

        trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    } */

    var readLimit = READ_LIMIT;

    // END: GCM-2062: support paging

    return retrieveResources(req.ownerId, query, readLimit, function (err, results) {

        if (err) return res.send(err, err.code);

        trace.info('results.length: ' + results.length);
		trace.info("Inside the retrieveResources:"+JSON.stringify(results));
		
		if(req.query.source==='magentopush'){
            return res.send(results);		
			
		}

        if (results.length < 1) {

            return res.send([]);
        }

        // GCM-2062: if we are at the readLimit mark the last record with "atReadLimit"

        var atReadLimit;

        if (results.length >= readLimit) {

            atReadLimit = readLimit;
        }

        // all results will be the same resourceType

        if (!results[0].provider || !results[0].region) {

            var converts = convertResultsForQuery(results);
			trace.info('the data=**&&&'+JSON.stringify(converts));
			setReadLimit(converts, atReadLimit);

            return res.send(converts);
        }

        // GCM-1627: resource might not be owned by caller - so pass the caller's ownerId through

        for (var index in results) {

            results[index].callerId = req.ownerId;
        }

        return async.forEachSeries(results, addRegionToResource, function (err) {

            if (err) return res.send(err, err.code);

            // GCM-1245: special case for image

            trace.info('query.resourceType: ' + query.resourceType);

            if (query.resourceType !== 'image') {

                var converts = convertResultsForQuery(results);

                setReadLimit(converts, atReadLimit);

                return res.send(converts);
            }

            // image: might as well get *all* the softwareTypes here

            trace.info('resourceQuery/query/image: getting all softwareTypes');

            var querySt = {

                resourceType: 'st'
            };

            readLimit = 9999;    // so we do not miss any

            return retrieveResources(req.ownerId, querySt, readLimit, function (err, softwareTypes) {

                if (err) return res.send(err, err.code);

                trace.info('softwareTypes.length: ' + softwareTypes.length);

                var softwareTypeMap = {};

                for (var index in softwareTypes) {

                    var softwareType = softwareTypes[index];

                    softwareTypeMap[softwareType.resourceUri] = softwareType;
                }
				trace.info("Before conversion	:"+JSON.stringify(results));
                var converts = convertResultsForQuery(results, softwareTypeMap);
				trace.info("After convertion results:%%%%%"+JSON.stringify(converts));
                setReadLimit(converts, atReadLimit);

                return res.send(converts);
            });
        });
    });
});

// GCM-2350
function setReadLimit(records, atReadLimit) {

    if (atReadLimit) {

        records[records.length - 1].atReadLimit = atReadLimit;
    }
}

function convertResultsForQuery(results, softwareTypeMap) {

    // convert results to the expected V1 format

    var converts = [];
	for (var index in results) {

        // GCM-1675: only return the base version (version 0 - for software types)
        // prevents duplicates on UI

        if (results[index].baseUri && (results[index].baseUri !== results[index].resourceUri)) continue;

        var converted = convertResourceForQuery(results[index].regionObj, results[index], softwareTypeMap);

        converts.push(converted);
    }

    trace.debug('converts.length: ' + converts.length);

    return converts;
}

function convertResourceForQuery(region, resource, softwareTypeMap) {


    var converted = {};

    // some "common" resources do not have a region (like 'st')

    if (region) {
		trace.debug("Inside if region");
        for (var property in rqRegionProperties) {

            var target = rqRegionProperties[property].target;

            if (!(property in region)) continue;

            converted[target] = region[property];

        }
		trace.log("converted in if region:"+JSON.stringify(converted));
    }

    // these are all the V1 resource types

    var resourceTypesToConvert = {

        kp: true,
        sg: true,
        vm: true,
        vs: true,
        image: true,
        vx: true,
        ip: true,
        lb: true,
        mp: true,
        st: true,
        package: true,
        snap: true,
		saas:true,
		channel:true
    };

    if (resource.resourceType in resourceTypesToConvert) {

        for (var property in rqResourceProperties) {

            var target = rqResourceProperties[property].target;

            if (!(property in resource)) continue;

            converted[target] = resource[property];
		}
    }

    // GCM-1245: special case for image

    if (softwareTypeMap) {

        converted.software = [];

        for (var index in resource.softwareTypeUris) {

            var stUri = resource.softwareTypeUris[index];

            if (stUri in softwareTypeMap) {

                var softwareType = softwareTypeMap[stUri];

                converted.software.push(softwareType.name);

                // GCM-1245: pick up some image properties from the softwareType

                if (!converted.operatingSystem && softwareType.operatingSystem) {

                    converted.operatingSystem = softwareType.operatingSystem;
                }

                if (!converted.operatingSystemType && softwareType.operatingSystemType) {

                    converted.operatingSystemType = softwareType.operatingSystemType;
                }

                if (!converted.operatingSystemVersion && softwareType.operatingSystemVersion) {

                    converted.operatingSystemVersion = softwareType.operatingSystemVersion;
                }
            }
            else {

                // the softwareType might be missing for a deleted (deprecated) resource

                if (resource.resourceStatus !== 'deleted') {

                    trace.warn('missing softwareType: resourceUri: ' + resource.resourceUri + ': stUri: ' + stUri);
                }
            }
        }
    }

    // pricing

    convertPricing(resource, converted);

    // fixed values

    fixedValues(region, resource, converted);

    trace.debug('convertResourceForQuery: converted: ' + JSON.stringify(converted, null, 2));

    return converted;
}

function convertPricing(resource, converted) {

    if (resource.subscriptionServiceTerm &&
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges &&
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.length) {

        var chargeAmount = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges[0].ChargeAmount;
        var currencyCode = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges[0].CurrencyCode;

        converted.costPerUnit = chargeAmount + ' ' + currencyCode;

        converted.costUnit = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges[0].ChargeAmountUnit;
    }
	else if (resource.subscriptionServiceTerm &&
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges) {

        var chargeAmount = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
        var currencyCode = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].CurrencyCode;

		var listPrice = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount;
		var displayCost = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.displayCost.Tierpricing[0].ChargeAmount;

        converted.costPerUnit = chargeAmount + ' ' + currencyCode;

        converted.costUnit = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmountUnit;
		converted.listPrice = listPrice;
		converted.displayCost = displayCost;
    }

}

function fixedValues(region, resource, converted) {

    converted.isAvailable = (resource.resourceStatus == 'available' ? '1' : '0');

    if (region) {

        converted.provider = region.providerName;
        converted.region = region.Name;
    }
    else {

        converted.provider = resource.provider;
        converted.region = resource.region;
    }

    converted.id = resource.resourceUri.replace(/\//g, '_');

    converted.id = converted.id.replace(/[\s\.\:]/g,'-');

    // "providerId" is meaningless and we cannot match V1, but include something
    converted.providerId = resource.provider;

    // "rank" is meaningless and we cannot match V1, but include something
    converted.rank = converted.id;

    // GCM-2062

    converted.created = resource.created;
    converted.updated = resource.updated;

    if (resource.atReadLimit) {

        converted.atReadLimit = resource.atReadLimit;
    }
		trace.debug("in fixedpricing:"+JSON.stringify(converted));
}

// async iterator: add the region information to the resource (V1 compatibility)
function addRegionToResource(resource, callback) {

    // NOTE: callerId is the user that called the API method, not the user that owns the resource

    trace.debug('enter: addRegionToResource: callerId: ' + resource.callerId);

    var query = {

        regionUri: resource.provider + '/' + resource.region
    };

    return getRegion(resource.callerId, query, function (err, region) {

        if (err) {

            // GCM-3011: might not find region for channel

            if (err.code === 404) {

                return callback();
            }

            return callback(err);
        }

        // attach the region object to the resource

        resource.regionObj = region;

        return callback(null, resource);
    });
}

app.get('/apiv1.0/resourceQuery/region', function (req, res) {

    trace.info('enter: get.apiv1-0.resourcequery.region (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.region');

    var query = {};

    addQueryOptions(req, [ 'provider', 'region' ], query);

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
		var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.apiv1-0.resourcequery.region: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var propertyName = 'channels.' + channelcode;

    query[propertyName] = true;

    return openMongoCode.retrieveCommon(regionsCollectionName, query, READ_LIMIT, function (err, results) {

        if (err) return res.send(err, err.code);

        for (var index in results) {

            results[index] = convertRegionForRegion(results[index]);
        }

        return res.send(results);
    });
});

function convertRegionForRegion(region) {

    trace.debug('convertRegionForRegion: region: ' + JSON.stringify(region, null, 2));

    var converted = {};

    for (var property in regionConversionProperties) {

        var target = regionConversionProperties[property].target;

        converted[target] = region[property];
    }

    // fixed values

    converted.isAvailable = (region.regionStatus == 'available' ? '1' : '0');

    converted.provider = region.providerName;

    converted.capabilities = 'some URL';

    converted.featured = 'true';

    converted.id = region.regionUri;

    converted.longDescription = 'some text';

    converted.supportedActions = 'some URL';

    converted.type = 'Region';

    trace.debug('convertRegionForRegion: converted: ' + JSON.stringify(converted, null, 2));

    return converted;
}

app.get('/apiv1.0/resourceUri/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: get.apiv1-0.resourceuri.id.id.id.id (V1): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);
	trace.info('channelCode>>>>' + channelCode);
	trace.info('languageCode>>>>' + languageCode);
	trace.info('currencyCode>>>>' + currencyCode);

    countCall('get.apiv1-0.resourceuri.id.id.id.id');

    return getResourceByUri(req.ownerId, resourceUri,channelCode, function (err, resource) {

        if (err) return res.send(err, err.code);

        delete resource._id;

        // common resource types do not have a region

        if (!resource.provider || !resource.region) {

            // conversions

            // NOTE: common resource types do not have any pricing at the moment - but could have in future?

            var converted = _.clone(resource);

            convertPricing(resource, converted);

            delete converted.subscriptionServiceTerm;

            fixedValues(null, resource, converted);

            return res.send(converted);
        }

        var regionUri = resource.provider + '/' + resource.region;

        trace.info('regionUri: ' + regionUri);

        var query = {

            //ownerId: req.ownerId,
            regionUri: regionUri
        };

        return getRegion(req.ownerId, query, function (err, region) {

            if (err) return res.send(err, err.code);

            // conversions

            var converted = _.clone(resource);

            convertPricing(resource, converted);

            delete converted.subscriptionServiceTerm;

            converted.connectorType = region.ConnectorClassname;
            converted.location = region.location;

            // GCM-1784: missing properties for VS

            if (converted.resourceType === 'vs') {

                converted.deviceNameLinux = region.deviceNameLinux;
                converted.deviceNameWindows = region.deviceNameWindows;
            }

            converted.slaSummary = region.SlaSummary;
            converted.networkAdapter = region.networkAdapter;
            converted.Ypflag = region.Ypflag;

            fixedValues(region, resource, converted);

			return getLanguageDetailsByUri(req.ownerId, languageCollectionName, resourceUri, languageCode, channelCode, function (err, langData) {

				if (err) {

						trace.error("error");
					//   return res.send(err);

				}

            trace.info("After lang details call==" + JSON.stringify(langData));

            return getSubscriptionDetails(req.ownerId, subscriptionCollectionName, resourceUri,channelCode, currencyCode, function (err, subscriptionData) {

                if (err) {

                    trace.error("error"+err);

                }

		    var resourceNew = cjson.extend(true,converted, langData,subscriptionData);
		    trace.info("The final data==>"+JSON.stringify(resourceNew));
                return res.send(resourceNew);

        });
    });
});
});
});

/* Start - Adding Price attributes */

function convertPrice(resource, converted) {
	trace.info('enter into convertPrice>>>'+ JSON.stringify(resource));
    if (resource.subscriptionServiceTerm && 
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges && 
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.length) {

        var chargeAmount = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges[0].ChargeAmount;

		converted.costPrice = chargeAmount;

    }
	else if (resource.subscriptionServiceTerm && 
        resource.subscriptionServiceTerm.SubscriptionServiceTermCharges) {

        var chargeAmount = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
		var listPrice = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount;
		var displayCost = resource.subscriptionServiceTerm.SubscriptionServiceTermCharges.displayCost.Tierpricing[0].ChargeAmount;

        converted.costPrice = chargeAmount;
		converted.listPrice = listPrice;
		converted.erpPrice = displayCost;
    }
}



 /* create a new end point in resource service to display different price attributes like costPrice,listPrice,and erpPrice */

app.get('/apiv1.0/resourceQuery/getpricingdetails/*', function (req, res) {
	
    var price = req.params[0].toLowerCase();
	var channelCode = req.query.channelCode.toLowerCase();
	var currencyCode = req.query.currencyCode.toLowerCase();
	
    trace.info('enter: get.apiv1-0.price.id.id.id.id (V1): price: ' + price + ': ownerId: ' + req.ownerId + ': channelCode: ' + channelCode+' currencyCode:'+currencyCode);

    countCall('get.apiv1-0.resourceuri.id.id.id.id');
	
	
    return getResourceByUri(req.ownerId, price,channelCode, function (err, resource) {

        if (err) return res.send(err, err.code);

        var regionUri = resource.provider + '/' + resource.region;

        trace.info('regionUri: ' + regionUri);


		return getSubscriptionDetails(req.ownerId, subscriptionCollectionName, price, channelCode, currencyCode, function (err, subscriptionData) {

                if (err) {

                    trace.error("error"+err);

                }

		    var resourceNew = cjson.extend(true,resource, subscriptionData);
		    trace.info("The final data==>"+JSON.stringify(resourceNew));
			 var converted = {};
			
            convertPrice(resourceNew, converted);
            return res.send(converted);		

        });
    });
});


/* End - Adding Price attributes */



app.get('/apiv1.0/resourceQuery/restrictions/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: get.apiv1-0.resourcequery.restrictions.id.id.id.id (V1): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.restrictions.id.id.id.id');

    return getResourceByUri(req.ownerId, resourceUri,channelCode, function (err, result) {

        if (err) return res.send(err, err.code);

        if (result.resourceType === 'st') {

            // software type

            // GCM-1196: get the images where this software type is used

            // GCM-1675: need to do a wildcard match on the resourceUri
            // (to find the different versions)

            // this is what we need the query to look like

//            var query = {
//
//                resourceType: 'image',
//                resourceStatus: 'available',
//                softwareTypeUris: { $in: [ /st\/windows\/windows\/windows-server-2008-r2*/ ] }       // GCM-1675
//            };

            // See: http://docs.mongodb.org/manual/reference/operator/query/regex/

            // cannot use $regex with $in - so need to do some messing about to convert this into a // style regex

            // escape forwardslashes in URI (for regex pattern)

            // replace forwardslash by backslash + forwardslash

            var searchUriPattern = resourceUri.replace(/\//g, '\\/');

            // GCM-1735: search pattern was too loose

            searchUriPattern = '/' + searchUriPattern + '-v*/';

            trace.info('searchUriPattern: ' + searchUriPattern);

            // OPS-837: make sure resourceStatus is "available"

            var query = {

                resourceType: 'image',
                resourceStatus: 'available',
                softwareTypeUris: { $in: [ '$$REPLACE$$' ] }
            };

            var queryString = JSON.stringify(query, null, 2);

            trace.info('1/ queryString: ' + queryString);

            // NOTE: the double quotes inside the single quotes

            queryString = queryString.replace('"$$REPLACE$$"', searchUriPattern);

            trace.info('2/ queryString: ' + queryString);

            // See: http://www.w3schools.com/json/json_eval.asp

            query = eval("(" + queryString + ")");

            trace.info('restrictions: query: ' + JSON.stringify(query, null, 2));

            // NOTE: it seems the regular expression does not show up in the trace here

            //

            return openMongoCode.retrieveCommon(resourcesCollectionName, query, READ_LIMIT, function (err, imageResources) {

                if (err) return res.send(err, err.code);

                trace.info('imageResources.length: ' + imageResources.length);

                // GCM-1735: search using the original resourceUri (base version)

                // OPS-837: make sure resourceStatus is "available"

                var query = {

                    resourceType: 'image',
                    resourceStatus: 'available',
                    softwareTypeUris: { $in: [ resourceUri ] }
                };

                return openMongoCode.retrieveCommon(resourcesCollectionName, query, READ_LIMIT, function (err, baseImageResources) {

                    if (err) return res.send(err, err.code);

                    trace.info('baseImageResources.length: ' + baseImageResources.length);

                    // push the base images onto the versioned images

                    for (var index in baseImageResources) {

                        imageResources.push(baseImageResources[index]);
                    }

                    trace.info('with base version images: imageResources.length: ' + imageResources.length);

                    // GCM-1627: resource might not be owned by caller - so pass the caller's ownerId through

                    for (var index in imageResources) {

                        imageResources[index].callerId = req.ownerId;
                    }

                    // find the region for each image

                    return async.forEachSeries(imageResources, addRegionToResource, function (err) {

                        if (err) return res.send(err, err.code);

                        var providerMap = {};
                        var regionMap = {};
                        var platformMap = {};

                        for (var index in imageResources) {

                            var imageResource = imageResources[index];

                            if (!imageResource.regionObj) continue;

                            if (!(imageResource.provider in providerMap)) {

                                providerMap[imageResource.provider] = true;
                            }

                            if (!(imageResource.region in regionMap)) {

                                regionMap[imageResource.region] = true;
                            }

                            if (!(imageResource.regionObj.CloudPlatformType in platformMap)) {

                                platformMap[imageResource.regionObj.CloudPlatformType] = true;
                            }
                        }

                        // convert to arrays

                        result.restrictions.provider = [];
                        result.restrictions.region = [];
                        result.restrictions.platform = [];

                        for (var provider in providerMap) {

                            result.restrictions.provider.push(provider);
                        }

                        for (var region in regionMap) {

                            result.restrictions.region.push(region);
                        }

                        for (var platform in platformMap) {

                            result.restrictions.platform.push(platform);
                        }

                        return res.send(result.restrictions);
                    });

                });

            });
        }
        else if (result.resourceType !== 'image') {

            //var error = 'resource type must be either "image" or "st": resourceUri: ' + resourceUri + ': resourceType: ' + result.resourceType;
			var error = resourceMsg['0006'][languageCode] + resourceUri + resourceMsg['0007'][languageCode] + result.resourceType;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return res.send(errorInfo, errorInfo.code);
        }

        // resourceType is image

        var softwareTypes = [];

        // GCM-1421

        if (result.softwareTypeUris) {

            trace.info('image: softwareTypeUris.length: ' + result.softwareTypeUris.length);

            for (var index in result.softwareTypeUris) {

                var softwareType = {

                    ownerId: req.ownerId,
                    resourceUri: result.softwareTypeUris[index]
                };

                softwareTypes.push(softwareType);
            }
        }

        return async.forEachSeries(softwareTypes, getSoftwareType, function (err) {

            if (err) return res.send(err, err.code);

            var compositeRestrictions = {};

            var validRestrictions = {

                cpuCount: true,
                cpuSpeed: true,
                localStorage: true,
                ram: true
            };

            trace.debug('after: softwareTypes: ' + JSON.stringify(softwareTypes, null, 2));

            for (var index in softwareTypes) {

                var softwareType = softwareTypes[index];

                for (var restrictionName in softwareType.restrictions) {

                    if (!(restrictionName in validRestrictions)) continue;

                    var restrictionValue = softwareType.restrictions[restrictionName];

                    trace.debug('restrictionName: ' + restrictionName + ': restrictionValue: ' + restrictionValue);

                    restrictionValue = restrictionValue.replace('[', '');
                    restrictionValue = restrictionValue.replace(']', '');

                    var parts = restrictionValue.split(',');

                    var error;

                    // min
                    if (parts[0] && _.isNumber(parts[0] - 0)) {

                        var valueMin = parts[0] - 0;

                        // cpuCountMin, cpuSpeedMin, etc.

                        var compositePropertyName = restrictionName + 'Min';

                        if (compositePropertyName in compositeRestrictions) {

                            // we want the maximum of the minimums

                            compositeRestrictions[compositePropertyName] = Math.max(compositeRestrictions[compositePropertyName], valueMin);
                        }
                        else {

                            compositeRestrictions[compositePropertyName] = valueMin;
                        }
                    }

                    // max
                    if (parts[1] && _.isNumber(parts[1] - 0)) {

                        var valueMax = parts[1] - 0;

                        // cpuCountMax, cpuSpeedMax, etc.

                        var compositePropertyName = restrictionName + 'Max';

                        if (compositePropertyName in compositeRestrictions) {

                            // we want the minimum of the maximums

                            compositeRestrictions[compositePropertyName] = Math.min(compositeRestrictions[compositePropertyName], valueMax);
                        }
                        else {

                            compositeRestrictions[compositePropertyName] = valueMax;
                        }
                    }
                }
            }

            // convert to the expected V1 format

            for (var restrictionName in validRestrictions) {

                var restriction = '[';

                var minRestriction = restrictionName + 'Min';

                if (minRestriction in compositeRestrictions) {

                    restriction += compositeRestrictions[minRestriction] + ',';
                }

                var maxRestriction = restrictionName + 'Max';

                if (maxRestriction in compositeRestrictions) {

                    restriction += compositeRestrictions[maxRestriction];
                }

                restriction += ']';

                compositeRestrictions[restrictionName] = restriction;
            }

            // GCM-1196

            var query = {

                regionUri: result.provider + '/' + result.region
            };

            return getRegion(req.ownerId, query, function (err, regionResult) {

                if (err) return res.send(err, err.code);

                // GCM-1196

                compositeRestrictions.provider = result.provider;
                compositeRestrictions.region = result.region;

                compositeRestrictions.platform = regionResult.CloudPlatformType;

                return res.send(compositeRestrictions);
            });
        });
    });
});

// async iterator
function getSoftwareType(softwareType, callback) {

    return getResourceByUri(softwareType.ownerId, softwareType.resourceUri,channelCode, function (err, result) {

        if (err) return callback(err);

        softwareType.restrictions = result.restrictions;

        return callback();
    });
}

function getResourceByUri(ownerId, resourceUri,channelCode, callback) {

    trace.debug('enter: getResourceByUri: resourceUri: ' + resourceUri);

    var query = {

        //ownerId: ownerId,         // ### SECURITY: CHECK LATER ###
        resourceUri: resourceUri.toLowerCase(),
		'channelCodes':channelCode
    };
	if(resourceUri==='subscription/microsoft/us/standard'){
		trace.info('in ciatins::::::::::::::;');
		delete query.channelCodes;
	}
	query = { $query: query, $orderby: { 'resourceUri': 1 } }

    // GCM-1627: add channelcode

    var channelcode = channelCode;

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + ownerId);

        trace.error('exit: getResourceByUri: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return callback(errorInfo);
    }

   // var propertyName = 'channels.' + channelcode;

  //  query[propertyName] = true;

    return openMongoCode.retrieveCommon(resourcesCollectionName, query, READ_LIMIT, function (err, results) {

        if (err) return callback(err);

        // SECURITY: check that the user has access to this resource

        var notFound = false;
        var accessDenied = false;

        if (results.length <= 0) {

            notFound = true;
        }
        else if (ownerId !== SYSTEM_USER_ID) {

            // system user has access to everything

            // other users have access to all public (non-private) resources

            if (results[0].isPrivate) {

                accessDenied = (ownerId !== results[0].ownerId);

                if (accessDenied) {

                    trace.info('access denied: private resource: resourceUri: ' + resourceUri + ': ownerId: ' + ownerId);
                }
            }
        }

        if (notFound || accessDenied) {

            //var error = 'resource not found: resourceUri: ' + resourceUri;
            var error = resourceMsg['0008'][languageCode] + resourceUri;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return callback(errorInfo);
        }

        return callback(null, results[0]);
    });
}

app.get('/apiv1.0/resourceQuery/capabilities/*', function (req, res) {

    var resourceUri = req.params[0].toLowerCase();

    trace.info('enter: get.apiv1-0.resourcequery.capabilities.id.id.id.id (V1): resourceUri: ' + resourceUri + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.capabilities.id.id.id.id');

    // NOTE: OK to parse the URI here because this is only for V1 compatiblity and this always works for all V1 resources

    // image/hpcloud/nova/ami-0000bd61

    var parts = resourceUri.split('/');

    var regionUri = parts[1] + '/' + parts[2];

    trace.info('regionUri: ' + regionUri);

    var query = {

        //ownerId: req.ownerId,
        regionUri: regionUri
    };

    return getRegion(req.ownerId, query, function (err, result) {

        if (err) return res.send(err, err.code);

        return res.send(result.Capabilities);
    });
});

app.post('/apiv1.0/resourceQuery/action', function (req, res) {

    var requests = req.body;

    // input is an ARRAY of requests

    trace.info('enter: post.apiv1-0.resourcequery.action (V1): requests.length: ' + requests.length + ': ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('post.apiv1-0.resourcequery.action');

    // output is an array of results

    var results = [];

    // some hokum to get around the limitations of async

    for (var index in requests) {

        requests[index].ownerId = req.ownerId;

        requests[index].results = results;
    }

    return async.forEachSeries(requests, processAction, function (err) {

        if (err) return res.send(err, err.code);

        return res.send(results);
    });
});

// async iterator
function processAction(request, callback) {

    trace.info('enter: processAction: ownerId: ' + request.ownerId + ': uri: ' + request.uri + ': State: ' + request.State);

    var errorInfo = checkProperties(request, ['uri', 'State']);

    if (errorInfo) return callback(errorInfo);

    return getResourceByUri(request.ownerId, request.uri,channelCode, function (err, resource) {

        if (err) return callback(err);

        // NOTE: OK to parse the URI here because this is only for V1 compatiblity and this always works for all V1 resources

        // image/hpcloud/nova/ami-0000bd61

        var parts = request.uri.split('/');

        var regionUri = parts[1] + '/' + parts[2];

        trace.info('regionUri: ' + regionUri);

        var query = {

            //ownerId: req.ownerId,
            regionUri: regionUri
        };

        // TODO: do we really need to get the resource or only the region?

        return getRegion(request.ownerId, query, function (err, region) {

            if (err) return callback(err);

            // find the state machine

            var stateMachine = 'basicStateMachine';

            if (resource.resourceType in stateMachinesTop.stateMachineMap) {

                stateMachine = stateMachinesTop.stateMachineMap[resource.resourceType];
            }

            trace.info('resourceType: ' + resource.resourceType + ': stateMachine: ' + stateMachine + ': # transitions: ' + stateMachinesTop.stateMachines[stateMachine].length);

            // go through all the transitions

            var result = {

                uri: request.uri,
                State: request.State,
                AllActions: [],
                AvailableActions: []
            };

            for (var index in stateMachinesTop.stateMachines[stateMachine]) {

                var transitionName = stateMachinesTop.stateMachines[stateMachine][index];

                trace.debug('transitionName: ' + transitionName);

                var transition = stateMachinesTop.transitions[transitionName];

                // GCM-1822: missing transitions cause crash

                if (!transition) {

                    trace.warn('missing transition: stateMachine: ' + stateMachine + ': transitionName: ' + transitionName);

                    continue;
                }

                trace.debug('transition: ' + JSON.stringify(transition, null, 2));

                // the action must be supported by the region at least

                if (!(region.supportedActionsMap)) {

                    region.supportedActionsMap = {};

                    for (var index in region.supportedActions) {

                        var supportedAction = region.supportedActions[index];

                        supportedAction = supportedAction.toLowerCase();

                        region.supportedActionsMap[supportedAction] = true;
                    }
                }

                if (transition.action && transition.action.toLowerCase() in region.supportedActionsMap) {

                    // some conversions on the names

                    // defaults

                    var restLabel = transition.action;
                    var name = transition.action;

                    if (transition.action in stateMachinesTop.actions) {

                        var actionElement = stateMachinesTop.actions[transition.action];

                        if (actionElement.name) {

                            name = actionElement.name;
                        }

                        if (actionElement.restLabel) {

                            restLabel = actionElement.restLabel;
                        }
                    }

                    // NOTE: string.camelize does not do what I thought it did...

                    restLabel = restLabel.slice(0, 1).toLowerCase() + restLabel.slice(1, restLabel.length);

                    var resultElement = {

                        id: restLabel,
                        name: name
                    };

                    result.AllActions.push(resultElement);

                    var resultElement2 = _.clone(resultElement);

                    if (transition.state.toLowerCase() === request.State.toLowerCase()) {
                    	
                    	if('pending' === request.State.toLowerCase()){
                    		
                    		if('creating' === request.currentStatus){  
                    			
	                    		resultElement2.description = transition.description;	
		                        result.AvailableActions.push(resultElement2);
                    		} else if('cnsp' === region.regionType || 'cnsp' === region.type){
								resultElement2.description = transition.description;	
		                        result.AvailableActions.push(resultElement2);
                    		}
                    	}else{

	                        resultElement2.description = transition.description;	
	                        result.AvailableActions.push(resultElement2);
                    	}
                    }
                }
            }

            // de-duplicate

            var allActionsIds = {};
            var allActions = [];

            trace.debug('before: AllActions.length: ' + result.AllActions.length);

            for (var index in result.AllActions) {

                var entry = result.AllActions[index];

                if (entry.id in allActionsIds) continue;

                allActionsIds[entry.id] = true;

                allActions.push(entry);
            }

            result.AllActions = allActions;

            trace.debug('after: AllActions.length: ' + result.AllActions.length);

            //

            request.results.push(result);

            return callback();
        });
    });
}

app.post('/apiv1.0/resourceQuery/validate', function (req, res) {

    trace.info('enter: post.apiv1-0.resourcequery.validate (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('post.apiv1-0.resourcequery.validate');

    var request = req.body;

    var errorInfo;
    var firstUri;
    var firstResourceType;
    var options;

    if (request.volumeStorageUri) {

        trace.info('volumeStorageUri: ' + request.volumeStorageUri);

        errorInfo = checkProperties(request, ['size']);

        firstUri = request.volumeStorageUri;

        firstResourceType = 'vs';

        options = {

            size: 0
        };
    }
	else if (request.uri) {

        trace.info('uri: ' + request.uri);

        errorInfo = checkProperties(request, ['size']);

        firstUri = request.uri;

        firstResourceType = 'saas';

        options = {

            size: 0
        };
    }
    else {

        errorInfo = checkProperties(request, ['instanceTypeUri', 'imageUri']);

        firstUri = request.instanceTypeUri;

        firstResourceType = 'vm';

        options = {

            cpuSpeed: 0,
            cpuCount: 0,
            localStorage: 0,
            ram: 0
        };
    }

    if (errorInfo) return res.send(errorInfo, errorInfo.code);

    trace.info('firstUri: ' + firstUri + ': firstResourceType: ' + firstResourceType);

    //return getResourceByUri(req.ownerId, firstUri, function (err, firstResource) {
		return getSubscriptionDetails(req.ownerId, subscriptionCollectionName,firstUri,channelCode,currencyCode, function (err, firstResource) {

        if (err) return res.send(err, err.code);

        if (firstResource.resourceType !== firstResourceType) {

            //var error = "invalid input: wrong resource type, should be '" + firstResourceType + "': uri: " + firstUri;
			var error = resourceMsg['0009'][languageCode] + firstResourceType + resourceMsg['0010'][languageCode] + firstUri;

            var errorInfo = errorInfoCode.getErrorInfo(400, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return res.send(errorInfo, errorInfo.code);
        }

        var result = getOptionsPricing(request, firstResource, options);

        // can return an errorInfo
        if (result.code) return res.send(result, result.code);

        if (firstResourceType === 'vs') {

            // result tidy up (& V1 compatibility)

            result.sizeLabel = result.size = options.size;

            result.volumeStorageUri = request.volumeStorageUri;

            trace.info('exit: post.validate (V1): result: ' + JSON.stringify(result, null, 2));

            return res.send(result);
        }
		else if (firstResourceType === 'saas') {

            // result tidy up (& V1 compatibility)

            result.sizeLabel = result.size = options.size;

            result.uri = request.uri;

            trace.info('exit: post.validate (V1): result: ' + JSON.stringify(result, null, 2));

            return res.send(result);
        }

        // IMAGE

        trace.info('imageUri: ' + request.imageUri);

        return getResourceByUri(req.ownerId, request.imageUri,channelCode, function (err, imageResource) {

            if (err) return res.send(err, err.code);

            if (imageResource.resourceType !== 'image') {

                //var error = "invalid input: wrong resource type, should be 'image': imageUri: " + request.imageUri;
				var error = resourceMsg['0028'][languageCode] + request.imageUri;

                var errorInfo = errorInfoCode.getErrorInfo(400, error);

                trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return res.send(errorInfo, errorInfo.code);
            }

            var vmRegion = firstResource.provider + '/' + firstResource.region;
            var imageRegion = imageResource.provider + '/' + imageResource.region;

            if (vmRegion !== imageRegion) {

                //var error = "invalid input: instance type and image must be in the same region: instance type region: " + vmRegion + ': image region: ' + imageRegion;
				var error = resourceMsg['0011'][languageCode] + vmRegion + resourceMsg['0012'][languageCode] + imageRegion;

                var errorInfo = errorInfoCode.getErrorInfo(400, error);

                trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                return res.send(errorInfo, errorInfo.code);
            }

            // now check the option values against the image (actually, softwareType) restrictions

            // TODO: consider only the first softwareType?

            var stUri = imageResource.softwareTypeUris[0];

            trace.info('check restrictions: stUri: ' + stUri);

            return getResourceByUri(req.ownerId, stUri,channelCode, function (err, stResource) {

                if (err) return res.send(err, err.code);

                if (stResource.restrictions) {

                    for (var optionName in options) {

                        if (optionName in stResource.restrictions) {

                            var optionValue = options[optionName];

                            var restriction = stResource.restrictions[optionName];

                            trace.info('optionName: ' + optionName + ': optionValue: ' + optionValue + ': restriction: ' + restriction);

                            restriction = restriction.replace('[', '');
                            restriction = restriction.replace(']', '');

                            var parts = restriction.split(',');

                            var error;

                            // min
                            if (parts[0] && _.isNumber(parts[0] - 0)) {

                                trace.info('restriction: ' + optionName + ': min: ' + parts[0]);

                                if (optionValue < parts[0]) {

                                    //error = 'restriction: less than min: ' + optionName + ': value: ' + optionValue + ': min: ' + parts[0] + ': uri: ' + stUri;
                                    error = resourceMsg['0013'][languageCode] + optionName + resourceMsg['0014'][languageCode] + optionValue + resourceMsg['0015'][languageCode] + parts[0] + resourceMsg['0010'][languageCode] + stUri;
                                }
                            }

                            // max
                            if (parts[1] && _.isNumber(parts[1] - 0)) {

                                trace.info('restriction: ' + optionName + ': max: ' + parts[1]);

                                if (optionValue > parts[1]) {

                                    //error = 'restriction: greater than max: ' + optionName + ': value: ' + optionValue + ': max: ' + parts[1] + ': uri: ' + stUri;
									error = resourceMsg['0016'][languageCode] + optionName + resourceMsg['0014'][languageCode] + optionValue + resourceMsg['0017'][languageCode] + parts[1] + resourceMsg['0010'][languageCode] + stUri;
                                }
                            }

                            if (error) {

                                var errorInfo = errorInfoCode.getErrorInfo(400, error);

                                trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                                return res.send(errorInfo, errorInfo.code);
                            }
                        }
                    }
                }

                // result tidy up (& V1 compatibility)

                result.cpuSpeedLabel = result.cpuSpeed = options.cpuSpeed;
                result.cpuCountLabel = result.cpuCount = options.cpuCount;
                result.localStorageLabel = result.localStorage = options.localStorage;
                result.ramLabel = result.ram = options.ram;

                result.instanceTypeUri = request.instanceTypeUri;
                result.imageUri = request.imageUri;

                trace.info('exit: post.validate (V1): result: ' + JSON.stringify(result, null, 2));

                return res.send(result);
            });
        });
    });
});

function getOptionsPricing(request, firstResource, options) {

    trace.info('enter: getOptionsPricing');

    // accumulate pricing

    var result = {

        totalUnitPrice: 0,
		listPrice: 0,
		displayCost: 0,
        CurrencyCode: 'USD',
        ChargeAmountUnit: '',
		channelCode: channelCode
    };

    // pricing - take these from the "base" SST

    result.CurrencyCode = firstResource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].CurrencyCode;
	result.ChargeAmountUnit = firstResource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmountUnit;

    // "base" SST
    result.totalUnitPrice += firstResource.subscriptionServiceTerm.SubscriptionServiceTermCharges.providerCost.Tierpricing[0].ChargeAmount;
	result.listPrice += firstResource.subscriptionServiceTerm.SubscriptionServiceTermCharges.listPrice.Tierpricing[0].ChargeAmount;
	result.displayCost += firstResource.subscriptionServiceTerm.SubscriptionServiceTermCharges.displayCost.Tierpricing[0].ChargeAmount;


    if (firstResource.options) {

        // configurable vm

        for (var optionName in options) {

            trace.info('optionName: ' + optionName);

            // some options can have fixed values
            // also: size = -1 for vs indicates configurable

            if ((optionName in firstResource) && (firstResource[optionName] >= 0)) {

                options[optionName] = firstResource[optionName];

                trace.info('optionName: ' + optionName + ': fixed value: ' + options[optionName]);

                continue;
            }

            if (firstResource.options[optionName]) {

                // if there's an option, the value must be provided in the JSON

                if (!(optionName in request)) {

                    //var error = "invalid input: required option does not have a value: " + optionName;
                    var error = resourceMsg['0018'][languageCode] + optionName;

                    var errorInfo = errorInfoCode.getErrorInfo(400, error);

                    trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return errorInfo;
                }

                // NOTE: the "- 0" converts from string to number

                var optionValue = request[optionName] - 0;

                trace.info('optionValue: ' + optionValue);

                // BEGIN: GCM-2007: alternate format for options

                if (firstResource.options[optionName].prices) {

                    var optionFound = false;

                    for (var index in firstResource.options[optionName].prices) {

                        var entry = firstResource.options[optionName].prices[index];

                        if ((entry.value - 0) === optionValue) {

                            result.totalUnitPrice += entry.SubscriptionServiceTermCharges[0].ChargeAmount;
 	                        result.listPrice += entry.SubscriptionServiceTermCharges[0].ChargeAmount;
							result.displayCost += entry.SubscriptionServiceTermCharges[0].ChargeAmount;

                            trace.info('optionName: ' + optionName + ': optionValue: ' + optionValue + ': totalUnitPrice: ' + result.totalUnitPrice);
							trace.info('optionName: ' + optionName + ': optionValue: ' + optionValue + ': listPrice: ' + result.listPrice);
							trace.info('optionName: ' + optionName + ': optionValue: ' + optionValue + ': displayCost: ' + result.displayCost);

                            options[optionName] = optionValue;

                            optionFound = true;

                            break;
                        }
                    }

                    if (optionFound) continue;     // next option

                    // option was not found

                    //var error = 'invalid input: option: ' + optionName + ': value: ' + optionValue + ': valid values: ' + firstResource.options[optionName].label;
					var error = resourceMsg['0019'][languageCode] + optionName + resourceMsg['0014'][languageCode] + optionValue + resourceMsg['0020'][languageCode] + firstResource.options[optionName].label;

                    var errorInfo = errorInfoCode.getErrorInfo(400, error);

                    trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return errorInfo;
                }

                // END: GCM-2007: alternate format for options

                // assumes shape of JSON...

                var min;
                var max;
                var interval;

                var intervalPrice;

                try {

                    min = firstResource.options[optionName].min.value - 0;
                    max = firstResource.options[optionName].max - 0;
                    interval = firstResource.options[optionName].interval.value - 0;

                    trace.info('min: ' + min + ': max: ' + max + ': interval: ' + interval);

                    // pricing
					var minTotalUnitPrice = result.totalUnitPrice * min;
					var minListPrice = result.listPrice * min;
					var minDisplayCost = result.displayCost * min;

                    trace.info('totalUnitPrice: ' + result.totalUnitPrice + ': minTotalUnitPrice: ' + minTotalUnitPrice);
					trace.info('listPrice: ' + result.listPrice + ': minListPrice: ' + minListPrice);
					trace.info('displayCost: ' + result.displayCost + ': minDisplayCost: ' + minDisplayCost);

                    intervalPrice = firstResource.options[optionName].interval.SubscriptionServiceTermCharges[0].ChargeAmount;

                    trace.info('intervalPrice: ' + intervalPrice);
                }
                catch (exception) {

                    //var error = 'exception processing options: ' + exception.name + ': ' + exception.message;
					var error = resourceMsg['0021'][languageCode] + exception.name + ': ' + exception.message;

                    var errorInfo = errorInfoCode.getErrorInfo(500, error);

                    trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    trace.info('exception: firstResource: ' + JSON.stringify(firstResource, null, 2));

                    trace.info('exception: request: ' + JSON.stringify(request, null, 2));

                    return errorInfo;
                }

                var found = false;

                if (optionValue < min || optionValue > max) {

                    trace.info('out of bounds');

                    found = false;
                }
                else {

                    // check if on interval boundary

                    var adjustedOptionValue = optionValue - min;

                    trace.info('adjustedOptionValue: ' + adjustedOptionValue);

                    var remainder = adjustedOptionValue % interval;

                    if (remainder) {

                        trace.info('not on interval: remainder: ' + remainder);

                        found = false;
                    }
                    else {

                        found = true;

                        var numberOfIntervals = adjustedOptionValue / interval;

                        trace.info('numberOfIntervals: ' + numberOfIntervals);

                        /*result.totalUnitPrice += numberOfIntervals * intervalPrice;
						result.listPrice += numberOfIntervals * intervalPrice;
						result.displayCost += numberOfIntervals * intervalPrice;*/
						result.totalUnitPrice = (numberOfIntervals * result.totalUnitPrice) + minTotalUnitPrice;
						result.listPrice = (numberOfIntervals * result.listPrice) + minListPrice;
						result.displayCost = (numberOfIntervals * result.displayCost) + minDisplayCost;
                    }
                }

                if (!found) {

                    //var error = 'invalid input: option: ' + optionName + ': value: ' + optionValue + ': min: ' + min + ': max: ' + max + ': interval: ' + interval;
					var error = resourceMsg['0019'][languageCode] + optionName + resourceMsg['0014'][languageCode] + optionValue + resourceMsg['0015'][languageCode] + min + resourceMsg['0017'][languageCode] + max + resourceMsg['0022'][languageCode] + interval;

                    var errorInfo = errorInfoCode.getErrorInfo(400, error);

                    trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

                    return errorInfo;
                }

                options[optionName] = optionValue;

                trace.info('optionName: ' + optionName + ': optionValue: ' + optionValue);
            }
            else if (optionName in request) {

                options[optionName] = request[optionName];
            }
        }
    }
    else {

        for (var optionName in options) {

            trace.info('optionName: ' + optionName);

            if ((optionName in firstResource) && (firstResource[optionName] >= 0)) {

                options[optionName] = firstResource[optionName];

                trace.info('optionName: ' + optionName + ': fixed value: ' + options[optionName]);
            }
        }
    }

    trace.info('exit: getOptionsPricing: options: ' + JSON.stringify(options, null, 2));

    result.totalUnitPrice = result.totalUnitPrice.toFixed(2);
    result.listPrice = result.listPrice.toFixed(2);
	result.displayCost = result.displayCost.toFixed(2);

    return result;
}

app.get('/apiv1.0/resourceQuery/subscription', function (req, res) {

    trace.info('enter: get.subscription (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resourcequery.subscription');

    var resourceUri;
	var extReferenceId;
    var optionParameters;
    // for now, only 'uri' is accepted for the query

    if (req.query.uri) {

        resourceUri = req.query.uri.toLowerCase();
    }

    trace.info('resourceUri:@@@@@@@@' + resourceUri);

   var query={
		//resourceUri:req.query.uri+ '&channelCode=' + channelCode + '&currencyCode=' + currencyCode
		resourceUri:req.query.uri ,
		channelCode:channelCode,
		currencyCode:currencyCode

	};
		trace.info('query@@@@@@@@@@@@@@@@@@@@@@@@@@' +JSON.stringify(query));
			trace.info('subscriptionCollectionName :' + subscriptionCollectionName + ': query :' + JSON.stringify(query,null,2) + ': READ_LIMIT :' + READ_LIMIT);
	 return openMongoCode.retrieveCommon(subscriptionCollectionName, query, READ_LIMIT, function (err, results) {
		 trace.info('The results >>'+results);
			if(err){
				return res.send(err);
			}
			trace.info("The results are:=>"+JSON.stringify(results));
			var notFound = false;
			if(results.length<=0){
				notFound=true;
			}

			if (notFound ) {

            var error = 'subscription not found for : resourceUri: ' + resourceUri + ' with channelCode ' + channelCode + ' with currency ' + currencyCode;

            var errorInfo = errorInfoCode.getErrorInfo(404, error);

            trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

            return res.send(errorInfo);
        }
			/*  var data = result[0];
			 if (result.length>0 && data.extReferenceId) {
			    extReferenceId = data.extReferenceId;
			}
			if (result.length>0 && data.optionParameters) {
			    optionParameters = data.optionParameters;
		    }
			delete data._id;  */
			trace.info('the subscription is @@@:'+JSON.stringify(results[0].subscriptionServiceTerm));
			if (results.extReferenceId) {
			extReferenceId = results.extReferenceId;
			}
			if (results.optionParameters) {
				optionParameters = results.optionParameters;
			}
			/* var converted = {
				channelCode: channelCode,
				currencyCode: currencyCode,
				subscriptionServiceTerm: data.subscriptionServiceTerm,
				uri: resourceUri,
			    extReferenceId: data.extReferenceId,
				optionParameters: data.optionParameters
			}; */
			
			var converted = {
				channelCode: channelCode,
				currencyCode: currencyCode,
				subscriptionServiceTerm: results[0].subscriptionServiceTerm,
				resourceUri: resourceUri,
			    extReferenceId: extReferenceId,
				optionParameters: optionParameters
			};

			trace.info("Subscription Response =>"+JSON.stringify(converted));

            return res.send(converted);
    });
  /*  return getResourceByUri(req.ownerId, query, function (err, result) {

        if (err) return res.send(err, err.code);
		if (result.extReferenceId) {
			extReferenceId = result.extReferenceId;
		if (result.optionParameters) {
			optionParameters = result.optionParameters;
		}
		}
        var converted = {

            //specialOffer: 'true',
            subscriptionServiceTerm: result.subscriptionServiceTerm,
            uri: resourceUri,
			extReferenceId: extReferenceId,
			l
        };

        return res.send(converted);
    });*/
});

// GCM-1428
app.get('/apiv1.0/resource/providers/capabilities/imageUploadSupported', function (req, res) {

    trace.info('enter: get.resource.providers.capabilities.imageuploadsupported (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resource.providers.capabilities.imageuploadsupported');

    var query = {

        // NOTE: *not* imageUploadSupported!
        imageSupportedFormat: { $exists: true }
    };

    // GCM-2364

    if (req.query.imageType) {

		var query = {

        imageSupportedFormat: {

			  $elemMatch: {

					imageType: req.query.imageType.toLowerCase()
				}
			}
		};
	}

	if (req.query.uploadType) {

		query.uploadType = req.query.uploadType.toLowerCase();
    }

    var readLimit = 9999;

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.resource.providers.capabilities.imageuploadsupported: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var propertyName = 'channels.' + channelcode;

    query[propertyName] = true;

    return openMongoCode.retrieveCommon(regionsCollectionName, query, readLimit, function (err, regions) {

        if (err) return res.send(err, err.code);

        trace.info('regions.length: ' + regions.length);

        // key is provider name
        var providers = {};

        var result = [];

        for (var index in regions) {

            var region = regions[index];

            if (!(region.providerName in providers)) {

                var provider = {

                    provider: region.providerName,
                    uploadType: region.uploadType,
                    imageCopySupport: region.imageCopySupport,
                    regions: []
                };

                providers[region.providerName] = provider;

                result.push(provider);
            }

            var regionEntry = {

                imageSupportedFormat: region.imageSupportedFormat,
                name: region.Name,
                displayName: region.location
            };

            providers[region.providerName].regions.push(regionEntry);
        }

        return res.send(result);
    });
});

// GCM-5025

app.get('/apiv1.0/resource/providers/capabilities/imageCopySupport', function (req, res) {

    trace.info('enter: get.resource.providers.capabilities.imageCopySupport (V1): ownerId: ' + req.ownerId + ': source: ' + req.query.source);

    countCall('get.apiv1-0.resource.providers.capabilities.imageCopySupport');

    var query = {


        imageCopySupport: { $exists: true }
    };



    var readLimit = 9999;

    // GCM-1627: add channelcode

    var channelcode = getChannelCodeForUser(req.ownerId);

    if (!channelcode) {

        //var errorInfo = errorInfoCode.getErrorInfo(500, 'channel code not found for user: ownerId: ' + req.ownerId);
        var errorInfo = errorInfoCode.getErrorInfo(500, resourceMsg['0004'][languageCode] + req.ownerId);

        trace.error('exit: get.resource.providers.capabilities.imageCopySupport: ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return res.send(errorInfo, errorInfo.code);
    }

    var propertyName = 'channels.' + channelcode;

    query[propertyName] = true;

    return openMongoCode.retrieveCommon(regionsCollectionName, query, readLimit, function (err, regions) {

        if (err) return res.send(err, err.code);

        trace.info('regions.length: ' + regions.length);

        // key is provider name
        var providers = {};

        var result = [];

        for (var index in regions) {

            var region = regions[index];

            if (!(region.providerName in providers)) {

                var provider = {

                    provider: region.providerName,
					imageCopySupport: region.imageCopySupport,
                    regions: []
                };

                providers[region.providerName] = provider;

                result.push(provider);
            }

            var regionEntry = {

                name: region.Name,
                displayName: region.location
            };

            providers[region.providerName].regions.push(regionEntry);
        }

        return res.send(result);
    });
});

// END: V1 compatibility layer

// END: REST API

// BEGIN: common functions

// add the query options to the query (filter by)
function addQueryOptions(req, queryOptions, query) {

    for (var index in queryOptions) {

        var optionBase = queryOptions[index];
        var optionIs = optionBase + 'Is';
        var optionIsNot = optionBase + 'IsNot';

        if (optionIs in req.query) {

            query[optionBase] = req.query[optionIs].toLowerCase();
        }
        else if (optionIsNot in req.query) {

            query[optionBase] = { $ne: req.query[optionIsNot].toLowerCase() };
        }
    }

    // GCM-1176: extend the properties by which we can query (max. 5)

    for (var i = 0; i < 5; i++) {

        var propertyTag = 'queryProperty' + i;
        var valueIsTag = 'queryValueIs' + i;
        var valueIsNotTag = 'queryValueIsNot' + i;

        if (propertyTag in req.query) {

            var queryProperty = req.query[propertyTag];

            trace.debug('propertyTag: ' + propertyTag + ': queryProperty: ' + queryProperty);

            if (valueIsTag in req.query) {

                var queryValueIs = req.query[valueIsTag];

                trace.debug('valueIsTag: ' + valueIsTag + ': queryValueIs: ' + queryValueIs);

                query[queryProperty] = queryValueIs;
            }
            else if (valueIsNotTag in req.query) {

                var queryValueIsNot = req.query[valueIsNotTag];

                trace.debug('valueIsNotTag: ' + valueIsNotTag + ': queryValueIsNot: ' + queryValueIsNot);

                query[queryProperty] = { $ne: queryValueIsNot };
            }
        }
    }
}

function addDateRanges(req, query) {

    // original: created
    var errorInfo = addDateRangesTag(req, query, 'from', 'to', 'created');

    if (errorInfo) return errorInfo;

    // GCM-908: updated
    errorInfo = addDateRangesTag(req, query, 'updatedFrom', 'updatedTo', 'updated');

    return errorInfo;
}

// returns errorInfo if it fails, null if OK
function addDateRangesTag(req, query, tagFrom, tagTo, queryPropertyName) {

    trace.debug('enter: addDateRangesTag: tagFrom: ' + tagFrom + ': tagTo: ' + tagTo + ': queryPropertyName: ' + queryPropertyName);

    var dateRange = {};

    dateRange[tagFrom] = baseDate;
    dateRange[tagTo] = new Date();

    // NOTE: need to pass Date inside an Object because Date is passed by value

    var errorInfo = addDateRange(req, tagFrom, dateRange);

    if (errorInfo) return errorInfo;

    var errorInfo = addDateRange(req, tagTo, dateRange);

    if (errorInfo) return errorInfo;

    trace.debug('dateRange.from: ' + dateRange[tagFrom].toISOString() + ': dateRange.to: ' + dateRange[tagTo].toISOString());

    if (dateRange[tagTo] <= dateRange[tagFrom]) {

        //var error = '<' + tagTo + '> date must be greater than <' + tagFrom + '> date: ' + tagTo + ': ' + dateRange[tagTo].toISOString() + ': ' + tagFrom + ': ' + dateRange[tagFrom].toISOString();
        var error = '<' + tagTo + resourceMsg['0024'][languageCode] + tagFrom + resourceMsg['0025'][languageCode] + tagTo + ': ' + dateRange[tagTo].toISOString() + ': ' + tagFrom + ': ' + dateRange[tagFrom].toISOString();

        var errorInfo = errorInfoCode.getErrorInfo(400, error);

        return errorInfo;
    }

    query[queryPropertyName] = { $gte: dateRange[tagFrom], $lte: dateRange[tagTo] };

    return null;
}

// returns errorInfo if it fails, null if OK
function addDateRange(req, tag, dateRange) {

    if (!req.query[tag]) return null;

    trace.info('addDateRange: ' + tag + ': ' + req.query[tag]);

    var timestamp = Date.parse(req.query[tag]);

    trace.debug('timestamp: ' + timestamp);

    // NOTE: if we use datejs this needs to change!

    if (isNaN(timestamp)) {

        //var error = 'invalid date string: ' + tag + ': ' + req.query[tag];
        var error = resourceMsg['0026'][languageCode] + tag + ': ' + req.query[tag];

        var errorInfo = errorInfoCode.getErrorInfo(400, error);

        return errorInfo;
    }

    var tagDate = new Date(req.query[tag]);

    trace.debug('tagDate: ' + tagDate.toISOString());

    dateRange[tag] = tagDate;

    return null;
}

function checkProperties(inputObject, propertyList) {

    //trace.debug('checkProperties: inputObject: ' + JSON.stringify(inputObject, null, 2));

    //trace.debug('checkProperties: propertyList: ' + propertyList);

    for (var index in propertyList) {

        //trace.debug('index: ' + index);

        if (propertyList[index] in inputObject) continue;

        //var error = 'invalid input: missing property: ' + propertyList[index];
        var error = resourceMsg['0027'][languageCode] + propertyList[index];

        var errorInfo = errorInfoCode.getErrorInfo(400, error);

        trace.info('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

        return errorInfo;
    }
}

// END: common functions

function initializeMongo(callback) {

    return openMongoCode.openMongo('resourcesv2', function (err) {

        if (err) {

            trace.error('PROCESS EXIT: cannot open database: err: ' + JSON.stringify(err, null, 2));

            process.exit(-1);
        }

        var collectionSpecs = [

            {
                collectionName: resourcesCollectionName,
                index: { resourceUri: 1 }
            },

            {
                collectionName: regionsCollectionName,
                index: { regionUri: 1 }
            }
        ];

        // TODO: more work needed on indexes

        return openMongoCode.createCollections(collectionSpecs, function (err) {

            return callback(err);
        });
    });
}

// background task that loops writing the metrics to a file
function backgroundWriteMetrics() {

    // GCM-1429: resourcesv2 metrics

    metrics.writeDateUtc = new Date();
    metrics.writeDate = metrics.writeDateUtc.toLocaleString();

    fs.writeFileSync(metricsFilename, JSON.stringify(metrics, null, 2));

    //

    return setTimeout(backgroundWriteMetrics, metricsIntervalInMsec);
}

// background task to update the vpa pricing
/*function backgroundVPAUpdate() {

    var vpapush = require('../resourcesv2/vpabackgroundjob.js');
	if (vpaconfig.testMode) {

        trace.info('TEST MODE: interval is 10 secs');
        vpaIntervalInMsec = 10 * 1000;

		vpaconfig.testMode = false;
    }
    else {

        vpaIntervalInMsec = vpaconfig.intervalInMinutes * 60 * 1000;
    }
	vpapush.VPAJob(vpaconfig.resourcePath, vpaconfig.vpaPath, function (err, result) {
	//console.log('testeeupdateVPAeree');
		if (err)
			return callback(err, '');

		return callback('', result);

	});

    return setTimeout(backgroundVPAUpdate, vpaIntervalInMsec);
}*/

// service initialization

var main = function () {

    return initializeMongo(function (err) {

        initializeServer();

        trace.info('resourcesv2 service running: err: ' + JSON.stringify(err, null, 2));
    });
};

// Launch server

// to support iisnode

function initializeServer() {
	
 		/*commonreg.getRegistry({ servicename:"resource"},function(err,data){
			if (err) 
				return trace.info(err);
			else
				{
					//trace.info('getRegistry data:::::::::::::::::::::::' + JSON.stringify(data));
					cjson.extend(true,config, data);		
				}			
		});*/
		

    port = process.env.PORT;

    if (port === undefined) {

        port = config.port;

        trace.info('### console mode: ' + port);
    }

    app.listen(port);

    trace.info('resourcesv2 server listening on port: ' + port);
}

main();

backgroundWriteMetrics();

//backgroundVPAUpdate();

