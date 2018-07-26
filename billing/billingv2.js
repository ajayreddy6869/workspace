// Copyright (c) 2013 ComputeNext Inc, Bellevue, WA. All rights reserved.
// billingv2.js

//Common TODO's
//TODO Implement new Auth Model
//TODO New Auth Model - no need as of now for payment
// TODO change all the rest serices to common restServices file

process.env.NAME = "billingv2";     // the process name - for tracing

// BEGIN: initialize tracing
var cjson = require('cjson');
var yaml_config = require('node-yaml-config');
var yamlfiles = cjson.load(__dirname + '/loadyamlinput.json');
yamlfiles.directoryPath = __dirname;
var config = require('../common/loadyamlfiles').loadYamlFiles(yamlfiles);
var config1 = yaml_config.load(__dirname + '/invoicing.yaml');
var queueConfig = yaml_config.load('../common/queueConfig.yaml');
var couponConfig = yaml_config.load(__dirname + '/autoApplyCoupon.yaml');
var authConfig = yaml_config.load('../common/auth.yaml');
var auth = require('../common/auth').auth;
var auth = require('../common/auth').auth;
var trace = require('cnextcommon').ftrace2(config.traceLevel);
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
// END: initialize tracing

// project files
var errorInfoCode = require('../common/errorInfo');
var mysql = require('./mysqlrestService.js');
var mysqlPopulateResourceUsage =  require('./mysql.js');
var queuemysql = require('./queuemysql.js');
var subscriptiondatamysql = require('./subscriptionPushApiMysql.js');
var exports = require ('./billingInformationApiMySql.js');
var payment = require ('./userPaymentInfoApiMysql.js');
var usagemysql = require('./usageInfoApiMysql.js');
var dbconnection = require('./mysqlconnection');
var paymentAuthServiceMysql = require('./paymentAuthServiceMysql.js');
var paymentVerifyServiceMysql = require('./paymentVerifyServiceMysql.js');
var coupons = require ('./couponCodesApiMySql.js');
var creditCardMysql = require ('./creditCardServiceMySql.js');
var initiateresourceUsage = require('./initiateresourceUsage.js');
var paymentRefundServiceMysql = require('./paymentRefundServiceMysql.js');
var invoices = require ('./providerInvoicesMySql.js');
var restservices = require('../common/rest-client.js');
var exposeToDataMart = require('./exposeToDataMart');
var invoiceMailAttachment = require('./invoiceMailAttachment.js');
var reconexecution = require('./reconexecution.js');
var feedNotificationJob = require('./feedNotificationJob.js')
var paymentCollectionMySql = require ('./paymentCollectionMySql.js');
var invoiceNotificationMysql = require ('./invoiceNotificationMysql.js');
var invoiceNotificationJob = require('./invoiceNotificationJob.js');
var invoiceconfig = yaml_config.load(__dirname + '/invoicing.yaml');
var approvedinvoices = require ('./approvedinvoices.js');
// packages
var uuid = require('node-uuid');
var promise = require('bluebird');
var amqp = require('amqp');
var fs = require("fs");
var http = require('http');
var express = require("express");
var async = require("async");
var query = require('querystring');
var querystring = require('querystring');
var url_parse = require('url').parse;
var qs_parse  = require('querystring').parse;
var nodemailer = require("nodemailer");
var parseGuid = require('cnextcommon').parseGuid;
var _ = require('underscore');
var roleHelperCode = require('../common/roleHelper');
var intl = require('intl');
var pdf = require('html-pdf');
var json2csv = require('json2csv');
var moment = require('moment');
var validate = require("json-schema").validate;     // schema validation	
var request = require("request");

var Joi = require('joi');
var joiValidate = promise.promisify(Joi.validate);
var couponSchemas = require ('./schemas/couponSchemas.js');

//promisified the existing functionalities
var createsubscriptiondependency = promise.promisify(subscriptiondatamysql.createsubscriptiondependency);
var updateAddOnAttributes = promise.promisify(subscriptiondatamysql.updateAddOnAttributes);

// project files
var put_userbillinginfo = require('./json-data/put_userbillinginfo.json');


// BEGIN: VARIABLES

// for /status
var startTime = new Date();

// the exchange for the message queue
var exchange;

// message count
var messageNumber = 0;
var messagesJson = cjson.load(__dirname + '/messages.json');
var resourceMsg=JSON.parse(JSON.stringify(messagesJson));

// END: VARIABLES

// BEGIN: configuration parameters
trace.info('port: ' + config.port);
trace.info('mqHost: ' + queueConfig.mqHost);
trace.info('mqPort: ' + queueConfig.mqPort);
trace.info('mqLogin: ' + queueConfig.mqLogin);
//trace.debug('mqPassword: ' + config.mqPassword);
trace.info('mqVHost: ' + config.mqVHost);
trace.debug('mqExchangeName: ' + config.mqExchangeName);
trace.debug('mqQueueName: ' + config.mqQueueName);
trace.debug('mqBindingKey: ' + config.mqBindingKey);


// END: configuration parameters

// BEGIN: express app for REST service

application_root = __dirname,
    express = require("express"),
    path = require("path");

var app = express();

// Mysql DB connection initialization

var conn = '',conn_err = '';

dbconnection.execute(function(err,response) {
 conn = response;
 conn_err = err;
});

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
// STATUS

// CFM-6577
var statusCount = 0;

// GET service status
app.get('/billing/status', function (req, res) {

    if (statusCount < 20 || !(statusCount % 100)) {
        trace.info('enter: /billing/status: ' + statusCount++);
    }
    else {
        trace.debug('enter: /billing/status: ' + statusCount++);
    }

    var status = {};

    status.Name = 'billing';
    status.Description = 'ComputeNext Billing Service';
    status.UtcCurrentTime = new Date();
    status.CurrentTime = status.UtcCurrentTime.toString();
    status.Port = port;
    status.UtcStartTime = startTime;
    status.StartTime = status.UtcStartTime.toString();
    status.channelcode = req.query.channelCode;
	if(!req.query.channelCode){
		req.query.channelCode = 'CSP';
	}

    res.send(status);
});

// To expose the queue messages (stored in mysql) to datamart
app.get('/billing/queuemessagedata', function (req, res) {

    var environment = req.query.environment;
    getQueueMessageData(environment, conn).then(function(getQueueMessageDataResult){

        res.send(getQueueMessageDataResult);
    }).catch(function(err){

        trace.warn ('Error occured in getQueueMessageDataQuery');
        if(err.stack){
            trace.warn(err.stack);
        }
        return res.send({'error' : err});
    });
});

function getQueueMessageData(environment, conn){

    return new promise(function(fulfill, reject){

        exposeToDataMart.getQueueMessageDataQuery(environment, conn).then (function(getQueueMessageDataQueryResult){

            return fulfill(getQueueMessageDataQueryResult);

        }).catch(function(err){
            trace.warn ('Error occured in getQueueMessageDataQuery');
            if(err.stack){
                trace.warn(err.stack);
            }
            return reject(err);

        });
    });
};

// TO-DO OBS development
// api exposed to push the subscriptiondata into billing service (mysql) from resource query - (author: suresh)
app.post('/billing/meteringusagedetails', function (req, res) {

	trace.info('enter: post.meteringUsage Data');
	trace.info("req.body >>>>>>>>"+req.body);
	var array1 = req.body;
	trace.info(array1.length);

    if(req.query && req.query.RU == 'true') {
    	mysqlPopulateResourceUsage.getAllDiscrepancy('', '', conn, function(err, result) {
			if (err) {
				trace.error('getAllDiscrepancy Error : '+err);
			}
			else {
				return insertingMeteringUsageInRU(result).then(function (output) {
		            trace.info(output);
		            return res.send(output);
		        }).catch(function onReject(err) {
		            return handleRestError(req, res, err, null);
		        }).catch(function (error) {
		            return handleRestError(req, res, null, error);
		        }); // then close
			}
		});
    }else{
        return insertingMeteringUsage(array1, 0, function(errLopping, resultLooping){
            var Status = 'Processed';
            if(errLopping){
                trace.error('Error Occurred , Error message : '+errLopping);
                Status = 'Error Occurred , Error message : '+errLopping;
                res.send(JSON.stringify(Status));
            }
            else{
                res.send(JSON.stringify(Status));
            }
        });
    }
});


function insertingMeteringUsageInRU (arrayRecords){

    return new promise(function(fulfill,reject) {
        promise.reduce(arrayRecords, function (finalRes, discrepancyRecord) {
        	trace.info("discrepancyRecord >>>>>"+JSON.stringify(discrepancyRecord));
        	return mysqlPopulateResourceUsage.getPriceDetailsByProviderInstanceId(discrepancyRecord.ProviderInstanceId,conn).then(function(priceListResult){
        		if(priceListResult.length > 0){
        			trace.info("priceListResult >>>>>"+JSON.stringify(priceListResult));
    				trace.info("priceListResult length>>>>>"+priceListResult.length);
    				return chargeCustomer(priceListResult, discrepancyRecord).then(function(result){
    					trace.info("chargeCustomer response >>>>>"+JSON.stringify(result));
    					return mysqlPopulateResourceUsage.updateMeteringUsageInRU(result, conn).then(function (miniDocOutput) {
    		                trace.info(miniDocOutput);
    		                if(finalRes != undefined){
    		                	finalRes.push(miniDocOutput);
    		                }
    		                return finalRes;
    		            });
    				});
        		}
			});
        }, []).then(function (total) {
            trace.info(JSON.stringify(total));
            return fulfill(total);
        }).catch(function onReject(err) {
            trace.warn('FAILED', err);
            return reject(err);
        }).catch(function (error) {
            trace.error(error);
            return reject(error);
        });
    });
}


function insertingMeteringUsage(arrayRecords,j,callback){
	if(j< arrayRecords.length){
		if(arrayRecords[j].MeteringUsageJobId && arrayRecords[j].ResourceInstanceId && arrayRecords[j].MeteringUsage
		&& arrayRecords[j].UsageStartTime && arrayRecords[j].UsageEndTime && arrayRecords[j].OwnerId){

			return mysqlPopulateResourceUsage.updateMeteringUsageInBilling(arrayRecords[j],conn,function(errMySql, resultMySql){
				if (errMySql){
					callback('Error occurring in MySQL',null);
				}
				else{
					if (resultMySql){
						return insertingMeteringUsage(arrayRecords, j+1, function(errLopping, resultLooping){

							callback(errLopping,resultLooping);

						});
					}
					else{
						callback('Error Occurred',null);
					}
				}
			});
		}
		else{
			callback('Parameters not correct',null);
		}
	}
	else{
		trace.info('No more Pending records');
		return callback(null,'Processed');
	}

}
//OBS development

//Charge the discrepancy to customer
function chargeCustomer(priceList, discrepancyRecord){

	return new promise(function(fulfill,reject) {
		//trace.info('chargeCustomer >>>>>'+priceList.length);
		var vpaParams = {};
		var reconObj = {}
		vpaParams.type = 'reconcile';
		for(var h=0; h<priceList.length; h++ ){
             if ( priceList[h].pricereferenceid == 3) {
            	 vpaParams.totalUnitPrice = priceList[h].chargeamount;
             }else{
            	 vpaParams.listPrice = priceList[h].chargeamount;
            	 vpaParams.resourceIdentifier = priceList[h].resourceuri;
                 vpaParams.ownerId = priceList[h].ownerid;
                 vpaParams.chargeUnit = priceList[h].chargeamountunit;
                 reconObj.UnitPrice = priceList[h].unitprice;
             }
         }

		reconObj.ProviderInstanceId = discrepancyRecord.ProviderInstanceId;
		reconObj.ChargeTypeDescription = 'descrepancy';
		reconObj.UsageStartTime = new Date();
		reconObj.UsageEndTime = new Date();
		reconObj.DifferenceQuantity = discrepancyRecord.DifferenceQuantity || 0;
		reconObj.DifferenceAmount = discrepancyRecord.DifferenceAmount || 0;

		var listPrice = Number(vpaParams.listPrice);
		var providerCost = Number(vpaParams.totalUnitPrice);
		var marginPercent =  ((listPrice-providerCost)/providerCost) * 100;
		var marginPercentRound = Math.round(marginPercent * 100)/100;

		trace.info('marginPercentRound >>>>>'+marginPercentRound);
		trace.debug('discrepancyRecord.Quantity     >>>>>' + reconObj.DifferenceQuantity);
		trace.debug('discrepancyRecord.UsageAmount  >>>>>' + reconObj.DifferenceAmount);

		if(reconObj.DifferenceQuantity > 0){
			vpaParams.listPrice = reconObj.DifferenceQuantity * listPrice;
			vpaParams.totalUnitPrice = reconObj.DifferenceQuantity * providerCost;
			return getVpaPriceOnApplicable(vpaParams).then(function(vpaPrice){
				trace.debug('vpaPrice : ' + vpaPrice);
				reconObj.DifferenceAmount = vpaPrice || vpaParams.listPrice;
				return fulfill(reconObj);
			});
		}else if(reconObj.DifferenceAmount > 0){
			var usageAmt = Number(reconObj.DifferenceAmount);
			if(marginPercentRound > 0){
				var marginOnAmt =  (usageAmt * marginPercentRound) / 100;
				usageAmt = usageAmt + marginOnAmt;
			}
			reconObj.DifferenceAmount = usageAmt;
			trace.debug('reconObj.DifferenceAmount  >>>>>' + usageAmt);
			return fulfill(reconObj);
		}
	});
}
app.post('/billing/sendapprovalmail', function(req, res){

approvedinvoices.sendapprovedemail('none','invoicenotificationstatus');
res.send({"MESSAGE":"SUCCESSFULLY SENT"});

})

// User Profile Updation
app.put('/billing/userinfo', function (req, res) {

	
	var userDetails = req.body;
	trace.info('enter: PUT user profile Data::' + JSON.stringify(userDetails));
	if(!userDetails.ownerId){
		trace.warn('ownerId_missing');
		res.statusCode = 400;
		res.send({err:'ownerId missing'});
	}

	getConfigByChannel(userDetails.ownerId).then(function(channelConfig){
		if(!channelConfig && !userDetails.channelCode){
			trace.warn('channelcode_unavailable');
			res.statusCode = 400;
			res.send({error : 'channelcode_unavailable'});
		} else if(userDetails.channelCode){
			return {channelCode:userDetails.channelCode};
		}else return channelConfig;
	}).then(function(channelConfig){

		var validation = validate(req.body, put_userbillinginfo);
		if (!validation.valid) {

			var message = validation.errors[0].property + ' ' + validation.errors[0].message;
			var errorInfo = 'invalid update: ' + message;
			//var errorInfo = resourceMsg['0009'][req.languageCode] + message;
			trace.error(errorInfo);
			return res.send(errorInfo);
		}
		userDetails.channelCode = channelConfig.channelCode;
		
		return updateUserProfileData(userDetails, function(errLopping, resultLooping){
			var Status = 'Processed';
			if(errLopping){
				trace.error('Error Occurred , Error message : '+errLopping);
				Status = 'Error Occurred , Error message : '+errLopping;
				res.send(JSON.stringify(Status));
			}
			else{
				if(userDetails.addressInfo) {

					if(typeof channelConfig.cniPaymentProviderInfoId !== 'undefined' && channelConfig.cniPaymentProviderInfoId != '')
						userDetails.addressInfo.paymentProviderInfoId = channelConfig.cniPaymentProviderInfoId;

					return mysqlPopulateResourceUsage.createDummyPayment(userDetails,conn,function(errMySql, resultMySql){
						if(errMySql){
							trace.warn('Error Occurred in updateUserInfo : '+errMySql);
							Status = 'Error Occurred , Error message : '+errMySql;
							res.send(JSON.stringify(Status));
						}
						else{
							res.send(JSON.stringify(Status));
						}
					});
				}
				res.send(JSON.stringify(Status));
			}
		});
	});

});

function updateUserProfileData(userDetails,callback){
    if(userDetails.ownerId && userDetails.vatId == null){
        return mysqlPopulateResourceUsage.updateUserInfo(userDetails,conn,function(errMySql, resultMySql){
            if(errMySql){
                trace.warn('Error Occurred in updateUserInfo : '+errMySql);
                return callback(errMySql,null);
            }
            else{
                return callback(null,'Processed');
            }
        });

    }else if(userDetails.ownerId && userDetails.vatId && userDetails.vatId !== null){
		return exports.updateuserproperties(userDetails,conn,function(errMySql, resultMySql){
            if(errMySql){
                trace.warn('Error Occurred in updateUserInfo : '+errMySql);
                return callback(errMySql,null);
            }
            else{
                return callback(null,'Processed');
            }
        });

	}else{
        return callback('userId missing',null);
    }
}
// User Profile Updation


//ComputeNext REST API for Sending Email
app.post('/billing/email/send', function(req, res) {

	trace.info(':::::::::::::::::: enter: /billing/email/send ::::::::::::::::::');

    var mailReqOptions = { };
	    mailReqOptions.toEmailAddresses = req.body.toEmailList;
		mailReqOptions.ccEmailAddresses = req.body.ccFilteredList;
		mailReqOptions.bccEmailAddresses = req.body.bccEmailList;
		mailReqOptions.subject = req.body.subjectBody;
		mailReqOptions.messageBody = req.body.messageBody;

	trace.log('mailReqOptions : '+JSON.stringify(mailReqOptions));

	var Email = {};
	Email.messageSent = null;
	Email.errMsg = null;
	Email.failedRecipients = null;

	trace.info('mailReqOptions : '+JSON.stringify(mailReqOptions));

	if(validateEmail(mailReqOptions.toEmailAddresses) && validateEmail(mailReqOptions.ccEmailAddresses)) {

		if(mailReqOptions.subject && mailReqOptions.messageBody) {

			sentMail(mailReqOptions.toEmailAddresses, mailReqOptions.ccEmailAddresses, mailReqOptions.bccEmailAddresses, mailReqOptions.subject, mailReqOptions.messageBody);
		}
		else {
			trace.warn('Email subject/messageBody is/are empty !');
			Email.errMsg = 'Email subject/messageBody is/are empty !';
			Email.messageSent = 'false';
			res.send(Email);
		}
	}
	else {
		trace.warn('The given EmailID is wrong format!');
		Email.errMsg = 'The given EmailID is wrong format!';
		Email.messageSent = 'false';
		res.send(Email);
	}

	function sentMail(toEmailAddresses, ccEmailAddresses, bccEmailAddresses, subject, messageBody) {

		// create reusable transport method (opens pool of SMTP connections)
		var smtpTransport = nodemailer.createTransport("SMTP",{
			host: config.mailHost, // hostname
			secureConnection: false, // use SSL
			port: config.mailPort, // port for secure SMTP
			auth: {
				user: config.mailAuthUser,
				pass: config.mailAuthPassword
			}
		});

		// setup e-mail data with unicode symbols
		var mailOptions = {

			from: config.mailFrom, // sender address
			to: toEmailAddresses, // list of receivers
			bcc: config.maillBcc, // list of bcc
			subject: subject, // Subject line
			html:messageBody

		};

		trace.info('mailOptions : '+JSON.stringify(mailOptions));

		// send mail with defined transport object
		smtpTransport.sendMail(mailOptions, function(error, response) {

			if(error) {
				trace.warn("Error Message: "+error);
				Email.messageSent = 'false';
				Email.errMsg = error.data;
				res.send(Email);
			}
			else {
				trace.info("Response : " + JSON.stringify(response));
				trace.info("Response Message : " + response.message);
				trace.info("Failed Recipients : " + response.failedRecipients);
				trace.info('messageSent : '+Email.messageSent);
				Email.messageSent = 'true';
				Email.failedRecipients = response.failedRecipients;
				res.send(Email);
			}

			// if we don't want to use this transport object anymore, uncomment following line
			smtpTransport.close(); // shut down the connection pool, no more messages
		});
	}

	//Function to Check whether the given EmailID is valid or not
	function validateEmail(EmailAddresses) {

		trace.info('EmailAddresses : '+JSON.stringify(EmailAddresses));
		var emails = EmailAddresses.split(',');
		var email = null;
		trace.info('emails length : '+emails.length);
		for(i=0;i<emails.length;i++) {
			email = emails[i];
			trace.info('email '+i+': '+email);
			var re = /\S+@\S+\.\S+/;
			trace.info(re.test(email));
			if(re.test(email) == false) {
				return false;
			}
		}
		return true;
	}
});
// User Profile Updation
//Approve/ Disapprove invoices and send notification for disapproved invoices
app.post('/billing/updateApprovalStatus', function(req, res){
trace.info('/billing/updateApprovalStatus'+ JSON.stringify(req.body));
var requestparams =req.body;
exports.updateApprovalStatus(requestparams,conn, function(err,result) {
	trace.info('>>>>>>>>>'+JSON.stringify(result));
		if (err) res.send(err);
		var approvalstatus = result[0].approvalStatus;
		var ordernumber =  result[0].ordernumber;
			
		if(approvalstatus == 'disapproved'){

        var mailReqOptions = { };
	    mailReqOptions.toEmailAddresses = invoiceconfig.todisapprovedinvoice;
		mailReqOptions.ccEmailAddresses = invoiceconfig.ccdisapprovedinvoice;
		mailReqOptions.bccEmailAddresses = invoiceconfig.ccdisapprovedinvoice;
		mailReqOptions.subject = invoiceconfig.channelCode+' Invoice with id: '+ordernumber+' got rejected' ;
		mailReqOptions.messageBody = "<html><head><style>div.container{ width: 100%; border: 1px solid gray;}</style></head><body><header><h2><justify>"+ordernumber+"Invoice Disapproved</justify></h2></header><br> <h4>Hi Support Team,</h4>"+invoiceconfig.channelCode+" has rejected the Invoice with id: "+ordernumber+" due to some discrepancies in the data. Please get in touch with  "+invoiceconfig.channelCode+" Contact person and resolve the issues if any.<br><br>Best Regards,<br>"+invoiceconfig.channelCode+"</body></html>"
        trace.info('mailReqOptionsmailReqOptionsmailReqOptionsmailReqOptionsmailReqOptions'+JSON.stringify(mailReqOptions))
		sentMail(mailReqOptions.toEmailAddresses, mailReqOptions.ccEmailAddresses, mailReqOptions.bccEmailAddresses, mailReqOptions.subject, mailReqOptions.messageBody);
		 		trace.info('>>>>>>>>>'+approvalstatus);

		}
		
		//res.send(approvalstatus);
	trace.info(approvalstatus);
res.send(result[0])
	});

});
function sentMail(toEmailAddresses, ccEmailAddresses, bccEmailAddresses, subject, messageBody) {

		// create reusable transport method (opens pool of SMTP connections)
		var smtpTransport = nodemailer.createTransport("SMTP",{
			host: config.mailHost, // hostname
			secureConnection: false, // use SSL
			port: config.mailPort, // port for secure SMTP
			auth: {
				user: config.mailAuthUser,
				pass: config.mailAuthPassword
			}
		});

		// setup e-mail data with unicode symbols
		var mailOptions = {

			from: config.mailFrom, // sender address
			to: toEmailAddresses, // list of receivers
			bcc: config.maillBcc, // list of bcc
			subject: subject, // Subject line
			html:messageBody

		};
var Email = {};
	Email.messageSent = null;
	Email.errMsg = null;
		trace.info('mailOptions : '+JSON.stringify(mailOptions));

		// send mail with defined transport object
		smtpTransport.sendMail(mailOptions, function(error, response) {

			if(error) {
				trace.warn("Error Message: "+error);
				Email.messageSent = 'false';
				Email.errMsg = error.data;
				res.send(Email);
			}
			else {
				trace.info("Response : " + JSON.stringify(response));
				trace.info("Response Message : " + response.message);
				//trace.info("Failed Recipients : " + response.failedRecipients);
				trace.info('messageSent : '+Email.messageSent);
				Email.messageSent = 'true';
				//Email.failedRecipients = response.failedRecipients;
				//res.send(Email);
			}

			// if we don't want to use this transport object anymore, uncomment following line
			smtpTransport.close(); // shut down the connection pool, no more messages
		});
	}

//api to update renewal(subscription end date)date
app.post('/billing/updaterenewaldate', function(req, res){
 
 trace.info('enter billing/updaterenewaldate:req.body:'+JSON.stringify(req.body));

 var body = req.body;

 if(body && body.renewalDate && body.attributes && body.attributes.providerInstanceId
  && body.metadata && body.metadata.workloadId){
  
 var input = {}; 
 
 // input.renewalDate = req.body.renewalDate;
  input.providerInstanceId = req.body.attributes.providerInstanceId;
  input.workloadId = req.body.metadata.workloadId;
   var datearray = (req.body.renewalDate).split(".");
   var getdate = datearray[0];
  input.renewalDate  = moment(getdate).format('YYYY-MM-DD HH:mm:ss');
  trace.info('enter: get.billing.updaterenewaldate:::input parameters is ::::'+JSON.stringify(input));
  
  exports.updateRenewaldate(input, conn, function(err, result){
   if(err){
       res.send(err);
    }
		   	if (req.query.from && req.query.from == 'scheduler' && req.body.instanceId) {
		   		input.instanceId = req.body.instanceId;
				 
				 trace.info('enter updateprices:::input parameters is ::::'+JSON.stringify(input));
				 
				 exports.updateSubscriptionPrices(input, conn, function(err, result){
					   if(err){
					     trace.error(err);
					    }
						else if(result && result.workloadid){
							return updatepricesinworkload(result, function(err,updatedDetails){
								if (err){
									var errormessage = 'Error while updating prices in workload'+err;
									res.send(errormessage);
								}
								res.send(updatedDetails);
							});
						}
					   res.send(null, result);					  
					  });
			 }else{
     res.send(null, result);
			 }	  
  });
 }else{
  var errorInfo = errorInfoCode.getErrorInfo(400, 'Required info is not available');
  res.send(errorInfo);
 }
});

function updatepricesinworkload(workloadDetails,callback){
	return new promise (function (onfulfill, onreject) {
		var ownerid = workloadDetails.ownerid;
		var workloadid = workloadDetails.workloadid;
		var headers = {
			"Content-Type": "application/json",
			"ownerId":ownerid,
			"cn-services-internal":"resource:a491ccbd-ea0b-11e4-b6f6-000c298a79e5"
		};
		var optionsgetworkloadDetails = {
			host: config.authServiceHost,
			port: 8070,
			path: '/workload/updateprice/'+workloadid,
			method: 'GET',
			headers: headers
		};	
		return restservices.getCall(optionsgetworkloadDetails).then(function (workloadresp) {
					return onfulfill(workloadresp);
		}).catch(function (error) {
			trace.warn('common.Catch:' + error);
			if (error.stack) {
				trace.error(error.stack);
			}
			return onreject(error);
		}).error(function (err) {
			trace.error('all errors:' + err);
			if (err.stack) {
				trace.error(err.stack);
			}
			return onreject(err);
		});
	});	
}



// Get all invoicenumbers and dates(month and year )based on account id of loggedin

app.get('/billing/AccountInvoicesList', function (req, resp) {
	
	
	var accountId = req.query.ownerid;
	 if(accountId){
		 
		return exports.getaccounttypeByOwnerid(accountId,conn,function(result){
			
			if(result.accounttype != 'customer'){
				return exports.AccountInvoicesList(accountId,conn,function(resultMySql){
				//if(resultMySql.length > 0)
				resp.send(resultMySql);
				});
				
			}
			else if(result.accounttype == 'customer'){
				return exports.userInvoicesList(accountId,conn,function(resultMySql){
				//if(resultMySql.length > 0)
				resp.send(resultMySql);
				});
			}
	 else
		{resp.send({"result":{"success":false,"message":"No invoice numbers found for this ownerid"}})}
           
	 
	 });
	 }
	else{
				resp.respcode = 404;
				resp.send({"result":{"success":false,"message":"account Id required"}});
			}
	
});

// API TO GENERATE CSV FOR BBSS INVOICE for enduser login

app.get('/billing/userCSVinvoices', function (req, resp) {
	var ownerId = req.query.ownerId;
	 var month = req.query.month|| "00";
	 var year = req.query.year || "0000";
	 var requestpar = req.query;
	 if(ownerId &&  month && year){
	 //var paymentorderid = req.query.paymentorderid;
	
				var BillingInvoiceData = 'Invoice_data_';
				var currentTime = new Date();
				var dateStr = currentTime.toISOString().slice(0,10);//.replace(/-/g,"");
				var invoiceFile =  BillingInvoiceData +dateStr+ownerId;
				exports.billingInvoiceData(requestpar, conn).then(function(invoiceData) {   
					if(invoiceData.length > 0){
						return new promise(function(fulfill, reject){
								//Invoice Feed
								var fields=[];
								Object.keys(invoiceData[0]).forEach(function(key) {
												fields.push(key);
											});
								var invoiceCSV = json2csv({ data: invoiceData, fields: fields });
								
								resp.set('Content-Type', 'text/csv');
								resp.setHeader('Content-disposition', 'attachment; filename=invoiceCSV.csv');
								
								trace.info('file invoiceCSV >>'+invoiceCSV);
								resp.attachment(invoiceFile+'.csv');
								resp.status(200).send(invoiceCSV);
						});
					}
			})
	 }
	 else {
				resp.respcode = 404;
				resp.send({"result":{"success":false,"message":"paymentorderid required"}});
			}
});

app.put('/billing/updatecustomercreditlimit',function(req, res){
	
		trace.info('enter: put.billing.userbillinginfo.updatecustomercreditlimit'+JSON.stringify(req.body));
		var updatecustomercreditlimit = { };
		if(req.body.ownerId && req.body.CustomerCreditLimit){
		updatecustomercreditlimit.CustomerCreditLimit = req.body.CustomerCreditLimit;
		updatecustomercreditlimit.ownerId = req.body.ownerId;
		return exports.updateCustomerCreditLimit(updatecustomercreditlimit.CustomerCreditLimit, updatecustomercreditlimit.ownerId,conn,function(resultMySql){
				res.send('saved CustomerCreditLimit');
		
		});
		}
    });
	


// API TO GENERATE CSV FOR BBSS INVOICE for agent /reseller login
app.get('/billing/accountCSVinvoices', function (req, resp) {
	
	 var ownerId = req.query.ownerId;
	 var month = req.query.month|| "00";
	 var year = req.query.year || "0000";
	 var requestpar = req.query;
	 if(ownerId &&  month && year){
				var BillingInvoiceData = 'Account_Invoice_data_';
				var currentTime = new Date();
				var dateStr = currentTime.toISOString().slice(0,10);//.replace(/-/g,"");
				var invoiceFile =  BillingInvoiceData +dateStr+ownerId;
				exports.billingAccoutInvoiceData(requestpar, conn).then(function(invoiceData) {   
					if(invoiceData.length > 0){
						return new promise(function(fulfill, reject){
								//Invoice Feed
								var fields=[];
								Object.keys(invoiceData[0]).forEach(function(key) {
												fields.push(key);
											});
								var invoiceCSV = json2csv({ data: invoiceData, fields: fields });
								
								resp.set('Content-Type', 'text/csv');
								resp.setHeader('Content-disposition', 'attachment; filename=invoiceCSV.csv');
								
								trace.info('file invoiceCSV >>'+invoiceCSV);
								resp.attachment(invoiceFile+'.csv');
								resp.status(200).send(invoiceCSV);
						});
					}
			})
	 }
	 else {
				resp.respcode = 404;
				resp.send({"result":{"success":false,"message":"paymentorderid required"}});
			}
});



// API TO GENERATE PDF FOR AGENT COMMISSION
app.get('/billing/agent/generatepdf', function (req, resp) {
	
	
	var paymentorderid = req.query.paymentorderid;
	var customerId = req.query.customerid;
	trace.info(customerId+'>>>>>>>>>'+paymentorderid);
	
	
// Get Resources based commission details of the single customer based on customerId	
	
	if(paymentorderid && customerId){
					
		return exports.commisionclientBreakdown(conn,paymentorderid,customerId, function(errMySql, resultMySql){
			//trace.info('<<<<<<<<<<<<<<<<commisionclientBreakdown mysql result>>>>>>>>>>>'+JSON.stringify(resultMySql));	
			 
			 var resourcedetails = {};
			 if (resultMySql[0].length>0){
					 resourcedetails.Month= resultMySql[1][0].showdate;
					 resourcedetails.amount= resultMySql[1][0].amount;
					 resourcedetails.name= resultMySql[1][0].name;
					
			
					rowDetails = '';
					for (var x in resultMySql[0]){
					var row = '';
					row = '<tr>'+
					'<td>'+resultMySql[0][x].description+'</td>'+
					'<td>'+resultMySql[0][x].quantity+'</td>'+
					'<td>'+resultMySql[0][x].reconDescription+'</td>'+
					'<td>'+resultMySql[2][0].PropertyValue+resultMySql[0][x].revenue+'</td>'+
					'<td>'+resultMySql[0][x].commisionbase+'</td>'+
					'<td>'+resultMySql[2][0].PropertyValue+resultMySql[0][x].commision+'</td>'+
					'<tr/>';
					rowDetails = rowDetails + row;

					resourcedetails.description = resultMySql[0][x].description;
					resourcedetails.quantity = resultMySql[0][x].quantity;
					resourcedetails.reconDescription = resultMySql[0][x].reconDescription;
					resourcedetails.revenue = resultMySql[0][x].revenue;
					resourcedetails.commisionbase = resultMySql[0][x].commisionbase;
					resourcedetails.commision = resultMySql[0][x].commision;
				
					};
					
					invoiceMailAttachment.readingAgentXmltemplate(resourcedetails, function(err,populatedHtml){


								fs.writeFileSync('commisionclientBreakdown.html', populatedHtml, 'utf8');
									var html = fs.readFileSync('commisionclientBreakdown.html', 'utf8');

									var options = { format: 'Letter' };

								pdf.create(html, options).toFile(resultMySql[1][0].name+'.pdf', function(err, res) {
										  if (err) return console.log(err);
										  //var file = resultMySql[1][0].name.pdf ;
											trace.info('created pdf for commisionclientBreakdown');
										
											
													var file = path.join(__dirname, resultMySql[1][0].name+'.pdf');
													  resp.download(file, function (err) {
													  if (err) {
													   console.log("Error");
														
													   } else {
													     console.log("Success");
															  }
														 });
														});

					});
		    }else {
				resp.respcode = 404;
				resp.send({"result":{"success":false,"message":"Invalid Input Data"}});
			}
		})
	}
		
			
	
	
     // Get Customers List with monthly commission breakdown

	else if(paymentorderid && !customerId){
		
		var paymentorderId = req.query.paymentorderid;
				
			return exports.commisionMonthlyBreakdown(conn,paymentorderId,function(errMySql, resultMySql){
					
				//trace.info('commisionMonthlyBreakdown mysql result'+JSON.stringify(resultMySql));
				trace.info('Length>>>>>>>'+resultMySql[1].length);
			 if (resultMySql[1].length > 0){
				var customerdetails = {};
					customerdetails.Month= resultMySql[1][0].showdate;
					customerdetails.Totalamount= resultMySql[1][0].amount;
					
				
				rowDetails = '';
				for (var x in  resultMySql[0]){
					var row = '';
					row = '<tr>'+
					'<td>'+resultMySql[0][x].accountname+'</td>'+
					'<td>'+resultMySql[2][0].PropertyValue+resultMySql[0][x].chargeamount+'</td>'+
					'<tr/>';
					rowDetails = rowDetails + row;

				 customerdetails.customername = resultMySql[0][x].accountname;
				 customerdetails.chargeamount= resultMySql[0][x].chargeamount;

				}
				
				invoiceMailAttachment.readingAgentXmltemplate(customerdetails, function(err,populatedHtml){

								fs.writeFileSync('commisionMonthlyBreakdown.html', populatedHtml, 'utf8');
									var html = fs.readFileSync('commisionMonthlyBreakdown.html', 'utf8');

									var options = { format: 'Letter' };

								pdf.create(html, options).toFile(customerdetails.Month+'.pdf', function(err, res) {
								  if (err) return console.log(err);
								  
									trace.info('created pdf for commisionMonthlyBreakdown');
											var file = path.join(__dirname, customerdetails.Month+'.pdf');
											resp.download(file, function (err) {
											 if (err) {
											console.log("Error");
											console.log(err);
											} else {
										  console.log("Success");
										}
									});
								});


				});
			}else {
				//resp.respcode = 404;
				resp.send({"result":{"success":false,"message":"Invalid Input Data"}});
			}
			
			}); 
	
	}else{
		 resp.send({"result":{"success":false,"message":"Invalid input data"}});
	}
});


app.get('/billing/calculatevpaprice', function(req, res) {
  trace.info("================="+JSON.stringify(req.query));
 vpaParams = {};
 vpaParams.resourceIdentifier = req.query.resourceUri;
 vpaParams.listPrice = req.query.listPrice;
 vpaParams.totalUnitPrice = req.query.costPrice;//ProviderCost
 vpaParams.ownerId = req.query.ownerid;
 return getVpaPriceOnApplicable(vpaParams).then(function (output) {
        trace.info(typeof output+"================="+output);
        if(output && output !="" && output!="null")
			return {"price":Math.floor(output)};
		else
			return {"price":Math.floor(req.query.listPrice)};
    }).then(function(vpaobj){
		 vpaParams.listPrice = req.query.onetime_listPrice;
		 vpaParams.totalUnitPrice = req.query.onetime_costPrice;//ProviderCost
		 return getVpaPriceOnApplicable(vpaParams).then(function (onetime_costPrice) {
			 if(onetime_costPrice && onetime_costPrice !="" && onetime_costPrice!="null")
				vpaobj.onetime_costPrice=Math.floor(onetime_costPrice);
			 else
				vpaobj.onetime_costPrice=Math.floor(req.query.onetime_listPrice);
			 return res.send(vpaobj);
		 });
    });	
});

app.get('/billing/getvpaaccounts', function(req, res) {
	 trace.info("================="+JSON.stringify(req.query));
	 vpaParams = {};
	 vpaParams.vpacode = req.query.vpacode;
	 return getVpaAccounts(vpaParams).then(function (output) {
			trace.info(typeof output+"================="+output);
			if(output && output !="" && output!="null")
				return res.send(output);
			else
				return res.send([]);
	 });  
});

function getVpaAccounts(vpaParams){

	return new promise(function(fulfill, reject){

		return mysql.getVpaIdByVpaCode(vpaParams.vpacode, conn).then(function(vpaId){
		trace.debug('vpaId: ' + vpaId);

		if(vpaId && vpaId != '') {

			return vpaId;
		} else return null;
		}).then(function(vpaId){

			if(vpaId) {				
				return mysql.getVPAAccounts(vpaId, conn).then(function(vpaAccounts){
					trace.info(vpaAccounts);
					return fulfill(vpaAccounts);
				})
			} else return fulfill(null);
		});

	});
};

app.post('/billing/vpa', function(req, res){
	trace.info('vpa post ' );
    var vpaArray = req.body;
    if(vpaArray.length > 0){
        var errRecords = [];
		var series = vpaArray.map(function (vpaElement) {
            return insertVPADetails(vpaElement);
        });

        promise.settle(series).then(function (dbResults) {
            for(var h=0; h<dbResults.length; h++ ){
                if ( dbResults[h].isFulfilled() ) {
                    trace.debug(dbResults[h].value());
                }else{
                    errRecords.push(vpaArray[h].resourceUri);
                }
            }
        }).then(function( ){
            if(errRecords.length > 0){
                res.send({error:'not processed for '+ JSON.stringify(errRecords)})
            }else{
                res.send({msg : 'processed'});
            }
        });
    }else{
        res.send({msg: 'No records to process'});
    }

	// functions
	function insertVPADetails(vpaInfo){
    return new promise(function(fulfill,reject) {
        if(vpaInfo.entries && vpaInfo.entries.providerList && ( vpaInfo.entries.providerList.length > 0	 || 	 vpaInfo.entries.providerList.length==0)
            && vpaInfo.name && vpaInfo.description) {

			var dbString = {
                name: vpaInfo.name,
                description: vpaInfo.description,
                resourceUri: vpaInfo.resourceUri,
                ChannelCode: vpaInfo.channelCode
            };

			subscriptiondatamysql.deleteVpaIfExists(dbString, conn).then(function(deletionResult){

				trace.info(deletionResult);
				return;
			}).catch(function(err){
				trace.warn ('Error occured in Deleting already existing VPA details in billing DB');
				reject(err);
				if(err.stack){
				trace.debug(err.stack);
				}
			}).then(function(){
				return getDenormalizedArray(vpaInfo.entries.providerList).then(function(denormalizedArray){
					trace.info(denormalizedArray);
					return denormalizedArray;
				})
			}).then(function(denormalizedArray){
				var dbresults = [];
				for (var i in denormalizedArray) {

					dbString.provider = denormalizedArray[i].provider || '';
					dbString.region = denormalizedArray[i].region || '';
					dbString.regionUri = denormalizedArray[i].regionUri || '';;
					dbString.category = denormalizedArray[i].category || '';;
					dbString.product = denormalizedArray[i].product || '';;
					dbString.basis = denormalizedArray[i].basis || '';;
					dbString.percentage = denormalizedArray[i].percentage || '';

					subscriptiondatamysql.insertVpaDetails(dbString, conn).then (function(insertionResult){

						trace.info(insertionResult);
						dbresults.push(insertionResult);
						return fulfill(insertionResult);

					}).catch(function(err){

						trace.warn ('Error occured in inserting VPA details to billing DB');
						reject(err);
						if(err.stack){
						trace.debug(err.stack);
					}
					});
				}

			});

        }else{
            return reject('attributes missing');
        }

    });
};

	function getDenormalizedArray(providerList) {

		return new promise(function(fulfill, reject){
				return promise.reduce(providerList, denormalize, []).then(function (denormalizedjson) {

					return denormalizedjson;
				}).then(function(resourceSpecifications){

					 return promise.reduce(resourceSpecifications, denormalizeCategory, []).then(function(denormalizedfinally){

						return fulfill(denormalizedfinally);
					 });
				});
		});
	};

	function denormalize(result, providerList){

		return new promise(function(fulfill, reject){
			var denormalized = {};
			denormalized.provider = providerList.provider;
			denormalized.basis = providerList.basis;
			denormalized.percentage = providerList.percentage;
			result.push(JSON.parse(JSON.stringify(denormalized)));

			if(providerList.regions && providerList.regions.length > 0) {

				for (var i in  providerList.regions){
					denormalized.provider = providerList.provider;
					denormalized.region = providerList.regions[i].name || '';
					denormalized.basis = providerList.regions[i].basis || '';
					denormalized.percentage = providerList.regions[i].percentage || '';
					denormalized.category =  providerList.regions[i].category || null;
					denormalized.products = providerList.products || null;
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}
			}
			return fulfill(result);
		});
	};

	function denormalizeCategory(result, providerList){
		return new promise(function(fulfill, reject){

			var denormalized = {};
			if(!providerList.region) {
				denormalized.provider = providerList.provider;
				denormalized.basis = providerList.basis;
				denormalized.percentage = providerList.percentage;
				result.push(JSON.parse(JSON.stringify(denormalized)));
			}

			if(providerList.region) {

				denormalized.provider = providerList.provider;
				denormalized.region = providerList.region;
				denormalized.basis = providerList.basis;
				denormalized.percentage = providerList.percentage;
				result.push(JSON.parse(JSON.stringify(denormalized)));
			}

			if(providerList.category && providerList.category.length > 0) {

				for (var i in  providerList.category){
					denormalized.provider = providerList.provider;
					denormalized.region = providerList.region;
					denormalized.category = providerList.category[i].resourceType || '';
					denormalized.basis = providerList.category[i].basis || '';
					denormalized.percentage = providerList.category[i].percentage || '';
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}

			}
			if(providerList.products && providerList.products.length > 0){

				for (var i in  providerList.products){
					var denormalized = {};
					denormalized.provider = providerList.provider;
					denormalized.region = ((providerList.products[i].resourceUri).toLowerCase()=='all')?providerList.region:'';
					denormalized.product = providerList.products[i].resourceUri || '';
					denormalized.basis = providerList.products[i].basis || '';
					denormalized.percentage = providerList.products[i].percentage || '';
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}
			}
			return fulfill(result);
		});
	};

});

app.post('/billing/commision', function(req, res){
	trace.info('commision post11 '+JSON.stringify(req.body));
    var commisionArray = req.body;
    if(commisionArray.length > 0){
        var errRecords = [];
		var series = commisionArray.map(function (commisionElement) {
            return insertCommisionDetails(commisionElement);
        });

        promise.settle(series).then(function (dbResults) {
            for(var h=0; h<dbResults.length; h++ ){
                if ( dbResults[h].isFulfilled() ) {
                    trace.debug(dbResults[h].value());
                }else{
                    errRecords.push(commisionArray[h].resourceUri);
                }
            }
        }).then(function( ){
            if(errRecords.length > 0){
                res.send({error:'not processed for '+ JSON.stringify(errRecords)})
            }else{
                res.send({msg : 'processed'});
            }
        });
    }else{
        res.send({msg: 'No records to process'});
    }

	// functions
	function insertCommisionDetails(commisionInfo){
		
    return new promise(function(fulfill,reject) {
        if(commisionInfo.entries && commisionInfo.entries.providerList && ( commisionInfo.entries.providerList.length > 0	 || 	 commisionInfo.entries.providerList.length==0)
            && commisionInfo.name && commisionInfo.description) {

			var dbString = {
                name: commisionInfo.name,
                description: commisionInfo.description,
                resourceUri: commisionInfo.resourceUri,
                ChannelCode: commisionInfo.channelCode
            };

			subscriptiondatamysql.deleteCommisionIfExists(dbString, conn).then(function(deletionResult){

				trace.info(deletionResult);
				return;
			}).catch(function(err){
				trace.warn ('Error occured in Deleting already existing commision details in billing DB');
				reject(err);
				if(err.stack){
				trace.debug(err.stack);
				}
			}).then(function(){
				return getDenormalizedArray(commisionInfo.entries.providerList).then(function(denormalizedArray){
					trace.info(denormalizedArray);
					return denormalizedArray;
				})
			}).then(function(denormalizedArray){
				var dbresults = [];
				for (var i in denormalizedArray) {

					dbString.provider = denormalizedArray[i].provider || '';
					dbString.region = denormalizedArray[i].region || '';
					dbString.regionUri = denormalizedArray[i].regionUri || '';;
					dbString.category = denormalizedArray[i].category || '';;
					dbString.product = denormalizedArray[i].product || '';;
					dbString.basis = denormalizedArray[i].basis || '';;
					dbString.percentage = denormalizedArray[i].percentage || '';

					subscriptiondatamysql.insertCommisionDetails(dbString, conn).then (function(insertionResult){

						trace.info(insertionResult);
						dbresults.push(insertionResult);
						return fulfill(insertionResult);

					}).catch(function(err){

						trace.warn ('Error occured in inserting commision details to billing DB');
						reject(err);
						if(err.stack){
						trace.debug(err.stack);
					}
					});
				}

			});

        }else{
            return reject('attributes missing');
        }

    });
	};

	function getDenormalizedArray(providerList) {

		return new promise(function(fulfill, reject){
				return promise.reduce(providerList, denormalize, []).then(function (denormalizedjson) {

					return denormalizedjson;
				}).then(function(resourceSpecifications){

					 return promise.reduce(resourceSpecifications, denormalizeCategory, []).then(function(denormalizedfinally){

						return fulfill(denormalizedfinally);
					 });
				});
		});
	};

	function denormalize(result, providerList){

		return new promise(function(fulfill, reject){
			var denormalized = {};
			denormalized.provider = providerList.provider;
			denormalized.basis = providerList.basis;
			denormalized.percentage = providerList.percentage;
			result.push(JSON.parse(JSON.stringify(denormalized)));

			if(providerList.regions && providerList.regions.length > 0) {

				for (var i in  providerList.regions){
					denormalized.provider = providerList.provider;
					denormalized.region = providerList.regions[i].name || '';
					denormalized.basis = providerList.regions[i].basis || '';
					denormalized.percentage = providerList.regions[i].percentage || '';
					denormalized.category =  providerList.regions[i].category || null;
					denormalized.products = providerList.products || null;
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}
			}
			return fulfill(result);
		});
	};

	function denormalizeCategory(result, providerList){
		return new promise(function(fulfill, reject){

			var denormalized = {};
			if(!providerList.region) {
				denormalized.provider = providerList.provider;
				denormalized.basis = providerList.basis;
				denormalized.percentage = providerList.percentage;
				result.push(JSON.parse(JSON.stringify(denormalized)));
			}

			if(providerList.region) {

				denormalized.provider = providerList.provider;
				denormalized.region = providerList.region;
				denormalized.basis = providerList.basis;
				denormalized.percentage = providerList.percentage;
				result.push(JSON.parse(JSON.stringify(denormalized)));
			}

			if(providerList.category && providerList.category.length > 0) {

				for (var i in  providerList.category){
					denormalized.provider = providerList.provider;
					denormalized.region = providerList.region;
					denormalized.category = providerList.category[i].resourceType || '';
					denormalized.basis = providerList.category[i].basis || '';
					denormalized.percentage = providerList.category[i].percentage || '';
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}

			}
			if(providerList.products && providerList.products.length > 0){

				for (var i in  providerList.products){
					var denormalized = {};
					denormalized.provider = providerList.provider;
					denormalized.region = ((providerList.products[i].resourceUri).toLowerCase()=='all')?providerList.region:'';
					denormalized.product = providerList.products[i].resourceUri || '';
					denormalized.basis = providerList.products[i].basis || '';
					denormalized.percentage = providerList.products[i].percentage || '';
					result.push(JSON.parse(JSON.stringify(denormalized)));

				}
			}
			return fulfill(result);
		});
	};

});

// api exposed to push the subscriptiondata into billing service (mysql) from resource query - (author: suresh)
app.post('/billing/subscriptiondata', function (req, res) {

    trace.info('enter: post.subscriptiondata (create subscriptiondata)');
    trace.debug('Subscriptions Length + Dependency Array Length : '+req.body.length );
    return insertSubscriptionPush(req.body, function(err, result) {
        var resultResponse = {
            //TODO: This array to be filled with uri's *NO* errors.
            status: 'Completed',
            data: []
        };

        if(err){
            resultResponse.status = 'Failed';
            res.send(resultResponse);
        }
        else{
            res.send(resultResponse);
        }
    });
});

app.post('/billing/billingAddress/:id', function (req, res) {

    trace.info('>>>>>>>>>>>>>>>>New Request for app.post.billing.billingAddress.id'+ req.params.id + ' >>>>>>>>>>');
    var request = req.body;
    var ownerId = req.params.id;
    promise.delay(0000).then (function (){
        if(ownerId && request.paymentTokenReferenceId && request.paymentProviderInfoId ){ //TODO add the validation part
            request.ownerId = ownerId;
            request.isDefault = request.isDefault || 0;
            request.maxCreditAmount = isNaN(parseFloat(request.maxCreditAmount)) ? null : parseFloat(request.maxCreditAmount, 10);
            return payment.createBillingAddress(request,conn);

        }else{
            res.statusCode = 400;
            res.send({});
            return null;

        }

    }).then (function(dbResult){
        if(dbResult) {
            trace.info('app.post.billing.billingAddress.id : ' + ownerId + ' : ' + JSON.stringify(dbResult));
            return res.send(dbResult[0]);
        }
    }).catch(function onReject(err) {
        trace.warn('FAILED', err);
        res.statusCode = 404;
        res.send({});
        if(err.stack)
            trace.debug(err.stack);

    }).catch(function (error) {
        res.statusCode = 500;
        res.send({error: null});
        trace.error(error);
        if (error.stack)
            trace.error('Error Occurred in : ' + error.stack);
    });

});

//TO get paystack Transaction details
app.post('/billing/payment/paystack/gettokendetails', function(req, res){
	trace.info('/billing/payment/paystack/gettokenetails :'+JSON.stringify(req.body));
	var errStatus = {};
	errStatus.status = '';
	errStatus.errMsg = '';
	var paymentReference = '';
	var responseJSON = {};

	var tokenReference = req.body.tokenReference;
	trace.info('tokenReference :'+tokenReference);
    
	//var ownerId = req.body.ownerId;
	
	var ownerId = req.body.ownerId; //'224334a3-00b0-4a8f-8e91-c4a9e80b5772';// 
	trace.info('ownerId >>>>> :'+ownerId);
	
		if(tokenReference !== 'undefined' && tokenReference) {

			var paymentProviderTransactionRequest =  {
                    AmountDto : 0,
                    OrderNumber : 0,
					Amount : 0,
                    ReturnUrl : '',
                    ReturnUrlPrefix : '',
                    CurrencyCode : '',
                    //Note: EffortId will be one first time transaction is processed.
                    EffortId : 1,
					ProviderCodeName : '',
                    CreditCard : 0,
                    LanguageCode : '',
                    CountryCode : 0,
                    TransactionType : 'RetrieveByTokenReference',
                    TokenReference :tokenReference,
                    NameOnCard : '',
					Description : '',
                    Street : '',
                    AdditionalAddressInfo : '',
                    City : '',
                    State : '',
                    Zip : ''
				};

			   trace.info('paymentProviderTransactionRequest :'+JSON.stringify(paymentProviderTransactionRequest));
				var getHeaders = {};
				getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
				getHeaders['ownerId'] = ownerId;

				var options = {
						host: config.paymentauthhost,
						port: config.paymentauthport,
						path: '/apiv1.0/payment?format=json?' + querystring.stringify(paymentProviderTransactionRequest),
						method: 'POST',
						headers:getHeaders
					};
				trace.info('Options : '+JSON.stringify(options));
			

                //TODO New Auth Model - no need as of now for payment
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
							    var contentresult = JSON.parse(content);
							    trace.info('contentresult : '+ JSON.stringify(contentresult));
								if(contentresult!= null && contentresult.status ==true){ 
									savePaystackDetailsInMongo(contentresult,ownerId);
									savePaystackDetailsInBilling(contentresult,ownerId);
									res.send(JSON.stringify(contentresult));
								  }else 
									  if(contentresult!= null && contentresult.status ==false){
										trace.warn('Error -  '+contentresult.message);
										trace.warn('resultResponse : '+JSON.stringify(resultResponse));
									    res.send(JSON.stringify(contentresult));
								  }
								else{
									var resultResponse = {
											status: 'Failed',
											message: 'ForgedException'
										};
										trace.warn('response statusCode : '+response.statusCode);
										trace.warn('Error there is no data in response ot null returned ');
										trace.warn('resultResponse : '+JSON.stringify(resultResponse));
										res.send(resultResponse);
								}
							}
						});
					}
				});

				request.on('error', function(e) {
					trace.warn('Error : '+e.message);
				});
				request.end();
         }


function savePaystackDetailsInMongo(paystackResponse,ownerId) {

	paystackResponse.ownerId = ownerId;
	paystackResponse.paymentProcessor = 'paystack';
	
    var jsonPaystackResponseObject = JSON.stringify(paystackResponse);

var headers = {
		"Content-Type": "application/json" ,
		"Content-Length": Buffer.byteLength(jsonPaystackResponseObject, 'utf8')
		};
		
	
        headers[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
        headers['ownerId'] = ownerId;// 'f620b967-0db4-405a-a9c8-83262c4f3624';//
		
		var optionspost = {
            host : config.apiv2host,
			port : config.apiv2port,
			path: '/apiv2/paystack/transaction',
			method: 'PUT',
			headers: headers
		};
			
	var responseObj = restservices.postCall(optionspost, jsonPaystackResponseObject);
	if(responseObj !=null){
		trace.info('responseObj >>>>>'+JSON.stringify(responseObj));
	}else{
		trace.info('responseObj >>>>>>'+responseObj);
	}

}


function savePaystackDetailsInBilling(paystackResponse,ownerId) {
	trace.info('ownerId >>>>>'+ownerId);
	// Get the address from existing active paymethod
	payment.getActivePaymentMethodById(ownerId, conn, function(err,result){

		if (err){
			res.send(err, err.code);
		}else{

			trace.info('result >>>>>'+JSON.stringify(result));
			var resultJson = JSON.parse(JSON.stringify(result));
			var address2 ='';
			if(resultJson[0].address2!=null)
				address2 = resultJson[0].address2;
				              else address2 ='';
			// Prepaaddress2re the address object
			var addressInfoDto =   {
					name : '',
					address1 : resultJson[0].address1,
					address2 : address2,
					city : resultJson[0].city,
					stateProvinceCode : resultJson[0].stateProvinceCode,
					countryCode : 'NG',
					zipPostalCode : resultJson[0].zipPostalCode,
					id : resultJson[0].addressId
			};

			trace.info('addressInfoDto >>>>>'+JSON.stringify(addressInfoDto));
			var PaymentProviderInfo = null;
			trace.info(' <<<<<<savePaystackDetails entered  >>>>>>>'+2);

			// Prepare the default UserPayment object
			var userPaymentInfoDto =   {
					address : '',
					paymentMethodName : 'paystack',
					providerCodeName : 'PSK',
					creditCardType : '',
					countryCode : 'NG',
					customerHttpAgent : '',
					customerIpAddress : '',
					languageCode : 'en_us',
					owner : ownerId,
					name : 'PayStack',
					id : '',
					status : null,
					isDefault : false,
					paymentProviderInfo : PaymentProviderInfo
			};

			userPaymentInfoDto.id = uuid();
			var userPaymentInfoId = userPaymentInfoDto.id;
			var providerCodeName = userPaymentInfoDto.providerCodeName;
			trace.info('providerCodeName : >>>>> '+providerCodeName);
			trace.info('userPaymentInfoId : '+userPaymentInfoId);
			// Mysql function for getProviderDetails
			paymentAuthServiceMysql.getProviderDetails(providerCodeName, conn, function(err,response) {

				if(err) {
					trace.warn('billingv2/getProviderDetails  Error: '+err);
				}
				else {

					var checkArray = JSON.stringify(response);

					trace.info('Testing PaymentProvider Array : '+checkArray);

					if(checkArray === '[]') {
						trace.warn('billingv2/ProviderDetails  Empty: ');

						ErrorMsg = "Payment Provider Code is not Exists";

						res.send(ErrorMsg);
					}
					else {
						paymentProviderDetails = response;
						PaymentProviderInfo = paymentProviderDetails;

						// PaymentProviderInfo = '093DB4DA-B12B-4F85-9B5F-936C68343E99';

						userPaymentInfoDto.status = 'Pending';

						userPaymentInfoDto.paymentProviderInfo = PaymentProviderInfo;

						trace.info('userPaymentInfoDto : '+JSON.stringify(userPaymentInfoDto) +'\n');
						trace.info(' <<<<<<savePaystackDetails entered  >>>>>>>'+3);
						// Mysql method to add default entry in UserPaymentInfo table
						paymentAuthServiceMysql.addUserPaymentInfo(JSON.stringify(userPaymentInfoDto),addressInfoDto, conn);

						// For getting PaymentProcessor Name
						var userPaymentInfo = userPaymentInfoDto;

						var paymentProviderInfoDto = userPaymentInfo.paymentProviderInfo;

						trace.info('paymentProviderInfo : '+JSON.stringify(paymentProviderInfoDto[0]));

						trace.info('paymentProcessorName : '+paymentProviderInfoDto[0].PPName);

						var paymentProcessorName = paymentProviderInfoDto[0].PPName;

						var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZ";
						var string_length = 8;
						var orderNumber = '';
						var newOrderNumber = '';
						for (var i=0; i<string_length; i++) {
							var rnum = Math.floor(Math.random() * chars.length);
							orderNumber += chars.substring(rnum,rnum+1);
						}

						// Mysql function for getProviderDetails
						   paymentVerifyServiceMysql.getPaymentOrderNumber(conn, function(err,newPaymentOrderNumber) {

							if(err) {
								trace.warn('billingv2/getPaymentOrderNumber  Error: '+err);
							}
								else {
								
									newOrderNumber = newPaymentOrderNumber;
									trace.info('newPaymentOrderNumber &&&&&&&&&&&&&&&&&&&&&&&&'+newOrderNumber);
									//sendProviderInfo(paymentProviderDetails);
								}
							//});

					   trace.info('newPaymentOrderNumber #######################'+newOrderNumber);
					   
						/*for (var i=0; i<string_length; i++) {
							var rnum = Math.floor(Math.random() * chars.length);
							newOrderNumber += chars.substring(rnum,rnum+1);
						}
*/
						var cardType ='';
						var lastFour ='';
						var expMonth ='';
						var expYear ='';
						var bank ='';
						var amount ='';
						var refCode ='';

						if(paystackResponse.data!=null){
							amount = paystackResponse.data.amount;
							//paystack response conatains a whole number including decimals. So we need divide by 100 to get the decimal values
							amount =amount/100;
							
							if(paystackResponse.data.authorization !=null){
								refCode = paystackResponse.data.authorization.authorization_code;
								cardType = paystackResponse.data.authorization.card_type;
								lastFour = '**********'+paystackResponse.data.authorization.last4;
								expMonth = paystackResponse.data.authorization.exp_month;
								expYear = paystackResponse.data.authorization.exp_year;
								bank = paystackResponse.data.authorization.bank;
							}

						}
						trace.info(' <<<<<<savePaystackDetails entered  >>>>>>>'+4);
						// default paymentOrder object
						var paymentOrderDto =  {
								paymentProcessor : paymentProcessorName,
								orderType : 'Recurring',
								owner : userPaymentInfoDto.owner,
								currencyCode : 'NGN',
								paymentMethodType : userPaymentInfoDto.creditCardType,
								amount : "1",
								isAuthorization : true,
								orderStatus : 'Success',
								userPaymentInfo : userPaymentInfoDto,
								softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ orderNumber,
								orderNumber :  orderNumber
						};

						trace.info('paymentOrderDto : '+JSON.stringify(paymentOrderDto));

						trace.info(' <<<<<<savePaystackDetails entered  >>>>>>>'+5);
						// Mysql method to add default entry in paymentOrder table with IsAuthorize
						// =1
						paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderDto, conn, function(err, result) {

							if(err){
								trace.info(' <<<<<<addPaymentOrderDto error  >>>>>>>'+6);
							}else{
								trace.info(' <<<<<<addPaymentOrderDto ADDED >>>>>>>');
							}
							var userPaymentInfo = {
									paymentTokenReferenceCode : refCode,
									maskedCreditCardNumber : lastFour,
									expirationMonth : expMonth,
									expirationYear : expYear,
									orderNumber : orderNumber,
									isAuthorized : 1,
									creditCardType : cardType,
									BankCode : '',
									BankAccount : '' ,
									Iban : ''
							};
							// Mysql function for updating UserPaymentInfo with card details
							paymentVerifyServiceMysql.updateUserPaymentInfo(userPaymentInfo, conn, function(err,result) {

								if(err) {
									trace.warn('updateUserPaymentInfo Error : '+err);
									var resultResponse = {
											status: 'Error',
											message: 'updateUserPaymentInfo Error'
									};
									trace.info('resultResponse : '+JSON.stringify(resultResponse));
									// res.send(resultResponse);
								}else{
									// res.send(resultResponse);
									trace.info(' <<<<<<savePaystackDetails End  >>>>>>>'+7);
									trace.info('resultResponse : '+JSON.stringify(result));
								}
							});	
						});

						// For actual paid order entry
						if(paystackResponse.data!=null){
							// paymentOrderAmountDto Object
							var paymentOrderAmountDto =  {
									paymentProcessor :  paymentProcessorName,
									orderType : 'Recurring',
									owner : userPaymentInfoDto.owner,
									currencyCode : 'NGN',
									paymentMethodType : cardType,
									amount : amount,
									isAuthorization : false,
									orderStatus : paystackResponse.data.status,
									userPaymentInfo : userPaymentInfoDto,
									softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ newOrderNumber,
									orderNumber :  newOrderNumber
							};

							trace.info(' <<<<<<savePaystackDetails End  >>>>>>>'+8);
							// Mysql method to add an order entry in paymentOrder table with actual
							// amount paid and IsAuthorize =0
							paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderAmountDto, conn, function(err, result) {

								if(err){
									trace.info(' <<<<<<addPaymentOrderDto error  >>>>>>>'+6);
								}else{
									
									paymentVerifyServiceMysql.updateChargeAmountInPaymentOrder(paymentOrderAmountDto, conn);
									
									paymentVerifyServiceMysql.isFirstPaymentMethodByOrderNumber(newOrderNumber, conn, function(err,result) {

										trace.info(JSON.stringify(result));

											var resultResponse = {
														status: 'Verified',
														message: "Card Verified"
											};

											if(err) {
												trace.warn('isFirstPaymentMethodByOrderNumber Error : '+err);

												res.send(resultResponse);
											}
											else {
												trace.info('isFirstPaymentMethodByOrderNumber Response : '+ JSON.stringify(result, null, 2));

												if (result[0]._isFirstPaymentMethodCheck == true && couponConfig.autoApplyCoupon == true) {
													trace.info('*****TO call Apply Coupon***');
													// call auto coupon apply function
													autoApplyCoupon(result[0]._ownerId, function(err,response) {

														trace.info('autoApplyCoupon response : '+JSON.stringify(response));
														if (err) {
															// When method technical error
															res.send(resultResponse);
														}
														else {
															if(response.message) {
																// When error message get from autoApplyCoupon method
																res.send(resultResponse);
															}
															else {
																resultResponse.status = 'Verified_Coupon_Applied';
																res.send(resultResponse);
															}
														}
													});
												}
												else {

													res.send(resultResponse);
												}
											}
										});
									trace.info(' <<<<<<addPaymentOrderDto ADDED >>>>>>>');
								}//end  of else
							});//end of addPaymentOrderDto
						} //end of actual paid entry
					});// end of getNewPaymentOrder
					}//end of getProviderDetails inner else
				}//end of getProviderDetails outer else
			});//end of getProviderDetails
		}// end of getActivePaymentMethodById else
	});// end of getActivePaymentMethodById
}//end of savePaystackDetailsInBilling

});//End of paystack API call


// api to get payment gateway configured status
app.get('/billing/getpaymentconfigurationstatus/:orderid', function(req, res){
trace.info('enter: get.billing.getpaymentconfigurationstatus');
var orderId = req.params.orderid;
trace.info('enter: get.billing.getpaymentconfigurationstatus:::orderid is ::::'+orderId);
exports.getPaymentGatewayConfigurationStatus(orderId, conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});

// api to update payment
app.post('/billing/updatepayment', function(req, res){
trace.info('enter: get.billing.updatepayment');
var input = req.body;
trace.info('enter: get.billing.getpaymentconfigurationstatus:::orderid is ::::'+JSON.stringify(input));
exports.updatePaymentDetails(input, conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});

//TO save ecpay Card details
app.post('/billing/payment/ecpay/savecarddetails', function(req, res){
	trace.info('/billing/payment/ecpay/savecarddetails :'+JSON.stringify(req.body));
	var errStatus = {};
	errStatus.status = '';
	errStatus.errMsg = '';
	
	var ecpayResponse = req.body.cardDetails;	
	
	var ownerId = req.body.ownerId; // '224334a3-00b0-4a8f-8e91-c4a9e80b5772';//
	trace.info('ownerId >>>>> :'+ownerId);
	if(ecpayResponse !== 'undefined' && ecpayResponse != null){
	saveECPayCardDetailsInMongo(ecpayResponse,ownerId);
	saveECPayCardDetailsInBilling(ecpayResponse,ownerId);
    }

    function saveECPayCardDetailsInMongo(ecpayResponse,ownerId) {

	ecpayResponse.ownerId = ownerId;
	ecpayResponse.paymentProcessor = 'ecpaycard';
	
    var jsonECPayResponseObject = JSON.stringify(ecpayResponse);

    var headers = {
		"Content-Type": "application/json" ,
		"Content-Length": Buffer.byteLength(jsonECPayResponseObject, 'utf8')
		};
		
	
        headers[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
        headers['ownerId'] = ownerId;// 'f620b967-0db4-405a-a9c8-83262c4f3624';//
		
		var optionspost = {
            host : config.apiv2host,
			port : config.apiv2port,
			path: '/apiv2/ecpay/transaction',
			method: 'PUT',
			headers: headers
		};
			
	var responseObj = restservices.postCall(optionspost, jsonECPayResponseObject);
	if(responseObj !=null){
		trace.info('responseObj >>>>>'+JSON.stringify(responseObj));
	}else{
		trace.info('responseObj >>>>>>'+responseObj);
	}

    }


    function saveECPayCardDetailsInBilling(ecpayResponse,ownerId) {
	
	// Get the address from existing active paymethod
	payment.getActivePaymentMethodById(ownerId, conn, function(err,result){

		if (err){
			res.send(err, err.code);
		}else{

			trace.info('result >>>>>'+JSON.stringify(result));
			var resultJson = JSON.parse(JSON.stringify(result));
			var address2 ='';
			if(resultJson[0].address2!=null)
				address2 = resultJson[0].address2;
				              else address2 ='';
			// Prepaaddress2re the address object
			var addressInfoDto =   {
					name : '',
					address1 : resultJson[0].address1,
					address2 : address2,
					city : resultJson[0].city,
					stateProvinceCode : resultJson[0].stateProvinceCode,
					countryCode : 'TW',
					zipPostalCode : resultJson[0].zipPostalCode,
					id : resultJson[0].addressId
			};

			trace.info('addressInfoDto >>>>>'+JSON.stringify(addressInfoDto));
			var PaymentProviderInfo = null;
			trace.info(' <<<<<<saveECPayCardDetails entered  >>>>>>>'+2);

			// Prepare the default UserPayment object
			var userPaymentInfoDto =   {
					address : '',
					paymentMethodName : 'ecpaycard',
					providerCodeName : 'ECPC',
					creditCardType : '',
					countryCode : 'TW',
					customerHttpAgent : '',
					customerIpAddress : '',
					languageCode : 'zh-CN',
					owner : ownerId,
					name : 'ecpaycard',
					id : '',
					status : null,
					isDefault : false,
					paymentProviderInfo : PaymentProviderInfo
			};

			userPaymentInfoDto.id = uuid();
			var userPaymentInfoId = userPaymentInfoDto.id;
			var providerCodeName = userPaymentInfoDto.providerCodeName;
			trace.info('providerCodeName : >>>>> '+providerCodeName);
			trace.info('userPaymentInfoId : '+userPaymentInfoId);
			// Mysql function for getProviderDetails
			paymentAuthServiceMysql.getProviderDetails(providerCodeName, conn, function(err,response) {

				if(err) {
					trace.warn('billingv2/getProviderDetails  Error: '+err);
				}
				else {

					var checkArray = JSON.stringify(response);

					trace.info('Testing PaymentProvider Array : '+checkArray);

					if(checkArray === '[]') {
						trace.warn('billingv2/ProviderDetails  Empty: ');

						ErrorMsg = "Payment Provider Code is not Exists";

						res.send(ErrorMsg);
					}
					else {
						paymentProviderDetails = response;
						PaymentProviderInfo = paymentProviderDetails;

						// PaymentProviderInfo =
						// '093DB4DA-B12B-4F85-9B5F-936C68343E99';

						userPaymentInfoDto.status = 'Pending';

						userPaymentInfoDto.paymentProviderInfo = PaymentProviderInfo;

						trace.info('userPaymentInfoDto : '+JSON.stringify(userPaymentInfoDto) +'\n');
						trace.info(' <<<<<<saveECPayCardDetails entered  >>>>>>>'+3);
						// Mysql method to add default entry in UserPaymentInfo
						// table
						paymentAuthServiceMysql.addUserPaymentInfo(JSON.stringify(userPaymentInfoDto),addressInfoDto, conn);

						// For getting PaymentProcessor Name
						var userPaymentInfo = userPaymentInfoDto;

						var paymentProviderInfoDto = userPaymentInfo.paymentProviderInfo;

						trace.info('paymentProviderInfo : '+JSON.stringify(paymentProviderInfoDto[0]));

						trace.info('paymentProcessorName : '+paymentProviderInfoDto[0].PPName);

						var paymentProcessorName = paymentProviderInfoDto[0].PPName;

						var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZ";
						var string_length = 8;
						var orderNumber = '';
						var newOrderNumber = '';
						for (var i=0; i<string_length; i++) {
							var rnum = Math.floor(Math.random() * chars.length);
							orderNumber += chars.substring(rnum,rnum+1);
						}

						// Mysql function for getProviderDetails
						   paymentVerifyServiceMysql.getPaymentOrderNumber(conn, function(err,newPaymentOrderNumber) {

							if(err) {
								trace.warn('billingv2/getPaymentOrderNumber  Error: '+err);
							}
								else {
								
									newOrderNumber = newPaymentOrderNumber;
									trace.info('newPaymentOrderNumber &&&&&&&&&&&&&&&&&&&&&&&&'+newOrderNumber);
									// sendProviderInfo(paymentProviderDetails);
								}
							// });

					   trace.info('newPaymentOrderNumber #######################'+newOrderNumber);
					   
						/*
						 * for (var i=0; i<string_length; i++) { var rnum =
						 * Math.floor(Math.random() * chars.length);
						 * newOrderNumber += chars.substring(rnum,rnum+1); }
						 */
						var cardType ='';
						var lastFour ='';
						var expMonth ='';
						var expYear ='';
						var bank ='';
						var amount ='';
						var refCode ='';

						if(ecpayResponse!=null){
							// amount = ecpayResponse.data.amount;
														
								refCode = ecpayResponse.CardID;
								cardType = providerCodeName;
								lastFour = '**********'+ecpayResponse.Card4No;
								expMonth = 'null';
								expYear = 'null';
								bank = '';
							
						}
						trace.info(' <<<<<<saveECPayCardDetails entered  >>>>>>>'+4);
						// default paymentOrder object
						var paymentOrderDto =  {
								paymentProcessor : paymentProcessorName,
								orderType : 'Recurring',
								owner : userPaymentInfoDto.owner,
								currencyCode : 'TWD',
								paymentMethodType : userPaymentInfoDto.creditCardType,
								amount : "1",
								isAuthorization : true,
								orderStatus : 'Pending',
								userPaymentInfo : userPaymentInfoDto,
								softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ orderNumber,
								orderNumber :  orderNumber
						};

						trace.info('paymentOrderDto : '+JSON.stringify(paymentOrderDto));

						trace.info(' <<<<<<saveECPayCardDetails entered  >>>>>>>'+5);
						// Mysql method to add default entry in paymentOrder
						// table with IsAuthorize
						// =1
						paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderDto, conn, function(err, result) {

							if(err){
								trace.info(' <<<<<<addPaymentOrderDto error  >>>>>>>'+6);
							}else{
								trace.info(' <<<<<<addPaymentOrderDto ADDED >>>>>>>');
							}
							var userPaymentInfo = {
									paymentTokenReferenceCode : refCode,
									maskedCreditCardNumber : lastFour,
									expirationMonth : expMonth,
									expirationYear : expYear,
									orderNumber : orderNumber,
									isAuthorized : 1,
									creditCardType : cardType,
									BankCode : '',
									BankAccount : '' ,
									Iban : ''
							};
							// Mysql function for updating UserPaymentInfo with
							// card details
							paymentVerifyServiceMysql.updateUserPaymentInfo(userPaymentInfo, conn, function(err,result) {

								if(err) {
									trace.warn('updateUserPaymentInfo Error : '+err);
									var resultResponse = {
											status: 'Error',
											message: 'updateUserPaymentInfo Error'
									};
									trace.info('resultResponse : '+JSON.stringify(resultResponse));
									// res.send(resultResponse);
								}else{
									// res.send(resultResponse);
									trace.info(' <<<<<<saveECPayCardDetails End  >>>>>>>'+7);
									trace.info('resultResponse : '+JSON.stringify(result));
									var resultResponse = {
											status: 'Success',
											message: 'updateUserPaymentInfo Success'
									};
									res.send(resultResponse);
								}
							});	
						});
						
					});// end of getNewPaymentOrder
					}// end of getProviderDetails inner else
				}// end of getProviderDetails outer else
			});// end of getProviderDetails
		}// end of getActivePaymentMethodById else
	});// end of getActivePaymentMethodById
}// end of saveECPayCardDetailsInBilling

});//End of ECPay API call

//TO save ecpay web-atm details
app.post('/billing/payment/ecpay/savewebatmdetails', function(req, res){
	trace.info('/billing/payment/ecpay/savewebatmdetails :'+JSON.stringify(req.body));
	var errStatus = {};
	errStatus.status = '';
	errStatus.errMsg = '';
	
	var ecpayResponse = req.body.webatmdetails;
	var ownerId = req.body.ownerId; // '224334a3-00b0-4a8f-8e91-c4a9e80b5772';//
	trace.info('ownerId >>>>> :'+ownerId);
	
	if(ecpayResponse != null){
	saveECPayWebAtmDetailsInMongo(ecpayResponse,ownerId);
	saveECPayWebAtmDetailsInBilling(ecpayResponse,ownerId);
	}
	
   function saveECPayWebAtmDetailsInMongo(ecpayResponse,ownerId) {

	ecpayResponse.ownerId = ownerId;
	ecpayResponse.paymentProcessor = 'ecpaywebatm';
	
    var jsonECPayResponseObject = JSON.stringify(ecpayResponse);

    var headers = {
		"Content-Type": "application/json" ,
		"Content-Length": Buffer.byteLength(jsonECPayResponseObject, 'utf8')
		};
		
	
        headers[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
        headers['ownerId'] = ownerId;// 'f620b967-0db4-405a-a9c8-83262c4f3624';//
		
		var optionspost = {
            host : config.apiv2host,
			port : config.apiv2port,
			path: '/apiv2/ecpay/transaction',
			method: 'PUT',
			headers: headers
		};
			
	var responseObj = restservices.postCall(optionspost, jsonECPayResponseObject);
	if(responseObj !=null){
		trace.info('responseObj >>>>>'+JSON.stringify(responseObj));
	}else{
		trace.info('responseObj >>>>>>'+responseObj);
	}

   }


    function saveECPayWebAtmDetailsInBilling(ecpayResponse,ownerId) {	
	// Get the address from existing active paymethod
	payment.getActivePaymentMethodById(ownerId, conn, function(err,result){

		if (err){
			res.send(err, err.code);
		}else{

			trace.info('result >>>>>'+JSON.stringify(result));
			var resultJson = JSON.parse(JSON.stringify(result));
			var address2 ='';
			if(resultJson[0].address2!=null)
				address2 = resultJson[0].address2;
				              else address2 ='';
			// Prepaaddress2re the address object
			var addressInfoDto =   {
					name : '',
					address1 : resultJson[0].address1,
					address2 : address2,
					city : resultJson[0].city,
					stateProvinceCode : resultJson[0].stateProvinceCode,
					countryCode : 'TW',
					zipPostalCode : resultJson[0].zipPostalCode,
					id : resultJson[0].addressId
			};

			trace.info('addressInfoDto >>>>>'+JSON.stringify(addressInfoDto));
			var PaymentProviderInfo = null;
			trace.info(' <<<<<<saveECPayWebAtmDetails entered  >>>>>>>'+2);

			// Prepare the default UserPayment object
			var userPaymentInfoDto =   {
					address : '',
					paymentMethodName : 'ecpaywebatm',
					providerCodeName : 'ECPW',
					creditCardType : '',
					countryCode : 'TW',
					customerHttpAgent : '',
					customerIpAddress : '',
					languageCode : 'zh-CN',
					owner : ownerId,
					name : 'ecpaywebatm',
					id : '',
					status : null,
					isDefault : false,
					paymentProviderInfo : PaymentProviderInfo
			};

			userPaymentInfoDto.id = uuid();
			var userPaymentInfoId = userPaymentInfoDto.id;
			var providerCodeName = userPaymentInfoDto.providerCodeName;
			trace.info('providerCodeName : >>>>> '+providerCodeName);
			trace.info('userPaymentInfoId : '+userPaymentInfoId);
			// Mysql function for getProviderDetails
			paymentAuthServiceMysql.getProviderDetails(providerCodeName, conn, function(err,response) {

				if(err) {
					trace.warn('billingv2/getProviderDetails  Error: '+err);
				}
				else {

					var checkArray = JSON.stringify(response);

					trace.info('Testing PaymentProvider Array : '+checkArray);

					if(checkArray === '[]') {
						trace.warn('billingv2/ProviderDetails  Empty: ');

						ErrorMsg = "Payment Provider Code is not Exists";

						res.send(ErrorMsg);
					}
					else {
						paymentProviderDetails = response;
						PaymentProviderInfo = paymentProviderDetails;

						// PaymentProviderInfo =
						// '093DB4DA-B12B-4F85-9B5F-936C68343E99';

						userPaymentInfoDto.status = 'Pending';

						userPaymentInfoDto.paymentProviderInfo = PaymentProviderInfo;

						trace.info('userPaymentInfoDto : '+JSON.stringify(userPaymentInfoDto) +'\n');
						trace.info(' <<<<<<saveECPayWebAtmDetails entered  >>>>>>>'+3);
						// Mysql method to add default entry in UserPaymentInfo
						// table
						paymentAuthServiceMysql.addUserPaymentInfo(JSON.stringify(userPaymentInfoDto),addressInfoDto, conn);

						// For getting PaymentProcessor Name
						var userPaymentInfo = userPaymentInfoDto;

						var paymentProviderInfoDto = userPaymentInfo.paymentProviderInfo;

						trace.info('paymentProviderInfo : '+JSON.stringify(paymentProviderInfoDto[0]));

						trace.info('paymentProcessorName : '+paymentProviderInfoDto[0].PPName);

						var paymentProcessorName = paymentProviderInfoDto[0].PPName;

						var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZ";
						var string_length = 8;
						var orderNumber = '';
						var newOrderNumber = '';
						for (var i=0; i<string_length; i++) {
							var rnum = Math.floor(Math.random() * chars.length);
							orderNumber += chars.substring(rnum,rnum+1);
						}

						// Mysql function for getProviderDetails
						   paymentVerifyServiceMysql.getPaymentOrderNumber(conn, function(err,newPaymentOrderNumber) {

							if(err) {
								trace.warn('billingv2/getPaymentOrderNumber  Error: '+err);
							}
								else {
								
									newOrderNumber = newPaymentOrderNumber;
									trace.info('newPaymentOrderNumber &&&&&&&&&&&&&&&&&&&&&&&&'+newOrderNumber);
									// sendProviderInfo(paymentProviderDetails);
								}
							// });

					   trace.info('newPaymentOrderNumber #######################'+newOrderNumber);
					   
						/*
						 * for (var i=0; i<string_length; i++) { var rnum =
						 * Math.floor(Math.random() * chars.length);
						 * newOrderNumber += chars.substring(rnum,rnum+1); }
						 */
						var cardType ='';
						var lastFour ='';
						var expMonth ='';
						var expYear ='';
						var bank ='';
						var amount ='';
						var refCode ='';

						if(ecpayResponse!=null){
							
							    amount = ecpayResponse.TradeAmt;							
								refCode = '';
								cardType = providerCodeName;
								lastFour ='';
								expMonth = '';
								expYear = '';
								bank = '';
							
						}
						trace.info(' <<<<<<saveECPayWebAtmDetails entered  >>>>>>>'+4);
						// default paymentOrder object
						var paymentOrderDto =  {
								paymentProcessor : paymentProcessorName,
								orderType : 'Recurring',
								owner : userPaymentInfoDto.owner,
								currencyCode : 'TWD',
								paymentMethodType : userPaymentInfoDto.creditCardType,
								amount : "1",
								isAuthorization : true,
								orderStatus : 'Success',
								userPaymentInfo : userPaymentInfoDto,
								softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ orderNumber,
								orderNumber :  orderNumber
						};

						trace.info('paymentOrderDto : '+JSON.stringify(paymentOrderDto));

						trace.info(' <<<<<<saveECPayWebAtmDetails entered  >>>>>>>'+5);
						// Mysql method to add default entry in paymentOrder
						// table with IsAuthorize
						// =1
						paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderDto, conn, function(err, result) {

							if(err){
								trace.info(' <<<<<<addPaymentOrderDto error  >>>>>>>'+6);
							}else{
								trace.info(' <<<<<<addPaymentOrderDto ADDED >>>>>>>');
							}
							var userPaymentInfo = {
									paymentTokenReferenceCode : refCode,
									maskedCreditCardNumber : lastFour,
									expirationMonth : 0,
									expirationYear : 0,
									orderNumber : orderNumber,
									isAuthorized : 1,
									creditCardType : cardType,
									BankCode : '',
									BankAccount : '' ,
									Iban : ''
							};
							// Mysql function for updating UserPaymentInfo with
							// card details
							paymentVerifyServiceMysql.updateUserPaymentInfo(userPaymentInfo, conn, function(err,result) {

								if(err) {
									trace.warn('updateUserPaymentInfo Error : '+err);
									var resultResponse = {
											status: 'Error',
											message: 'updateUserPaymentInfo Error'
									};
									trace.info('resultResponse : '+JSON.stringify(resultResponse));
									// res.send(resultResponse);
								}else{
									// res.send(resultResponse);
									trace.info(' <<<<<<saveECPayWebAtmDetails End  >>>>>>>'+7);
									trace.info('resultResponse : '+JSON.stringify(result));
								}
							});	
						});

						// For actual paid order entry
						if(ecpayResponse!=null){
							// paymentOrderAmountDto Object
							var paymentOrderAmountDto =  {
									paymentProcessor :  paymentProcessorName,
									orderType : 'Recurring',
									owner : userPaymentInfoDto.owner,
									currencyCode : 'TWD',
									paymentMethodType : cardType,
									amount : amount,
									isAuthorization : false,
									orderStatus : 'Success',
									userPaymentInfo : userPaymentInfoDto,
									softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ newOrderNumber,
									orderNumber :  newOrderNumber
							};

							trace.info(' <<<<<<savePaystackDetails End  >>>>>>>'+8);
							// Mysql method to add an order entry in
							// paymentOrder table with actual
							// amount paid and IsAuthorize =0
							paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderAmountDto, conn, function(err, result) {

								if(err){
									trace.info(' <<<<<<addPaymentOrderDto error  >>>>>>>'+6);
								}else{
									
									paymentVerifyServiceMysql.updateChargeAmountInPaymentOrder(paymentOrderAmountDto, conn);
									
									paymentVerifyServiceMysql.isFirstPaymentMethodByOrderNumber(newOrderNumber, conn, function(err,result) {

										trace.info(JSON.stringify(result));

											var resultResponse = {
														status: 'Verified',
														message: "Card Verified"
											};

											if(err) {
												trace.warn('isFirstPaymentMethodByOrderNumber Error : '+err);

												res.send(resultResponse);
											}
											else {
												trace.info('isFirstPaymentMethodByOrderNumber Response : '+ JSON.stringify(result, null, 2));

												if (result[0]._isFirstPaymentMethodCheck == true && couponConfig.autoApplyCoupon == true) {
													trace.info('*****TO call Apply Coupon***');
													// call auto coupon apply
													// function
													autoApplyCoupon(result[0]._ownerId, function(err,response) {

														trace.info('autoApplyCoupon response : '+JSON.stringify(response));
														if (err) {
															// When method
															// technical error
															res.send(resultResponse);
														}
														else {
															if(response.message) {
																// When error
																// message get
																// from
																// autoApplyCoupon
																// method
																res.send(resultResponse);
															}
															else {
																resultResponse.status = 'Verified_Coupon_Applied';
																res.send(resultResponse);
															}
														}
													});
												}
												else {

													res.send(resultResponse);
												}
											}
										});
									trace.info(' <<<<<<addPaymentOrderDto ADDED >>>>>>>');
								}// end of else
							});// end of addPaymentOrderDto
						} // end of actual paid entry
					});// end of getNewPaymentOrder
					}// end of getProviderDetails inner else
				}// end of getProviderDetails outer else
			});// end of getProviderDetails
		}// end of getActivePaymentMethodById else
	});// end of getActivePaymentMethodById
}// end of saveECPayWebAtmDetailsInBilling

});//End of ECPay Web-Atm API call

app.post('/billing/payment/ecpay/webatmrecurringpay', function(req, res){
	
	trace.info('/billing/payment/ecpay/webatmrecurringpay :'+JSON.stringify(req.body));
	var OrderNumber = req.body.orderNumber;
	var webatmresponse = req.body.webatmdetails;	
	
	paymentCollectionMySql.getPaymentOrderByOrderNumber(OrderNumber, conn, function(err, result) {   
		
		if (err) {
			
		trace.info('Error in fetching the Failure records :'+err);
		
		}
		else {
			trace.info('PaymentOrder result :'+JSON.stringify(result));
			
			var paymentOrderId = result[0].Id;
			var responseDto = {};
			responseDto.TransactionNumber = webatmresponse.TradeNo;
			if(typeof webatmresponse.RtnCode != 'undefined' && webatmresponse.RtnCode == 1)
		    	responseDto.TransactionStatus = 'Success';		
			else
				responseDto.TransactionStatus = 'Failed';
			updateBillingResourceOnPaymentResponse(paymentOrderId, responseDto);
		}
		res.send(result);
	});
	
	
});

function updateBillingResourceOnPaymentResponse(paymentOrderId, responseDto) {		
	
	if(paymentOrderId && responseDto) {
	
		trace.info('::::::::::::::::::::: Enter updateBillingResourceOnPaymentResponse :::::::::::::::::::::');

		trace.info('updateBillingResourceOnPaymentResponse / TransactionNumber : '+responseDto.TransactionNumber);
		trace.info('updateBillingResourceOnPaymentResponse / TransactionStatus : '+responseDto.TransactionStatus);			
		trace.info('updateBillingResourceOnPaymentResponse / paymentOrderId : '+paymentOrderId);
	
		var transactionNumber = responseDto.TransactionNumber;			
		var paymentTransactionStatus = responseDto.TransactionStatus;		
		var defaultBillingFrequency = config.billingFrequency;					
		var isError = false;
		var deferPaymentOrder = false;
		var isFailure = false;
		
		if(typeof transactionNumber == 'undefined') {
				
			transactionNumber = "";			
		}
		
		if(typeof paymentTransactionStatus == 'undefined') {
				
			paymentTransactionStatus = "";			
		}
		if(paymentTransactionStatus === "Failed") {
			isFailure = true;
		}
		
		if(transactionNumber && paymentTransactionStatus) {
		
			paymentCollectionMySql.updateBillingTablesOnResponse(paymentOrderId, transactionNumber, paymentTransactionStatus, defaultBillingFrequency, isError, deferPaymentOrder, conn, function(err, result) {
						
				if(err) {				
					trace.warn(' updateBillingTablesOnResponse Error :'+err);	
				}
				else {
					trace.info(' updateBillingTablesOnResponse result :'+JSON.stringify(result));						
					
				}
				//process.exit();
					
			}); 
		}
		else {
			trace.warn('transactionNumber/paymentTransactionStatus is / are undefined..!');
		}
	
	}
	else {
		trace.warn('paymentorderid/paymentProviderResponseDto is/are Empty');
	}

}

app.all('/billing/*', auth, function (req, res, next) {
    trace.info('req.ownerId: ' + req.ownerId +' 2. req.userId: ' + req.userId);
	trace.info(req.headers.channelCode);

	//req.languageCode = typeof req.query.LanguageCode != "undefined" ? req.query.LanguageCode.toLowerCase(): config.defaultLanguage.toLowerCase();
    req.channelCode = typeof req.query.channelCode != "undefined" ? req.query.channelCode.toLowerCase(): config.defaultChannel.toLowerCase();

    trace.info('enter: all.billing: languageCode: ' + req.languageCode);
    trace.info('enter: all.billing: channelCode: ' + req.channelCode);
    /*
    req.ownerId = req.remoteUser.toLowerCase();
    trace.debug('enter: all.billing: ownerId: ' + req.ownerId);
    */

    if (config.skipAuthorization) {
        trace.warn('===== TESTING: authorization is turned OFF =====');
        return next();
    }

    return roleHelperCode.authorizeRequest(req, res, next);
});

app.post('/billing/pricingdetails', function (req, res) {
	var request = req.body;
	trace.info('/billing/pricingdetails request>>'+JSON.stringify(request));
	
	var channelCode = null;
	var currencyCode = null;
	var localeCode = null;
    var noLocalePrice = req.query.noLocalePrice;
    
	if (!request.elements || request.elements.length <= 0) {
		trace.debug('no elements found');
		
		res.statusCode = 400;
        return res.send({});
	}
	
	var elementsUris = []; // list of normal uris
	var imageUris = []; // list of normal uris
	var configurableUris = []; // list of config uri's
	var configurableImageUris = []; // list of config uri's
	var elementArray = []; // to construct the elementsArray with PricingDetails in WorkLoadInfo
	var metadataModified = {}; // to construct the metadata under each element with pricing detail
	var pricing = {};
	var configurableElementarray = []; // for chargeAmountUnitLevelPricing
	var channelConfig_global = {};

	if(!request.ownerId){
		trace.warn('ownerId_missing');
		res.statusCode = 400;
		res.send({err:'ownerId missing'});
	};
	if (!request.elements || request.elements.length <= 0) {
		trace.debug('no elements found');

		res.statusCode = 400;
        return res.send({});
	};
	getConfigByChannel(request.ownerId).then(function(channelConfig){
		trace.info('channelConfig ::::' + JSON.stringify(channelConfig));
		channelConfig_global = channelConfig;
		if(!channelConfig){
			trace.warn('channelcode_unavailable');
			res.statusCode = 400;
			res.send({error : 'channelcode_unavailable'});
		} else return channelConfig;
	}).then(function(channelConfig){
		if(channelConfig && config.port){
			channelCode = channelConfig.channelCode;
			currencyCode = channelConfig.currencyCode;
			var isVpaAllowed = false;
			// userid to get the VPA rule for Showing Pricing details
			var VPAUserId = req.parentUserId || req.userId;

			var workloadinfo = {
				workloadId: request.workloadId,
				ownerId: request.ownerId,
				uniqueName: request.uniqueName,
				name: request.name
			};
			var headers = {
				"Content-Type": "application/json"
				//"Authorization": "Basic " + new Buffer(ownerid + ":" + ownerid).toString("base64")
				//'x-auth-token': req.headers['x-auth-token']
			};

			var optionsgetVPA = {
			host: config.authorizationServiceHost,
			port: config.authorizationServicePort,
			path: '/api/authorization/user/' + VPAUserId + '?role=' + channelConfig.VPARule + '&ownerId=' + request.ownerId,
			method: 'GET',
			headers: headers
			};

			var series = request.elements.map(function (element) {
				return parseElementArray(element);
			});

	promise.settle(series).then(function () {
		trace.debug(elementsUris.concat(imageUris).join(','));
		//call the configResource API's -- pass the configurableUris
		if(elementsUris.concat(imageUris).length >0)
			return getOnDemandSubscriptionData(elementsUris.concat(imageUris).join(','), channelCode, currencyCode, request.ownerId)
		else
			return 'NoRecords';
	}).then(function () {

		return restservices.getCall(optionsgetVPA);
	}).then(function (roleDetail) {
		isVpaAllowed = roleDetail.inrole;
	}).then(function () {
				if(elementsUris.concat(imageUris).length >0){
					return [
						getpricingSummary(request.elements, isVpaAllowed, request.workloadId, channelCode, currencyCode), //TODO no way to make it as a single DB call -- need to find
						mysql.chargeamountunitlevelPricing((elementsUris.concat(imageUris)).join(','), workloadinfo.ownerId, currencyCode, channelCode, conn),
						mysql.resourcetypelevelPricing(elementsUris.concat(imageUris).join(','), workloadinfo.ownerId, currencyCode, channelCode, conn),
						mysql.chargeAmountUnitlevelPricingByActiveResource('',workloadinfo.workloadId,conn),
						mysql.resourcetypelevelPricingByActiveResource('', workloadinfo.workloadId,conn)
					]
				}else{
					return [
						getpricingSummary(request.elements, isVpaAllowed, request.workloadId, channelCode, currencyCode), //TODO no way to make it as a single DB call -- need to find
						[],
						[],
						[],
						[]
					]
				}

			}).spread(function (usernamesResult, pricingDetail, resourcePricingDetail, actualPricingDetail, actualResourcePricingDetail) {

				trace.info('pricingDetail: ' + JSON.stringify(pricingDetail)
							+ '\n' +
							'resourcePricingDetail: ' + JSON.stringify(resourcePricingDetail));

				workloadinfo.elements = elementArray; //final Step //Result1

				//merge configurable resource with concrete resource pricing details - handle configurable resource
				if (configurableElementarray.length > 0) {
					var concatednatedArray = pricingDetail.concat(JSON.parse(JSON.stringify(configurableElementarray)));
					var concatednatedArray2 = resourcePricingDetail.concat(configurableElementarray);

					var finalResult = [];
					var i = concatednatedArray.reduce(function (result, o) {
						var key = o.chargeAmountUnit + o.currencyCode;
						if (!(key in result)) {
							result.arr.push(result[key] = o);
							finalResult.push(result);
						}
						else {
							result[key].setupCost += Number(o.setupCost);
							result[key].recurringCost += Number(o.recurringCost);
							result[key].chargeAmount += Number(o.chargeAmount);
							result[key].chargeAmount = Math.round(result[key].chargeAmount * 100) / 100;
							result[key].setupCost = Math.round(result[key].setupCost * 100) / 100;
						}
						return result;
					}, {arr: []}).arr;

					pricing.chargeamountunitLevel = i;
					//trace.info(i); //Result2

					var j = concatednatedArray2.reduce(function (result, l) {
						var key = l.chargeAmountUnit + l.currencyCode + l.Name;
						if (!(key in result)) {
							result.arr.push(result[key] = l);
						}
						else {
							result[key].setupCost += Number(l.setupCost);
							result[key].recurringCost += Number(l.recurringCost);
							result[key].chargeAmount += Number(l.chargeAmount);
							result[key].chargeAmount = Math.round(result[key].chargeAmount * 100) / 100;
							result[key].setupCost = Math.round(result[key].setupCost * 100) / 100;
						}
						return result;
					}, {arr: []}).arr;

					pricing.resourcetypeLevel = j;
					
			
		}
		else {
			pricing.chargeamountunitLevel = pricingDetail;
			pricing.resourcetypeLevel = resourcePricingDetail;
		}
		workloadinfo.pricing = { estimated : pricing };
		workloadinfo.pricing.actual = { chargeamountunitLevel : actualPricingDetail, resourcetypeLevel : actualResourcePricingDetail };
		
		if(noLocalePrice)
			res.send(workloadinfo);
		else 
			res.send(formatPricingSummarytoLocale(workloadinfo));

	}).catch(function onReject(err) {
		trace.info('FAILED', err);
		res.statusCode = 404;
		res.send({});
	}).catch(function (error) {
		trace.error('Error Occurred in : ' + error.stack);
		res.statusCode = 500;
		return res.send({error: error.stack});
	});

		}// if channelconfig condition ends
	});

	//TODO write it as a inline function
	function  parseElementArray(element) {
		return new promise(function (fulfill, reject) {
			if (element.uri.match('sg/') || element.uri.match('kp/') || element.uri.match('domain/')) {//TODO not adding the unwanted uris sg, kp
				trace.debug(element.uri + ' ---- ' + 'Skipped');
				return fulfill('Succeeded');
			}
			else {
				if (!((element.uri).match('/configurable'))) {
					elementsUris.push(element.uri);
					if (element.parameters.imageUri)
						imageUris.push(element.parameters.imageUri);
				}
				else {
					configurableUris.push(element.uri);
					if (element.parameters.imageUri)
						configurableImageUris.push(element.parameters.imageUri);
				}
				return fulfill('Succeeded');
			}
		});
	}

	function getpricingSummary(elements, isVpaAllowed, workloadId, channelCode, currencyCode){
		return new promise(function (fulfill, reject) {
			var series = elements.map(function (element) {
				element.workloadId = workloadId;
				return formElementArrayPricing(element, isVpaAllowed, channelCode, currencyCode);
			});

			promise.settle(series).then(function (resultsOfelementArrayPricing) {
				for (var i = 0; i < resultsOfelementArrayPricing.length; i++) {
					if (resultsOfelementArrayPricing[i].isFulfilled()) {
						elementArray.push(resultsOfelementArrayPricing[i].value());
					}
					//TODO avoiding 404 error -- comment the else block
					else {
						return reject(resultsOfelementArrayPricing[i].reason());
					}
				}
				trace.info('ElementlevelPricing has been added');
				return fulfill('Succeed');

			});

		});
	}


	function formElementArrayPricing(element, isVpaAllowed, channelCode, currencyCode) {
		trace.info('formElementArrayPricing >>>'+JSON.stringify(element));
		return new promise(function (fulfill, reject) {

			if (element.uri.match('/configurable')) {
				//var configJson = JSON.parse(elements.parameters.ResourceParameters);
				return promise.delay(0000).then(function(){

					return [
						getConfigPricingFromResourceQuery_promise(request.ownerId, element, channelCode, currencyCode),
						getConfigResourceType(element.uri)
						//TODO: Add the attribute Name : [resourceTypeValue] in the pricingDetail json
						//TODO: Get the type[Name] from ResourceService
					]
				}).spread(function (configJson, resourceType) {

					metadataModified = element || {};

					if (configJson && configJson.listPrice > -1) {
						configurableElementarray.push(JSON.parse(JSON.stringify(
							{ "chargeAmount": Math.round((configJson.listPrice+configJson.InitialCharge) * 100)/100,
								"setupCost": Math.round(configJson.InitialCharge * 100)/100,
								"recurringCost": Math.round(configJson.listPrice * 100)/100,
								"chargeAmountUnit": configJson.ChargeAmountUnit,
								"currencyCode": configJson.CurrencyCode,
								"Name":resourceType }
						)));

						var pricingDetail = {
							"charge": {
								"amount": Math.round(configJson.listPrice * 100)/100,
								"setupCost": Math.round(configJson.InitialCharge * 100)/100,
								"unit": configJson.ChargeAmountUnit,
								"currencyCode": configJson.CurrencyCode
							}
						};
						if (isVpaAllowed === true) {

							var margin = Math.round((configJson.listPrice - configJson.displayCost) * 100)/100;
							var marginPercent =  ((configJson.listPrice - configJson.displayCost)/configJson.listPrice) * 100;
							var marginPercentRound = Math.round(marginPercent * 100)/100;

							pricingDetail.cost = {
								"amount": configJson.displayCost,
								"unit": configJson.ChargeAmountUnit,
								"currencyCode": configJson.CurrencyCode
							};

							pricingDetail.list = {
								"amount": configJson.listPrice,
								"unit": configJson.ChargeAmountUnit,
								"currencyCode": configJson.CurrencyCode
							};

							pricingDetail.margin = {
								"amount": margin,
								"unit": configJson.ChargeAmountUnit,
								"currencyCode": configJson.CurrencyCode,
								"percent": marginPercent
							};

						}


						//if (isVpaAllowed === true) { //TODO Have to verify the how to set the VPA here in GCM Configurable
						//TODO : VPA Details for config resource must come from ResourceService API
						//}
						metadataModified.pricingSummary = [pricingDetail];
						var elementUri = [];
						elementUri = elementUri.concat(element.uri);
						if(element.parameters && element.parameters.imageUri){
							elementUri = elementUri.concat(element.parameters.imageUri);
						}

						return mysql.elementlevelpricing(elementUri.join(), request.ownerId, currencyCode, channelCode, isVpaAllowed, conn).then(function (elementlevelpricingSummary) {

							metadataModified = element || {};
							var basePricingDetail = getElementLevelPricingStructure(elementlevelpricingSummary, isVpaAllowed);
							if(basePricingDetail && basePricingDetail.length > 0) {

								var basePrice = {
									"basePrice" : basePricingDetail[0].charge
								}
								metadataModified.pricingSummary.push(basePrice);
								return fulfill(metadataModified);
							}
						});

					}
					else {
						metadataModified.pricingSummary = [{
							"charge": {
								amount: 0.00,
								unit: "/hr",
								currencyCode: "USD"
							}
						}];
					}
					// element = metadataModified;
					return fulfill(metadataModified);

				}).catch(function onReject(err) {
					reject(err)
					trace.error(err);
					if(err && err.stack){
						trace.debug(err.stack);
					}
				}).catch(function (error) {
					reject(error)
					trace.error(error);
					if(error && error.stack){
						trace.debug(error.stack);
					}
				});
			}
			else {
				var elementUri = [];
				elementUri = elementUri.concat(element.uri);
				if(element.parameters && element.parameters.imageUri){
					elementUri = elementUri.concat(element.parameters.imageUri);
				}
				
				return mysql.elementlevelpricing(elementUri.join(), request.ownerId, currencyCode, channelCode, isVpaAllowed, conn).then(function (elementlevelpricingSummary) {

					metadataModified = element || {};
					var pricingDetail = getElementLevelPricingStructure(elementlevelpricingSummary, isVpaAllowed);
					metadataModified.pricingSummary = pricingDetail;
					if(pricingDetail && pricingDetail.length > 0) {

						var basePrice = {
							"basePrice" : pricingDetail[0].charge
						}
						metadataModified.pricingSummary.push(basePrice);
					}
				    return fulfill(metadataModified);
				});
			}
		});
	}
	function getElementLevelPricingStructure(elementlevelpricingSummary, isVpaAllowed){

		var pricingDetail = {};

		if (elementlevelpricingSummary.length > 0) {

			pricingDetail = {
				"charge": {
					"amount": elementlevelpricingSummary[0].chargeAmount,
					"unit": elementlevelpricingSummary[0].chargeAmountUnit,
					"currencyCode": elementlevelpricingSummary[0].currencyCode
				}
			};
			if (isVpaAllowed === true) { // TODO hardcoded as of now

				pricingDetail.cost = {
					"amount": elementlevelpricingSummary[0].costPrice,
					"unit": elementlevelpricingSummary[0].costChargeAmountUnit,
					"currencyCode": elementlevelpricingSummary[0].costCurrencyCode
				};

				pricingDetail.list = {
					"amount": elementlevelpricingSummary[0].listPrice,
					"unit": elementlevelpricingSummary[0].listChargeAmountUnit,
					"currencyCode": elementlevelpricingSummary[0].listCurrencyCode
				};

				pricingDetail.margin = {
					"amount": elementlevelpricingSummary[0].margin,
					"unit": elementlevelpricingSummary[0].marginChargeAmountUnit,
					"currencyCode": elementlevelpricingSummary[0].marginCurrencyCode,
					"percent": elementlevelpricingSummary[0].marginPercent
				};

			}
			//metadataModified.pricingSummary = elementlevelpricingSummary;
		} else {
			pricingDetail = {
								"charge": {
									amount: 0.00,
									unit: "/hr",
									currencyCode: "USD"
								}
					        };
		}
		return [pricingDetail];
	};
	
	function formatPricingSummarytoLocale(pricingJson) {

		try{
			var decimalprecision = channelConfig_global.decimalprecision?channelConfig_global.decimalprecision : 0;
		    	var currencylocale = channelConfig_global.localeCode?channelConfig_global.localeCode : 'en-US';
			var elements = pricingJson.elements;
			
			for (var i in elements){
			
				var pricingSummary = JSON.parse(JSON.stringify(elements[i].pricingSummary));
				if(pricingJson.elements[i].pricingSummary && pricingJson.elements[i].pricingSummary[0].charge) {
					
					pricingJson.elements[i].pricingSummary[0].charge.amount = (pricingSummary[0].charge.amount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				}
				if(pricingJson.elements[i].pricingSummary && pricingJson.elements[i].pricingSummary[1].basePrice) {	
					
					pricingJson.elements[i].pricingSummary[1].basePrice.amount = (pricingSummary[1].basePrice.amount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				}
			}
			
			if(pricingJson.pricing && pricingJson.pricing.estimated && pricingJson.pricing.estimated.chargeamountunitLevel && (pricingJson.pricing.estimated.chargeamountunitLevel).length > 0) {
				
				pricingJson.pricing.estimated.chargeamountunitLevel[0].chargeAmount = (pricingJson.pricing.estimated.chargeamountunitLevel[0].chargeAmount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.estimated.chargeamountunitLevel[0].setupCost = (pricingJson.pricing.estimated.chargeamountunitLevel[0].setupCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.estimated.chargeamountunitLevel[0].recurringCost = (pricingJson.pricing.estimated.chargeamountunitLevel[0].recurringCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.estimated.resourcetypeLevel[0].chargeAmount = (pricingJson.pricing.estimated.resourcetypeLevel[0].chargeAmount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.estimated.resourcetypeLevel[0].setupCost = (pricingJson.pricing.estimated.resourcetypeLevel[0].setupCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.estimated.resourcetypeLevel[0].recurringCost = (pricingJson.pricing.estimated.resourcetypeLevel[0].recurringCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
			}
			
			if(pricingJson.pricing && pricingJson.pricing.actual && pricingJson.pricing.actual.chargeamountunitLevel && (pricingJson.pricing.actual.chargeamountunitLevel).length > 0) {
			
				pricingJson.pricing.actual.chargeamountunitLevel[0].chargeAmount = (pricingJson.pricing.actual.chargeamountunitLevel[0].chargeAmount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.actual.chargeamountunitLevel[0].setupCost = (pricingJson.pricing.actual.chargeamountunitLevel[0].setupCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.actual.chargeamountunitLevel[0].recurringCost = (pricingJson.pricing.actual.chargeamountunitLevel[0].recurringCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.actual.resourcetypeLevel[0].chargeAmount = (pricingJson.pricing.actual.resourcetypeLevel[0].chargeAmount).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.actual.resourcetypeLevel[0].setupCost = (pricingJson.pricing.actual.resourcetypeLevel[0].setupCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
				pricingJson.pricing.actual.resourcetypeLevel[0].recurringCost = (pricingJson.pricing.actual.resourcetypeLevel[0].recurringCost).toLocaleString(currencylocale, { minimumFractionDigits: decimalprecision, maximumFractionDigits: decimalprecision });
			}
			
		} catch(e) {	
			trace.error(e);
		}	
		trace.info('/billing/pricingdetails response >>'+JSON.stringify(pricingJson));
		return pricingJson;
	};
});

/*app.post('/billing/pricingdetails', function (req, res) {
    var request = req.body;

    if (request.elements && request.elements.length > 0) {
        var elementsUris = []; // list of normal uris
        var imageUris = []; // list of normal uris
        var configurableUris = []; // list of config uri's
        var configurableImageUris = []; // list of config uri's
        var elementArray = []; // to construct the elementsArray with PricingDetails in WorkLoadInfo
        var metadataModified = {}; // to construct the metadata under each element with pricing detail
        var pricing = {};
        var configurableElementarray = []; // for chargeAmountUnitLevelPricing

        var isVpaAllowed = false;
        // userid to get the VPA rule for Showing Pricing details
        var VPAUserId = req.parentUserId || req.userId;

        var workloadinfo = {
            workloadId: request.workloadId,
            ownerId: request.ownerId,
            uniqueName: request.uniqueName,
            name: request.name
        };

        var headers = {
            "Content-Type": "application/json"
            //"Authorization": "Basic " + new Buffer(ownerid + ":" + ownerid).toString("base64")
            //'x-auth-token': req.headers['x-auth-token']
        };

        var optionsgetVPA = {
            host: config.authorizationServiceHost,
            port: config.authorizationServicePort,
            path: '/api/authorization/user/' + VPAUserId + '?role=' + config.VPARule + '&ownerId=' + request.ownerId,
            method: 'GET',
            headers: headers
        };

        var series = request.elements.map(function (element) {
            return parseElementArray(element);
        });

        promise.settle(series).then(function () {
            trace.debug(elementsUris.concat(imageUris).join(','));
            //call the configResource API's -- pass the configurableUris
            if(elementsUris.concat(imageUris).length >0)
                return getOnDemandSubscriptionData(elementsUris.concat(imageUris).join(','), request.ownerId)
            else
                return 'NoRecords';
        }).then(function () {

            return restservices.getCall(optionsgetVPA);
        }).then(function (roleDetail) {
            isVpaAllowed = roleDetail.inrole;
        }).then(function () {

            if(elementsUris.concat(imageUris).length >0){
                return [
                    getpricingSummary(request.elements, isVpaAllowed), //TODO no way to make it as a single DB call -- need to find
                    mysql.chargeamountunitlevelPricing((elementsUris.concat(imageUris)).join(','), workloadinfo.ownerId, conn),
                    mysql.resourcetypelevelPricing(elementsUris.concat(imageUris).join(','), workloadinfo.ownerId, conn)
                ]
            }else{
                return [
                    getpricingSummary(request.elements, isVpaAllowed), //TODO no way to make it as a single DB call -- need to find
                    [],
                    []
                ]
            }

        }).spread(function (usernamesResult, pricingDetail, resourcePricingDetail) {

            workloadinfo.elements = elementArray; //final Step //Result1

            //merge configurable resource with concrete resource pricing details - handle configurable resource
            if (configurableElementarray.length > 0) {
                var concatednatedArray = pricingDetail.concat(JSON.parse(JSON.stringify(configurableElementarray)));
				var concatednatedArray2 = resourcePricingDetail.concat(configurableElementarray);

                var finalResult = [];
                var i = concatednatedArray.reduce(function (result, o) {
                    var key = o.chargeAmountUnit + o.currencyCode;
                    if (!(key in result)) {
                        result.arr.push(result[key] = o);
                        finalResult.push(result);
                    }
                    else {
                        result[key].chargeAmount += Number(o.chargeAmount);
                        result[key].chargeAmount = Math.round(result[key].chargeAmount * 100) / 100;
                    }
                    return result;
                }, {arr: []}).arr;

                pricing.chargeamountunitLevel = i;
                //trace.info(i); //Result2

                var j = concatednatedArray2.reduce(function (result, l) {
                    var key = l.chargeAmountUnit + l.currencyCode + l.Name;
                    if (!(key in result)) {
                        result.arr.push(result[key] = l);
                    }
                    else {
                        result[key].chargeAmount += Number(l.chargeAmount);
                        result[key].chargeAmount = Math.round(result[key].chargeAmount * 100) / 100;
                    }
                    return result;
                }, {arr: []}).arr;

                pricing.resourcetypeLevel = j;
                //trace.info(j); //Result2
            }
            else {
                pricing.chargeamountunitLevel = pricingDetail;
                pricing.resourcetypeLevel = resourcePricingDetail;
            }
            workloadinfo.pricing = pricing;
            res.send(workloadinfo);

        }).catch(function onReject(err) {
            trace.info('FAILED', err);
            res.statusCode = 404;
            res.send({});
        }).catch(function (error) {
            trace.error('Error Occurred in : ' + error.stack);
            res.statusCode = 500;
            return res.send({error: error.stack});
        });

        //TODO write it as a inline function
        function  parseElementArray(element) {
            return new promise(function (fulfill, reject) {
                if (element.uri.match('sg/') || element.uri.match('kp/')) {//TODO not adding the unwanted uris sg, kp
                    trace.debug(element.uri + ' ---- ' + 'Skipped');
                    return fulfill('Succeeded');
                }
                else {
                    if (!((element.uri).match('/configurable'))) {
                        elementsUris.push(element.uri);
                        if (element.parameters.imageUri)
                            imageUris.push(element.parameters.imageUri);
                    }
                    else {
                        configurableUris.push(element.uri);
                        if (element.parameters.imageUri)
                            configurableImageUris.push(element.parameters.imageUri);
                    }
                    return fulfill('Succeeded');
                }
            });
        }


        function getpricingSummary(elements, isVpaAllowed){
            return new promise(function (fulfill, reject) {
                var series = elements.map(function (element) {
                    return formElementArrayPricing(element, isVpaAllowed);
                });

                promise.settle(series).then(function (resultsOfelementArrayPricing) {
                    for (var i = 0; i < resultsOfelementArrayPricing.length; i++) {
                        if (resultsOfelementArrayPricing[i].isFulfilled()) {
                            elementArray.push(resultsOfelementArrayPricing[i].value());
                        }
                        //TODO avoiding 404 error -- comment the else block
                        else {
                            return reject(resultsOfelementArrayPricing[i].reason());
                        }
                    }
                    trace.info('ElementlevelPricing has been added');
                    return fulfill('Succeed');
                });

            });
        }

        function formElementArrayPricing(element, isVpaAllowed) {

            return new promise(function (fulfill, reject) {
                if (element.uri.match('/configurable')) {
                    //var configJson = JSON.parse(elements.parameters.ResourceParameters);
                    return promise.delay(0000).then(function(){

                        return [
                            getConfigPricingFromResourceQuery_promise(request.ownerId, element),
                            getConfigResourceType(element.uri)
                            //TODO: Add the attribute Name : [resourceTypeValue] in the pricingDetail json
                            //TODO: Get the type[Name] from ResourceService
                        ]
                    }).spread(function (configJson, resourceType) {

                        metadataModified = element.metadata || {};

                        if (configJson && configJson.totalUnitPrice) {
                            configurableElementarray.push(JSON.parse(JSON.stringify(
                                { "chargeAmount": Math.round(configJson.totalUnitPrice * 100)/100,
                                    "chargeAmountUnit": configJson.ChargeAmountUnit,
                                    "currencyCode": configJson.CurrencyCode,
                                    "Name":resourceType }
                            )));

                            var pricingDetail = {
                                "charge": {
                                    "amount": Math.round(configJson.totalUnitPrice * 100)/100,
                                    "unit": configJson.ChargeAmountUnit,
                                    "currencyCode": configJson.CurrencyCode
                                }
                            };
                            //if (isVpaAllowed === true) { //TODO Have to verify the how to set the VPA here in GCM Configurable
                            //TODO : VPA Details for config resource must come from ResourceService API
                            //}
                            metadataModified.pricingSummary = [pricingDetail];
                        }
                        else {
                            metadataModified.pricingSummary = [{
                                "charge": {
                                    amount: 0.00,
                                    unit: "/hr",
                                    currencyCode: "USD"
                                }
                            }];
                        }
                        element.metadata = metadataModified;
                        return fulfill(element);

                    }).catch(function onReject(err) {
                        reject(err)
                        trace.error(err);
                        if(err && err.stack){
                            trace.debug(err.stack);
                        }
                    }).catch(function (error) {
                        reject(error)
                        trace.error(error);
                        if(error && error.stack){
                            trace.debug(error.stack);
                        }
                    });
                }
                else {
                    var elementUri = [];
                    elementUri = elementUri.concat(element.uri);
                    if(element.parameters && element.parameters.imageUri){
                        elementUri = elementUri.concat(element.parameters.imageUri);
                    }
                    return mysql.elementlevelpricing(elementUri.join(), request.ownerId, isVpaAllowed, conn).then(function (elementlevelpricingSummary) {

                        metadataModified = element.metadata || {};
                        var pricingDetail = {};

                        if (elementlevelpricingSummary.length > 0) {

                            pricingDetail = {
                                "charge": {
                                    "amount": elementlevelpricingSummary[0].chargeAmount,
                                    "unit": elementlevelpricingSummary[0].chargeAmountUnit,
                                    "currencyCode": elementlevelpricingSummary[0].currencyCode
                                }
                            };
                            if (isVpaAllowed === true) { // TODO hardcoded as of now

                                pricingDetail.cost = {
                                    "amount": elementlevelpricingSummary[0].costPrice,
                                    "unit": elementlevelpricingSummary[0].costChargeAmountUnit,
                                    "currencyCode": elementlevelpricingSummary[0].costCurrencyCode
                                };

                                pricingDetail.list = {
                                    "amount": elementlevelpricingSummary[0].listPrice,
                                    "unit": elementlevelpricingSummary[0].listChargeAmountUnit,
                                    "currencyCode": elementlevelpricingSummary[0].listCurrencyCode
                                };

                                pricingDetail.margin = {
                                    "amount": elementlevelpricingSummary[0].margin,
                                    "unit": elementlevelpricingSummary[0].marginChargeAmountUnit,
                                    "currencyCode": elementlevelpricingSummary[0].marginCurrencyCode,
                                    "percent": elementlevelpricingSummary[0].marginPercent
                                };

                            }
                            //metadataModified.pricingSummary = elementlevelpricingSummary;
                            metadataModified.pricingSummary = [pricingDetail];
                        }
                        else {
                            metadataModified.pricingSummary = [{
                                "charge": {
                                    amount: 0.00,
                                    unit: "/hr",
                                    currencyCode: "USD"
                                }
                            }];
                        }
                        element.metadata = metadataModified;

                        return fulfill(element);
                    });
                }
            });
        }
    }else{
        res.statusCode = 400;
        res.send({});
    }
});*/

function getOnDemandSubscriptionData(resourceIdentifiers,channelCode,currencyCode,accessKey) {

    return new promise(function(fulfill,reject) {
        return mysql.getOnDemandSubscriptionData(resourceIdentifiers,channelCode,currencyCode, conn).then (function(result){
            //if (result.IsResourceURIExists === 'true'){ //TODO returning false for sg kp have to fix these
            trace.debug(JSON.stringify(result));
            if (result.length <= 0 ){
                return fulfill(true);
            }
            else{
                var series = result.map(function(resourceIdentifier){
                  return getOnDemandSubscriptionDataByResourceUri(resourceIdentifier.Col,channelCode,currencyCode, accessKey);

                });

                return promise.settle(series).then(function (resultsFromResourceService) {
                    for(var i=0; i< resultsFromResourceService.length; i++){
                        if(resultsFromResourceService[i].isRejected()) {
                            //TODO avoiding 404 error -- comment the below return reject line
                            return reject(resultsFromResourceService[i].reason());
                        }
                        else{ //TODO put it as separate func with promoise.settle
                            insertSubscriptionPush(resultsFromResourceService[i].value(), function(err, result) {
                                if(err) {
                                    trace.warn('insertSubscriptionPush error : '+err);
                                    //TODO avoiding 404 error -- comment the below reject line
                                    return reject(err);
                                }
                                else {
                                    trace.info('On Demand data is inserted in Subscription successfully');
                                }
                            });
                        }
                    }
                    return fulfill();
                });
            }
        }).catch(function onReject(err) {
            trace.warn('FAILED', err);
            return reject(err);

        }).catch(function(error){
            if(error.stack)
                trace.error('Error Occurred in : '+ error.stack);
            return reject(error);
        });
    });
}

function getOnDemandSubscriptionDataByResourceUri(resourceIdentifier,channelCode,currencyCode, accessKey) {
    return new promise(function(fulfill,reject) {

        // prepare the header
        var getHeaders = {
            'Content-Type': 'application/json'
           // "Authorization": "Basic " + new Buffer(accessKey + ":" + accessKey).toString("base64")
        };

        //TODO Implement new Auth Model
        getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
        getHeaders['ownerId'] = accessKey;


        var optionsget = {
            host: config.resourceServiceHost,
            port: config.resourceServicePort,
            path: '/apiv1.0/resourceQuery/subscription?uri=' + resourceIdentifier + '&currencyCode=' + currencyCode + '&channelCode=' + channelCode,
            method: 'GET',
            headers: getHeaders
        };
        trace.debug(JSON.stringify(optionsget));

        return restservices.getCall(optionsget).then(function (resourceServiceresult) {

            if (typeof (resourceServiceresult.length) === 'undefined') {

                resourceServiceresult = [resourceServiceresult];
            }
            // to adopt the resource V2
            if (resourceServiceresult[0].subscriptionServiceTerm) {
                return fulfill(resourceServiceresult);
            }
            else return reject('error');

        }).catch(function onReject(err) {
            trace.warn('FAILED', err);
            return reject(err);

        }).catch(function(error){
            if(error.stack)
                trace.error('Error Occurred in : '+ error.stack);
            return reject(error);
        });
    });
}

// get pricing summary only for active resources - exposed in dashboard
app.post('/billing/pricingdetails/isactive/:id', function (req, res) {
    var request = req.body;
    var response = {};
    var workloadinfo = {
        workloadId: request.workloadId,
        ownerId: request.ownerId,
        uniqueName: request.uniqueName,
        name: request.name

    };
    var ownerid = request.ownerId;
    trace.info(ownerid);
    var pricing = {};
    var isVpaAllowed = false;
    var VPAUserId = req.parentUserId || req.userId;

    if (request.elements && request.elements.length > 0) {
        var elementArray = [];
        var allresourceIdentifierArray = [];
        var metadataModified = {};
        var configurableElementarray = [];
        var workloadid = request.workloadId;
        var allresourceIdentifiers = null;

        //TODO Implement new Auth Model
        var headers = {
            "Content-Type": "application/json"
            //"Authorization": "Basic " + new Buffer(ownerid + ":" + ownerid).toString("base64")
            //'x-auth-token': req.headers['x-auth-token']
        };
        /*
        var optionsget = {
            host : config.apiv2host,
            port : config.apiv2port,
            path: '/apiv2/instance?workloadId=' + workloadid,
            method: 'GET',
            headers: headers
        };
        */

        var optionsgetVPA =  {
            host : config.authorizationServiceHost,
            port : config.authorizationServicePort,
            path: '/api/authorization/user/' +VPAUserId + '?role=' + config.VPARule+'&ownerId='+request.ownerId,
            method: 'GET',
            headers: headers
        };

        promise.delay(0000).then (function(){
            return [
                null,
                //restservices.getCall(optionsget),
                restservices.getCall(optionsgetVPA)
            ]
        }).spread(function(apiv2Response,roleDetail) {

            isVpaAllowed = roleDetail.inrole;
/*
            for (var i = 0; i < apiv2Response.length; i++) {

                if (apiv2Response[i].instanceId) {
                    allresourceIdentifierArray.push(apiv2Response[i].instanceId);
                    trace.info('apiv2 response [' + i + ']  instanceID: ' + apiv2Response[i].instanceId);
                }
                else {
                    trace.warn('apiv2 InstanceId is empty');
                }
            }
            allresourceIdentifiers = allresourceIdentifierArray.join(',');
            trace.info(allresourceIdentifiers);
            */
            return allresourceIdentifiers;

        }).then(function() {
                return [
                    getpricingSummary(request.elements), //TODO no way to make it as a single DB call -- need to find
                    mysql.chargeAmountUnitlevelPricingByActiveResource( allresourceIdentifiers,workloadid,conn),
                    mysql.resourcetypelevelPricingByActiveResource(allresourceIdentifiers, workloadid, conn),
                ]
        }).spread(function(usernamesResult,pricingDetail,resourcePricingDetail) {

            workloadinfo.elements = elementArray; //final Step //Result1

            trace.info(JSON.stringify(pricingDetail));

            //merge configurable resource with concrete resource pricing details - handle configurable resource
            if (configurableElementarray.length > 0) {

                var concatednatedArray = pricingDetail.concat(configurableElementarray);

                trace.info(pricingDetail);

                var finalResult = [];

                var i = concatednatedArray.reduce(function (result, o) {

                    var key = o.chargeAmountUnit + o.currencyCode;

                    if (!(key in result)) {
                        result.arr.push(result[key] = o);
                        finalResult.push(result);
                    }

                    else {
                        result[key].chargeAmount += Number(o.chargeAmount);
                        result[key].chargeAmount = Math.round(result[key].chargeAmount * 100) / 100;
                    }

                    return result;
                }, {arr: []}).arr;

                pricing.chargeamountunitLevel = i;

                trace.info(i); //Result2


                var concatednatedArray2 = resourcePricingDetail.concat(configurableElementarray);

                var j = concatednatedArray2.reduce(function (result, l) {

                    var key  = l.chargeAmountUnit + l.currencyCode + l.Name;

                    if (!(key in result)) {
                        result.arr.push(result[key] = l);
                    }

                    else {
                        result[key].chargeAmount += Number(l.chargeAmount);
                        result[key].chargeAmount = Math.round(result[key].chargeAmount * 100)/100;
                    }

                    return result;
                }, { arr: [] }).arr;

                pricing.resourcetypeLevel = j;
                trace.info(j); //Result2

            }
            else {
                pricing.chargeamountunitLevel = pricingDetail;
                pricing.resourcetypeLevel = resourcePricingDetail;
            }

            workloadinfo.pricing = pricing;
            res.send(workloadinfo);

        }).catch(function onReject(err) {
            trace.info('FAILED', err);
            res.statusCode = 404;
            res.send({});
        }).catch(function(error){
            trace.error('Error Occurred in : '+ error.stack);
            res.statusCode = 500;
            return res.send({error: error.stack});
        });

        function getpricingSummary(elements) {
            return new promise(function(fulfill,reject) {
                var series = elements.map(function (element) {
                    return formElementArrayPricing (element);
                });

                promise.settle(series).then(function (resultsOfelementArrayPricing) {
                    for(var i=0; i< resultsOfelementArrayPricing.length; i++){
                        if(resultsOfelementArrayPricing[i].isFulfilled()) {
                            elementArray.push(resultsOfelementArrayPricing[i].value());
                        }
                        else{
                            return reject(resultsOfelementArrayPricing[i].reason());
                        }
                    }
                    trace.info('ElementlevelPricing has been added');
                    return fulfill('Succeed');
                });
            });
        }


        function formElementArrayPricing(element) {
            return new promise(function (fulfill, reject) {

                if (element.uri.match('/configurable')) {
                    //call resourceAPi to get the pricing details
                    //configurableElementarray.push(elementArray[index].metadata.pricingSummary[0]);
                    return reject('uri not found');
                }
                else {
                    return mysql.elementlevelpricing(element.uri,ownerid, currencyCode, channelCode, isVpaAllowed,conn).then(function (elementlevelpricingSummary) {

                        metadataModified = element.metadata || {};

                        //GCM-3979
                        if (elementlevelpricingSummary.length > 0) {
                            metadataModified.pricingSummary = elementlevelpricingSummary;
                        }
                        else {
                            metadataModified.pricingSummary = [{
                                chargeAmount: 0.00,
                                chargeAmountUnit: "/hr",
                                currencyCode: "USD"
                            }];
                        }
                        element.metadata = metadataModified;

                        return fulfill(element);
                    });
                }
            });
        }
    }
    else{
        return res.send({});
    }
});


function insertSubscriptionPush(subscriptionjson, callback) {

    var subscriptiondata = JSON.parse(JSON.stringify(subscriptionjson));
    trace.debug('subscriptiondata : ' + JSON.stringify(subscriptiondata));

    if (subscriptiondata && subscriptiondata.length > 0) {

        trace.info('Subscription Array Length : ' + subscriptiondata.length);
        async.forEachSeries(subscriptiondata, createSubscriptionElement, function (err) {
            if (err) {
                trace.warn(err);
                return callback(err);
            }
            else {
                return callback();
            }
        });
    }
}

function createSubscriptionElement(element, callback) {
    if(typeof element.subscriptionServiceTerm != 'undefined'){

        var elements = JSON.parse(JSON.stringify(element));
        trace.debug(JSON.stringify(elements));

        var subscriptionserviceterm = elements.subscriptionServiceTerm;

        var chargeAmount = [], chargeamountUnit = [],
            currencyCode = [], chargeperiodValue = [],
            priceReference = [];

        var sequenceNumber = [],
            startingValue = [],
            endingValue = [],
            isDefault = [];

        var BillingPeriodFrequency = [],
            BillingPeriodFrequencyType = [],
            UsageRoundOffUnit = [],
            UsageRoundOffType = [],
			UsageRoundOffRule = [],
			UsageRoundOffFrequency = [],
            StoppedStateChargeValue = [],
            chargeType = [],
            priceReferenceSSTA = [];
        //trace.info('TermCharges Array Length : '+ subscriptionserviceterm.SubscriptionServiceTermCharges.length);

        var SubscriptionServiceTermkeys = Object.keys(subscriptionserviceterm.SubscriptionServiceTermCharges);
        for (var i = 0; i < SubscriptionServiceTermkeys.length; i++) {

            var subscriptionservicetermChargesBasedOnKey = subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].Tierpricing;

            // TODO needs to be modify the below section -- it should be moved to provderCost/listPrice inside
            BillingPeriodFrequency.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].BillingPeriodFrequency || 1);
            UsageRoundOffType.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffType || null);
            StoppedStateChargeValue.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].StoppedStateChargeValue || 0);
            UsageRoundOffUnit.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffUnit || null);
			if(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffRule){
				UsageRoundOffRule.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffRule || null);
			}
			if(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffFrequency){
				UsageRoundOffFrequency.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].UsageRoundOffFrequency || null);
			}
            BillingPeriodFrequencyType.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].BillingPeriodFrequencyType || null);
            chargeType.push(subscriptionserviceterm.SubscriptionServiceTermCharges[SubscriptionServiceTermkeys[i]].ChargeType || null);
            priceReferenceSSTA.push(SubscriptionServiceTermkeys[i]);

            for (var j = 0; j < subscriptionservicetermChargesBasedOnKey.length; j++) {

                // SubscriptionServiceTermCharges values
                var subscriptionservicetermCharges = subscriptionservicetermChargesBasedOnKey[j];

                priceReference.push(SubscriptionServiceTermkeys[i]);
                chargeAmount.push(subscriptionservicetermCharges.ChargeAmount);
                chargeamountUnit.push(subscriptionservicetermCharges.ChargeAmountUnit);
                currencyCode.push(subscriptionservicetermCharges.CurrencyCode);
                chargeperiodValue.push(subscriptionservicetermCharges.ChargePeriodValue);

                //added for tier
                sequenceNumber.push(subscriptionservicetermCharges.SequenceNumber || null);
                startingValue.push(subscriptionservicetermCharges.StartingValue || null);
                endingValue.push(subscriptionservicetermCharges.EndingValue || null);
                isDefault.push(typeof subscriptionservicetermCharges.IsDefault === 'undefined' ? 0 : subscriptionservicetermCharges.IsDefault);

            }
        }
        var functionName = 'createsubscriptiondata';

        var req = {

            //reqresourceIdentifier: elements.uri || null,
			reqresourceIdentifier: elements.resourceUri || null,
			reqSubscriptionChannelCode: elements.channelCode || null,
			reqSubscriptionCurrencyCode: elements.currencyCode || null,
            reqextReferenceId: elements.extReferenceId || null,
            reqResourceDescription: subscriptionserviceterm.ResourceDescription || '',
            reqresourceType: subscriptionserviceterm.ResourceType,
            reqisautoRenew:  (elements.autorenew && 'yes' == elements.autorenew) ? 1 : 0,
            reqistaxInclusive:  typeof subscriptionserviceterm.IsTaxInclusive === 'undefined' ? 0 : subscriptionserviceterm.IsTaxInclusive,

			//custom product fields - optional params (eg: Abtis)
			reqcn_option_int_1: elements.optionParameters && elements.optionParameters.cn_option_int_1 || null,
			reqcn_option_int_2: elements.optionParameters && elements.optionParameters.cn_option_int_2 || null,
			reqcn_option_string_1: elements.optionParameters && elements.optionParameters.cn_option_string_1 || null,
			reqcn_option_string_2: elements.optionParameters && elements.optionParameters.cn_option_string_2 || null,
			reqcn_option_string_3: elements.optionParameters && elements.optionParameters.cn_option_string_3 || null,

            /*TODO needs to be modify the below section*/
            reqbillingPeriodfrequency: BillingPeriodFrequency.join(),
            requsageRoundOffType: UsageRoundOffType.join(),
            reqstoppedStateChargeValue: StoppedStateChargeValue.join(),
            requsageRoundOffUnit: UsageRoundOffUnit.join(),
			reqUsageRoundOffRule: UsageRoundOffRule.join(),
			reqUsageRoundOffFrequency: UsageRoundOffFrequency.join(),

            reqbillingPeriodFrequencyType: BillingPeriodFrequencyType.join(),
            reqchargeTypes: chargeType.join(),
            reqpriceReferenceSSTA: priceReferenceSSTA.join(),

            reqPriceReference: priceReference.join(), // chargeAmounts
            reqchargeAmounts: chargeAmount.join(), // chargeAmounts
            reqchargeamountUnits: chargeamountUnit.join(),
            reqcurrencyCodes: currencyCode.join(),
            reqchargeperiodValues: chargeperiodValue.join(),

            reqsequenceNumbers: sequenceNumber.join(),
            reqstartingValues: startingValue.join(),
            reqendingValues: endingValue.join(),
            reqisDefaults: isDefault.join(),            
            reqfreeperiodflag:  (elements.additionalparameters && 'Yes' == elements.additionalparameters.freeperiodflag) ? 1 : 0,
            reqfreeperiod: (elements.additionalparameters && elements.additionalparameters.freeperiod) ?  elements.additionalparameters.freeperiod : 1,
            reqminimumusageperiod: (elements.additionalparameters && elements.additionalparameters.minimumusageperiod) ? elements.additionalparameters.minimumusageperiod : 1,
            xionservicenumber: (elements.additionalparameters && elements.additionalparameters.xionservicenumber) ? elements.additionalparameters.xionservicenumber : null,
            xionservicename: (elements.additionalparameters && elements.additionalparameters.xionservicename) ? elements.additionalparameters.xionservicename : null,
            xiondetailsforinitial: (elements.additionalparameters && elements.additionalparameters.xiondetailsforinitial) ? elements.additionalparameters.xiondetailsforinitial : null,
            xiondetailsformonthly: (elements.additionalparameters && elements.additionalparameters.xiondetailsformonthly) ? elements.additionalparameters.xiondetailsformonthly : null,
            xiondetailsforother: (elements.additionalparameters && elements.additionalparameters.xiondetailsforother) ? elements.additionalparameters.xiondetailsforother : null,
            autorenewalperiod: (elements.additionalparameters && elements.additionalparameters.autorenewalperiod) ? elements.additionalparameters.autorenewalperiod : 1,
            productnameforsystemlinkage: (elements.additionalparameters && elements.additionalparameters.productnameforsystemlinkage) ? elements.additionalparameters.productnameforsystemlinkage : null,
            cdbinfo: (elements.additionalparameters && elements.additionalparameters.cdbinfo) ? elements.additionalparameters.cdbinfo : null,
			reqnoteforbilling: (elements.additionalparameters && elements.additionalparameters.noteforbilling) ? elements.additionalparameters.noteforbilling : null           
        };

        if (req !== '' && req.reqresourceIdentifier && req.reqchargeAmounts && req.reqchargeamountUnits
            && req.reqcurrencyCodes && req.reqsequenceNumbers) {

            return subscriptiondatamysql.execute(functionName, req, conn, function (err, result) {
                if (err) {
                    var errorString = JSON.stringify(err, null, 2);
                    trace.warn('errorString: ' + errorString);
                    return callback(errorString);
                }

                else {
                	if(elements.dependentProducts && elements.dependentProducts.oneOf){
                		trace.info("Core product Add ons ::"+JSON.stringify(elements.dependentProducts.oneOf));
                		var arr = elements.dependentProducts.oneOf;
                		updateSubscriptionAddOns(arr,req).then(function (){
                			trace.info("Add-ons attributed updated : :");                            
                        }).catch(function onReject(err) {
                            trace.warn('FAILED', err);                           
                        }).catch(function(error) {
                            trace.error('common.Catch:' + error);
                            if(error && error.stack)
                                trace.debug('Error Occurred in : '+ error.stack);                           
                        });
                	}
                    if (elements.subscriptionServiceTerm.dependencies) {
                        trace.info(JSON.stringify(elements.subscriptionServiceTerm.dependencies));
                        var arr = elements.subscriptionServiceTerm.dependencies;

                        return createSubscriptionDependent(arr,req.reqresourceIdentifier).then(function (){
                            return callback(null, elements.uri);
                        }).catch(function onReject(err) {
                            trace.warn('FAILED', err);
                            return callback(err,null);
                        }).catch(function(error) {
                            trace.error('common.Catch:' + error);
                            if(error && error.stack)
                                trace.debug('Error Occurred in : '+ error.stack);
                            return callback(error,null);
                        });
                    } else {
                        return callback(null, elements.uri)
                    }
                }
            });
        }else {
            trace.warn('Subscription push encountered error in resource service');
            return callback('Subscription push encountered error in resource service');
        }
    }else{
        trace.debug('undefined');
        return callback(null,'Success');
    }
}

function updateSubscriptionAddOns(arr,req){
	
	return new promise(function(fulfill,reject) {
        var series = arr.map(function (addOns) {        	
            var addOnUri = addOns.uri || null;            
            return updateAddOnAttributes(req,addOnUri,conn);
        });

        promise.settle(series).then(function (results) {
            for(var h=0; h<results.length; h++ ){
                if (results[h].isRejected() === true) {
                    trace.warn('Rejected in Create SubscriptionAddOn : ' +results[h].reason());
                    return reject(results[h].reason());
                }
            }
            return fulfill(req.reqresourceIdentifier);
        });
    });
	
}

function createSubscriptionDependent(arr,parentUri){

    return new promise(function(fulfill,reject) {
        var series = arr.map(function (dependent) {
            var subscriptionDependencyParams = {};
            subscriptionDependencyParams.parentUri = parentUri;
            subscriptionDependencyParams.dependentUri = dependent.uri;
            subscriptionDependencyParams.action = dependent.action;
            if (dependent.visibility && dependent.visibility.length > 0) {
                subscriptionDependencyParams.visibility = formVisibility(dependent.visibility);
            } else {
                subscriptionDependencyParams.visibility = '';
            }
            return createsubscriptiondependency(subscriptionDependencyParams,conn);
        });

        promise.settle(series).then(function (results) {
            for(var h=0; h<results.length; h++ ){
                if (results[h].isRejected() === true) {
                    trace.warn('Rejected in Create SubscriptionDependency : ' +results[h].reason());
                    return reject(results[h].reason());
                }
            }
            return fulfill(parentUri);
        });
    });
}


function formVisibility(visibilityArray) {
    var visibility = [];
    for (var ar = 0; ar < visibilityArray.length; ar++) {
        visibility.push('$' + visibilityArray[ar] + '$');
    }
    return visibility.join();
}

// get resourcetype of the configurable resource
function getConfigResourceType(resourceIdentifiers){
    return new promise(function(fulfill,reject) {

        mysql.getConfigResourceTypeid(resourceIdentifiers, conn, function (result) {
            fulfill(result[0].Name);
            trace.debug(result);
        });
    });
}

app.post('/billing/workloadpricingdetails', function (req, res) {
    trace.info('get.billing.pricingdetails?workloadid');

    //promise.isArray(JSON.parse(req.body.workloadid)).then (function () {
    promise.delay(0000).then (function () {
        trace.info('workloadid: '+ req.body.workloadid + ' details: '+req.body.details);
		if (req.body.workloadid && req.body.details) {
			trace.info('entered details=true');
			return mysql.getWorkloadDetailedPricingInfo(req.body.workloadid,
			conn);
		} else if (req.body.workloadid && _.isArray(JSON.parse(req.body.workloadid))) {
			trace.info(JSON.parse(req.body.workloadid));
            // TODO: Maintain status in JSON file
			var status = ['active','none','stopped', 'stoprequested'];
            if(req.body.status && _.isArray(JSON.parse(req.body.status)))
                status = JSON.parse(req.body.status);
            return mysql.getWorkloadPricingInfo(JSON.parse(req.body.workloadid).join(), status.join(), conn);

        } else {
            return promise.reject({reason: 'Workloadid should be in array', statusCode: 400});
        }
    }).then(function (results){
		if(results && results.instances && results.instances.length > 0){
			for (var i = 0; i<results.instances.length; i++){
				if(results.instances[i].activationTime){
					results.instances[i].activationTime = moment(Date.parse(results.instances[i].activationTime)).format('YYYY-MM-DDTHH:mm:ss z');
				}else{
					delete results.instances[i].activationTime;
				}
			}
		}
        return res.send(results);
    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function (error) {
        return handleRestError(req,res,null,error);
    });
})

// get billed and unbilled usagedata by resourceinstanceid
app.get('/billing/usagedatabyinstance/:id', function(req, res){

trace.info('enter: get.billing.usagedatabyinstance.id');

 var resourceinstanceId = req.params.id;
 var startDate = req.query.startdate;
 var endDate = req.query.enddate;

 usagemysql.usagebyresourcetypeId(resourceinstanceId, startDate, endDate, conn, function(result){

   res.send(result);

    });
});

// api to get revenue summary
app.get('/billing/revenuesummary', function(req, res){
trace.info('enter: get.billing.revenuesummary');

 var resourceinstanceId = req.params.id;
 var startDate = req.query.startdate;
 var endDate = req.query.enddate;
 var channelCode = req.query.channelcode;

 exports.getRevenueSummary(startDate, endDate, channelCode, conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});
// api to get all payment types 
app.get('/billing/getpaymenttypes', function(req, res){
trace.info('enter: get.billing.getpaymenttypes');

 exports.getPaymentTypes(conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});
// api to get orders count
app.get('/billing/ordercount', function(req, res){
trace.info('enter: get.billing.ordercount');

 var resourceinstanceId = req.params.id;
 var startDate = req.query.startdate;
 var endDate = req.query.enddate;
 var channelCode = req.query.channelcode;

 exports.getOrdersCount(startDate, endDate, channelCode, conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});

// api to get account count
app.get('/billing/accountcount', function(req, res){
trace.info('enter: get.billing.accountcount');

 var startDate = req.query.startdate;
 var endDate = req.query.enddate;
 var channelCode = req.query.channelcode;

 exports.getAccountsCount(startDate, endDate, channelCode, conn, function(err,result){
	if(err){
		   res.send(err);
		}
   res.send(result);

    });
});

//api to get channelcode and currency code of owner
app.get('/billing/channelcurrency', function(req, res){
	trace.info('enter: get.billing.channelcurrency');
	var ownerId = req.ownerId || req.query.ownerId;
	trace.info('enter: ownerId '+ownerId);

	return mysql.getChannelCurrency(ownerId, conn).then(function(result){
		trace.info('getChannelCurrency Result:' + JSON.stringify(result));
		if(result && result.length > 0){
			channelCode = result[0].channelCode;
			currencyCode = req.headers['currencycode'] || result[0].currencyCode;
			return res.send({channelCode: result[0].channelCode,currencyCode: result[0].currencyCode});
		} else 
			return res.send({reason: 'channelcode/currencyCode_unavailable', statusCode: 400});
	});
});

app.get('/billing/channelcurrencylanguage', function(req, res){
	trace.info('enter: get.billing.channelcurrencylanguage');
	var ownerId = req.ownerId || req.query.ownerId;
	trace.info('enter: ownerId '+ownerId);

	return mysql.getChannelCurrency(ownerId, conn).then(function(result){
		trace.info('channelcurrencylanguage Result:' + JSON.stringify(result));
		if(result && result.length > 0){
			channelCode = result[0].channelCode.toLowerCase();
			currencyCode = req.headers['currencycode'] || result[0].currencyCode.toLowerCase;
			languageCode = result[0].invoicingLanguage;
			return res.send({channelCode: result[0].channelCode.toLowerCase(),currencyCode: result[0].currencyCode.toLowerCase(),languageCode: result[0].invoicingLanguage});
		} else 
			return res.send({reason: 'channelcode/currencyCode/languageCode_unavailable', statusCode: 400});
	});
});

// api to get orders count, accounts count and next billing date
app.get('/billing/getAnalyticsInfo', function(req, res){
	trace.info('enter: get.billing.getAnalyticsInfo');
		var monthnames = ["None","Jan", "Feb","Mar","Apr","May", "Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

	 var startDate = req.query.startdate;
	 var endDate = req.query.enddate;
	 var channelCode = req.query.channelcode;
	 var finalResponse =[];
	 exports.getOrdersCount(startDate, endDate, channelCode, conn, function(err,result){
		if(err){

		   finalResponse.orderCount=err;
		}

		finalResponse.push(result[0]);
		trace.info('Response from getOrdersCount:'+JSON.stringify(result));

		exports.getAccountsCount(startDate, endDate, channelCode, conn, function(err,accResult){
		if(err){
		    finalResponse.accountCount=err;
		}

		trace.info('Response from getAccountsCount:'+JSON.stringify(accResult));
		finalResponse.push(accResult[0]);

		var billingFrequency=config.billingFrequency;
		var billingFrequencyType=config.billingFrequencyType;
		var datevalue='';
		if ( typeof config.billingFrequency !== 'undefined' && config.billingFrequency != '' &&
				typeof config.billingFrequencyType !== 'undefined' && config.billingFrequencyType != '')
		{

			var datetime = new Date();
		    trace.info('Current Date is:'+datetime);
			var month = datetime.getMonth();
			datetime.setDate(billingFrequency);
			datetime.setMonth((month+1));
			trace.info('After setting next month and billingFrequency date is:'+datetime);
			var day = datetime.getDate();
			var finalMonth = (datetime.getMonth()+1);
			var year = datetime.getFullYear();
			var finalDate= day +' '+monthnames[finalMonth]+', '+year;
			trace.info('finalDate is:'+finalDate);
			var billingDate = {"NextBillingDate":finalDate};
			finalResponse.push(billingDate);
			trace.info('finalResponse:'+JSON.stringify(finalResponse));
	    }
		res.send(finalResponse);

    });

    });
});

// api to get account count
app.get('/billing/topaccountssummary', function(req, res){
	trace.info('enter: get.billing.topaccountssummary');

	var startDate = req.query.startdate;
	var endDate = req.query.enddate;
	var channelCode = req.query.channelcode;
	var finalResponse = {};
	exports.getTopAccountByrevenue(startDate, endDate, channelCode, conn, function(err,result) {
		if (err) {
			res.send(err);
		}
		var topaccounts = [];
		if (result.length > 0) {
			for (var i = 0; i < result.length; i++) {
				topaccounts.push(result[i].accountName);
			}
			finalResponse.topAccounts = topaccounts;
			exports.getTopAccountSummary(startDate, endDate, channelCode, topaccounts, conn, function (err, sresult) {
				if (err) {
					res.send(err);
				}
				finalResponse.summary = sresult;
				res.send(finalResponse);
			});
		}else{
			res.send(finalResponse);
		}
	});
});

//api to get resources report for each account with cost price for reports in magento admin
app.get('/billing/resources/costreport', function(req, res){
	trace.info('enter: get.billing.resources.costreport');
	var startDate = req.query.startdate;
	var endDate = req.query.enddate;
	var channelCode = req.query.channelcode;
	exports.getResourceCostbyAccount(startDate, endDate, channelCode, req.query.accountid, req.query.provider,conn, function(err,result) {
		if (err) {
			res.send(err);
		}
		res.send(result);
	});
});

//api to get resources by revenue(listprice) order by listprice in descending order for revenue report in magento admin
app.get('/billing/resources/revenuereport', function(req, res){
	trace.info('enter: get.billing.resources.revenuereport');
	var startDate = req.query.startdate;
	var endDate = req.query.enddate;
	var channelCode = req.query.channelcode;

	exports.getResourceByRevenue(startDate, endDate, channelCode, req.query.resourcename, req.query.provider, conn, function(err,result) {
		if (err) {
			res.send(err);
		}
		res.send(result);
	});
});
// api exposed to paymentauthrestservice into PaymentProcessorService

app.post('/billing/paymentauthrestservice/authorize', function (req, res) {
	
getConfigByChannel(req.ownerId).then(function(channelConfig){
    trace.info('::::::::::::::::::::: enter: post.paymentauthrestservice/authorize :::::::::::::::::::::');

	var request = req.body;

	var ErrorMsg = null;

	trace.info('UserId : '+request.UserId);
	trace.info('ReturnUrl : '+request.ReturnUrl);

	if(isValidUUID(request.UserId) && request.ReturnUrl) {

		trace.info('UserId : '+request.UserId);

		var returnUrl = request.ReturnUrl;

		var addressInfoDto =   {
		    name : request.Name,
            address1 : request.Address1,
            address2 : request.Address2,
            city : request.City,
            stateProvinceCode : request.StateProvinceCode,
            countryCode : request.CountryCode,
            zipPostalCode : request.ZipPostalCode,
			id : null
        };

		var PaymentProviderInfo = null;

		var userPaymentInfoDto =   {
		    address : addressInfoDto,
			paymentMethodName : request.PaymentMethodName,
			providerCodeName : request.ProviderCodeName,
            creditCardType : request.CreditCardType,
            countryCode : request.PaymentMethodCountryCode,
            customerHttpAgent : request.CustomerHttpAgent,
            customerIpAddress : request.CustomerIpAddress,
            languageCode : request.LanguageCode,
            owner : request.UserId,
			name : addressInfoDto.name,
			id : request.UserPaymentInfoId,
			status : null,
			isDefault : false,
			paymentProviderInfo : PaymentProviderInfo
        };
		
		// GCC - GIRO Credit Card, GDD - GIRO Direct Debit
		if(request.ProviderCodeName =='GCC'){
			creditCardType : 'GCC';
		}else if (request.ProviderCodeName =='GDD'){
			creditCardType : 'GDD';
		}else if (request.ProviderCodeName =='MONARIS'){
			creditCardType : 'MONARIS';
		}else if (request.ProviderCodeName =='AUTHORIZENET'){
			creditCardType : 'AUTHORIZENET';
		}else if (request.ProviderCodeName =='PAYPAL'){
			creditCardType : 'PAYPAL';
		}
		
		trace.info('userPaymentInfoDto : '+userPaymentInfoDto);

		var userPaymentInfoId = userPaymentInfoDto.id;

		trace.info('userPaymentInfoId : '+userPaymentInfoId);

		// If an UserPaymentInfoId is exists, need to delete that payment and create a new
		if(userPaymentInfoId !== '') {

			deletePaymentAuthorization(userPaymentInfoId);
		}

		// To create a new payment
		authorizePaymentMethod(userPaymentInfoDto, returnUrl);

		function authorizePaymentMethod(userPaymentInfoDto, returnUrl) {

			if(addressInfoDto && userPaymentInfoDto.owner) {

				var paymentProviderInfoDto = null;

				var providerCodeName = userPaymentInfoDto.providerCodeName;

				// Make Uuid null to create a new row.
				userPaymentInfoDto.id = null;

				userPaymentInfoDto.id = uuid();

				addressInfoDto.id = uuid();

				// Mysql function for addOrUpdateAddress
				paymentAuthServiceMysql.addOrUpdateAddress(addressInfoDto, conn);

				var paymentProviderDetails = null;

				// Mysql function for getProviderDetails
				paymentAuthServiceMysql.getProviderDetails(providerCodeName, conn, function(err,response) {

					if(err) {
						trace.warn('billingv2/getProviderDetails  Error: '+err);
					}
					else {

						var checkArray = JSON.stringify(response);

						trace.info('Testing PaymentProvider Array : '+checkArray);

						if(checkArray === '[]') {
							trace.warn('billingv2/ProviderDetails  Empty: ');

							ErrorMsg = "Payment Provider Code is not Exists";

							res.send(ErrorMsg);
						}
						else {
							paymentProviderDetails = response;

							sendProviderInfo(paymentProviderDetails);
						}
					}

				});

				function sendProviderInfo(paymentProviderDetails) {

					PaymentProviderInfo = paymentProviderDetails;

					userPaymentInfoDto.status = 'Pending';

					userPaymentInfoDto.paymentProviderInfo = PaymentProviderInfo;

					trace.info('userPaymentInfoDto : '+JSON.stringify(userPaymentInfoDto) +'\n');

					// Mysql function for addUserPaymentInfo
					paymentAuthServiceMysql.addUserPaymentInfo(JSON.stringify(userPaymentInfoDto),addressInfoDto, conn);

					// For getting PaymentProcessor Name
					var userPaymentInfo = userPaymentInfoDto;

					var paymentProviderInfoDto = userPaymentInfo.paymentProviderInfo;

					trace.info('paymentProviderInfo : '+JSON.stringify(paymentProviderInfoDto[0]));

					trace.info('paymentProcessorName : '+paymentProviderInfoDto[0].PPName);

					var paymentProcessorName = paymentProviderInfoDto[0].PPName;

					var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZ";
					var string_length = 8;
					var orderNumber = '';
					for (var i=0; i<string_length; i++) {
						var rnum = Math.floor(Math.random() * chars.length);
						orderNumber += chars.substring(rnum,rnum+1);
					}

					var paymentOrderDto =  {
                        paymentProcessor : paymentProcessorName,
                        orderType : 'Recurring',
                        owner : userPaymentInfoDto.owner,
                        currencyCode : request.CurrencyCode,
                        paymentMethodType : userPaymentInfoDto.creditCardType,
                        amount : request.Amount,
                        isAuthorization : true,
                        orderStatus : 'Pending',
                        userPaymentInfo : userPaymentInfoDto,
                        softDescriptorText : config.PaymentOrderSoftDescriptorPrefix +' - '+ orderNumber,
						orderNumber :  orderNumber
                    };

					trace.info('paymentOrderDto : '+JSON.stringify(paymentOrderDto));

					// Mysql function for addPaymentOrderDto
					paymentAuthServiceMysql.addPaymentOrderDto(paymentOrderDto, conn, function(err, result) {

						if(err) {

							trace.warn("addPaymentOrderDto Error "+ err);
						}
						else {
							
							if (returnUrl == null) {

								// If null , get the defalt returnUrl from the config settings
								returnUrl = channelConfig.ReturnUrl;
							}

							// Always append the suffix
							var returnUrlPrefix = channelConfig.ReturnUrlPrefix;
							
							var paymentProviderTransactionRequest =  {
                                AmountDto : paymentOrderDto.amount,
                                OrderNumber : paymentOrderDto.orderNumber,
								Amount : paymentOrderDto.amount,
                                ReturnUrl : returnUrl,
                                ReturnUrlPrefix : returnUrlPrefix,
                                CurrencyCode : paymentOrderDto.currencyCode,
                                //Note: EffortId will be one first time transaction is processed.
                                EffortId : 1,
								ProviderCodeName : userPaymentInfoDto.providerCodeName,
                                CreditCard : userPaymentInfoDto.creditCardType,
                                LanguageCode : userPaymentInfoDto.languageCode,
                                CountryCode : userPaymentInfoDto.countryCode,
                                TransactionType : 'Authorize',
                                NameOnCard : userPaymentInfoDto.name,
								Description : paymentOrderDto.softDescriptorText,
                                Street : addressInfoDto.address1,
                                AdditionalAddressInfo : addressInfoDto.address2,
                                City : addressInfoDto.city,
                                State : addressInfoDto.stateProvinceCode,
                                Zip : addressInfoDto.zipPostalCode
								
							};

							var providerCode = request.ProviderCodeName;
							if(providerCode == 'GDD'){
								paymentProviderTransactionRequest.AccountHoldersName = request.AccountHoldersName;
								if(request.Iban!=null && request.Iban != ''){
								   paymentProviderTransactionRequest.Iban =request.Iban;
								}else{
									paymentProviderTransactionRequest.Iban ='0';
									paymentProviderTransactionRequest.Bankcode =request.bankcode;
									paymentProviderTransactionRequest.Bankaccount =request.bankaccount;
								}
							}
							trace.info('paymentProviderTransactionRequest : '+JSON.stringify(paymentProviderTransactionRequest));

							var count = 1 ;

							var initialTransform  = function (callback) {
								var opt = [];
								opt = paymentProviderTransactionRequest;
								callback(null,opt);
							};

							// Api call from PaymentAuthService to PaymentProcessorService
							var postPaymenyAuth = function (result,callback) {

								var getHeaders = {};
								getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
								getHeaders['ownerId'] = req.ownerId;
								result.channelCode = channelConfig.channelCode;
								var options = {
									host: config.paymentauthhost,
									port: config.paymentauthport,
									path: '/apiv1.0/payment?format=json?' + querystring.stringify(result),
									method: 'POST',
									headers: getHeaders

								};
								trace.info('Options : '+JSON.stringify(options));

                                //TODO New Auth Model - no need as of now for payment
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
											    var contentresult = JSON.parse(content);
											    trace.info('contentresult : '+ JSON.stringify(contentresult));
												if(contentresult.UrlToRedirect !== '')
												{
												 trace.info('UrlToRedirect : '+contentresult.UrlToRedirect);
												// GCC - GIRO Credit Card, GDD - GIRO Direct Debit
												if(providerCode == 'GDD' || providerCode == 'GCC'){
												 res.send(JSON.stringify(contentresult.PaymentReference, null, 2))
												}else if(providerCode == 'MONARIS'){
													if(contentresult.PaymentReference!=null && contentresult.PaymentReference!=''){
													  res.send(JSON.stringify({'reference':contentresult.PaymentReference}, null, 2))
													}else{
													   res.send(JSON.stringify({'error':contentresult.ResponseCode}, null, 2))
													}
												}else if(providerCode == 'AUTHORIZENET'){
													if(contentresult.PaymentReference!=null && contentresult.PaymentReference!=''){
													  res.send(JSON.stringify({'reference':contentresult.PaymentReference}, null, 2))
													}else{
													   res.send(JSON.stringify({'error':contentresult.ResponseCode}, null, 2))
													}
												}else if(providerCode == 'PAYPAL'){
													if(contentresult.PaymentReference!=null && contentresult.PaymentReference!=''){
													  res.send(JSON.stringify({'reference':contentresult.PaymentReference}, null, 2))
													}else{
													   res.send(JSON.stringify({'error':contentresult.ResponseCode}, null, 2))
													}
												}else{
													 res.send(JSON.stringify(contentresult.UrlToRedirect, null, 2));
												}
												 callback(null);
												}
												else
												{

												 callback('failed');
												}
											}
										});
									}
								});

								request.on('error', function(e) {
									trace.warn('Error : '+e.message);
								});

								request.end();
							}

							var start = function () {

								async.waterfall([
									function (callback) {
										initialTransform(callback);
									},
									postPaymenyAuth
								],
								function (err) {
									if (err !== null) {

										trace.info('----------------------------------------FAILED------------------------------------');
									}
									else {

										trace.info('----------------------------------------SUCCESS------------------------------------');
									}
								});
							}
							start();

						}

					});

				}

			}

		}

	}
	else {

		trace.warn('UserId/ReturnUrl is/are empty or invalid');

		ErrorMsg = "UserId/ReturnUrl is/are Empty/Invalid";

		res.send(ErrorMsg);

	}
});

	function deletePaymentAuthorization(userPaymentInfoId) {

		trace.info('-------------- enter : deletePaymentAuthorization --------------');

		if(isValidUUID(userPaymentInfoId)) {

			payment.getOneUserPaymentInfoId(userPaymentInfoId, conn, function(err, response) {

				if(err) {
					trace.info('Error : '+ err);
				}
				else {

					var responseMessage = {}

					trace.info('response : '+ JSON.stringify(response[0]));

					if(typeof response[0] == 'undefined') {

						responseMessage.status = null;

						trace.info('responseMessage : '+ JSON.stringify(responseMessage));
					}
					else {
						payment.deleteUserPaymentInfoId(userPaymentInfoId, conn, function(result) {

							responseMessage.status = 'Deleted';

							trace.info('responseMessage : '+ JSON.stringify(responseMessage));

						});
					}
				}
			});
		}
		else {
			trace.warn('UserPaymentInfoId is not valid');
		}

	}

	//Function to Check whether the given UUID is valid or not
	function isValidUUID(v) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
	}

});

// api exposed to paymentverifyrestservice into PaymentProcessorService
// api exposed to paymentverifyrestservice into PaymentProcessorService
app.post('/billing/paymentauthrestservice/verify', function (req, res) {

	var request = req.body;
		trace.info('--------------- enter: post.paymentauthrestservice/verify ---------------'+JSON.stringify(request));
	getConfigByChannel(request.ownerId).then(function(channelConfig){
	trace.info('channelConfig>>>>>>>>>>>>>>>>>>>.'+JSON.stringify(channelConfig));

	//trace.info('InitialUrl : '+ request.InitialUrl);

	var redirectReturnUrl = null;

	var providerCodeName = request.ProviderCodeName;

	var verifyTransactionMessage = null;

	if(request.InitialUrl || request.Reference) {

		var returnURL =request.InitialUrl;
		var providerCodeName = request.ProviderCodeName;
		var reference ='';
		// GCC - GIRO Credit Card, GDD - GIRO Direct Debit
		if(request.ProviderCodeName == 'GCC' || request.ProviderCodeName =='GDD' || request.ProviderCodeName =='MONARIS'|| request.ProviderCodeName =='AUTHORIZENET'|| request.ProviderCodeName =='PAYPAL'){
			returnURL =request.Reference;
			reference = request.Reference;
			
		}
				
		if(request.ProviderCodeName =='AUTHORIZENET'){
					var str1 = request.expMonth;
					var str2 = request.expYear;
					request.expYear = str1.concat(str2);
		}
		
		var paymentProviderTransactionRequest = {
			Amount : request.Amount,
			ProviderCodeName : request.ProviderCodeName,
			EffortId : 2,
            ReturnUrl : returnURL,
			TransactionType : request.TransactionType,
			cardNo : request.cardNo,
			expYear : request.expYear,
			expMonth : request.expMonth,
        };

	if(paymentProviderTransactionRequest.ProviderCodeName == 'AUTHORIZENET'|| paymentProviderTransactionRequest.ProviderCodeName =='PAYPAL'){
			paymentProviderTransactionRequest.firstName = request.firstName;
			paymentProviderTransactionRequest.lastName = request.lastName;
			paymentProviderTransactionRequest.address = request.address;
			paymentProviderTransactionRequest.city = request.city;
			paymentProviderTransactionRequest.country = request.country;
			paymentProviderTransactionRequest.zip = request.zip;
			paymentProviderTransactionRequest.cvv = request.cvv;
			paymentProviderTransactionRequest.phoneNumber = request.phoneNumber;
			paymentProviderTransactionRequest.channelCode = channelConfig.channelCode;
		}
		trace.info('paymentProviderTransactionRequest : '+ querystring.stringify(paymentProviderTransactionRequest));

		verifyPaymentAuthorization(paymentProviderTransactionRequest);

		function verifyPaymentAuthorization(paymentProviderTransactionRequest) {
		getConfigByChannel(req.ownerId).then(function(channelConfig){
		paymentProviderTransactionRequest.channelCode = channelConfig.channelCode;
			var getHeaders = {};
			getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
			getHeaders['ownerId'] = req.ownerId;

			var options = {
				host: config.paymentauthhost,
				port: config.paymentauthport,
				path: '/apiv1.0/payment?format=json?' + querystring.stringify(paymentProviderTransactionRequest),
				method: 'POST',
				headers:getHeaders
			};

			trace.info('Options : '+ options);

            //TODO New Auth Model - no need as of now for payment
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
							trace.info(content);
							var result = JSON.parse(content);
							trace.info('result : '+result);
							if(result.ReturnUrl !== '') {

								redirectReturnUrl = result.ReturnUrl;

								trace.info(JSON.stringify(result));

								trace.info('verifyPaymentAuthorization/redirectReturnUrl : '+redirectReturnUrl);

								// Splitting TransactionStatus, OrderNumber, TransactionNumber from the redirectReturnUrl
								var qs = qs_parse(url_parse(redirectReturnUrl).query);

								trace.info('qs : '+qs);

								var transactionStatus = qs.TransactionStatus;

								var isAuthorized = null;

								if(transactionStatus.toLowerCase() == "success") {
									isAuthorized = true;
								}
								else {
									isAuthorized = false;
								}

								var orderNumber = qs.OrderNumber;
								
							       trace.info('orderNumber>>>>>>>>'+orderNumber);
							/*		trace.info('reference>>>>>>>>'+reference);
								if(providerCodeName == 'GCC'){
										orderNumber = orderNumberGcc;
										trace.info('Order No &&&&&&&&&&&>>>>>>>>'+orderNumber);

							  }*/
								
								var transactionNumber = result.TransactionNumber;

								// pass the transactionNumber into PaymentProcessorService & Get and Set the response in paymentTransactionDto

								trace.info('UpdateWorkloadOrderAuthorizationStatus ::: orderNumber :'+orderNumber +', transactionNumber : '+ transactionNumber+ ',isAuthorized : '+isAuthorized+'\n');
								
								
								req.DataKey = result.DataKey;
								req.CreditCardNumber= result.MaskedPan;
								req.ExpirationMonth= result.ExpDate;
								if (paymentProviderTransactionRequest.ProviderCodeName =='AUTHORIZENET'){
								req.ExpirationMonth = paymentProviderTransactionRequest.expYear;
								req.firstName = paymentProviderTransactionRequest.firstName;
								req.lastName = paymentProviderTransactionRequest.lastName;
								req.address = paymentProviderTransactionRequest.address;
								req.city = paymentProviderTransactionRequest.city;
								req.state = paymentProviderTransactionRequest.state;
								req.zip = paymentProviderTransactionRequest.zip;
								req.country = paymentProviderTransactionRequest.country;
								req.phoneNumber = paymentProviderTransactionRequest.phoneNumber;									
								}
								if (paymentProviderTransactionRequest.ProviderCodeName =='PAYPAL'){
								req.CreditCardNumber= result.MaskedPan;
								req.ExpirationMonth = result.Expmonth;
								req.ExpirationYear = result.Expyear;						
								req.cardtype = result.cardtype;									
								}
								

								updateWorkloadOrderAuthorizationStatus(orderNumber, transactionNumber, isAuthorized,req);
								
									}
							else   {
								trace.warn('ReturnURL is empty');

								var resultResponse = {
									status: 'Failed',
									message: 'ReturnURL is empty'
								};

								res.send(resultResponse);
							}
						}
						else {
							var resultResponse = {
								status: 'Failed',
								message: 'ForgedException'
							};
							trace.warn('response statusCode : '+response.statusCode);
							trace.warn('Error might be mismatched the Payment Provider accounts (Sandbox/Production) ');
							trace.warn('resultResponse : '+JSON.stringify(resultResponse));
							res.send(resultResponse);

						}
					});
				}
			});

			request.on('error', function(e) {
				trace.warn('Error : '+e.message);
			});

			request.end();
		});
		}

		function updateWorkloadOrderAuthorizationStatus(orderNumber, transactionNumber, isAuthorized,req) {

			if(orderNumber && transactionNumber) {

				trace.info("paymentauthrestservice.UpdateWorkloadOrderAuthorizationStatus: paymentOrderNumber = " + orderNumber + " transactionNumber = " + transactionNumber + " isAuthorized = " + isAuthorized);

				var paymentOrderSoftDescriptorPrefix = config.PaymentOrderSoftDescriptorPrefix;

				var paymentOrderDto = {
					orderNumber : orderNumber,
					transactionNumber : transactionNumber,
					isAuthorized : isAuthorized,
					softDescriptorText : paymentOrderSoftDescriptorPrefix
				};

				trace.info('paymentOrderDto : '+JSON.stringify(paymentOrderDto));

				// Update PaymentOrderDto
				paymentVerifyServiceMysql.updatePaymentOrderDto(paymentOrderDto, conn);

				var transactionNumberRequest = {
					TransactionNumberDto : transactionNumber,
					TransactionNumber : transactionNumber,
					EffortId : '6',
					TransactionType : 'RetrieveByTransactionNumber',
					ProviderCodeName : request.ProviderCodeName
				};

				trace.info('transactionNumberRequest : '+transactionNumberRequest);

				trace.info('UpdateWorkloadOrderAuthorizationStatus/TransactionNumber : '+transactionNumberRequest.TransactionNumber+'\n');
				RetrieveByTransactionNumber(transactionNumberRequest,req);
			}
			else {
				trace.warn('orderNumber/transactionNumber is/are null values');

				var resultResponse = {
					status: 'Failed',
					message: 'OrderNumber/TransactionNumber is/are not generated'
				};

				res.send(resultResponse);
			}

		}

		// For RetrieveByTransactionNumber
		function RetrieveByTransactionNumber(transactionNumberRequest,req) {
			
         getConfigByChannel(req.ownerId).then(function(channelConfig){

			var getHeaders = {};
			getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
			getHeaders['ownerId'] = req.ownerId;
			
			transactionNumberRequest.cardNo = req.CreditCardNumber;
			transactionNumberRequest.expYear = req.ExpirationMonth;
			transactionNumberRequest.DataKey = req.DataKey;
			transactionNumberRequest.firstName = req.firstName ;
			transactionNumberRequest.lastName = req.lastName;
			transactionNumberRequest.address = req.address;
			transactionNumberRequest.city = req.city;
			transactionNumberRequest.state = req.state;
			transactionNumberRequest.zip = req.zip;
			transactionNumberRequest.country = req.country;
			transactionNumberRequest.phoneNumber = req.phoneNumber;
			transactionNumberRequest.channelCode = channelConfig.channelCode;

			var options = {
				host: config.paymentauthhost,
				port: config.paymentauthport,
				path: '/apiv1.0/payment?format=json?' + querystring.stringify(transactionNumberRequest),
				method: 'POST',
				headers: getHeaders
			};

			trace.info('RetrieveByTransactionNumber Options : '+ JSON.stringify(options));

            //TODO New Auth Model - no need as of now for payment
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
						trace.info(content);
						var resultRetrieve = JSON.parse(content);
						trace.info('resultRetrieve : '+resultRetrieve);
							if(resultRetrieve) {
								trace.info('resultRetrieveTransaction : '+JSON.stringify(resultRetrieve));

								var paymentTokenReferenceCode = resultRetrieve.PaymentTokenReferenceCode;

								verifyTransactionMessage = resultRetrieve.ResponseMessage;

								var reqOrderNumber = resultRetrieve.PaymentOrderId;

								var reqPaymentTokenReferenceCode = resultRetrieve.PaymentTokenReferenceCode;

								trace.info('paymentOrderNumber : '+reqOrderNumber);

								
								var paymentTransactionRequestDto = {
                                    PaymentTokenReferenceCodeDto : paymentTokenReferenceCode,
									SenderTokenId : resultRetrieve.PaymentTokenReferenceCode,
									TransactionNumber : resultRetrieve.TransactionNumber,
									ProviderCodeName : providerCodeName,
									OrderNumber : resultRetrieve.PaymentOrderId,
									TransactionStatus : resultRetrieve.TransactionStatus,
                                    EffortId : '5',
                                    TransactionType : 'RetrieveTokenStatus'
								};
								    // GCC - GIRO Credit Card, GDD - GIRO Direct Debit
									if(providerCodeName =='GCC' || providerCodeName =='GDD' ){
										paymentTransactionRequestDto.PaymentTokenReferenceCodeDto = 'giro';
										paymentTransactionRequestDto.SenderTokenId = 'giro';
										paymentTransactionRequestDto.Reference = reference;
										//paymentTransactionRequestDto.TransactionType = 'pkninfo';
										reqPaymentTokenReferenceCode = 'giro';
									}else if(providerCodeName =='MONARIS'){
										paymentTransactionRequestDto.PaymentTokenReferenceCodeDto = 'monaris';
										paymentTransactionRequestDto.SenderTokenId = 'monaris';
										paymentTransactionRequestDto.Reference = reference;
										//paymentTransactionRequestDto.TransactionType = 'pkninfo';
										reqPaymentTokenReferenceCode = transactionNumberRequest.DataKey;
									}else if(providerCodeName =='AUTHORIZENET'){
										paymentTransactionRequestDto.PaymentTokenReferenceCodeDto = 'AUTHORIZENET';
										paymentTransactionRequestDto.SenderTokenId = 'AUTHORIZENET';
										paymentTransactionRequestDto.Reference = reference;
										//paymentTransactionRequestDto.TransactionType = 'pkninfo';
										reqPaymentTokenReferenceCode = transactionNumberRequest.DataKey;
										paymentTransactionRequestDto.firstName = req.firstName;
										paymentTransactionRequestDto.lastName = req.lastName;
										paymentTransactionRequestDto.address = req.address;
										paymentTransactionRequestDto.city = req.city;
										paymentTransactionRequestDto.state = req.state;
										paymentTransactionRequestDto.zip = req.zip;
										paymentTransactionRequestDto.country = req.country;
										paymentTransactionRequestDto.phoneNumber = req.phoneNumber;
									
									}else if(providerCodeName =='PAYPAL'){
										paymentTransactionRequestDto.PaymentTokenReferenceCodeDto = 'PAYPAL';
										paymentTransactionRequestDto.SenderTokenId = 'PAYPAL';
										paymentTransactionRequestDto.Reference = reference;
										//paymentTransactionRequestDto.TransactionType = 'pkninfo';
										paymentTransactionRequestDto.maskedCreditCardNumber = transactionNumberRequest.cardNo;
										reqPaymentTokenReferenceCode = transactionNumberRequest.DataKey;
										
									
									}
								

								trace.info('paymentTransactionRequestDto : '+JSON.stringify(paymentTransactionRequestDto));
								trace.info('transactionNumberRequest : '+JSON.stringify(transactionNumberRequest));

								trace.info('paymentTransactionRequestDto/PaymentTokenReferenceCode : '+paymentTransactionRequestDto.SenderTokenId);

								if(reqPaymentTokenReferenceCode === null || reqPaymentTokenReferenceCode === '') {

									var userPaymentInfo = {
										paymentTokenReferenceCode : null,
										maskedCreditCardNumber : null,
										expirationMonth : null,
										expirationYear : null,
										orderNumber : reqOrderNumber,
										isAuthorized : false,
										BankCode : '',
									    BankAccount : '' ,
									    Iban : ''
									};

									// Mysql function for updating UserPaymentInfo when Failed verification
									paymentVerifyServiceMysql.updateUserPaymentInfo(userPaymentInfo, conn, function(err,result) {

										if(err) {
											trace.warn('updateUserPaymentInfo when Failed verification Error : '+err);
										}
										else {
											trace.info('updateUserPaymentInfo when Failed verification Response : '+result);

											var resultResponse = {
												status: 'Failed',
												message: verifyTransactionMessage
											};

											res.send(resultResponse);
										}

									});

								}
								else {
									
									RetrieveTokenStatus(paymentTransactionRequestDto, reqOrderNumber, reqPaymentTokenReferenceCode,req);
                                }
							}
							else   {
								trace.warn('REST API RetrieveByTransactionNumber Process is Failed');
							}
						}
					});
				}
			});

			request.on('error', function(e) {
				trace.warn('Error : '+e.message);
			});

			request.end();
				});
		}

		// For RetrieveByTransactionNumber
		function RetrieveTokenStatus(paymentTransactionRequestDto, orderNumber, reqPaymentTokenReferenceCode,req) {
			getConfigByChannel(req.ownerId).then(function(channelConfig){
			trace.info('req.ownerId>>>>>>>>>>>>'+req.ownerId)
			trace.info('RetrieveTokenStatus paymentTransactionRequestDto >>'+JSON.stringify(req.body));
			trace.info('RetrieveTokenStatus paymentTransactionRequestDto >>'+JSON.stringify(paymentTransactionRequestDto));
			trace.info('RetrieveTokenStatusreqPaymentTokenReferenceCode >>'+JSON.stringify(reqPaymentTokenReferenceCode));
			trace.info('RetrieveTokenStatus req >>'+JSON.stringify(req.body));
			var getHeaders = {};
			getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
			getHeaders['ownerId'] = req.ownerId;
			paymentTransactionRequestDto.DataKey = req.DataKey;
			paymentTransactionRequestDto.cardNo = req.query.MaskedPan;
			paymentTransactionRequestDto.expYear = req.body.expYear;
			paymentTransactionRequestDto.expMonth = req.body.expMonth;
			paymentTransactionRequestDto.channelCode = channelConfig.channelCode;

			var options = {
				host: config.paymentauthhost,
				port: config.paymentauthport,
				path: '/apiv1.0/payment?format=json?' + querystring.stringify(paymentTransactionRequestDto),
				method: 'POST',
				headers: getHeaders
			};

			trace.info('RetrieveTokenStatus Options : '+ JSON.stringify(options));

            //TODO New Auth Model - no need as of now for payment
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
							trace.info(content);
							var resultToken = JSON.parse(content);
							trace.info('resultToken : '+JSON.stringify(resultToken));
							if(resultToken) {
								trace.info('resultToken : '+JSON.stringify(resultToken));

								// Mysql function for checking whether the given CC is blacklisted or not
								paymentVerifyServiceMysql.checkBlackListedCC(resultToken.maskedcreditcardnumber, conn, function(err,result) {
									if(err) {
										trace.warn('checkBlackListedCC Error : '+err);
										var resultResponse = {
											status: 'Error',
											message: 'checkBlackListedCC Error'
										};
										res.send(resultResponse);
									}
									else {
										trace.info('checkBlackListedCC Response: '+result[0].IsBlackList+'orderNumber>>>'+orderNumber+'reqPaymentTokenReferenceCode>>'+reqPaymentTokenReferenceCode+'resultToken.TransactionStatus'+resultToken.TransactionStatus);

										var isAuthorized = null;

										if(orderNumber && reqPaymentTokenReferenceCode && resultToken.TransactionStatus == 'Success' && result[0].IsBlackList == 'No') {
											isAuthorized = true;
										}
										else {
											isAuthorized = false;
										}
										trace.info('isAuthorized : '+isAuthorized);
										var userPaymentInfo = {
											paymentTokenReferenceCode : reqPaymentTokenReferenceCode || resultToken.DataKey,
											maskedCreditCardNumber : resultToken.MaskedCreditCardNumber,
											expirationMonth : resultToken.ExpirationMonth,
											expirationYear : resultToken.ExpirationYear,
											orderNumber : orderNumber,
											isAuthorized : isAuthorized,
											creditCardType : resultToken.CreditCardType,
											BankCode : '',
											BankAccount : '' ,
											Iban : ''
										};
										// GCC - GIRO Credit Card, GDD - GIRO Direct Debit
										if(providerCodeName =='GCC'|| providerCodeName =='GDD'){
											userPaymentInfo.Iban = "";
											userPaymentInfo.BankCode = "";
											userPaymentInfo.BankAccount = "";
											userPaymentInfo.paymentTokenReferenceCode = resultToken.PaymentTokenReferenceCode;
											
											if (providerCodeName =='GDD'){
												userPaymentInfo.Iban = resultToken.Iban;
												userPaymentInfo.BankCode = resultToken.BankCode;
												userPaymentInfo.BankAccount = resultToken.BankAccount;
												userPaymentInfo.maskedCreditCardNumber = 'NA';
												userPaymentInfo.expirationMonth = 00;
												userPaymentInfo.expirationYear = 0000;
										   }
										}
										if(providerCodeName =='AUTHORIZENET'){
												
										userPaymentInfo.paymentTokenReferenceCode = resultToken.PaymentTokenReferenceCode;
										userPaymentInfo.expirationMonth = 00;
										userPaymentInfo.expirationYear = 0000;
										}
										if(providerCodeName =='PAYPAL'){
												
										userPaymentInfo.maskedCreditCardNumber = resultToken.maskedcreditcardnumber;
										userPaymentInfo.paymentRegistrationLimit = channelConfig.paymentRegistrationLimit;

										}
																			
										if(typeof userPaymentInfo.creditCardType == 'undefined') {

											userPaymentInfo.creditCardType = "";
										}

										trace.info('userPaymentInfo : '+JSON.stringify(userPaymentInfo));
										trace.info('userPaymentInfo/maskedCreditCardNumber : '+userPaymentInfo.maskedCreditCardNumber);
										trace.info('userPaymentInfo/expirationMonth : '+userPaymentInfo.expirationMonth);
										trace.info('userPaymentInfo/expirationYear : '+userPaymentInfo.expirationYear);
										trace.info('userPaymentInfo/creditCardType : '+userPaymentInfo.creditCardType);

										// Mysql function for updating UserPaymentInfo
										paymentVerifyServiceMysql.updateUserPaymentInfo(userPaymentInfo, conn, function(err,result) {

											if(err) {
												trace.warn('updateUserPaymentInfo Error : '+err);
												var resultResponse = {
													status: 'Error',
													message: 'updateUserPaymentInfo Error'
												}
												trace.warn('resultResponse : '+JSON.stringify(resultResponse));
												res.send(resultResponse);
											}
											else {

												trace.info('isAuthorized : '+isAuthorized);

												if(!isAuthorized) {

													var resultResponse = {
																status: 'Failed',
																message: verifyTransactionMessage
													};
													res.send(resultResponse);
												}
												else {

													trace.info('updateUserPaymentInfo Response : '+result);

													paymentVerifyServiceMysql.isFirstPaymentMethodByOrderNumber(userPaymentInfo.orderNumber, conn, function(err,result) {

													trace.info(JSON.stringify(result));

														var resultResponse = {
																	status: 'Verified',
																	OrderNo: userPaymentInfo.orderNumber,
																	message: verifyTransactionMessage
														};

														if(err) {
															trace.warn('isFirstPaymentMethodByOrderNumber Error : '+err);

															res.send(resultResponse);
														}
														else {
															trace.info('isFirstPaymentMethodByOrderNumber Response : '+ JSON.stringify(result, null, 2));

															if (result[0]._isFirstPaymentMethodCheck == true && couponConfig.autoApplyCoupon == true) {
																trace.info('*****TO call Apply Coupon***');
																// call auto coupon apply function
																autoApplyCoupon(result[0]._ownerId, req, function(err,response) {

																	trace.info('autoApplyCoupon response : '+JSON.stringify(response));
																	if (err) {
																		// When method technical error
																		res.send(resultResponse);
																	}
																	else {
																		if(response.message) {
																			// When error message get from autoApplyCoupon method
																			res.send(resultResponse);
																		}
																		else {
																			resultResponse.status = 'Verified_Coupon_Applied';
																			res.send(resultResponse);
																		}
																	}
																});
															}
															else {

																res.send(resultResponse);
															}
														}
													});

												}

											}
										});

									}
								});

							}
							else {

								var resultResponse = {
									status: 'Failed'
								};

								trace.info('REST API RetrieveTokenStatus Process is Failed');

								res.send(resultResponse);
							}
						}
						else {
							var resultResponse = {
								status: 'Failed',
								message: 'Error'
							};
							trace.warn('response statusCode : '+response.statusCode);
							trace.warn('resultResponse : '+JSON.stringify(resultResponse));
							res.send(resultResponse);

						}
					});
				}
			});

			request.on('error', function(e) {
				trace.warn('Error : '+e.message);
			});

			request.end();
			});
		}

	}
});

});

// API to get all creditcard
app.get('/billing/creditcard', function(req, res) {

	trace.info('--------------- enter: /billing/creditcard ---------------');

	creditCardMysql.getCreditCard(conn, function(result) {

			res.send(result);

    });
});

// API to get one creditcard by Id
app.get('/billing/creditcard/:id', function(req, res) {

	trace.info('--------------- /billing/creditcard/:id ---------------');
	trace.info(req.params);

	var request = req.params;

	var creditCardId = request.id;

	trace.info('creditCardId : '+creditCardId);

	creditCardMysql.getCreditCardById(creditCardId, conn, function(result) {

			res.send(result);

    });
});

//Api to update Default Payment in UserPaymentInfo
app.post('/billing/userpaymentinfo/UserPaymentInfoId', function(req, res) {

	trace.info('--------------- enter: /billing/userpaymentinfo/UserPaymentInfoId ---------------');

    var userpaymentinfo = { }
	    userpaymentinfo.UserPaymentInfoId = req.body.UserPaymentInfoId;
		userpaymentinfo.UserId = req.body.UserId;
		userpaymentinfo.IsDefault = req.body.IsDefault;

	trace.info('userpaymentinfo : '+JSON.stringify(userpaymentinfo));

	if(isValidUUID(userpaymentinfo.UserPaymentInfoId) && isValidUUID(userpaymentinfo.UserId) && (userpaymentinfo.IsDefault.toLowerCase() == "true" )) {

		payment.getUserPaymentInfoId(userpaymentinfo, conn, function(err, response) {

			trace.info('--------------- enter: getUserPaymentInfoId ---------------');

			if(err) {
				trace.info('Error : '+ err);
			}
			else {

				var responseMessage = {}

				trace.info('response : '+ JSON.stringify(response[0]));

				if(typeof response[0] == 'undefined') {

					responseMessage.Id = null;

					res.send(responseMessage);
				}
				else {

					trace.info('userPaymentInfoId : '+ response[0].Id);

					payment.updateDefaultPayment(userpaymentinfo, conn, function(result) {

						responseMessage.Id = userpaymentinfo.UserPaymentInfoId;

						trace.info('responseMessage : '+ JSON.stringify(responseMessage));

						res.send(responseMessage);

					});
				}

			}

		});

	}
	else {
		trace.info('The given parameter(s) is/are wrong format!');
		var ErrMsg = 'The UserId & UserPamynetInfoId both should be UUID and IsDefault value should be true';
		res.send(ErrMsg);
	}

	//Function to Check whether the given UUID is valid or not
	function isValidUUID(v) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
	}
});

//Api to delete any one Payment method in UserPaymentInfo
app.delete('/billing/userpaymentinfoid/delete/:id', function(req, res) {

	trace.info('--------------- enter: /billing/id/delete ---------------');

	var userPaymentInfoId = req.params.id;

	trace.info('userPaymentInfoId : '+userPaymentInfoId);

	var deletedRows = 0;

	if(isValidUUID(userPaymentInfoId)) {

		payment.getOneUserPaymentInfoId(userPaymentInfoId, conn, function(err, response) {

			if(err) {
				trace.info('Error : '+ err);
			}
			else {

				var responseMessage = {}

				trace.info('response : '+ JSON.stringify(response[0]));

				if(typeof response[0] == 'undefined') {

					responseMessage.status = null;

					res.send(responseMessage);
				}
				else {
					payment.deleteUserPaymentInfoId(userPaymentInfoId, conn, function(result) {

						responseMessage.status = 'Deleted';

						trace.info('responseMessage : '+ JSON.stringify(responseMessage));

						res.send(responseMessage);

					});
				}
			}
		});

	}
	else {
		trace.warn('UserPaymentInfoId is not valid');
	}

	//Function to Check whether the given UUID is valid or not
	function isValidUUID(v) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
	}

});

//API to expose the billing information by passing userid and date
app.get('/billing/billinginfobyuseridwithdate/:id', function(req, res){

	trace.info('enter: get.billing.billinginfobyuseridwithdate.id');

	var values = {};

	values.id = req.params.id;

	values.startdate = req.query.startdate;

	values.enddate = req.query.enddate;

    return exports.getByIdAndDate(values, conn, function(err,result){

		if (err) {
			return res.send(err, err.code);
		}

		return res.send(result);

	});
});


app.get('/billing/billinginfobyuserid', function(req, res){
    /*
     CALL SP_ApiBillingInformationWithId('7f6ee9cd-18b7-454d-a44c-73daea0c978b')
     CALL SP_ApiBillingInformationDetailsByIds('0766213d-f9bf-4809-b208-11eec188ab56,0b2c5444-2819-4ca3-b0d7-4b8ba278f24c,1baa3f5e-79de-4793-9137-737e8e5939cb,2967aa9d-9421-4160-a78c-1a60289bd1ee,2ab16fe3-fa07-4c80-aee9-d94a982cc6a2,34835e2c-019c-4d61-900e-08ebe4e885df,348f7c8c-a8e7-4a84-92d4-d51961d073e3,39524bf3-270b-4b4a-b91a-4311a83e8708,402f0ea9-3d39-4a83-8eda-f136d51a462c,41b24647-98b3-4bbd-aa73-7aff31b06030,45328101-c4e0-4caf-b41b-58f9079f3159,47ad3e21-0c84-4d32-be78-cbfc510c05ab,57405327-a0ea-4c98-b9ce-fc0ddf530139,5a41e3c1-4652-4828-b4ee-e09d38ab0578,5b8875ca-668d-4830-82b7-efd2d6a86995,5cb0f3b8-3783-4ea7-9837-fae3beb31bdd,5f09c5fc-e403-4533-8719-56075b64f26f,6fa500d8-a4d7-44ed-a10d-322ef487e6b5,7a530a8f-0675-430d-a256-d2be9e09b01a,7f6ee9cd-18b7-454d-a44c-73daea0c978b,80940a08-2a09-4f3f-9ac4-02b93db2dedb,890b8767-d305-4ccf-8b2e-8d92b82caefc,8d53553b-4ff1-418e-9e92-d24c2a2ca02f,9cef44d9-1e57-4d3c-9d5e-9f491bdc71ec,9f931e13-4592-47d6-a092-2c67f8d105ab,a08f31c4-0ac7-4e34-896b-96b4ef6ca5b9,a7b90b47-17a1-4db9-b99b-ae70fe729c2c,af2e3bdf-f2ff-4926-a1f9-dba885b1c21a,b7a5c447-d261-4f5e-991e-9ebc78fe20e1,bb593afa-df9c-455c-a57b-9fb645490677,bc4a6225-9b50-4a39-b270-ad9cf1c1362e,c9eaa509-d451-40e9-8239-7fef848b8484,d04cbe05-c3b0-4dd4-b53a-c645790993c2,d367a985-8c7d-4b78-8f30-ed7d1ca712a3,d38f8b9a-acd8-44d8-b435-04fc162c91ae,d7553a92-4b53-432e-ac77-39e2074f40f3,d95541db-c576-4f7c-b071-ff0db34514c3,dfd9ed36-fbec-4f23-a202-ce65c029cddb,f6e1f45f-ac14-44c7-afe9-d4b7ffd4d922,fcaed9d7-aced-467d-8bb7-75a73eaaac20')
     CALL SP_ApiBillingInformationWithId('0766213d-f9bf-4809-b208-11eec188ab56,0b2c5444-2819-4ca3-b0d7-4b8ba278f24c,1baa3f5e-79de-4793-9137-737e8e5939cb,2967aa9d-9421-4160-a78c-1a60289bd1ee,2ab16fe3-fa07-4c80-aee9-d94a982cc6a2,34835e2c-019c-4d61-900e-08ebe4e885df,348f7c8c-a8e7-4a84-92d4-d51961d073e3,39524bf3-270b-4b4a-b91a-4311a83e8708,402f0ea9-3d39-4a83-8eda-f136d51a462c,41b24647-98b3-4bbd-aa73-7aff31b06030,45328101-c4e0-4caf-b41b-58f9079f3159,47ad3e21-0c84-4d32-be78-cbfc510c05ab,57405327-a0ea-4c98-b9ce-fc0ddf530139,5a41e3c1-4652-4828-b4ee-e09d38ab0578,5b8875ca-668d-4830-82b7-efd2d6a86995,5cb0f3b8-3783-4ea7-9837-fae3beb31bdd,5f09c5fc-e403-4533-8719-56075b64f26f,6fa500d8-a4d7-44ed-a10d-322ef487e6b5,7a530a8f-0675-430d-a256-d2be9e09b01a,7f6ee9cd-18b7-454d-a44c-73daea0c978b,80940a08-2a09-4f3f-9ac4-02b93db2dedb,890b8767-d305-4ccf-8b2e-8d92b82caefc,8d53553b-4ff1-418e-9e92-d24c2a2ca02f,9cef44d9-1e57-4d3c-9d5e-9f491bdc71ec,9f931e13-4592-47d6-a092-2c67f8d105ab,a08f31c4-0ac7-4e34-896b-96b4ef6ca5b9,a7b90b47-17a1-4db9-b99b-ae70fe729c2c,af2e3bdf-f2ff-4926-a1f9-dba885b1c21a,b7a5c447-d261-4f5e-991e-9ebc78fe20e1,bb593afa-df9c-455c-a57b-9fb645490677,bc4a6225-9b50-4a39-b270-ad9cf1c1362e,c9eaa509-d451-40e9-8239-7fef848b8484,d04cbe05-c3b0-4dd4-b53a-c645790993c2,d367a985-8c7d-4b78-8f30-ed7d1ca712a3,d38f8b9a-acd8-44d8-b435-04fc162c91ae,d7553a92-4b53-432e-ac77-39e2074f40f3,d95541db-c576-4f7c-b071-ff0db34514c3,dfd9ed36-fbec-4f23-a202-ce65c029cddb,f6e1f45f-ac14-44c7-afe9-d4b7ffd4d922,fcaed9d7-aced-467d-8bb7-75a73eaaac20')
     CALL SP_ApiDetailedBillingInformationWithOrderNumber('D4A58038');
     */

    trace.info('GET /billing/billinginfobyuserid - UserId:'+ req.parentUserId || req.userId);
    var accountids_length = 0;

    return getUserAccounts(req).then (function (accountids){
        if(accountids){
            accountids_length = accountids.length;

			console.log('accountids_length: ' + accountids_length);

			var queryParams = {};
			queryParams.filter = req.query.filter || "";
			queryParams.limit = req.query.limit || 1000;
			queryParams.offset = req.query.offset || 0;
			queryParams.accountIds = accountids.join();

			return exports.getByIds(queryParams, conn);
        } else {
            return res.send([]);
        }
    }).then(function (dbresults) {
        if (req.query.limit && req.query.offset && dbresults && dbresults.length > 1){
            res.setHeader('offset' , parseInt(req.query.offset));
			res.setHeader('total' , parseInt(dbresults[1][0].totalRows));
			res.setHeader('limit' , parseInt(req.query.limit));
		}
        return res.send(dbresults[0]);
    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function (error) {
        return handleRestError(req,res,null,error);
    });
});

app.get('/billing/billinginfobyaccountid', function(req, res){
    /*
     CALL SP_ApiBillingInformationWithId('7f6ee9cd-18b7-454d-a44c-73daea0c978b')
     CALL SP_ApiBillingInformationDetailsByIds('0766213d-f9bf-4809-b208-11eec188ab56,0b2c5444-2819-4ca3-b0d7-4b8ba278f24c,1baa3f5e-79de-4793-9137-737e8e5939cb,2967aa9d-9421-4160-a78c-1a60289bd1ee,2ab16fe3-fa07-4c80-aee9-d94a982cc6a2,34835e2c-019c-4d61-900e-08ebe4e885df,348f7c8c-a8e7-4a84-92d4-d51961d073e3,39524bf3-270b-4b4a-b91a-4311a83e8708,402f0ea9-3d39-4a83-8eda-f136d51a462c,41b24647-98b3-4bbd-aa73-7aff31b06030,45328101-c4e0-4caf-b41b-58f9079f3159,47ad3e21-0c84-4d32-be78-cbfc510c05ab,57405327-a0ea-4c98-b9ce-fc0ddf530139,5a41e3c1-4652-4828-b4ee-e09d38ab0578,5b8875ca-668d-4830-82b7-efd2d6a86995,5cb0f3b8-3783-4ea7-9837-fae3beb31bdd,5f09c5fc-e403-4533-8719-56075b64f26f,6fa500d8-a4d7-44ed-a10d-322ef487e6b5,7a530a8f-0675-430d-a256-d2be9e09b01a,7f6ee9cd-18b7-454d-a44c-73daea0c978b,80940a08-2a09-4f3f-9ac4-02b93db2dedb,890b8767-d305-4ccf-8b2e-8d92b82caefc,8d53553b-4ff1-418e-9e92-d24c2a2ca02f,9cef44d9-1e57-4d3c-9d5e-9f491bdc71ec,9f931e13-4592-47d6-a092-2c67f8d105ab,a08f31c4-0ac7-4e34-896b-96b4ef6ca5b9,a7b90b47-17a1-4db9-b99b-ae70fe729c2c,af2e3bdf-f2ff-4926-a1f9-dba885b1c21a,b7a5c447-d261-4f5e-991e-9ebc78fe20e1,bb593afa-df9c-455c-a57b-9fb645490677,bc4a6225-9b50-4a39-b270-ad9cf1c1362e,c9eaa509-d451-40e9-8239-7fef848b8484,d04cbe05-c3b0-4dd4-b53a-c645790993c2,d367a985-8c7d-4b78-8f30-ed7d1ca712a3,d38f8b9a-acd8-44d8-b435-04fc162c91ae,d7553a92-4b53-432e-ac77-39e2074f40f3,d95541db-c576-4f7c-b071-ff0db34514c3,dfd9ed36-fbec-4f23-a202-ce65c029cddb,f6e1f45f-ac14-44c7-afe9-d4b7ffd4d922,fcaed9d7-aced-467d-8bb7-75a73eaaac20')
     CALL SP_ApiBillingInformationWithId('0766213d-f9bf-4809-b208-11eec188ab56,0b2c5444-2819-4ca3-b0d7-4b8ba278f24c,1baa3f5e-79de-4793-9137-737e8e5939cb,2967aa9d-9421-4160-a78c-1a60289bd1ee,2ab16fe3-fa07-4c80-aee9-d94a982cc6a2,34835e2c-019c-4d61-900e-08ebe4e885df,348f7c8c-a8e7-4a84-92d4-d51961d073e3,39524bf3-270b-4b4a-b91a-4311a83e8708,402f0ea9-3d39-4a83-8eda-f136d51a462c,41b24647-98b3-4bbd-aa73-7aff31b06030,45328101-c4e0-4caf-b41b-58f9079f3159,47ad3e21-0c84-4d32-be78-cbfc510c05ab,57405327-a0ea-4c98-b9ce-fc0ddf530139,5a41e3c1-4652-4828-b4ee-e09d38ab0578,5b8875ca-668d-4830-82b7-efd2d6a86995,5cb0f3b8-3783-4ea7-9837-fae3beb31bdd,5f09c5fc-e403-4533-8719-56075b64f26f,6fa500d8-a4d7-44ed-a10d-322ef487e6b5,7a530a8f-0675-430d-a256-d2be9e09b01a,7f6ee9cd-18b7-454d-a44c-73daea0c978b,80940a08-2a09-4f3f-9ac4-02b93db2dedb,890b8767-d305-4ccf-8b2e-8d92b82caefc,8d53553b-4ff1-418e-9e92-d24c2a2ca02f,9cef44d9-1e57-4d3c-9d5e-9f491bdc71ec,9f931e13-4592-47d6-a092-2c67f8d105ab,a08f31c4-0ac7-4e34-896b-96b4ef6ca5b9,a7b90b47-17a1-4db9-b99b-ae70fe729c2c,af2e3bdf-f2ff-4926-a1f9-dba885b1c21a,b7a5c447-d261-4f5e-991e-9ebc78fe20e1,bb593afa-df9c-455c-a57b-9fb645490677,bc4a6225-9b50-4a39-b270-ad9cf1c1362e,c9eaa509-d451-40e9-8239-7fef848b8484,d04cbe05-c3b0-4dd4-b53a-c645790993c2,d367a985-8c7d-4b78-8f30-ed7d1ca712a3,d38f8b9a-acd8-44d8-b435-04fc162c91ae,d7553a92-4b53-432e-ac77-39e2074f40f3,d95541db-c576-4f7c-b071-ff0db34514c3,dfd9ed36-fbec-4f23-a202-ce65c029cddb,f6e1f45f-ac14-44c7-afe9-d4b7ffd4d922,fcaed9d7-aced-467d-8bb7-75a73eaaac20')
     CALL SP_ApiDetailedBillingInformationWithOrderNumber('D4A58038');
     */

    trace.info('GET /billing/billinginfobyaccountid - AccountId:'+ req.query.accountId);
    var accountids_length = 0;

    return getUserAccounts(req).then (function (accountids){
        if(accountids){
            accountids_length = accountids.length;

			console.log('accountids_length: ' + accountids_length);

			var queryParams = {};
			queryParams.filter = req.query.filter || "";
			queryParams.limit = req.query.limit || 100;
			queryParams.offset = req.query.offset || 0;
			queryParams.accountIds = req.query.accountId;

			return exports.getByIds(queryParams, conn);
        } else {
            return res.send([]);
        }
    }).then(function (dbresults) {
        if (req.query.limit && req.query.offset && dbresults && dbresults.length > 1){
            res.setHeader('offset' , parseInt(req.query.offset));
			res.setHeader('total' , parseInt(dbresults[1][0].totalRows));
			res.setHeader('limit' , parseInt(req.query.limit));
		}
        return res.send(dbresults[0]);
    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function (error) {
        return handleRestError(req,res,null,error);
    });
});

//API to expose the billing information by passing userid
app.get('/billing/billinginfobyuserid/:id', function(req, res){

	trace.info('enter: get.billing.billinginfobyuserid.id');
    var id = req.params.id;

    return exports.getById(id, conn).then(function (dbresults) {
        return res.send(dbresults);
    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function (error) {
        return handleRestError(req,res,null,error);
    });
});



//API to expose the billing information by passing orderid
app.get('/billing/billinginfobyordernumber/:id', function(req, res){

    if (req.query && req.query.details && req.query.details == 'true' ) {
    	
    	if(req.query.accounttype && (req.query.accounttype).toLowerCase()=='reseller'){
    		return detailedResellerBillingInformationWithOrderNumber(req,res);
    	}else{
    		return detailedBillingInformationWithOrderNumber(req,res);
    	}        

    } else {
        trace.info('enter: get.billing.billinginfobyordernumber.id');
        var order = req.params.id;
        exports.getByOrderNumber(order, conn, function (err, result) {
            if (err) res.send(err, err.code);
            res.send(result);
        });
    }
});

function detailedResellerBillingInformationWithOrderNumber(req,res){
    trace.info('enter: get.billing.billinginfobyordernumber.id?details=true');
    promise.delay(0000).then (function (){
        var orderNumber = req.params.id;
        return exports.getDetailedResellerInformationByOrderNumber(orderNumber,conn);

    }).then (function (details){
        var result = details[0][0];
        result.lineItems = details[1];
        return res.send(result);

    }).catch(function onReject(err) {
        return handleRestError(req,res, err, null);
    }).catch(function(error){
        return handleRestError(req,res, null,error);
    }); // then close
}


function detailedBillingInformationWithOrderNumber(req,res){
    trace.info('enter: get.billing.billinginfobyordernumber.id?details=true');
    promise.delay(0000).then (function (){
        var orderNumber = req.params.id;
        return exports.getDetailedInformationByOrderNumber(orderNumber,conn);

    }).then (function (details){
        var result = details[0][0];
        result.lineItems = details[1];
        return res.send(result);

    }).catch(function onReject(err) {
        return handleRestError(req,res, err, null);
    }).catch(function(error){
        return handleRestError(req,res, null,error);
    }); // then close
}

//TODO will be depricated after analysing the dependencies of this API
//API to expose the billing details of user by passing userid
app.get('/billing/billingdetailsbyuserid/:id', function(req, res){

	trace.info('enter: get.billing.billingdetailsbyuserid.id');

	var id = req.params.id;

    exports.getByOwnerId(id, conn, function(err,result){

	 if (err) res.send(err, err.code);

	 res.send(result);

	});
});

//API to expose the billing details of user by passing userid
app.get('/billing/billingdetailsbyaccountid/:id', function(req, res){

    trace.info('enter: get.billing.billingdetailsbyaccountid.id');
    var id = req.params.id;
    var noLocalePrice = req.query.noLocalePrice;
    
    if(noLocalePrice){
    	exports.getNoLocalePriceByAccountId(id, conn, function (err, result) {
	        if (err) return res.send(err, err.code);
	        res.send(result);
	    });
	} else {
		exports.getByAccountId(id, conn, function (err, result) {
	        if (err) return res.send(err, err.code);
	        res.send(result);
	    });
	}
});

// upload csv file

app.post('/billing/fileimport', function (req,res){

 trace.info('Inside billing/fileimport');
		return reconexecution.uploadfile(req,res);

});

// reconcile all
app.post('/billing/reconcileall', function (req,res){

 trace.info('Inside billing/reconcileall');
		return reconexecution.reconcileall(req,res);

});

// api to get getMaxCreditLimit
app.get('/billing/getdefaultmaxcreditlimit', function(req, res){
trace.info('enter: get.billing.getdefaultmaxcreditlimit');
var maxCreditLimit=[];
maxCreditLimit = config.maxCreditAmount;
trace.info('The getdefaultmaxcreditlimit is ::::::::'+maxCreditLimit);
return res.send(maxCreditLimit);

});

app.get('/billing/billingdetails/allaccounts', function(req, res) {

    trace.info('GET billing/billingdetails/allaccounts - UserId:'+ req.parentUserId || req.userId);
    return getUserAccounts(req).then (function (accountids){
        if(accountids){
            return exports.getByAccountIds(accountids.join(), conn);
        } else {
            return res.send([]);
        }
    }).then(function (dbresults) {
        return res.send(dbresults);
    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function (error) {
        return handleRestError(req,res,null,error);
    });
});

//API to get the available credit amount
app.get('/billing/availablecreditamount/:id', function(req, res){

	trace.info('enter: get.billing.availablecreditamount.id');

	var id = req.params.id;

    exports.getAvailableCreditAmountById(id, conn, function(err,result){

    if (err) res.send(err, err.code);

	 res.send(result);

	});
});

//API to get the check for payment token by userid
app.get('/billing/istokenavailable/:id', function(req, res){

	trace.info('enter: get.billing.istokenavailable.id');

	var id = req.params.id;

	if(config.skipPaymentInfoVerfications) {

		var maskedResult = [];

		response = {

			ownerid : id,
			isPaymentTokenExists : 'true'
		}

		maskedResult.push(response);

		res.send(maskedResult);
	}

    payment.getId(id, conn, function(err,result){

    if (err) res.send(err, err.code);

    res.send(result);

	});
});

//API to get all payment methods for an user
app.get('/billing/userpaymentinfo/user/:id', function(req, res){

	trace.info('enter: get.billing.userpaymentinfo.user.id');

	var id = req.params.id;

    payment.getPaymentMethodsById(id, conn, function(err,result){

    if (err) res.send(err, err.code);

    res.send(result);

    });
});

//API to get the payment method details by userpaymentinfoid
app.get('/billing/userpaymentinfo/user/userpaymentinfoid/:id', function(req, res){

	trace.info('enter: get.billing.userpaymentinfo.user.userpaymentinfoid.id');

	var id = req.params.id;

     payment.getPaymentMethodsByUserPaymentInfoId(id, conn, function(err,result){

	if (err) res.send(err, err.code);

    res.send(result);

	 });
});

//API to get the billing settings of user by passing userid (fedadmin page)
app.get('/billing/userbillinginfo/getallusers/:id', function(req, res) {

	trace.info('enter: get.billing.userbillinginfo.getallusers.id');
	var id = req.params.id;
    exports.getBillingSettingsByOwnerId(id, conn, function(err,result) {

		if(err) {
			var errorInfo = {
				userId : "",
				message : err.code
			};
			res.send(errorInfo);
		}
		else {
			res.send(result);
		}
	});
});

// Api to get the user billing status
app.get('/billing/validateuser/:id', function(req, res){
	trace.info('enter: get.billing.validateuser.id');

	var ownerId = req.params.id;
	var action = req.query.action;

	// By-pass billing settings as per configuration
	var maskedResult = {

	  ownerId: ownerId,
	  billingStatus: 'Active',
	  creditWorthinessLevelId: '3'

	}

	if (config.skipPaymentInfoVerfications) {

		res.send(JSON.stringify(maskedResult));

	}

	var probationErrorInfo = {
									errorCode : 'RestrictActivation',
									errorMessage : 'Billing in probation state'
							 }


     exports.getBillingStatusByOwnerId(ownerId, conn, function(err,result){
		if (err)
		{
		trace.info('Error in fetching the data from SP');
		}else{

		 var output = result;
		 var retryCount = output[0].retryCount;
		 var level = output[0].creditWorthinessLevelId;
		 var billingStatus = output[0].billingStatus;
		 var userid = output[0].ownerId;
		 var PaymentRegistrationStatus = output[0].isPaymentRegistrationBlocked;
		 var errorResult = {};
		 var statusWithoutError = {
								ownerId : userid,
								billingStatus : billingStatus,
								creditWorthinessLevelId : level
							 }

		 var array = [];
			if(action == 'activate')
			{
				if(billingStatus == 'Delinquent' || billingStatus == 'Fraudulent')
				{
					var delinquentErrorInfo = {
									errorCode : 'RestrictActivation',
									errorMessage : 'Billing in suspended state'
									}

									array.push(delinquentErrorInfo);

					errorResult = {
					ownerId : userid,
					billingStatus : billingStatus,
					creditWorthinessLevelId : level,
					error : array
				    }

					res.send(errorResult);

				}

				else if(billingStatus == 'Probation')
				{

					// userbillingstatus = probation and not allowed to activate resource
					if(level == 1){

						array.push(probationErrorInfo);
						errorResult = {
								ownerId : userid,
								billingStatus : billingStatus,
								creditWorthinessLevelId : level,
								error : array
						}
						res.send(errorResult);

					}
					// userbillingstatus = probation and not allowed to activate resource
					else if (retryCount == 2 && (level == 3 || level == 2)){

						array.push(probationErrorInfo);

						errorResult = {
								ownerId : userid,
								billingStatus : billingStatus,
								creditWorthinessLevelId : level,
								error : array
						}

						res.send(errorResult);

					}
					// userbillingstatus = probation and not allowed to activate resource
					else if (retryCount == 3 && level == 3){

						array.push(probationErrorInfo);

						errorResult = {
								ownerId : userid,
								billingStatus : billingStatus,
								creditWorthinessLevelId : level,
								error : array
						}

						res.send(errorResult);
					}
					// userbillingStatus = probation and user is allowed to activate the resource
					else{

						res.send(statusWithoutError);
					}


				}

				// userbillingstatus = active
				else{

					res.send(statusWithoutError);

				}
			}else if(action == 'paymentregistration'){

				res.send({isPaymentRegistrationBlocked : PaymentRegistrationStatus})

			}
			// api is not provided with correct parameter
			else{
				var actions = {error : 'Parameter action required'}

				res.send(actions);
			}
		}
	});
});

//TODO needs to be depricated
//API to put the billing settings of user by passing userbilllinginfoid (fedadmin page)
app.put('/billing/userbillinginfo/userbillingsettings', function(req, res) {

	trace.info('enter: put.billing.userbillinginfo.userbillingsettings');

    var updateBillingSettings = { };
		updateBillingSettings.BillingFrequency = req.body.billingFrequency;
		updateBillingSettings.NextBillingDate = req.body.nextBillingDate;
		updateBillingSettings.MaxCreditLimit = req.body.maxCreditLimit;
		updateBillingSettings.CreditLevel = req.body.creditLevel;
		updateBillingSettings.BillingStatus = req.body.billingStatus;
		updateBillingSettings.billingCurrency = req.body.billingCurrency || null;
		updateBillingSettings.invoicingLanguage = req.body.invoicingLanguage || null;
		updateBillingSettings.UserBillingInfoId = req.body.userBillingInfoId;

    exports.updateBillingSettings(updateBillingSettings, conn).then(function(mySqlResult){
        res.send(mySqlResult);

    }).catch(function onReject(err) {
        trace.error(err);
        if(err.stack) trace.debug(err);
        var errorInfo = {
            userBillingInfoId : "",
            message : err
        };
        res.send(errorInfo);
    }).catch(function (error) {
        trace.error('Catch Error:', error);
        if (error.stack)
            trace.debug('Error Occurred in : ' + error.stack);
        res.statusCode = 500;
        return res.send(null);
    });
});


//API to put the billing settings of user by passing userbilllinginfoid (fedadmin page)
app.post('/billing/accountbillinginfo/accountbillingsettings', function(req, res) {
    trace.info('POST /billing/accountbillinginfo/accountbillingsettings'+JSON.stringify(req.body));
	if(!req.body.ownerId){
		trace.warn('ownerId_missing');
		res.statusCode = 400;
		res.send({err:'ownerId missing'});
	};
	getConfigByChannel(req.body.ownerId).then(function(channelConfig){
		trace.info(channelConfig);
		req.body.channelCode = channelConfig.channelCode;
		if(!channelConfig){
			trace.warn('channelcode_unavailable');
			res.statusCode = 400;
			res.send({error : 'channelcode_unavailable'});
		} else return channelConfig;
	}).then(function(channelConfig){
		if(!req.body.billingFrequency){
			if(channelConfig && channelConfig.billingFrequency){
				req.body.billingFrequency = channelConfig.billingFrequency;
				req.body.billingFrequencyType = channelConfig.billingFrequencyType;
				req.body.channelCode = channelConfig.channelCode;
			}
		};
		return updateBillingSettings(req, res);
	}).catch(function (error) {
        trace.error('Catch Error:', error);
        if (error.stack)
            trace.debug('Error Occurred in : ' + error.stack);
        res.statusCode = 500;
        return res.send(null);
    });

});

//API to put the billing settings of user by passing userbilllinginfoid (fedadmin page)
app.put('/billing/accountbillinginfo/accountbillingsettings', function(req, res) {
    trace.info('PUT /billing/accountbillinginfo/accountbillingsettings'+JSON.stringify(req.body));
	
		if(req.body.userBillingInfoId) {
		var ownerIduser = (req.body.ownerId)? req.body.ownerId : req.ownerId;
		getConfigByChannel(ownerIduser).then(function(channelConfig){
		trace.info('>>>>>>channelConfig>>>>>>>>>>'+JSON.stringify(channelConfig));
		if(!channelConfig){
			trace.warn('channelcode_unavailable');
			res.statusCode = 400;
			res.send({error : 'channelcode_unavailable'});
		} else return channelConfig;
	}).then(function(channelConfig){
		
		if(channelConfig.channelCode){
			if(channelConfig && channelConfig.channelCode){
				trace.info('>>>>>>channelConfig11>>>>>>>>>>'+channelConfig.channelCode);
				req.body.channelCode = channelConfig.channelCode;
				return updateBillingSettings(req, res);
			}
		};
		
	})
        
    }else{
        res.statusCode = 400;
        res.send({err:'userBillingInfoId missing'});
    }

});

function updateBillingSettings(req,res){

    var VpaCode = null;
    var ChannelCode = (req.query.channelCode) ? (req.query.channelCode).toLowerCase() : null;
    var UserChannelCode = (req.body.channelCode) ? (req.body.channelCode).toLowerCase() : null;
    var CountryCode = config.CountryCode;
	trace.info('CountryCode'+CountryCode+'ChannelCode'+ChannelCode)

    promise.delay(0000).then(function() {
        var requestBillingSettings = req.body;

        var updateBillingSettings = {};
		updateBillingSettings.CountryCode = config.CountryCode;
		updateBillingSettings.UserChannelCode = UserChannelCode;
        updateBillingSettings.BillingFrequency = parseInt(requestBillingSettings.billingFrequency) || null;
        updateBillingSettings.BillingFrequencyType = requestBillingSettings.billingFrequencyType || null;
        //updateBillingSettings.NextBillingDate = new Date(requestBillingSettings.nextBillingDate).toISOString().replace(/T/, ' ').replace(/\..+/, '') || null;
        updateBillingSettings.NextBillingDate = requestBillingSettings.nextBillingDate || '1900-00-00';
        updateBillingSettings.MaxCreditLimit = isNaN(parseFloat(requestBillingSettings.maxCreditLimit)) ? null : parseFloat(requestBillingSettings.maxCreditLimit, 10);
		// initially setting maxcreditlimit to availablecreditamount
		updateBillingSettings.CreditLimitUnUsed= updateBillingSettings.MaxCreditLimit;
        updateBillingSettings.CreditLevel = parseInt(requestBillingSettings.creditLevel, 10) || null;
        updateBillingSettings.BillingStatus = requestBillingSettings.billingStatus || null;
        updateBillingSettings.UserBillingInfoId = requestBillingSettings.userBillingInfoId || null;
        updateBillingSettings.ownerId = requestBillingSettings.ownerId || null;
        updateBillingSettings.paymentterm = requestBillingSettings.paymentterm || null;
		updateBillingSettings.payMethod = requestBillingSettings.payMethod || null;
		updateBillingSettings.AllowedToTransact = requestBillingSettings.AllowedToTransact || null;
		updateBillingSettings.invoiceMailStatus = requestBillingSettings.invoiceMailStatus || null;
		updateBillingSettings.BillingTerm = requestBillingSettings.BillingTerm || null;
		updateBillingSettings.CommissionPaymentDate = requestBillingSettings.CommissionPaymentDate || null;
		updateBillingSettings.CountryCode = config.CountryCode || null;
		updateBillingSettings.ChannelCode = ChannelCode;
		updateBillingSettings.invoicePayDueDate = requestBillingSettings.invoicePayDueDate || null;
		updateBillingSettings.Vatpercent = requestBillingSettings.Vatpercent || null;
		updateBillingSettings.accountVat = requestBillingSettings.vat || null;
		if (UserChannelCode && requestBillingSettings.Vatpercent ){
			trace.info('vat info'+JSON.stringify(updateBillingSettings))
			
			   exports.updatevatinfo(updateBillingSettings, conn);
		
		}	
	   if(requestBillingSettings.vpacode === ''){
			VpaCode = 'NONE';
			updateBillingSettings.VpaCode = '';
		}else{
			VpaCode = requestBillingSettings.vpacode || null;
			updateBillingSettings.VpaCode = requestBillingSettings.vpacode || '';
		}
		/*Some Changes	are made regarding CommissionID	*/
		// CommissionID For agent Only 
		 if(requestBillingSettings.commissionId === ''){
			commissionId = 'NONE';
			updateBillingSettings.commissionId = '';
		}else{
			commissionId = requestBillingSettings.commissionId || null;
			updateBillingSettings.commissionId = requestBillingSettings.commissionId || '';
		}
		
		//updateBillingSettings.VpaCode = requestBillingSettings.vpacode || null;
		
		if(typeof updateBillingSettings.BillingFrequency == 'number'
			&& updateBillingSettings.BillingFrequencyType === 'of every month'
			&& (updateBillingSettings.BillingFrequency > 28 || updateBillingSettings.BillingFrequency < 1)) {

			trace.warn('BillingFrequency_Between_1_and_28_For_MonthlyBilling/BillingFrequency/'
						+ updateBillingSettings.BillingFrequency
						+ '/BillingFrequencyType/'
						+ updateBillingSettings.BillingFrequencyType);

			res.statusCode = 400;
			res.send({err:'BillingFrequency_Between_1_and_28_For_MonthlyBilling'});

			return null;
		}

        return updateBillingSettings;

    }).then(function(updateBillingSettings) {
		if (updateBillingSettings == null) {
			return null;
		}

        return exports.updateBillingSettings(updateBillingSettings, conn);

    }).then(function (mySqlResult) {

		if (mySqlResult == null) {
			return null;
		}
        if (VpaCode && mySqlResult.length > 0 && mySqlResult[0].ownerId) {
            var jsonObject = JSON.stringify({"VpaCode": VpaCode});
            //send to accountProperties in authentication
            var postheaders = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonObject, 'utf8')
            };

            postheaders[authConfig.bypassHeaderName] = 'billing' + ':' + authConfig.billing;
            postheaders['ownerId'] = mySqlResult[0].ownerId;

            // the post options
            var optionspost = {
                host: config.authServiceHost,
                port: config.authServicePort,
                path: '/api/authentication/account/' + mySqlResult[0].ownerId,
                method: 'PUT',
                headers: postheaders
            };

            return restservices.postCall(optionspost, jsonObject);
        }else{
            return null;
        }
    }).then(function (authResult) {
        if (authResult) {
            trace.info('AuthService result on updating VpaCode : ' + JSON.stringify(authResult));
        }
        return res.send(authResult);
    }).catch(function onReject(err) {
        trace.error(err);
        if (err.stack) trace.debug(err);
        var errorInfo = {
            userBillingInfoId: "",
            message: err
        };
        res.send(errorInfo);
    }).catch(function (error) {
        trace.error('Catch Error:', error);
        if (error.stack)
            trace.debug('Error Occurred in : ' + error.stack);
        res.statusCode = 500;
        return res.send(null);
    });
}

app.put('/billing/billingaddress/:id', function(req, res) {
    var request = req.body;
    if(typeof request.isDefault !== 'undefined') {
        var updatePost = {};
        updatePost.billingAddressId = req.params.id;
        updatePost.ownerId = req.ownerId;
        updatePost.isDefault = request.isDefault;

        exports.updateBillingAddress(updatePost, conn).then(function (dbresults) {
            return res.send({billingAddressId :req.params.id });
        }).catch(function onReject(err) {
            trace.warn('FAILED', err);
            if(err.stack)
                trace.debug(err.stack);
            res.statusCode = 404;
            res.send({});
        }).catch(function (error) {
            res.statusCode = 500;
            res.send({error: null});
            if (error.stack)
                trace.error('Error Occurred in : ' + error.stack);
        });
    }else{
        res.statusCode = 400;
        res.send({});
    }

});

//Api to create the coupon
app.post('/billing/coupon/addcoupon', function(req, res) {

	trace.info('enter: post.billing.coupon.addcoupon');

    var createCouponmysql = promise.promisify(coupons.createCoupon);

    promise.delay(0000).then (function(){
    	if(req.body !=null && (!req.body.accountId || req.body.accountId == '')){
    		trace.info('req.body.accountId >>>>>'  +req.body.accountId);
    		req.body.accountId ='null';
    	}
        return joiValidate(req.body, couponSchemas.postCoupon,{stripUnknown: true, noDefaults: false}); //since POST, noDefaults: true
    }).then (function (body) {
        return createCouponmysql(body,conn);
    }).then (function (result){
        return res.send(result);

    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function(error){
        return handleRestError(req,res,null,error);
    }); // then close
});

//Api to update the coupon
app.put('/billing/coupon/updatecoupon', function(req, res) {

	trace.info('enter: put.billing.coupon.updatecoupon');

    var updateCouponmysql = promise.promisify(coupons.updateCoupon);

    promise.delay(0000).then (function(){
    	if(req.body !=null && req.body.accountId == ''){
    		trace.info('req.body.accountId >>>>>'  +req.body.accountId);
    		req.body.accountId ='null';
    	}
    	
        return joiValidate(req.body, couponSchemas.putCoupon,{stripUnknown: true}); //since PUT, noDefaults: true
    }).then (function (body) {
        return updateCouponmysql(body,conn);
    }).then (function (result){
        return res.send(result);

    }).catch(function onReject(err) {
        return handleRestError(req,res,err,null);
    }).catch(function(error){
        return handleRestError(req,res,null,error);
    }); // then close


});

//API to get all coupons information
app.get('/billing/coupon', function(req, res){

	trace.info('enter: get.billing.coupon');

    coupons.getCoupons(conn, req.channelCode, function(err, result){

	if (err) res.send(err, err.code);

    res.send(result);

	 });
});

//API to get coupons used by the user
app.get('/billing/coupon/user/:id', function(req, res){

	trace.info('enter: get.billing.coupon.user.id');

	var id = req.params.id;

    coupons.getCouponsById(id, conn, function(err,result){

	if (err) res.send(err, err.code);

    res.send(result);

	});
});

 //API to validate whether coupon exists
app.get('/billing/coupon/validatecouponexists/:id', function(req, res){

	trace.info('enter: get.billing.coupon.validatecouponexists.id');

	var couponcode = req.params.id;

	var channelcode = req.query.channelcode;
	var ownerId = req.ownerId;
     coupons.verifyCoupons(couponcode,channelcode,ownerId, conn, function(result){

	 var output = result;

		if(output[0].error)
		{
			var errorInfo =errorInfoCode.getErrorInfo(404, 'coupon not valid');

			trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

			res.send(errorInfo);

		}
		else
		{
		res.send(output);
		}

	 });
});

//API for appliying coupon for an user
app.post('/billing/coupon/applycoupon',function(req, res) {

	trace.info('enter: post.billing.coupon.applycoupon');

    coupons_verifyCouponDetails =  promise.promisify(coupons.verifyCouponDetails);
    coupons_applyCoupon = promise.promisify(coupons.applyCoupon);

    var input = {};

    promise.delay(0000).then (function (){
        return joiValidate(req.body, couponSchemas.postApplyCoupon,{stripUnknown: true, noDefaults: true});

    }).then (function (parsedBody){
        input = {
            UserId : parsedBody.userId,
            CouponCode: parsedBody.couponCode,
            handledUserId : parsedBody.handledUserId,
            ChannelCode: parsedBody.channelCode
        };
        return coupons_verifyCouponDetails(input,conn);
    }).then (function (result){
    	 trace.info('RESULTTTT------'+result)//If result is Empty (Means Coupon is already deleted by Admin)
    	 if(result !=null && result !=''){
 
	         var couponInfo = result[0];
	         
	        trace.info('couponInfo.accountIdd-------'+couponInfo.accountId)
	        if(couponInfo.accountId !=null && couponInfo.accountId !='null' && couponInfo.accountId!=''){
	        	if(couponInfo.accountId==input.UserId){
	        		trace.info('------Account is VAlid-------')
	        		 return coupons_applyCoupon(input, conn);
	        	}else{
	        		trace.info('------Account is IN------VAlid-------')
	        		var errorInfo =errorInfoCode.getErrorInfo(404, 'The coupon not applicable for the selected account');
		            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
		            res.send(errorInfo);
		            return null;
	        	}
        }
        else{
        	    trace.info('---------In  else AccountId is null----------------')
		        if(couponInfo.maxUsages == 0) {
		            return coupons_applyCoupon(input, conn);
		        }else if( Number(couponInfo.currentUsers) < Number(couponInfo.maxUsages) && couponInfo.currentDate >= couponInfo.activeDate && couponInfo.currentDate < couponInfo.expiryDate) {
		            return coupons_applyCoupon(input, conn);
		        }else if(couponInfo.currentDate > couponInfo.expiryDate){
		        	 var errorInfo =errorInfoCode.getErrorInfo(404, 'The coupon is no longer valid. It is expired');
		             trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
		             res.send(errorInfo);
		             return null;
		        }else if( Number(couponInfo.currentUsers) >= Number(couponInfo.maxUsages)){
		            // var errorInfo =errorInfoCode.getErrorInfo(404, 'Max usages reached');
		            var errorInfo =errorInfoCode.getErrorInfo(404, 'The coupon is no longer valid. Max usage limit is reached');
		            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
		            res.send(errorInfo);
		            return null;
		
		        }else if(couponInfo.currentDate < couponInfo.activeDate){
		            var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon activation not started');
		            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
		            res.send(errorInfo);
		            return null;
		        }else{
		            res.send({});
		            return null;
		        }
            }
        } else{
        	trace.info('------Coupon Already Deleted by Admin-----')
    		var errorInfo =errorInfoCode.getErrorInfo(404, 'The coupon code entered does not exist');
            trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
            res.send(errorInfo);
            return null;
        }
    }).then (function (results){
        if(results) {
            var output = results[0];

            if (output.result) {
                var errorInfo = errorInfoCode.getErrorInfo(404, 'Coupon already applied');
               // var errorInfo = errorInfoCode.getErrorInfo(404, resourceMsg['0003'][req.languageCode]);
                trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
                return res.send(errorInfo);

            } else {
                return res.send(output);
            }
        }
    }).catch(function onReject(err) {
        return handleRestError(req,res, err, null);
    }).catch(function(error){
        return handleRestError(req,res, null,error);
    }); // then close
});


//Api to delete coupon by Admin
app.put('/billing/coupon/deletecoupon', function(req, res) {
trace.info('enter: put.billing.coupon.deletecoupon');

   input = {
	         CouponId: req.body.id,
	         CouponCode:req.body.couponCode,
	         ChannelCode: req.body.channelCode || req.query.channelCode
       };

   coupons.deleteCoupon(input, conn, function(err,results){

   var output = results[0];

   if(output.error){
	
	 var errorInfo =errorInfoCode.getErrorInfo(404, 'Requested Coupon Code does not exist :');
	
	 trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
	
	 res.send(errorInfo);
	
	}

   else
   res.send(output);
});
});




//API to to get the coupon billing history
app.get('/billing/coupon/paymentorder/:id', function(req, res){

	trace.info('enter: get.billing.coupon.paymentorder.id');

	var paymentorderid = req.params.id;

     coupons.couponHistory(paymentorderid, conn, function(err,result){

	 if (err) res.send(err, err.code);

	 res.send(result);

	 });
});


app.get('/billing/getaccountinvoice', function(req, res){
	
	
	
	var queryParams = {};
			queryParams.accountId = req.query.accountId;
			queryParams.invoicestartdate = req.query.invoicestartdate || "1900-01-01";
			queryParams.invoiceenddate = req.query.invoiceenddate || "2030-12-31";
			queryParams.limit = req.query.count || 1000;
			queryParams.offset = req.query.offset || 0;
						
	       var resp = {};
		   return mysql.invoicebydate(queryParams,conn,function(err,data){
			
			trace.info("get all invoice data --------------" + data[0].length)
			
			if(data[0].length>0){
				
			var array = data[0][0] ;
			var billing = data[1] ;

			
			 resp.respcode = 200;
			 resp.accountid = array.accountid;
			 resp.accountnumber = array.accountnumber;
			 resp.usagestarttime = array.usagestarttime;
			 resp.usageendtime = array.usageendtime;
			  resp.accountType = array.accountType;

			 resp.invoices = billing ; 

			var success = {};
			 success.respcode = 200;
			 success.accountinfo = resp ;
			
			res.send({"result":{"response":resp,"success":true,"message":"Invoice data retrieved successfully"}});

			}else{
				 resp.respcode = 404;
				 resp.errorcode = "BZSSS1452E";
				trace.info("No invoice data " + data[0]);
				
				res.send({
				  "result": {
					"response": {
					  "respcode": 404,
					  "errormessage": "No invoices found"
					},
					"success": false,
					"message": "No invoices found."
				  }
				});
			}

		});	
});	
	

// API TO GET INVOICE DETAILS

app.get('/billing/getinvoice/:invoicenumber', function (req,res) {
	var invoicenumber = req.params.invoicenumber;
	return exports.getaccounttype (invoicenumber,conn,function(data){
						
		//trace.info(data.accounttype);
		if(!data){
			res.send({
			  "result": {
				"response": {
				  "respcode": 404,
				  "errormessage": "No invoice details found"
				},
				"success": false,
				"message": "No invoice details found"
			  }
			});
		}			
		else if(data.accounttype == "reseller"){
				return mysql.resellerInvoiceReport(invoicenumber,conn,function(err,data){
					
					trace.info('>>>>>>>>GET RESELLER INVOICE REPORT>>>>>>>>>>>>'+JSON.stringify(data));	
				if(data[0].length>0){
					var accountinfo = {};
				accountinfo['accountId'] = data[1][0].ownerId;
				accountinfo['adminemail'] = data[1][0].adminemail;
				accountinfo['accountname'] = data[1][0].accountname;
				accountinfo['accountnumber'] = data[1][0].accountnumber;
				accountinfo['accounttype'] = data[1][0].accountType;


				var invoiceinfo = {};
				invoiceinfo['invoicenumber'] = data[1][0].orderNumber;
				invoiceinfo['InvoiceDate'] = data[1][0].invoiceDate;
				invoiceinfo['InvoiceDueDate'] = data[1][0].tenDaysDue;
				invoiceinfo['currency'] = data[1][0].currencysymbol;
				invoiceinfo['amount'] = data[1][0].amount;
				invoiceinfo['vatpercentage'] = data[1][0].VatPercentage;
				invoiceinfo['vatamount'] = data[1][0].vatAmount;
				invoiceinfo['totalamount'] = data[1][0].chargeAmount;
				var response={};
					response.accountinfo = accountinfo;
					response.invoiceinfo = invoiceinfo;

				var lineitems1 = [];
				var i=0;
				trace.info('-----------------'+data[0].length);

				for(var i=0;i<data[0].length;i++){
				var additionalparameters = {};

				var lineitems = {};
				lineitems.instanceid= data[0][i].resourceInstanceId;
				lineitems.resourcetype= data[0][i].resourcetype;
				lineitems.resourcename= data[0][i].description;
				lineitems.ChargeTypeDescription= data[0][i].reconDescription;
				lineitems.usagefromtime= data[0][i].usageFromDate;
				lineitems.usagetodate = data[0][i].usageToDate;
				lineitems.pricingunit = "/month";
				lineitems.unitprice= data[0][i].actualUnitPrice;
				lineitems.quantity = data[0][i].quantity;
				lineitems.amount= data[0][i].amount;
				lineitems.remCommitment= data[0][i].remainingcommitment;
				
				additionalparameters.xionservicenumber = data[0][i].xionservicenumber;
					additionalparameters.xionservicename = data[0][i].xionservicename;
					additionalparameters.xiondetailsforinitial = data[0][i].xiondetailsforinitial;
					additionalparameters.xiondetailsformonthly = data[0][i].xiondetailsformonthly;
					additionalparameters.xiondetailsforother = data[0][i].xiondetailsforother;
					additionalparameters.cdbinfo = data[0][i].cdbinfo;
					additionalparameters.productnameforsystemlinkage = data[0][i].productnameforsystemlinkage;
					
					lineitems.additionalparameters = additionalparameters;
				lineitems1.push(lineitems);
				}
				response.lineitems=lineitems1;

				res.send({"result":{"response":response,"success":true,"message":"Invoice data retrieved successfully"}});
				}else{
					res.respcode = 404;
								 
					trace.info("No invoice data For this AccountId " );
					res.send({"result":{"response":res.respcode,"success":false,"message":"No Reseller invoice found"}});}
				});
			
			
		}
		else{
							
			return mysql.invoicebyid(invoicenumber,conn,function(err,data){
				trace.info('>>SP_GetInvoiceById Result>>'+JSON.stringify(data));
				var response={};
				if(data[0].length>0){
					trace.info('_____'+data.length)
				  var accountinfo = {};
				  
				accountinfo['accountId'] = data[0][0].accountid;
				//accountinfo['adminemail'] = data[0][0].adminemail;
				accountinfo['accountname'] = data[0][0].accountname;
				//accountinfo['accountnumber'] = data[0][0].accountnumber;
				accountinfo['accounttype'] = data[0][0].accountType;
				var invoiceinfo = {};
				invoiceinfo['invoicenumber'] = data[0][0].invoicenumber;
				invoiceinfo['InvoiceDate'] = data[0][0].InvoiceDate;
				invoiceinfo['InvoiceDueDate'] = data[0][0].InvoiceDueDate;
				invoiceinfo['currency'] = data[0][0].currency;
				invoiceinfo['amount'] = data[0][0].amount;
				invoiceinfo['coupondiscountamount'] = data[0][0].coupondiscountamount;
				invoiceinfo['vatpercentage'] = data[0][0].vatpercent;
				invoiceinfo['vatamount'] = data[0][0].vatamount;
				invoiceinfo['totalamount'] = data[0][0].totalamount;
				
					response.accountinfo = accountinfo;
					response.invoiceinfo = invoiceinfo;

				var lineitems1 = [];
				var i=0;
				trace.info('length'+data[1].length);

				for(var i=0;i<data[1].length;i++){
				var additionalparameters = {};

				var lineitems = {};
				lineitems.instanceid= data[1][i].instanceid;
				lineitems.resourcetype= data[1][i].resourcename;
				lineitems.resourcename= data[1][i].resourcetype;
				lineitems.ChargeTypeDescription= String(data[1][i].lineitemdescription);
				lineitems.usagefromtime= data[1][i].usageFromDate;
				lineitems.usagetodate = data[1][i].usageToDate;
				lineitems.pricingunit = "/month";
				lineitems.unitprice= data[1][i].actualUnitPrice;
				lineitems.quantity = data[1][i].quantity;
				lineitems.amount= data[1][i].amount;
				lineitems.remCommitment= data[1][i].remainingcommitment;
				additionalparameters.xionservicenumber = data[1][i].xionservicenumber;
					additionalparameters.xionservicename = data[1][i].xionservicename;
					additionalparameters.xiondetailsforinitial = data[1][i].xiondetailsforinitial;
					additionalparameters.xiondetailsformonthly = data[1][i].xiondetailsformonthly;
					additionalparameters.xiondetailsforother = data[1][i].xiondetailsforother;
					additionalparameters.cdbinfo = data[1][i].cdbinfo;
					additionalparameters.productnameforsystemlinkage = data[1][i].productnameforsystemlinkage;
					
					lineitems.additionalparameters = additionalparameters;
				lineitems1.push(lineitems);
				}
				response.lineitems=lineitems1;

				res.send({"result":{"response":response,"success":true,"message":"Invoice data retrieved successfully"}});
				}
				else {
					res.respcode = 404;
					//res.send({"result":{"response":res.respcode,"success":false,"message":"No ivoices available with invoice number"}});
					res.send({
					  "result": {
						"response": {
						  "respcode": 404,
						  "errormessage": "No invoice details found"
						},
						"success": false,
						"message": "No invoice details found."
					  }
					});
				}
				});
							
			
			
		}
	});
	
});


app.put('/billing/updateWorkloadDetails',function(req, res){
	trace.info('Enter updateWorkloadDetails');
	return exports.updateworkloaddetails(req,conn,function(err,result){
		if (err)
		{
			trace.info("Workload details Couldn't be updated"+err);
			res.send(err);
		}
		res.send(result);
	});
});



app.get('/billing/agentCommisionStatements', function(req, res){
	
	var queryParams = {};
			queryParams.accountId = req.query.accountId;
			
			trace.info("get all commissionStatements of agent -----------"+JSON.stringify(queryParams));	
	       var resp = {};
		   return mysql.agentcommissionstatements(queryParams.accountId,conn,function(err,data){
			
			trace.info("get all commissionStatements of agent --------------" + data[0].length)
			
			if(data[0].length>0){
				
			var array = data[0][0] ;
			var billing = data[1] ;

			
			 resp.respcode = 200;
			 resp.accountid = array.accountid;
			 resp.accountnumber = array.accountnumber;
			 resp.usagestarttime = array.usagestarttime;
			 resp.usageendtime = array.usageendtime;
			 resp.commissionStatements = billing ; 

			var success = {};
			 success.respcode = 200;
			 success.accountinfo = resp ;
			
			res.send({"result":{"response":resp,"success":true,"message":"Invoice data retrieved successfully"}});

			}else{
				 resp.respcode = 404;
				 
				trace.info("No invoice data For this AccountId " + data[0]);
				
				res.send({
				  "result": {
					"response": {
					  "respcode": 404,
					  "errormessage": "No commission statements found"
					},
					"success": false,
					"message": "No commission statements found"
				  }
				});
			}

		});	
});	
	



app.get('/billing/commisionStatementsdetails', function (req,res) {
	
	var commissionId = req.query.commissionId;
	return mysql.commissionStatementDetails(commissionId,conn,function(err,data){
	trace.info('>>commissionStatementDetails Result>>'+JSON.stringify(data));
	var response={};
if(data[0].length>0){
	trace.info('_____'+data.length)
  var accountinfo = {};
accountinfo['accountid'] = data[0][0].accountid;
accountinfo['adminemail'] = data[0][0].adminemail;
accountinfo['accountname'] = data[0][0].accountname;
accountinfo['accountnumber'] = data[0][0].accountnumber;

var invoiceinfo = {};
invoiceinfo['Commissionnumber'] = data[0][0].invoicenumber;
invoiceinfo['commissionDate'] = data[0][0].InvoiceDate;
//invoiceinfo['commissionDueDate'] = data[0][0].InvoiceDueDate;
invoiceinfo['commissionBase'] = data[0][0].commissionBase;
invoiceinfo['currency'] = data[0][0].currency;
invoiceinfo['amount'] = data[0][0].amount;

//var response={};
	response.accountinfo = accountinfo;
	response.commissioninfo = invoiceinfo;

var lineitems1 = [];
var i=0;
trace.info('length'+data[1].length);

for(var i=0;i<data[1].length;i++){

var lineitems = {};
lineitems.customerId= data[1][i].customerId;
lineitems.Customername = data[1][i].Customername;
lineitems.instanceid= data[1][i].instanceid;
lineitems.resourcetype= "Saas";
lineitems.resourcename= data[1][i].resourcename;
lineitems.lineitemdescription= String(data[1][i].lineitemdescription);
lineitems.usagefromtime= data[1][i].usageFromDate;
lineitems.usagetodate = data[1][i].usageToDate;
lineitems.createtime = data[1][i].createtime;
lineitems.usage = data[1][i].usagehrs;
lineitems.usageunit = "/hr";
lineitems.unitprice= data[1][i].unitprice;
lineitems.pricingunit = "/month";
lineitems.quantity = data[1][i].quantity;
lineitems.amount= data[1][i].amount;
lineitems.actualunitprice= data[1][i].actualunitprice;
lineitems.proratedunitprice = data[1][i].proratedunitprice;
lineitems1.push(lineitems);
}
response.lineitems=lineitems1;

res.send({"result":{"response":response,"success":true,"message":"commission data retrieved successfully"}});
}
else {
	response.status=404;
	
	res.send({
	  "result": {
		"response": {
		  "respcode": 404,
		  "errormessage": "No commission details found"
		},
		"success": false,
		"message": "No commission details found"
	  }
	});
}
});		
});



//API to get the invoice by passing provider name, month and year
app.get('/billing/providerinvoicebynamemonthandyear/:id', function(req, res){

trace.info('enter: get.billing.providerinvoicebynamemonthandyear.id');

	var values = { }
	values.id = req.params.id;
	values.month = req.query.month;
	values.year = req.query.year;

     invoices.getProviderInvoiceByNameMonthAndYear(values, conn, function(err,result){

	 if (err) res.send(err, err.code);

   res.send(result);
	 });
});

//API to get the invoice by passing provider name
app.get('/billing/providerinvoicebyname/:id', function(req, res){

trace.info('enter: get.billing.providerinvoicebyname.id');

	var id = req.params.id;

     invoices.getProviderInvoicesByName(id, conn, function(err,result){

	 if (err) res.send(err, err.code);

   res.send(result);

	 });
});

//API to get the invoice by passing provider name, month and year
app.get('/billing/providerinvoicebymonthandyear', function(req, res){

trace.info('enter: get.billing.providerinvoicebymonthandyear');

	var values = { }
	values.month = req.query.month;
	values.year = req.query.year;

     invoices.getProviderInvoiceByMonthAndYear(values, conn, function(err,result){

	 if (err) res.send(err, err.code);

   res.send(result);

	 });
});

//  API to retrieve all prices for the given instances
app.post('/billing/getinstanceprices', function(req, res) {

	trace.info('------------------- /billing/getinstanceprices ---------------');
	var input = req.body;
	var ownerId = input.ownerId;
	var instanceIds = input.instanceIds;

	 exports.getPricingForInstances(ownerId,instanceIds,conn,function(err,result) {
		if(err){
		   res.send(err);
		}
	   res.send(result);
    });
});

//Api to insert the invoice
app.post('/billing/providerinvoice/addinvoice', function(req, res) {
trace.info('enter: post.billing.providerinvoice.addinvoice');
    var invoice = { }
		invoice.ProviderName = req.body.providerName;
		invoice.InvoiceNumber = req.body.invoiceNumber;
		invoice.InvoiceDate = req.body.invoiceDate;
		invoice.DueDate = req.body.dueDate;
		invoice.FromDate = req.body.fromDate;
		invoice.ToDate = req.body.toDate;
		invoice.TotalAmount = req.body.totalAmount;
		invoice.DiscountAmount = req.body.discountAmount;
		invoice.ConversionRatio = req.body.conversionRatio;
		invoice.UsdAmount = req.body.usdAmount;
		invoice.AmountPaid = req.body.amountPaid;
		invoice.PaymentStatus = req.body.paymentStatus;
		invoice.PaymentDate = req.body.paymentDate;

   invoices.insertProviderInvoice(invoice, conn, function(err,results){

   var output = results[0];

   if(output.error)

					{

					 //var errorInfo =errorInfoCode.getErrorInfo(404, 'Provider does not exists:');
					 var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0004'][req.languageCode]);

					 trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);

					 res.send(errorInfo);

					}

   else
   res.send(output);
});
});

//Api to update provider invoice
app.put('/billing/providerinvoice/updateinvoice', function(req, res) {
trace.info('enter: put.billing.providerinvoice.updateinvoice');
    var invoice = { }
		invoice.Id = req.body.id;
		invoice.InvoiceNumber = req.body.invoiceNumber;
		invoice.InvoiceDate = req.body.invoiceDate;
		invoice.DueDate = req.body.dueDate;
		invoice.FromDate = req.body.fromDate;
		invoice.ToDate = req.body.toDate;
		invoice.TotalAmount = req.body.totalAmount;
		invoice.DiscountAmount = req.body.discountAmount;
		invoice.ConversionRatio = req.body.conversionRatio;
		invoice.UsdAmount = req.body.usdAmount;
		invoice.AmountPaid = req.body.amountPaid;
		invoice.PaymentStatus = req.body.paymentStatus;
		invoice.PaymentDate = req.body.paymentDate;

   invoices.updateProviderInvoice(invoice, conn, function(err,result){

   if (err) res.send(err, err.code);
   res.send(result[0]);
	 });
});

//API to get refundamount
 app.get('/billing/paymentrefund/paymentorderid/:id', function(req, res){

	var paymentOrderId = req.params.id;

	      paymentRefundServiceMysql.getPaymentRefundbyPaymentOrder(paymentOrderId, conn, function(err,result){

			var refundByCreditCard  = result[0];
			var refundByUserCoupon  = result[1];
			var refundObj = [];
			trace.info('refundByCreditCard>>'+refundByCreditCard);
			trace.info('refundByUserCoupon>>'+refundByUserCoupon);
			if(refundByCreditCard.length > 0){
				if(refundByCreditCard[0].lastTransactionNumber !== 'undefined' && refundByCreditCard[0].lastTransactionNumber)
				{
					refundObj.push(refundByCreditCard[0]);
				}
			}
			if(refundByUserCoupon.length > 0){
				for (var index in refundByUserCoupon)
				{
					if(refundByUserCoupon[index].UserCouponBillingHistoryId !== 'undefined' && refundByUserCoupon[index].UserCouponBillingHistoryId)
					{
						refundObj.push(refundByUserCoupon[index]);
					}
				}
				trace.info(JSON.stringify(refundByUserCoupon[0].UserCouponBillingHistoryId));
			}
			trace.info('::::::::::::::::Get RefundObj:::::::::::');
			trace.info(refundObj);
			res.send(refundObj);
			//return callback(null, refundObj);

		});

});

// Api to get sales report
app.get('/billing/salesreport', function(req, res){

trace.info('enter: get.billing.salesreport.channelcode');
if(req.query.channelcode){
	var channelcode = req.query.channelcode;

     exports.getsalesreportBychannelcode(channelcode, conn, function(err,result){
		
		var pricelist ={};
		
		pricelist.resources = result;
		 
		trace.info('enter: pro>>>>>>>');

		if (err) res.send(err, err.code);
	 
		if(result.length>0){
			 trace.info('length>>>>>>>.'+result.length);
			 var length = result.length;
			 pricelist.TotalListprice = 0;
			 pricelist.TotaCostprice= 0;
			 
			 for(i=0;i<length; i++){
				 pricelist.TotalListprice += result[i].listprice;
				 pricelist.TotaCostprice += result[i].costprice;
				}
		    res.send(pricelist);
	    } else{
				res.status=404;
				
				res.send({
				  "result": {
					"response": {
					  "respcode": 404,
					  "errormessage": "channel code not available"
					},
					"success": false,
					"message": "channel code not available"
				  }
				});
		}
		 
  

	 });
}
	else{	
		res.status=404;
				
			res.send({
				  "result": {
					"response": {
					  "respcode": 404,
					  "errormessage": "channel code not available"
					},
					"success": false,
					"message": "channel code not available"
				  }
				});
		}
		 

	
});

  //New method for GIRO refund
 app.post('/billing/paymentrefund/refund/', function(req, res){
	 
	 trace.info('--------------- enter: post.billing.paymentrefund.refund ---------------');

		var errStatus = {};
		errStatus.status = '';
		errStatus.errMsg = '';
		var providerTransactionId = '';
		var responseJSON = {};
		var paymentOrderId = req.body.PaymentOrderId;
		var ownerId = req.body.ownerId;
		var isFullRefund =true;
		var refundAmountToCustomer ='';
		var finalRefundAmountToCustomer='';
		
		//Check wether the Refund is passed as a paramater OR Full full refund by querying in DB
		trace.info('req.body.RefundAmount >>>>>'+req.body.RefundAmount);
		if(req.body.RefundAmount !=null && req.body.RefundAmount !== 'undefined' ){
			refundAmountToCustomer = parseFloat(req.body.RefundAmount);
			refundAmountToCustomer = refundAmountToCustomer.toFixed(2);
		    isFullRefund =false;
		}
		
		//To refund the amount to Cutomer
		directDebitOrCreditCardRefund();	
		function directDebitOrCreditCardRefund() {

			if (paymentOrderId) {

				paymentRefundServiceMysql.getPaymentRefundbyPaymentOrderNo(paymentOrderId, conn, function(err,result){

					var refundByPaymentOrderId  = result[0];

					trace.info('refundByPaymentOrderId : '+JSON.stringify(refundByPaymentOrderId)+'\n');

					if(refundByPaymentOrderId[0].OrderStatus == 'Success') {

						if(refundByPaymentOrderId[0].lastTransactionNumber !== 'undefined' && refundByPaymentOrderId[0].lastTransactionNumber) {

							var transactionNumberRequest = {
								TransactionNumberDto : refundByPaymentOrderId[0].lastTransactionNumber,
								TransactionNumber : refundByPaymentOrderId[0].lastTransactionNumber,
								EffortId : 6,
								TransactionType : "RetrieveByTransactionNumber",
								ProviderCodeName : refundByPaymentOrderId[0].ProviderCode,
								maskedCreditCardNumber: refundByPaymentOrderId[0].maskedCreditCardNumber

							};

							var currencyCode = refundByPaymentOrderId[0].CurrencyCode;
							var providerCode = refundByPaymentOrderId[0].ProviderCode;
							
							 finalRefundAmountToCustomer = isFullRefund ? refundByPaymentOrderId[0].refundedAmount:refundAmountToCustomer;
							
							trace.info('isFullRefund :'+isFullRefund);
							trace.info('refundAmountToCustomer :'+refundAmountToCustomer);
							trace.info('finalRefundAmountToCustomer :'+finalRefundAmountToCustomer);
							
							trace.info('transactionNumberRequest :'+JSON.stringify(transactionNumberRequest));
							
							var retriveTransactionRequest = {
									
									ownerId : ownerId,
									currencyCode : currencyCode,
							        providerCode : providerCode,
							        paymentOrderId : paymentOrderId,
							        refundAmount   : finalRefundAmountToCustomer,
							        maskedCreditCardNumber: refundByPaymentOrderId[0].maskedcreditcardnumber

							}
							
							trace.info('retriveTransactionRequest :'+JSON.stringify(retriveTransactionRequest));
							
							RetrieveByTransactionReference(transactionNumberRequest,retriveTransactionRequest,res);
						}
					}
					else {
						trace.warn('Payment order not yet settled!');
						errStatus.status = 'Failed';
						errStatus.errMsg = 'Payment order not yet settled';
						res.send(errStatus);
					}
				});
			}
			else {
				trace.warn('paymentOrderId/RefundAmount/OwnerId is/are empty');
				errStatus.status = 'Failed';
				errStatus.errMsg = 'Error in Refund';
				res.send(errStatus);
			}
		}
	
 });
 
	
	// RetrieveByTransactionNumberAPI
	function RetrieveByTransactionReference(transactionNumberRequest,retriveTransactionRequest,res) {

		//trace.info('transactionNumberRequest :'+JSON.stringify(transactionNumberRequest));
		var errStatus = {};
		errStatus.status = '';
		errStatus.errMsg = '';
		var paymentReference = '';
		var responseJSON = {};
		var getHeaders = {};
		getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
		getHeaders['ownerId'] = retriveTransactionRequest.ownerId;

		var options = {
			host: config.paymentauthhost,
			port: config.paymentauthport,
			path: '/apiv1.0/payment?format=json?' + querystring.stringify(transactionNumberRequest),
			method: 'POST',
			headers: getHeaders
		};

		trace.info('RetrieveByTransactionReference Options : '+ JSON.stringify(options));

  //TODO New Auth Model - no need as of now for payment
		var request = http.request(options, function (response) {

			if (response.statusCode === 204) {
				res.send('response statusCode : '+response.statusCode);
			}
			else {
				var content = '';
				response.setEncoding('utf8');
				response.on('data', function (chunk) {
					content += chunk;
				});

				response.on('end', function () {
					if (response.statusCode === 200 || response.statusCode === 201) {

						var resultRetrieve = JSON.parse(content);

						if(resultRetrieve) {
							trace.info('resultRetrieveTransaction : '+JSON.stringify(resultRetrieve));

							paymentReference = resultRetrieve.PaymentReference;
							ProviderTransactionId =resultRetrieve.ProviderTransactionId;
							
							trace.info('paymentReference : '+paymentReference);

							if(paymentReference) {

								var refundRequestParams = {
									OwnerId : retriveTransactionRequest.ownerId,	
									ProviderCodeNameDto : retriveTransactionRequest.providerCode,
									ProviderCodeName : retriveTransactionRequest.providerCode,
									TransactionType:"Refund",
									Description:"Refund API",
									OrderNumber: retriveTransactionRequest.paymentOrderId,
									Amount: retriveTransactionRequest.refundAmount,
									CurrencyCode: retriveTransactionRequest.currencyCode,
									paymentReference: paymentReference,
									ProviderTransactionId:ProviderTransactionId,
									maskedCreditCardNumber : resultRetrieve.PaymentTokenReferenceCode
								};
								trace.info('retriveTransactionRequest.refundAmount : '+retriveTransactionRequest.refundAmount);
								trace.info('retriveTransactionRequest.currencyCode : '+retriveTransactionRequest.currencyCode);
								trace.info('refundRequestParams : '+JSON.stringify(refundRequestParams));
								refundAPI(refundRequestParams,res);

							}
							else {
								trace.warn('TransactionReference is null');
							    errStatus.status = 'Failed';
								errStatus.errMsg = 'Error in Refund';
								res.send(JSON.stringify(errStatus));
							}

						}
						else   {
							trace.warn('REST API RetrieveByTransactionReference Process is Failed');
							errStatus.status = 'Failed';
							errStatus.errMsg = 'Error in Refund';
							res.send(JSON.stringify(errStatus));
						}
					}
				});
			}
		});

		request.on('error', function(e) {
			trace.warn('Error : '+e.message);
		});

		request.end();

	}

	// refundAPI
	function refundAPI(refundRequestParams,res) {

		trace.info('refundRequestParams : '+JSON.stringify(refundRequestParams)+'\n');
		var errStatus = {};
		errStatus.status = '';
		errStatus.errMsg = '';
		var paymentReference = '';
		var responseJSON = {};
		var getHeaders = {};
		getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
		getHeaders['ownerId'] = refundRequestParams.OwnerId;

		var refundOptions = {
			host: config.paymentauthhost,
			port: config.paymentauthport,
			path: '/apiv1.0/payment?format=json?' + querystring.stringify(refundRequestParams),
			method: 'POST',
			headers: getHeaders
		};

		trace.info('refundOptions : '+ JSON.stringify(refundOptions));

        //TODO New Auth Model - no need as of now for payment
		var request = http.request(refundOptions, function (response) {

			if (response.statusCode === 204) {
				res.send('response statusCode : '+response.statusCode);
			}
			else {
				var content = '';
				response.setEncoding('utf8');
				response.on('data', function (chunk) {
					content += chunk;
				});

				response.on('end', function () {
					if (response.statusCode === 200 || response.statusCode === 201) {

						var resultRefund = JSON.parse(content);

						trace.info('resultRefund : '+JSON.stringify(resultRefund));

						if(resultRefund.TransactionStatus == 'Success') {

							// insert into paymentrefund table before sending the success response
							paymentRefundServiceMysql.createPaymentRefund(refundRequestParams.OrderNumber, refundRequestParams.Amount, '', '', conn, function(err, result) {

								var paymentRefundDto = [];
								paymentRefundDto = result[0];

								if(paymentRefundDto && paymentRefundDto.length > 0) {

									trace.info('Refund has been completed successfully!');
									errStatus.status = 'Success';
									errStatus.errMsg = 'Refunded successfully';
									res.send(errStatus);
								}
								else {
									trace.warn('some error occured in inserting the refunded values into mysql db');
									errStatus.status = 'Failed';
									errStatus.errMsg = 'Error in Refund';
									res.send(errStatus);
								}

							});

						}
						else  {
							trace.warn('Refund REST API Process is Failed');
							errStatus.status = 'Failed';
							errStatus.errMsg = 'Error in Refund';
							res.send(errStatus);
						}
					}
					else  {
						trace.warn('resultRefund API status code is '+response.statusCode);
						errStatus.status = 'Failed';
						errStatus.errMsg = 'Error in Refund';
						res.send(errStatus);
					}
				});
			}
		});

		request.on('error', function(e) {
			trace.warn('Error : '+e.message);
		});

		request.end();

	}
app.post('/billing/paymentrefund/fullrefund/:isfullrefund', function(req, res){

	trace.info('--------------- enter: post.billing.paymentfullrefund ---------------');

	var errStatus = {};
	errStatus.status = '';
	errStatus.errMsg = '';
	var providerTransactionId = '';
	var responseJSON = {};
	var paymentOrderId = req.body.PaymentOrderId;
	var refundAmount = parseFloat(req.body.RefundAmount);
	    refundAmount = refundAmount.toFixed(2);
	var ownerId = req.body.UserId;
	var isFullRefund = req.params.isfullrefund;
	trace.info('isFullRefund : '+isFullRefund);

	if(req.body.TransactionNumber || isFullRefund == 'true' ) {
		trace.info('credit card refund');
		creditCardRefund();
	}

	if(req.body.UserCouponBillingHistoryId || isFullRefund == 'true' ) {
		trace.info('coupon refund');
		paymentRefundByCoupon(req);
		var userCouponBillingHistoryId = req.body.UserCouponBillingHistoryId;
	}

	trace.info('paymentOrderId : '+paymentOrderId);
	trace.info('RefundAmount : '+refundAmount);
	trace.info('OwnerId : '+ownerId);

	function creditCardRefund() {

		if (paymentOrderId && refundAmount) {

			paymentRefundServiceMysql.getPaymentRefundbyPaymentOrder(paymentOrderId, conn, function(err,result){

				var refundByPaymentOrderId  = result[0];

				trace.info('refundByPaymentOrderId : '+JSON.stringify(refundByPaymentOrderId)+'\n');

				if(refundByPaymentOrderId[0].OrderStatus == 'Success') {

					if(refundByPaymentOrderId[0].lastTransactionNumber !== 'undefined' && refundByPaymentOrderId[0].lastTransactionNumber) {

						var transactionNumberRequest = {
							TransactionNumberDto : refundByPaymentOrderId[0].lastTransactionNumber,
							TransactionNumber : refundByPaymentOrderId[0].lastTransactionNumber,
							EffortId : 6,
							TransactionType : "RetrieveByTransactionNumber",
							ProviderCodeName : refundByPaymentOrderId[0].ProviderCode
						};

						var currencyCode = refundByPaymentOrderId[0].CurrecyCode;
						var providerCode = refundByPaymentOrderId[0].ProviderCode;

						trace.info('transactionNumberRequest :'+JSON.stringify(transactionNumberRequest));

						RetrieveByTransactionNumberAPI(transactionNumberRequest, currencyCode, providerCode);
					}
				}
				else {
					trace.warn('Payment order not yet settled!');
					errStatus.status = 'Failed';
					errStatus.errMsg = 'Payment order not yet settled';
					res.send(errStatus);
				}
			});

		}
		else {
			trace.warn('paymentOrderId/RefundAmount/OwnerId is/are empty');
			errStatus.status = 'Failed';
			errStatus.errMsg = 'Error in Refund';
			res.send(errStatus);
		}
	}

	// RetrieveByTransactionNumberAPI
	function RetrieveByTransactionNumberAPI(transactionNumberRequest, currencyCode, providerCode) {

		trace.info('transactionNumberRequest :'+JSON.stringify(transactionNumberRequest));

		var getHeaders = {};
		getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
		getHeaders['ownerId'] = req.ownerId;

		var options = {
			host: config.paymentauthhost,
			port: config.paymentauthport,
			path: '/apiv1.0/payment?format=json?' + querystring.stringify(transactionNumberRequest),
			method: 'POST',
			headers: getHeaders
		};

		trace.info('RetrieveByTransactionNumber Options : '+ JSON.stringify(options));

        //TODO New Auth Model - no need as of now for payment
		var request = http.request(options, function (response) {

			if (response.statusCode === 204) {
				res.send('response statusCode : '+response.statusCode);
			}
			else {
				var content = '';
				response.setEncoding('utf8');
				response.on('data', function (chunk) {
					content += chunk;
				});

				response.on('end', function () {
					if (response.statusCode === 200 || response.statusCode === 201) {

						var resultRetrieve = JSON.parse(content);

						if(resultRetrieve) {
							trace.info('resultRetrieveTransaction : '+JSON.stringify(resultRetrieve));

							providerTransactionId = resultRetrieve.ProviderTransactionId;

							if(providerTransactionId) {

								var refundRequestParams = {
									ProviderCodeNameDto : providerCode,
									ProviderCodeName : providerCode,
									TransactionType:"Refund",
									Description:"Brain Tree Refund API",
									OrderNumber: paymentOrderId,
									Amount: refundAmount,
									CurrencyCode: currencyCode,
									ProviderTransactionId: providerTransactionId
								};

								refundAPI(refundRequestParams);

							}
							else {
								trace.warn('providerTransactionId is null');
							    errStatus.status = 'Failed';
								errStatus.errMsg = 'Error in Refund';
								res.send(JSON.stringify(errStatus));
							}

						}
						else   {
							trace.warn('REST API RetrieveByTransactionNumber Process is Failed');
							errStatus.status = 'Failed';
							errStatus.errMsg = 'Error in Refund';
							res.send(JSON.stringify(errStatus));
						}
					}
				});
			}
		});

		request.on('error', function(e) {
			trace.warn('Error : '+e.message);
		});

		request.end();

	}

	// refundAPI
	function refundAPI(refundRequestParams) {

		trace.info('refundRequestParams : '+JSON.stringify(refundRequestParams)+'\n');

		var getHeaders = {};
		getHeaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
		getHeaders['ownerId'] = req.ownerId;

		var refundOptions = {
			host: config.paymentauthhost,
			port: config.paymentauthport,
			path: '/apiv1.0/payment?format=json?' + querystring.stringify(refundRequestParams),
			method: 'POST',
			headers: getHeaders
		};

		trace.info('refundOptions : '+ JSON.stringify(refundOptions));

        //TODO New Auth Model - no need as of now for payment
		var request = http.request(refundOptions, function (response) {

			if (response.statusCode === 204) {
				res.send('response statusCode : '+response.statusCode);
			}
			else {
				var content = '';
				response.setEncoding('utf8');
				response.on('data', function (chunk) {
					content += chunk;
				});

				response.on('end', function () {
					if (response.statusCode === 200 || response.statusCode === 201) {

						var resultRefund = JSON.parse(content);

						trace.info('resultRefund : '+JSON.stringify(resultRefund));

						if(resultRefund.TransactionStatus == 'Success') {

							// insert into paymentrefund table before sending the success response
							paymentRefundServiceMysql.createPaymentRefund(paymentOrderId, refundAmount, '', '', conn, function(err, result) {

								var paymentRefundDto = [];
								paymentRefundDto = result[0];

								if(paymentRefundDto && paymentRefundDto.length > 0) {

									trace.info('Refund has been completed successfully!');
									errStatus.status = 'Success';
									errStatus.errMsg = 'Refunded successfully';
									res.send(errStatus);
								}
								else {
									trace.warn('some error occured in inserting the refunded values into mysql db');
									errStatus.status = 'Failed';
									errStatus.errMsg = 'Error in Refund';
									res.send(errStatus);
								}

							});

						}
						else  {
							trace.warn('Refund REST API Process is Failed');
							errStatus.status = 'Failed';
							errStatus.errMsg = 'Error in Refund';
							res.send(errStatus);
						}
					}
					else  {
						trace.warn('resultRefund API status code is '+response.statusCode);
						errStatus.status = 'Failed';
						errStatus.errMsg = 'Error in Refund';
						res.send(errStatus);
					}
				});
			}
		});

		request.on('error', function(e) {
			trace.warn('Error : '+e.message);
		});

		request.end();

	}

// For Coupon Refund
	function paymentRefundByCoupon(req) {

		trace.info(':::::::::::::::: get into paymentRefundByCoupon() ');

        var refundAmountParamCoupon;
		trace.info('refundAmount : '+refundAmount);
		trace.info('paymentOrderId : '+paymentOrderId);
		paymentRefundServiceMysql.getUserCouponBillingHistoryforRefund(paymentOrderId, conn, function(err, result) {

			trace.info(':::::::::::::::: Coupon mysql :::::::::::::');

			var userCouponBillingHistoryArr = [];
			userCouponBillingHistoryDto = result[0];
			trace.info('userCouponBillingHistoryDto : '+JSON.stringify(userCouponBillingHistoryDto));
			var amountApplied = Number(userCouponBillingHistoryDto.chargeAmount);
			var previousCouponrefundAmount = Number(userCouponBillingHistoryDto.refundedAmount);
			var couponRefundAmount = amountApplied - previousCouponrefundAmount;
			trace.info('amountApplied : '+amountApplied);
			trace.info('previousCouponrefundAmount : '+previousCouponrefundAmount);
			trace.info('couponRefundAmount : '+couponRefundAmount);
			trace.info('userCouponBillingHistoryId : '+userCouponBillingHistoryId);

			if((userCouponBillingHistoryId != '') || isFullRefund == 'true') {
				refundAmountParamCoupon = couponRefundAmount;
			}
			else {
				refundAmountParamCoupon = refundAmount;
			}

			if(couponRefundAmount <= 0 && isFullRefund == 'false' ) {
				errStatus.status = 'Failed';
				errStatus.errMsg = 'Coupon refund amount cannot be negative or zero';
				//var errorInfo = errorInfoCode.getErrorInfo(404, 'Coupon refund amount cannot be negative or zero');
				var errorInfo = errorInfoCode.getErrorInfo(404, resourceMsg['0005'][req.languageCode]);
				trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
				res.send(errStatus);
			}

			else if(refundAmount > couponRefundAmount && isFullRefund == 'false') {
				errStatus.status = 'Failed';
				//errStatus.errMsg = 'Coupon refund amount too large to be refunded';
				errStatus.errMsg = resourceMsg['0006'][req.languageCode];
				//var errorInfo = errorInfoCode.getErrorInfo(404, 'Coupon refund amount too large to be refunded');
				var errorInfo = errorInfoCode.getErrorInfo(404, resourceMsg['0006'][req.languageCode]);
				trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
				res.send(errStatus);
			}

			else {

				paymentRefundServiceMysql.createPaymentRefund(paymentOrderId, refundAmount, userCouponBillingHistoryId, ownerId, conn,function(err, result) {
					if (err) {
						trace.warn('coupon/createPaymentRefund Mysql Error');
						errStatus.status = 'Failed';
						errStatus.errMsg = 'Error in Refund';
						res.send(errStatus);
					}
					else {
						var paymentRefundDto = [];
						paymentRefundDto = result[0];

						if(isFullRefund != 'true') {   // For partial coupon refund
							errStatus.status = 'Success';
							errStatus.errMsg = 'Refunded Successfully';
							res.send(errStatus);
						}
					}

				});
			}
		});
	}

});

function autoApplyCoupon(userId,req,callback) {

	var input = { }
	input.UserId = userId;
	input.CouponCode = couponConfig.couponCode;
	input.ChannelCode = couponConfig.channelCode;

	coupons.verifyCouponDetails(input, conn, function(err,result) {
       trace.info('autoApplyCouponresult'+result)
       
       if(result && result !=null && result[0] && result[0]!=null){
		var couponInfo = result[0];

		if( Number(couponInfo.currentUsers) < Number(couponInfo.maxUsages) && couponInfo.currentDate >= couponInfo.activeDate && couponInfo.currentDate < couponInfo.expiryDate) {
			coupons.applyCoupon(input, conn, function(err,results){

				var output = results[0];

				if (err) {
					trace.info('Error :' + err);
					return callback(err);
				}
				else if (output.result) {

					//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon already applied');
					var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0003'][req.languageCode]);
					trace.info('errornfo: ' + JSON.stringify(errorInfo, null, 2));
					return callback(err, errorInfo);
				}
				else {
					return callback(err, output);
				}

			});
		}
		else if(couponInfo.currentDate > couponInfo.expiryDate && Number(couponInfo.currentUsers) >= Number(couponInfo.maxUsages) ) {

			var MaxUsers = couponConfig.maxUsers;
			var ExpiryDays = couponConfig.expiryDays;
			coupons.updateCouponExpiryDateAndMaxUsers(input.CouponCode, ExpiryDays, MaxUsers, conn, function(err,result) {

				var couponOutput = result[0];

				if (err) {
					trace.info('Error :' + err);
					return callback(err);
				}

				else if (couponOutput.error) {
					//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon does not exists');
					var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0007'][req.languageCode]);
					trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
					return callback(err, errorInfo);
				}
				else {
					coupons.applyCoupon(input, conn, function(err,results) {

						var output = results[0];

						if (err) {

							trace.info('Error :' + err);
							return callback(err);
						}

						else if (output.result) {
							//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon already applied');
							var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0003'][req.languageCode]);
							trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
							return callback(err, errorInfo);
						}
						else {
							return callback(err, output);
						}
					});
				}
			});
		}
		else if( Number(couponInfo.currentUsers) >= Number(couponInfo.maxUsages)) {

			var MaxUsers = couponConfig.maxUsers;
			coupons.updateCouponUsers(input.CouponCode, MaxUsers, conn, function(err,result) {

				var couponOutput = result[0];

				if (err) {
					trace.info('Error :' + err);
					return callback(err);
				}
				else if(couponOutput.error) {
					//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon does not exists');
					var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0007'][req.languageCode]);
					trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
					return callback(err, errorInfo);
				}
				else {
					coupons.applyCoupon(input, conn, function(err,results) {

						var output = results[0];

						if (err) {
							trace.info('Error :' + err);
							return callback(err);
						}

						else if(output.result) {
							 //var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon already applied');
							 var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0003'][req.languageCode]);
							 trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
							 return callback(err, errorInfo);
						}
						else {
							return callback(err, output);
						}
					});
				}
			});
		}
		else {

			if(couponInfo.currentDate > couponInfo.expiryDate) {

				var ExpiryDays = couponConfig.expiryDays;
				coupons.updateCouponExpiryDate(input.CouponCode, ExpiryDays, conn, function(err,result) {

					var couponOutput = result[0];

					if (err) {
							trace.info('Error :' + err);
							return callback(err);
					}
					else if (couponOutput.error) {
						//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon doesnt exists');
						var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0007'][req.languageCode]);
						trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
						return callback(err, errorInfo);
					}
					else {
						coupons.applyCoupon(input, conn, function(err,results) {

							var output = results[0];

							if (err) {
								trace.info('Error :' + err);
								return callback(err);
							}
							else if (output.result) {
								//var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon already applied');
								var errorInfo =errorInfoCode.getErrorInfo(404, resourceMsg['0003'][req.languageCode]);
								trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
								return callback(err, errorInfo);
							}
							else {
								return callback(err, output);
							}
						});
					}
				});
			}

		}
       }else{
    	    var errorInfo =errorInfoCode.getErrorInfo(404, 'Coupon does not exist');
			trace.warn('ticket: ' + errorInfo.ticket + ': code: ' + errorInfo.code + ': message: ' + errorInfo.message);
			return callback(err, errorInfo);
       }
	});
}

// get pricing for configurable resource from resource Query
function getConfigPricingFromResourceQuery(ownerid, elements, callback) {
    var configJson = {};

    // Identify configurable vs
    if((elements.uri).match('vs/') && (elements.uri).match('/configurable')){
        configJson.volumeStorageUri = elements.uri;
        if(elements.parameters && elements.parameters.sizeInGBytes){
            configJson.size = elements.parameters.sizeInGBytes;
        }
    }else if((elements.uri).match('saas/') && (elements.uri).match('/configurable')){
        configJson.uri = elements.uri;
        if(elements.parameters && elements.parameters.sizeInGBytes){
            configJson.size = elements.parameters.sizeInGBytes;
        }
    }else {
        if(elements.uri){
            configJson.instanceTypeUri = elements.uri;
        }
        if(elements.parameters && elements.parameters.imageUri){
            configJson.imageUri = elements.parameters.imageUri;
        }
        if(elements.parameters && elements.parameters.ram){
            configJson.ram = elements.parameters.ram;
        }
        if(elements.parameters && elements.parameters.cpuCount){
            configJson.cpuCount = elements.parameters.cpuCount;
        }
        if(elements.parameters && elements.parameters.localStorage){
            configJson.localStorage = elements.parameters.localStorage;
        }
        trace.info(configJson);
    }

    jsonObject = JSON.stringify(configJson);

    // prepare the header
    //TODO Implement new Auth Model
    var postheaders = {
    'Content-Type' : 'application/json',
    'Content-Length' : Buffer.byteLength(jsonObject, 'utf8')
    //"Authorization": "Basic " + new Buffer(ownerid + ":" + ownerid).toString("base64")
    };

    postheaders[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
    postheaders['ownerId'] = ownerid;

    // the post options
    var optionspost = {
    host :  config.resourceServiceHost,
    port :  config.resourceServicePort,
    path :  '/apiv1.0/resourceQuery/validate',
    method : 'POST',
    headers : postheaders
    };

    // do the POST call to resource service
    restservices.postCall(optionspost,jsonObject).then(function (resourceServiceresult) {
        return callback(resourceServiceresult);

    }).catch(function onReject(err) {
        trace.error('Rejected', err);
        if(err.stack)
            trace.debug('Error Occurred in : '+ err.stack);
        return callback(null);

    }).catch(function(error){
        trace.error('Catch Error:', error);
        if(error.stack)
            trace.debug('Error Occurred in : '+ error.stack);
        return callback(null);
    });
}

// get pricing for configurable resource from resource Query

function getConfigPricingFromResourceQuery_promise(ownerid, elements, channelCode, currencyCode) {
	trace.info('getConfigPricingFromResourceQuery_promise elements>>>'+JSON.stringify(elements));
    return new promise(function(fulfill,reject) {
        promise.delay(0000).then (function() {
            var configJson = {};            
            if(((elements.uri).match('saas/') || (elements.uri).match('professional/')|| (elements.uri).match('bundle/')) 
            		&& (elements.uri).match('/configurable')){
                configJson.uri = elements.uri;
                if(elements.parameters && elements.parameters.sizeInGBytes){
                    configJson.size = elements.parameters.sizeInGBytes;
                }
                return mysql.elementpricingdetails(elements.uri,ownerid,elements.workloadId,configJson.size,currencyCode, channelCode,conn).then(function (result) {
                	trace.info('elementpricingdetails Result >>:' + JSON.stringify(result));
                	var priceJson =  {};
                	if(result && result.length > 0){                		      
                		priceJson = result[0];
                		priceJson.service = 'billing';                		
                	}
                	return priceJson;            		           	
                });
            }else{
            	// Identify configurable vs
                if((elements.uri).match('vs/') && (elements.uri).match('/configurable')){
                    configJson.volumeStorageUri = elements.uri;
                    if(elements.parameters && elements.parameters.sizeInGBytes){
                        configJson.size = elements.parameters.sizeInGBytes;
                    }
                }else {
                    if (elements.uri) {
                        configJson.instanceTypeUri = elements.uri;
                    }
                    if (elements.parameters && elements.parameters.imageUri) {
                        configJson.imageUri = elements.parameters.imageUri;
                    }
                    if (elements.parameters && elements.parameters.ram) {
                        configJson.ram = elements.parameters.ram;
                    }
                    if (elements.parameters && elements.parameters.cpuCount) {
                        configJson.cpuCount = elements.parameters.cpuCount;
                    }
                    if (elements.parameters && elements.parameters.localStorage) {
                        configJson.localStorage = elements.parameters.localStorage;
                    }               
                }
                
                jsonObject = JSON.stringify(configJson);
     
                // prepare the header
    	        var postheaders = {
    	            'Content-Type': 'application/json',
    	            'Content-Length': Buffer.byteLength(jsonObject, 'utf8')
    	        };
    	
                postheaders[authConfig.bypassHeaderName] = 'billing' + ':' + authConfig.billing;
                postheaders['ownerId'] = ownerid;

                // the post options
                var optionspost = {
                    host: config.resourceServiceHost,
                    port: config.resourceServicePort,
                    path: '/apiv1.0/resourceQuery/validate',
                    method: 'POST',
                    headers: postheaders
                };
                return restservices.postCall(optionspost, jsonObject);
            }
            
        }).then (function (resourceServiceResult){

            trace.info('Catalog Result:' + JSON.stringify(resourceServiceResult));

            if(!(resourceServiceResult.listPrice) && !(resourceServiceResult.totalUnitPrice)) {
            	return fulfill(resourceServiceResult);
			}else{
				if(!(resourceServiceResult.service)){
					vpaParams = {};
					vpaParams.resourceIdentifier = resourceServiceResult.uri;
					vpaParams.listPrice = resourceServiceResult.listPrice;
					//vpaParams.costPrice = resourceServiceResult.displayCost;
					vpaParams.totalUnitPrice = resourceServiceResult.totalUnitPrice;//ProviderCost
					vpaParams.ownerId = ownerid;
					 
					return getVpaPriceOnApplicable(vpaParams).then(function(vpaPrice){
						trace.debug('vpaPrice : ' + vpaPrice);
						if(config.localecode == 'ja-JP') {
							resourceServiceResult.ChargeAmountUnit = '/月';
						}
						resourceServiceResult.listPrice = vpaPrice || resourceServiceResult.listPrice;
						return fulfill(resourceServiceResult);
					});
				}else{
					 trace.info('resourceServiceResult.service >>>' + resourceServiceResult.service);
					return fulfill(resourceServiceResult);
				}
			}

        }).catch(function onReject(err) {
            reject (null);
            trace.error('Rejected', err);
            if (err && err.stack)
                trace.debug('Error Occurred in : ' + err.stack);

        }).catch(function (error) {
            reject (null);
            trace.error('Catch Error:', error);
            if (error && error.stack)
                trace.debug('Error Occurred in : ' + error.stack);
        });
    });
};

// get vpa price by accountid
function getVpaPriceOnApplicable(vpaParams){

	return new promise(function(fulfill, reject){

		return mysql.getVpaIdByOwner(vpaParams.ownerId, conn).then(function(vpaId){
		trace.debug('vpaId: ' + vpaId);

		if(vpaId && vpaId != '') {

			return vpaId;
		} else return null;
		}).then(function(vpaId){

			if(vpaId) {
				vpaParams.vpaId = vpaId;
				trace.info(vpaParams);
				/*if(vpaParams.type == 'reconcile'){
					return mysql.getVPApricingForReconcile(vpaParams, conn).then(function(vpaPrice){
						trace.info(vpaPrice);
						return fulfill(vpaPrice);
					})
				}else{
					return mysql.getVPApricing(vpaParams, conn).then(function(vpaPrice){
						trace.info(vpaPrice);
						return fulfill(vpaPrice);
					})
				}*/
				return mysql.getVPApricing(vpaParams, conn).then(function(vpaPrice){
					trace.info(vpaPrice);
					return fulfill(vpaPrice);
				})
			} else return fulfill(null);
		});

	});
};

//Api to mark mark the user as fraudulent
app.put('/billing/userbillinginfo/fraudulent', function(req, res) {
	trace.info('enter: put.billing.userbillinginfo.fraudulent');
    var fraudulent = { }
		fraudulent.ownerId = req.body.userId;
		fraudulent.message = "";
		trace.info('ownerId : '+fraudulent.ownerId);

	exports.updateFraudulentUser(fraudulent, conn, function(err,result) {
		if(err) {
		    fraudulent.ownerId = "";
			fraudulent.message = "Error";
			trace.warn('updateFraudulentUser DB Error: '+err);
			return res.send(fraudulent);
		}
		else {
			trace.info('updateFraudulentUser Response: '+result[0]);
			if(typeof result[0] == 'undefined') {
					fraudulent.ownerId = "";
					fraudulent.message = "ownerId not in UserBillingInfo";
					trace.warn('ownerId not in UserBilling');
					res.send(fraudulent);
			}
			else {
				fraudulent.message = "Updated Successfully";
				trace.info('Response : '+result[0]);
				return res.send(fraudulent);
			}
		}
	});
});

//Api to fetch the summary of payment registration attempts by an user
app.get('/billing/userpaymentinfo/paymentattempts/:userid', function(req, res) {
	trace.info('enter: put.billing.userpaymentinfo.paymentattempts');
    var paymentattempts = { }
		paymentattempts.ownerId = req.params.userid;
		paymentattempts.noOfPaymentAttempts = "";
		paymentattempts.noOfFailedCC = "";
		paymentattempts.noOfPendingCC = "";
		paymentattempts.noOfSuccessCC = "";
		paymentattempts.message = "";

	payment.getPaymentAttempts(paymentattempts, conn, function(err,result) {
		if(err) {
		    paymentattempts.ownerId = "";
			paymentattempts.noOfPaymentAttempts = "";
			paymentattempts.noOfFailedCC = "";
			paymentattempts.noOfPendingCC = "";
			paymentattempts.noOfSuccessCC = "";
			paymentattempts.message = "Error";
			trace.warn('getPaymentAttempts DB Error: '+err);
			return res.send(paymentattempts);
		}
		else {
			trace.info('getPaymentAttempts Response: '+result[0]);
			if(typeof result[0] == 'undefined') {
					paymentattempts.ownerId = "";
					paymentattempts.noOfPaymentAttempts = "";
					paymentattempts.noOfFailedCC = "";
					paymentattempts.noOfPendingCC = "";
					paymentattempts.noOfSuccessCC = "";
					paymentattempts.message = "OwnerId not in UserPaymentInfo";
					res.send(paymentattempts);
			}
			else {
			    paymentattempts.ownerId = result[0].OwnerId;
				paymentattempts.noOfPaymentAttempts = result[0].NoOfPaymentAttempts;
				paymentattempts.noOfFailedCC = result[0].NoOfFailedCC;
				paymentattempts.noOfPendingCC = result[0].NoOfPendingCC;
				paymentattempts.noOfSuccessCC = result[0].NoOfSuccessCC;
				paymentattempts.message = "";
				trace.info('Response : '+result[0]);
				return res.send(paymentattempts);
			}
		}
	});
});

//Api to insert fraudulent CC to BlacklistedCC
app.post('/billing/blacklistcc', function(req, res) {
	trace.info('enter: put.billing.blacklistcc');
    var blackListed = { }
		blackListed.status = "";
		blackListed.message = "";
	var blackListedParams = { }
		blackListedParams.CreditCardNumber = req.body.creditCardNumber;
		blackListedParams.ExpirationMonth = req.body.expirationMonth;
		blackListedParams.ExpirationYear = req.body.expirationYear;
		blackListedParams.CreditCardType = req.body.creditCardType;

	payment.insertBlackListedCC(blackListedParams, conn, function(err,result) {
		if(err) {
		    blackListed.status = "";
			blackListed.message = "Error";
			trace.warn('insertBlackListedCC DB Error: '+err);
			return res.send(blackListed);
		}
		else {
			trace.info('getPaymentAttempts Response: '+result[0]);
			if(typeof result[0] == 'undefined') {
					blackListed.status = "";
					blackListed.message = "Error";
					trace.warn('BlackListedCC Not in DB: '+err);
					res.send(blackListed);
			}
			else if(result[0].BlackListStatus == 'Exist') {
				blackListed.status = "200";
				blackListed.message = "CC already Blacklisted";
				trace.info("Credit Card Number: "+result[0].BlacklistedCreditCardNumber+" has BlackListed already");
				return res.send(blackListed);
			}
			else {     // result[0].BlackListStatus == 'Inserted'
			    blackListed.status = "200";
				blackListed.message = "Blacklisted CC";
				trace.info("Credit Card Number: "+result[0].BlacklistedCreditCardNumber+" has been BlackListed Successfully");
				return res.send(blackListed);
			}
		}
	});
});

//Api to get all payment methods by an user
app.get('/billing/userpaymentinfo/user/:userid/:isretrieveall', function(req, res) {
	trace.info('enter: put.billing.userpaymentinfo.user.userid.isretrieveall');
	var ownerId = req.params.userid;
	var isRetrieveAll = req.params.isretrieveall;
	trace.info('ownerId  : '+ownerId+' & '+'isRetrieveAll : '+isRetrieveAll);

	payment.getAllPaymentMethodsByUserId(ownerId, isRetrieveAll, conn, function(err,result) {

		if(err) {
			res.send(err.code);
		}
		else {
			res.send(result);
		}

	});
});


// Description: API to retrieve all users applied a particular coupon by coupon code
// Create Date: 19-May-2014
// Author: Kamal
app.get('/billing/coupon/retrieveusers/:couponcode', function(req, res) {

	trace.info('enter: get.billing.coupon.retrieveusers.couponcode');

	var couponCode = req.params.couponcode;
	
	var channelCode = req.query.channelcode;

	trace.info('coupon code: '+ couponCode);

	var couponData = {};

	couponData.couponCode = couponCode;
	couponData.channelCode= channelCode;

	// call getCouponUsers() method in couponCodes MySQL connector
	coupons.getCouponUsers(couponData, conn, function (err, result) {

		if (err) return res.send(err);

		return res.send(result);

	});

});

// Description: API to retrieve all instances from billing DB
// Create Date: 03-April-2015
// Author: Dheeraj
app.get('/billing/instances', function(req, res) {

	trace.info('--------------- /billing/instances ---------------');

	exports.getInstanceDetails(conn, function(err,result) {

			if (err) res.send(err);

			res.send(result);

    });
});

//api to get he user details by passing credit level or billing status
app.get('/billing/getallusers', function(req, res){

	trace.info('enter: get.billing.getallusers');

	var CreditLevel = req.query.creditLevel;
	var BillingStatus = req.query.billingStatus;

	if(req.query.creditLevel){

		exports.getUsersWithCreditLevelOrBillingstatus(CreditLevel,-1, conn, function(err,result){

			if (err)
				{
					trace.error('Error in fetching the data from SP');
					res.send(err);
				}else{

				res.send(result);

				}
		});

	}
	else if(req.query.billingStatus){

		exports.getUsersWithCreditLevelOrBillingstatus(-1,BillingStatus, conn, function(err,result){

			if (err)
				{
					trace.error('Error in fetching the data from SP');
					res.send(err);
				}else{

				res.send(result);

				}

			});

	}
	else{

		var actions = {error : 'Parameter with CreditLevel/BillingStatus is required'}

		res.send(actions);

	}

});

app.get('/billing/getinvoicedocument', function(req, res){

	var channelConfig = null;
	var unexpectedError = 'UnexpectedError';
	if(!req.query.invoiceNumber) {
		res.statusCode = 400;
		return res.send({'error' : 'InvoiceNumberEmpty'});
	}
	else if(!req.query.fileFormat) {
		res.statusCode = 400;
		return res.send({'error' : 'FileFormatEmpty'});
	}
	if(!req.ownerId){
		trace.warn('ownerId_missing');
		res.statusCode = 400;
		res.send({err:'ownerId missing'});
	}
	getConfigByChannel(req.ownerId).then(function(channelConfig){
		if(!channelConfig){
			trace.warn('channelcode_unavailable');
			res.statusCode = 400;
			res.send({error : 'channelcode_unavailable'});
		} else return channelConfig;
	}).then(function(channelConfig){
		if(channelConfig){
			var supportedFormatsArray = (channelConfig.supportedInvoiceFormats).split(',');
			if(supportedFormatsArray.indexOf(req.query.fileFormat) <= -1) {
				res.statusCode = 400;
				return res.send({'error' : 'FileFormatNotSupported'});
			} else {
				var fileFormat = req.query.fileFormat;
				var invoiceNumber = req.query.invoiceNumber;
				invoiceMailAttachment.getPaymentOrder(invoiceNumber, 'none', conn).then(function(paymentOrderDto){
					trace.info(paymentOrderDto);
					paymentOrderDto[0].OwnerId = req.ownerId;

					if(paymentOrderDto.length <= 0) {
						res.statusCode = 404;
						return res.send({'error' : 'InvoiceNotFound'});
					} else return paymentOrderDto;
				}).then(function(paymentOrderDto){
					return promise.reduce(paymentOrderDto, invoiceMailAttachment.createInvoiceFile, []);
				}).then(function(invoiceDocumentingStatus){
					trace.info(invoiceDocumentingStatus + JSON.stringify(invoiceDocumentingStatus));
					if(invoiceDocumentingStatus && invoiceDocumentingStatus.length > 0){
						if(invoiceDocumentingStatus[0].docGenStatus != 'success') {
							res.statusCode = 500;
							return res.send({'error' : unexpectedError});
						}
						else {
							var file = channelConfig.customerInvoicePath + invoiceNumber + '.' + fileFormat;
							try{
								stats = fs.statSync(file);
								res.download(file, invoiceNumber + '.' + fileFormat);
							} catch (e) {
								trace.error(e);
								res.statusCode = 500;
								return res.send({'error' : unexpectedError});
							}
						}
					} else {
						res.statusCode = 500;
						return res.send({'error' : unexpectedError})
					};
				});

			}

		}
	});

});

app.get('/billing/getfeeddocument', function(req, res){
	var channelConfig = null;
	var unexpectedError = 'UnexpectedError';
	var parentid = req.parentUserId || req.userId;
	var channelcode = req.channelCode;
	trace.warn('$$$$$$$$$$$$$$$$$$$$$::::::::::::'+channelcode);
	trace.warn('$$$$$$$$$$$$$$$$$$$$$::::::::::::'+parentid);
	if(!req.query.status) {
		res.statusCode = 400;
		return res.send({'error' : 'StatusEmpty'});
	}
	else if(!req.query.invoicedate) {
		res.statusCode = 400;
		return res.send({'error' : 'invoicedateEmpty'});
	}
	var fileFormat = req.query.fileFormat;
				var status = req.query.status;
				var invoicedate = req.query.invoicedate;
				var feedtype =  req.query.feedtype;
			 return getUserAccounts(req).then (function (accountids){
        if(accountids){
            accountids_length = accountids.length;
			trace.info('acclength'+accountids_length);
			var accountIds = accountids.join();    
				feedNotificationJob.getFeedDocument(status, invoicedate, accountIds, conn).then(function(feedData){
					trace.info('::::::'+JSON.stringify(feedData));
					if(feedData.length <= 0) {
						res.statusCode = 404;
						return res.send({'error' : 'FeedNotFound'});
					} else {
							var invoicefile = config1.customerInvoicePath + 'Invoice_Feed_' + invoicedate + '.'+fileFormat;
							trace.info(':::'+config1.customerInvoicePath);
							var subscriptionFile = config1.customerInvoicePath + 'Subscription_Feed_' + invoicedate + '.'+fileFormat;
							try{
								if (feedtype == 'invoice'){
								stats = fs.statSync(invoicefile);
								res.download(invoicefile,'Invoice_Feed_' + invoicedate +  '.' + fileFormat);
								}
								else {
									stats = fs.statSync(subscriptionFile);
									res.download(subscriptionFile,'Subscription_Feed_' + invoicedate +  '.' + fileFormat);
								}
							} catch (e) {
								trace.error(e);
								res.statusCode = 500;
								return res.send({'error' : unexpectedError});
							}
						}
					});
				}
				else {
					res.statusCode = 404;
					return res.send({'error' : 'No accounts fetched for this user.'});
				}		
			});
		});

function getUserAccounts(req){
    return new promise (function (fulfill, reject) {

        var userId = req.parentUserId || req.userId;
        var headers = {
            "Content-Type": "application/json",
            'x-auth-token': req.headers['x-auth-token']
        };
        
        var path = '/api/authentication/useraccounts/' + req.ownerId + '?source=billingv2&accounttype=all&list=allcustomers&channelcode='+req.channelCode;
        if(req.query && req.query.action)
        	path = path+'&action='+req.query.action; 
        var optionsgetUserAccounts = {
            host: config.authServiceHost,
            port: config.authServicePort,
            path: path,
            method: 'GET',
            headers: headers
        };

        if(parseInt(req.query.limit) && parseInt(req.query.offset))
            optionsgetUserAccounts.path = optionsgetUserAccounts.path;//+ "?limit="+req.query.limit+ "&offset="+req.query.offset;

        return restservices.getCall(optionsgetUserAccounts).then(function (accounts) {
            if (accounts.length) {
                var accountids = [];
                for (var i = 0; i < accounts.length; i++) {
                    accountids.push(accounts[i].accountid);
                }
                return fulfill(accountids);

            } else {
                return promise.reject({reason: 'Accounts not available', statusCode: 400 })
            }
        }).catch(function (error) {
            trace.warn('common.Catch:' + error);
            if (error.stack) {
                trace.error(error.stack);
            }
            return reject(error);
        }).error(function (err) {
            trace.error('all errors:' + err);
            if (err.stack) {
                trace.error(err.stack);
            }
            return reject(err);
        }); // then close;
    });
}

// CFM-2428: express "catch-all" error handler
// See: http://expressjs.com/guide.html#error-handling
function errorHandler(err, req, res, next) {

    trace.warn('(express) errorHandler: err: ' + err.stack);

    var errorInfo = errorInfoCode.getErrorInfo(400, 'invalid input');
    //var errorInfo = errorInfoCode.getErrorInfo(400, resourceMsg['0008'][req.languageCode]);

    trace.warn('(express) errorHandler: errorInfo: ' + JSON.stringify(errorInfo, null, 2));

    return res.send(JSON.stringify(errorInfo, null, 2), errorInfo.code);
}

// END: REST API

// BEGIN: initialize message queue
var mqOptions = {
    host: queueConfig.mqHost,
    port: queueConfig.mqPort,
    login: queueConfig.mqLogin,
    password: queueConfig.mqPassword,
    vhost: config.mqVHost
};

var connection = amqp.createConnection(mqOptions);

connection.on('ready', function () {

    trace.debug('connection.on.ready');

    var exchangeOptions = {
        type: 'topic',
        durable: true,
        autoDelete: false
    };

    return connection.exchange(config.mqExchangeName, exchangeOptions, function (ex) {

        trace.debug('connection.exchange: ' + ex.name);

        exchange = ex;

        var queueOptions = {
            durable: true,
            autoDelete: false
        };

        return connection.queue(config.mqQueueName, queueOptions, function (q) {

            trace.info('connection.queue');

            q.bind(ex, config.mqBindingKey);

            q.on('queueBindOk', function () {

                trace.info('queueBindOk');

                return q.subscribe('{}', function (messageObj, headers, deliveryInfo) {

                    messageObj.routingKey = deliveryInfo.routingKey;

                    var message = JSON.stringify(messageObj, null, 2);

                    //trace.debug('SUBSCRIBE: q.subscribe: deliveryInfo.routingKey: ' + deliveryInfo.routingKey);

                    //trace.info('------------------- ' + messageNumber++ + ' -------------------');

                    //trace.info(message);

                    var queueMessageJson = JSON.parse(message);
                    
                    trace.info("queueMessageJson>>>"+JSON.stringify(queueMessageJson, null, 2));
                    var bundledElementCharge = true;
                    
                	//bundledElementCharge attribute is set only for elements in bundle product 
            		//so,when bundledElementCharge attribute is present,the charge is always false and
            		//Should not have entries for the elements of bundle in Billing
                    if(queueMessageJson && queueMessageJson.body){
                    	if(queueMessageJson.body.parameters && queueMessageJson.body.parameters.bundledElementCharge
                    		&& queueMessageJson.body.parameters.bundledElementCharge === 'false'){                    	
                    		bundledElementCharge = false;
                    	}
                    	else if(queueMessageJson.body.results && queueMessageJson.body.results.bundledElementCharge
                        		&& queueMessageJson.body.results.bundledElementCharge === 'false'){                    	
                        		bundledElementCharge = false;
                        }
                    	else if(queueMessageJson.body.attributes && queueMessageJson.body.attributes.bundledElementCharge
                        		&& queueMessageJson.body.attributes.bundledElementCharge === 'false'){                    	
                        		bundledElementCharge = false;
                        }
                    	else if(queueMessageJson.body.metadata && queueMessageJson.body.metadata.bundledElementCharge
                        		&& queueMessageJson.body.metadata.bundledElementCharge === 'false'){                    	
                        		bundledElementCharge = false;
                        }
                    }
                    
                    if(bundledElementCharge){
	                    if(queueMessageJson && queueMessageJson.body && queueMessageJson.body.results 
	                    		&& queueMessageJson.body.results.instanceStatus && queueMessageJson.body.connector === 'hilpConnector'){
	                    		
	                    	if(queueMessageJson.body.results.instanceStatus !== 'pending' && queueMessageJson.body.results.instanceStatus !== 'cancel'){
	                    		getresponseValues(message);
	                    	}
	                    		
	                    } else {
	                    	     getresponseValues(message);
	                    } 
                    }

                });
            });
        });
    });
});

// END: initialize message queue

//Api to update payment status from Admin portal
app.post('/billing/updatepaymentstatus', function(req, res) {
	trace.info('enter: put.billing.updatepaymentstatus');
	trace.info('PUT /billing/updatepaymentstatus - OrderNo:'+ req.body.orderNumber);

  return updateBillingStatusManually(req.body.orderNumber).then(function (output) {
    trace.info(output);
    return res.send(output);
}).catch(function onReject(err) {
    return handleRestError(req, res, err, null);
}).catch(function (error) {
    return handleRestError(req, res, null, error);
});

});

app.get('/billing/azurecustomers', function(req, res) {

	trace.info('--------------- /billing/azurecustomers ---------------');

	exports.getAzureCustomers(conn, req.query, function(err,result) {

			if (err) res.send(err);

			res.send(result);

    	});
});

app.get('/billing/azureusagebreakdown', function(req, res) {

	trace.info('--------------- /billing/azureusagebreakdown ---------------');	
	
	var currentDate = new Date();
		
	if(currentDate.getMonth() < 3){
		fromDate = (currentDate.getFullYear()-1)+'-'+(currentDate.getMonth() + 12 - 2)+'-'+1;
	}else{
		fromDate = currentDate.getFullYear()+'-'+(currentDate.getMonth() - 2)+'-'+1;
	}
	
	var reqQuery = {
		"fromDate" : fromDate
	}
	
	if(req.query){
		if(req.query.ownerId)
			reqQuery.ownerId = req.query.ownerId;	
		if(req.query.provider)
			reqQuery.provider = req.query.provider;	
	}	
	
	exports.getAzureUsageBreakdown(conn, reqQuery, function(err,result) {

			if (err) res.send(err);

			res.send(result);

    	});
});

app.get('/billing/azureusage', function(req, res) {

	trace.info('--------------- /billing/azureusage ---------------');
	
	var currentDate = new Date();
		
	if(currentDate.getMonth() < 3){
		fromDate = (currentDate.getFullYear()-1)+'-'+(currentDate.getMonth() + 12 - 2)+'-'+1;
	}else{
		fromDate = currentDate.getFullYear()+'-'+(currentDate.getMonth() - 2)+'-'+1;
	}
	
	var reqQuery = {
		"fromDate" : fromDate
	}
	
	if(req.query){
		if(req.query.ownerId)
			reqQuery.ownerId = req.query.ownerId;	
		if(req.query.provider)
			reqQuery.provider = req.query.provider;	
	}	
	
	exports.getAzureUsage(conn, reqQuery, function(err,result) {

			if (err) res.send(err);

			res.send(result);

    	});
});

app.get('/billing/azurerunningcost', function(req, res) {

	trace.info('--------------- /billing/azurerunningcost ---------------');
	
	var fromDate = '';
	
	var billingFrequency = config.billingFrequency;
	
	var currentDate = new Date();	
	
	if(billingFrequency < currentDate.getDate()){
		fromDate = currentDate.getFullYear()+'-'+(currentDate.getMonth()+1)+'-'+billingFrequency;
	} else {
		if(currentDate.getMonth() == 0){
			fromDate = (currentDate.getFullYear()-1)+'-'+12+'-'+billingFrequency;
		}else{
			fromDate = currentDate.getFullYear()+'-'+(currentDate.getMonth())+'-'+billingFrequency;
		}
	}	
	
	var reqQuery = {
		"fromDate" : fromDate
	}
	
	if(req.query){
		if(req.query.ownerId)
			reqQuery.ownerId = req.query.ownerId;	
		if(req.query.provider)
			reqQuery.provider = req.query.provider;	
	}	

	exports.getAzureRunningCost(conn, reqQuery, function(err,result) {

			if (err) res.send(err);

			res.send(result);

    	});
});

function updateBillingStatusManually (orderNumber) {

    return new promise(function(fulfill,reject) {

         trace.info("orderNumber >>>>>"+orderNumber);
         return exports.getOrderIdsByOrderNumber(orderNumber,conn).then(function(orderId){
          if(orderId !=null){
	           trace.info("orderId >>>>>"+JSON.stringify(orderId));
	          return exports.updateBillingStatusManually(orderId,conn).then(function(result){
	          trace.info("chargeCustomer response >>>>>"+result);
	                      return fulfill('Success');

	        });
          }
         });
    });
}




function getresponseValues(message) {

	var instanceresponseId = uuid();
	var channelCode = '';
	var currencyCode = '';
    var queueMessage = JSON.parse(message);
    //trace.info('queueMessage >>>'+message);
    var status = 'error';

    if (queueMessage.body.ownerId && queueMessage.body.uri
    && queueMessage.body.resourceType && queueMessage.body.created
    && queueMessage.body.action
    && queueMessage.body.results && queueMessage.body.results.instanceStatus
    ) {
        status = 'pending';
    }

    queuemysql.createresponse(instanceresponseId, queueMessage, status, conn, function(err, res) {
		if(err) {
			trace.error('Queue message insertion error : '+err);
		}
		else {
		return mysql.getChannelCurrency(queueMessage.body.ownerId, conn).then(function(result){
				trace.info('getChannelCurrency Result from queue msg>>>' + JSON.stringify(result));
				if(result && result.length > 0){
					channelCode = result[0].channelCode.toLowerCase();
					currencyCode = result[0].currencyCode.toLowerCase();
					trace.info('channel/currency: ' + channelCode + '/' + currencyCode);
					return null;
				} else return res.send({reason: 'channelcode/currencyCode_unavailable', statusCode: 400});
			}).then(function () {				
			if( (queueMessage.body.instanceId) && (queueMessage.body.ownerId)
			&& (queueMessage.body.created)  &&
			( (queueMessage.body.results && queueMessage.body.results.instanceStatus == 'deleted')
				|| (queueMessage.body.results && queueMessage.body.results.instanceStatus == 'deleting')
				|| (queueMessage.body.action == config.actionToStopCharging)
				|| (queueMessage.body.results && queueMessage.body.results.instanceStatus == 'suspended'
					&& queueMessage.body.metadata.imported !== true)
			) ){
				trace.info('Suspended status Or deleted >>: ' + queueMessage.body.results.instanceStatus);
				var subscriptionDetails  = new Object();

				subscriptionDetails.resourceinstanceId = queueMessage.body.instanceId;
				subscriptionDetails.ownerId = queueMessage.body.ownerId;
				subscriptionDetails.instanceStatus = 'deleted';

				if (queueMessage.body.results && typeof queueMessage.body.results.instanceStatus !== 'undefined'
						&& queueMessage.body.results.instanceStatus !== 'suspended'){
					subscriptionDetails.instanceStatus  = queueMessage.body.results.instanceStatus;
				}

				var UTC = queueMessage.body.created;
				subscriptionDetails.instancecreatedDate= new Date(UTC).toISOString().replace(/T/, ' ').replace(/\..+/, '');

				mysqlPopulateResourceUsage.updateResourceSubscription(subscriptionDetails,conn,function(err, result){
					if (err) {
						trace.error('Error in updating the subscription status/ Error : '+err);
					}
					else {
						trace.info('Update the subscription status on vm.delete action for instanceId : '+subscriptionDetails.resourceinstanceId);
					}
				});
			}
			else if(status === 'pending') {

				var imageUri = '';

				if (queueMessage.body.parameters && queueMessage.body.parameters.imageUri){
					imageUri = typeof queueMessage.body.parameters.imageUri === 'undefined' ? '' : queueMessage.body.parameters.imageUri;
				}

				if(queueMessage.body.uri.match('/configurable')) {

				    trace.info('configurable resource');
					var configResourceParameters = {};
					configResourceParameters.uri = queueMessage.body.uri;
					configResourceParameters.instanceStatus = queueMessage.body.results.instanceStatus;
					configResourceParameters.instanceId = queueMessage.body.parameters.instanceId;
					configResourceParameters.ownerid = queueMessage.body.ownerId;
					configResourceParameters.parameters = queueMessage.body.parameters;
					configResourceParameters.workloadId = queueMessage.body.parameters.workloadId;
					//For VS Resizing
					if(configResourceParameters.instanceStatus == 'detached'
					|| configResourceParameters.instanceStatus == 'attached'
					|| configResourceParameters.instanceStatus == 'active') {

						getStorageDetailsfromApiv2(configResourceParameters, function(err,apiv2Details){
							if (err){
								trace.error(err);
							}
							else{
								configResourceParameters.parameters.sizeInGBytes = apiv2Details.parameters.sizeInGBytes;

								if (apiv2Details.attributes.sizeInGBytes && apiv2Details.parameters.sizeInGBytes
								&& apiv2Details.parameters.sizeInGBytes != apiv2Details.attributes.sizeInGBytes){
									configResourceParameters.parameters.sizeInGBytes = apiv2Details.attributes.sizeInGBytes;
								}
								trace.info('No of licenses : ' + configResourceParameters.parameters.sizeInGBytes);
								//If there is an increase in quantity
								if (apiv2Details.attributes.licenseQuantity && apiv2Details.parameters.licenseQuantity
										&& apiv2Details.parameters.licenseQuantity != apiv2Details.attributes.licenseQuantity){
											configResourceParameters.parameters.sizeInGBytes = apiv2Details.attributes.licenseQuantity;
											trace.info('license update : ' + configResourceParameters.parameters.sizeInGBytes);
								}
									getConfigPricingFromResourceQuery_promise(configResourceParameters.ownerid,configResourceParameters, channelCode, currencyCode).then(function(configPricing){
									trace.debug('catalog pricing to create config_resourcesubscription : ' + JSON.stringify(configPricing));
									// For pushing into subscription table
									initiateresourceUsage.createresourceUsage(instanceresponseId, queueMessage, configPricing, '', '', conn, function(err, result) {
										if (err) {
											trace.error('initiateresourceUsage.createresourceUsage/ Error : '+err);
										}
										else {
											if(queueMessage.body.provisioningmethod && queueMessage.body.action && queueMessage.body.provisioningmethod == 'cnsp' && queueMessage.body.action == 'saas.create'){
												var input = {};
												var datearray = (apiv2Details.renewalDate).split(".");
												input.renewalDate = moment(datearray[0]).format('YYYY-MM-DD HH:mm:ss');
												input.providerInstanceId = apiv2Details.attributes.providerInstanceId;
												input.workloadId = apiv2Details.parameters.workloadId;
												exports.updateRenewaldate(input, conn, function(err, result){
												   if(err)
													trace.info('subscriptionenddate couldnot be updated'+err);
												});
											}
											trace.info('-------- initiateresourceUsage.createresourceUsage/ Data are inserted in 3tables(RS,RSD&UBI)');
										}
									});
								});
							}
						});
					}

					else {
                          // Condition for SAAS Suspend 20161229
						if(queueMessage.body.uri && queueMessage.body.uri.match('saas/') && queueMessage.body.uri.match('/configurable')){
							
							getStorageDetailsfromApiv2(configResourceParameters, function(err,apiv2Details){
								if (err){
									trace.error(err);
								}
								else{
									configResourceParameters.parameters.sizeInGBytes = apiv2Details.parameters.sizeInGBytes;
									trace.info('SAAS Suspended sizeInGBytes: ' + configResourceParameters.parameters.sizeInGBytes);
										getConfigPricingFromResourceQuery_promise(configResourceParameters.ownerid,configResourceParameters, channelCode, currencyCode).then(function(configPricing){
							
										trace.info('SAAS Suspended >> ' + JSON.stringify(configPricing));
										// For pushing into subscription table
										initiateresourceUsage.createresourceUsage(instanceresponseId, queueMessage, configPricing, '', imageUri, conn, function(err, result) {

											if (err) {
												trace.error('initiateresourceUsage.createresourceUsage/ Error : '+err);
											}
											else {
												trace.info('-------- initiateresourceUsage.createresourceUsage/ Data are inserted in 3tables(RS,RSD&UBI)');
											}
										});
									});
								}
							});
						}
						else{
							getConfigPricingFromResourceQuery_promise(configResourceParameters.ownerid,configResourceParameters, channelCode, currencyCode).then(function(configPricing){
							
								trace.debug('catalog pricing to create config_resourcesubscription : ' + JSON.stringify(configPricing));
								// For pushing into subscription table
								initiateresourceUsage.createresourceUsage(instanceresponseId, queueMessage, configPricing, '', imageUri, conn, function(err, result) {

									if (err) {
										trace.error('initiateresourceUsage.createresourceUsage/ Error : '+err);
									}
									else {
										trace.info('-------- initiateresourceUsage.createresourceUsage/ Data are inserted in 3tables(RS,RSD&UBI)');
									}
								});
							});
					   }
					}
				}


				else if (queueMessage.body.results.addOns && queueMessage.body.results.addOns.length > 0) {

					var addOns = queueMessage.body.results.addOns;

					var packageQuantity = 0;//&addon

					trace.info('addOns : '+addOns);

					trace.info('*********** add-ons length>0 ******');
					//Mediapaas package plus add-on uri
					var mPIncludingAddOnresourceIdentifiers = queueMessage.body.uri;

					// consider the quantity as 1 for package
					mPIncludingAddOnresourceIdentifiers = mPIncludingAddOnresourceIdentifiers + '*1';//&addon

					for (var index in addOns) {

						trace.info('*********** add-ons looping ******');
						packageQuantity = addOns[index].qty; //&addon
						mPIncludingAddOnresourceIdentifiers += ',' + addOns[index].uri + '*' + packageQuantity; //&addon
						trace.info('MediaPaaswithAddOn' + mPIncludingAddOnresourceIdentifiers);//&addon

					}
					trace.info(mPIncludingAddOnresourceIdentifiers);
					// call procedure that give pricing summary of package including add-on based on quantity
					mysql.mpAddOnPricingSummary(mPIncludingAddOnresourceIdentifiers, conn, function (result) { //&addon
						// mediapaas package price plus add-on
						trace.info(result);
						if (result[0].chargeAmount) {

							var mPPriceIncludingAddOn = result[0].chargeAmount;

							initiateresourceUsage.createresourceUsage(instanceresponseId, queueMessage, null, mPPriceIncludingAddOn, '', conn, function (err, result) {
								if (err) {
									trace.error('initiateresourceUsage.createresourceUsage/ Error : '+err);
								}
								else {
									trace.info('initiateresourceUsage.createresourceUsage(addOns)/ Data are inserted in 3tables(RS,RSD&UBI)');
								}
							});
						}
					});
				}

				else {
					trace.info('Concrete Resource');
					var resourceParameters = {};
					resourceParameters.ownerid = queueMessage.body.ownerId;
					resourceParameters.instanceId = queueMessage.body.parameters.instanceId;

					var instanceStatus = typeof queueMessage.body.results.instanceStatus != 'undefined' ? '' : queueMessage.body.results.instanceStatus;

					initiateresourceUsage.createresourceUsage(instanceresponseId,queueMessage, null, '', imageUri, conn, function(err, result) {
						if (err) {
							trace.error('initiateresourceUsage.createresourceUsage/ Error : '+err);
						}
						else {
							trace.info('initiateresourceUsage.createresourceUsage(Concrete Resource + imageUri)/ Data are inserted in 3tables(RS,RSD&UBI)');
						}
					});
				}
			}
			else {
				trace.info("Queue message doesn't have required attributes");
			}
	});
   }
    });
}


//function to call the apiv2/instance/instanceId
function getStorageDetailsfromApiv2(instanceDetails,callback){

	if (instanceDetails.instanceId){

		//var accessKeyId = instanceDetails.ownerid;
		//var secretKeyId = instanceDetails.ownerid;
		var instanceId = instanceDetails.instanceId;

        //TODO Implement new Auth Model
        var headers = {
			"Content-Type": "application/json"
			//"Authorization": "Basic " + new Buffer(accessKeyId + ":" + secretKeyId).toString("base64")
		};
        headers[authConfig.bypassHeaderName] = 'billing'+':'+authConfig.billing;
        headers['ownerId'] = instanceDetails.ownerid;

		var optionsget = {
            host : config.apiv2host,
			port : config.apiv2port,
			path: '/apiv2/instance/'+ instanceId,
			method: 'GET',
			headers: headers
		};
		trace.info('optionsget : '+JSON.stringify(optionsget));


		restservices.getCall(optionsget).then(function(apiv2Response){
			    if(apiv2Response.parameters && apiv2Response.parameters.sizeInGBytes){

                    var apiV2Details = {
		    	renewalDate : apiv2Response.renewalDate?apiv2Response.renewalDate:'',
                        attributes : apiv2Response.attributes,
                        parameters : apiv2Response.parameters
                        //sizeInGBytes : apiv2Response.attributes.sizeInGBytes;
                    };

					return callback(null,apiV2Details);
				}
				else{
					return callback('VS not resized',null);
				}
		}).catch(function onReject(err) {
            trace.warn('Rejected in apiv2/instance call : '+ err);
            if(err.stack)
                trace.debug('Error Occurred in : '+ err.stack);
            return callback(err,null);

        }).catch(function(error){
            trace.error('Catch Error : '+error);
            if(error.stack)
                trace.debug('Error Occurred in : '+ error.stack);
            return callback(error,null);
        });

	}
	else{
		trace.warn('Parameters not having enough details');
		return callback('Parameters not having enough details',null);
	}
}

//function -- common functionality for all the GET/PUT/DELETE Api calls
function getCall(optionsget, callback){
	var reqGet = http.request(optionsget, function (res) {
	var data = '';
	trace.info('API Call details: ' + JSON.stringify(optionsget));
    //the listener that handles the response chunks
    res.addListener('data', function (chunk) {
        data += chunk.toString();
    });
	res.addListener('end', function (err, result) {
		if (err) {
			return callback(err,null);
        }

		else {
			try{
				var result=JSON.parse(data);
				return callback(null,result);
			}
			catch(e){
				trace.info(e.message);
				return callback(e.message,null);
			}
		}
	});
    });

    reqGet.end();
	reqGet.on('error', function(e) {
		trace.error(e);
		return callback(e,'');
	});
}

function getConfigByChannel(ownerId){
	//var channelConfig = null;
	var channelConfig = {};
	var innerObj = {};
	//var channelFile = '';
	//var currencyFile = '';
	//var localeFile = '';
	return mysql.getChannelCurrency(ownerId, conn).then(function(result){
			trace.info('getChannelCurrency Result:' + JSON.stringify(result));
			if(result && result.length > 0){
				channel = result[0].channelCode.toLowerCase();
				currency = result[0].currencyCode.toLowerCase();
				locale = result[0].localeCode.toLowerCase();
				trace.info('result: ' + JSON.stringify(result));
				trace.info('channel/currency: ' + channel + '/' + currency);
				//channelConfig = channelCode;
				// trace.info('config>>>>>>>>>>>>>'+JSON.stringify(config));
				var currentKeys = Object.keys(config);    			
					for(var i=0;i<currentKeys.length;i++){   
					if((currentKeys[i]).toLowerCase() == channel.toLowerCase()){
						 trace.info('true >>>>>>>>>>>');
					var innerObj = config[currentKeys[i]];
						channelConfig = innerObj; 
					   }
					}

				channelConfig = channelConfig;
				channelConfig.channelCode = channel;
				channelConfig.currencyCode = currency ;
				channelConfig.localeCode = locale;

				trace.info('channelConfig ::' + JSON.stringify(channelConfig));

				return channelConfig;
			} else{
				trace.warn('channelcode_unavailable');
				return null;
			}
	});
};

//all Agent commisions reports 
app.get('/billing/agentcmmnhistory', function(req, res) {

	trace.info('billing/agentcmmnhistory' );
	var reqQuery = {channelcode:req.channelCode
	}
	
	if(req.query){
		if(req.query.ownerId)
			reqQuery.ownerId = req.query.ownerId;	
	}	
	exports.getAllAgentsCommision(conn,reqQuery, function(err,result) {

			if (err) res.send(err);

			res.send(result);
    });
});

//all Agent commisions reports 
app.get('/billing/getagentinvoices', function(req, res) {

	trace.info('billing/getAgentInvoices ');
	var reqQuery = {	};
	
	if(req.query){
		if(req.query.ownerId)
			reqQuery.ownerId = req.query.ownerId;	
	}	
	exports.getAgentInvoices(conn,reqQuery, function(err,result) {
			if (err) res.send(err);
				res.send(result);
    });
});

//all Agent commisions reports 
app.get('/billing/commisionaccountbreakdown', function(req, res) {

	trace.info('billing/commisionAccountBreakdown ');
	var reqQuery = {	};
	
	if(req.query){
		if(req.query.paymentorderid)
			reqQuery.paymentorderid = req.query.paymentorderid;	
	}	
	exports.commisionAccountBreakdown(conn,reqQuery, function(err,result) {
			if (err) res.send(err);
				res.send(result);
    });
});

//all Agent commisions reports 
app.get('/billing/commisionaccountresourcebreakdown', function(req, res) {

	trace.info('billing/commisionAccountResourceBreakdown');
	var reqQuery = {	};
	
	if(req.query){
		if(req.query.customerId)
			reqQuery.customerId = req.query.customerId;	
		if(req.query.paymentorderid)
			reqQuery.paymentorderid = req.query.paymentorderid;	
	}	
	exports.commisionAccountResourceBreakdown(conn,reqQuery, function(err,result) {
			if (err) res.send(err);
				res.send(result);
    });
});



// service initialization
var running = false;

var main = function () {
		/*commonreg.getRegistry({ servicename:"billing"},function(err,data){
			if (err) 
				return trace.info(err);
			else
			{
				//trace.info('getRegistry data:::::::::::::::::::::::' + JSON.stringify(data));
				cjson.extend(true,config, data);		
			}			
		});*/

    if (running) return;

    running = true;

    trace.info('billing service running');
};

// Launch server

// to support iisnode

var port = process.env.PORT;

var consoleMode = false;

if (port === undefined) {

    port = config.port;

    trace.info('### console mode: ' + port);

    consoleMode = true;
}

app.listen(port);

trace.info('billing server listening on port: ' + port);

main();

function handleRestError(req,res,err,error){
    if(err && err.cause){
        trace.warn(JSON.stringify(err));
        res.statusCode = 400;
        return res.send({err: err.cause.name+ ' : '+ err.cause.details[0].message});
    }
    /* else if(err && err.rejected) { // return promise.reject ( {rejected: {UserId: results[0]._id}});
     trace.warn(JSON.stringify(err));
     return res.send(err.rejected);
     }*/
    else if(err && err.reason) { // {reason: 'AE Details not available in the system', statusCode: 400 }
        trace.warn(JSON.stringify(err));
        res.statusCode = err.statusCode || 400;
        return err.statusCode == 400 ? res.send({reason : err.reason }) : res.send(err.reason);
        // return promise.reject ({reason:{UserId: results[0]._id}, statusCode: 200});
    }else if(err && err.stack){
        trace.warn('Error Occurred in : '+ err.stack);
        delete err.stack;
        return res.send({err:err});
    }else if(err){
        trace.warn('Error Occurred : '+ err);
        return res.send({err: err});
    }else if(error && error.stack){ //unhandled error
        trace.error('Error Occurred in : '+ error.stack);
    }else if(error){
        trace.error('Error Occurred : '+ error);
    }
    return res.send({});

}

process.on('unhandledRejection', function(reason, p){
    trace.error("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);

});

process.on('uncaughtException', function(reason){
    trace.error("Possibly uncaught Exception reason: ", reason );
    if(reason && reason.stack)
        trace.error("Possibly uncaught Exception reason: ", reason," at : ", reason.stack);

});
