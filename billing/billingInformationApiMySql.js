// Copyright (c) 2012 ComputeNext Inc, Bellevue, WA. All rights reserved.
//
 process.env.NAME = "billingv2";     // the process name - for tracing

// BEGIN: initialize tracing
var yaml_config = require('node-yaml-config');
var cjson = require('cjson');
var config = yaml_config.load(__dirname + '/billingv2.yaml');
var yamlfiles = cjson.load(__dirname + '/loadyamlinput.json');
yamlfiles.directoryPath = __dirname;
var config1 = require('../common/loadyamlfiles').loadYamlFiles(yamlfiles);
var promise = require('bluebird');
var trace = require('cnextcommon').ftrace2(config.traceLevel);
var authConfig = yaml_config.load('../common/auth.yaml');
var restservices = require('../common/rest-client.js');
var translation = cjson.load(__dirname + '/translation.json');
/*
trace[config.traceLevel]('trace level is: ' + config.traceLevel);
trace[config.traceLevel]('NODE_ENV: ' + process.env.NODE_ENV);
*/
// END: initialize tracing

// Project Files
var conn = require('./mysqlconnection.js');

var getByIdAndDate = function(input, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
		var billingInformationWithIdAndDate = "call SP_ApiBillingInformationWithIdAndDate('"+input.id+"','"+ input.startdate +"','"+ input.enddate +"')";
		
		conn.query(billingInformationWithIdAndDate, function(err, result)
			{		
				if(err) {
				
				trace.info('Error in fetching the data fron DB');
				
				}
				else {
				
				callback(err,result[0]);		
				
				}
			});
	}
	else {
		trace.info('MySql DB connection is Empty');
	}
};

// to update payment details

var updatePaymentDetails = function(input, conn, callback)
{
	if(conn !== '') {

		var test = false;

		var updatePaymentInfo = "call SP_UpdatePaymentDetails('"+input.orderId+"','"+ input.paymentProcessor +"','"+ input.invoiceAmount +"','"+ input.chargeAmount +"')";
		trace.info('The updatePayment Query:::::'+JSON.stringify(updatePaymentInfo));
		conn.query(updatePaymentInfo, function(err, result)
			{
				if(err) {

				trace.info('Error in updating the data fron DB');

				}
				else {

				callback(err,result[0]);

				}
			});
	}
	else {
		trace.info('MySql DB connection is Empty');
	}
};


var getByOrderNumber = function(ordernumber, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
			var billingInformationWithOrderNumber = "call SP_ApiBillingInformationWithOrderNumber('"+ ordernumber +"')";
			
			conn.query(billingInformationWithOrderNumber, function(err, result)
			{
		
				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
					callback(err,result[0]);	
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};


var getPaymentGatewayConfigurationStatus = function(ordernumber, conn, callback)
{
	if(conn !== '') {

			trace.info('paymentConfigurationQuery::: ordernumber'+ordernumber);
			var paymentConfigurationQuery = "call SP_getUserPaymentGatewayConfiguration('"+ ordernumber +"')";

			conn.query(paymentConfigurationQuery, function(err, result)
			{

				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
					trace.info('paymentConfigurationQuery:::'+JSON.stringify(paymentConfigurationQuery));
					callback(err,result[0]);
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};


/*

var getPaymentGatewayConfigurationStatus = function(orderId, conn, callback){
	 trace.info('Entered getPaymentGatewayConfigurationStatus >>>>>>>>>>'+orderId);
	       if(conn){

				var getPaymentGatewayConfigurationQuery = "SELECT po.ownerid,po.id AS paymentproviderinfoid,ppo.name FROM paymentorder po \
							INNER JOIN userpaymentinfo upo ON upo.ownerid = po.ownerid  \
							INNER JOIN paymentproviderinfo ppo ON upo.paymentproviderinfoid=ppo.id  \
							WHERE po.id='"+orderId+"'";


	        	 trace.info('getPaymentGatewayConfigurationQuery >>>>>>>>>>'+getPaymentGatewayConfigurationQuery);

	        	   conn.query(getPaymentGatewayConfigurationQuery, function(err, result){
					 trace.info('result:>>>>>>>>is @@@@@@'+JSON.stringify(result));
					 callback(err,result);

            });
        }
}*/



var getByOwnerId = function(id, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
			var billingDetailsWithId = "call SP_ApiBillingInformationDetailsById('"+ id +"')";
			
			conn.query(billingDetailsWithId, function(err, result)
			{
				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
                    callback(err,result[0]);
                }
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};

var getByAccountId = function(id, conn, callback)
{
    if(conn !== '') {
        var billingDetailsWithId = "call SP_ApiBillingInformationDetailsById('"+ id +"')";

        conn.query(billingDetailsWithId, function(err, result)
        {
            if(err){
                trace.info('Error in fetching the data fron DB');
            }
            else
            {
                if(result[0][0]) result[0][0].creditDetails = result[1][0];
                callback(err,result[0]);
            }
        });
    }
    else {
        trace.info('MySql DB connection is Empty');
    }
};

var getNoLocalePriceByAccountId = function(id, conn, callback)
{
    if(conn !== '') {
        var billingDetailsWithId = "call SP_ApiNoLocaleBillingInformationDetailsById('"+ id +"')";

        conn.query(billingDetailsWithId, function(err, result)
        {
            if(err){
                trace.info('Error in fetching the data fron DB');
            }
            else
            {
                if(result[0][0]) result[0][0].creditDetails = result[1][0];
                callback(err,result[0]);
            }
        });
    }
    else {
        trace.info('MySql DB connection is Empty');
    }
};

var getAvailableCreditAmountById = function(id, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
			var availableCreditLimit = "call SP_ApiAvailableCreditAmount('"+ id +"')";
			
			conn.query(availableCreditLimit, function(err, result)
			{
				if(err){
					trace.info('Error in fetching the data fron DB');
				}	
				else
				{
					callback(err,result[0]);	
				}		
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};
	

//  To get the user's Billing Settings
var getBillingSettingsByOwnerId = function(id, conn, callback) {

	if(conn !== '') { 
		
		var test = false;
		
		var billingSettingDetailsWithId = "call SP_ApiGetBillingSettingsById('"+ id +"')";
		conn.query(billingSettingDetailsWithId, function(err, result) {
			if(err) {
				trace.warn('Error in fetching the data from DB');
				callback(err,'');
			}
			else {
				callback(err,result[0]);	
			}
		});
	}
	else {
		trace.warn('MySql DB connection is Empty');
	}
};

// To update the user's Billing Settings
var updateBillingSettings = function(input, conn) {
    return new promise(function(fulfill,reject) {
        if (conn) {

            var fedAdminUpdateBillingSettings = "call SP_ApiPostBillingSettingsById("
                + ( (typeof input.BillingFrequency === 'undefined' || input.BillingFrequency == null) ? null :  input.BillingFrequency) + ","
                + ( (typeof input.BillingFrequencyType === 'undefined' || input.BillingFrequencyType == null) ? null :  "'" + input.BillingFrequencyType + "'" ) + ","
                + ( (typeof input.NextBillingDate === 'undefined' || input.NextBillingDate == null) ? null : "'"+ input.NextBillingDate +"'") + ","
                + ( (typeof input.MaxCreditLimit === 'undefined' || input.MaxCreditLimit == null) ? null :  input.MaxCreditLimit ) + ","
				+ ( (typeof input.CreditLimitUnUsed === 'undefined' || input.CreditLimitUnUsed == null) ? null :  input.CreditLimitUnUsed ) + ","
                + ( (typeof input.CreditLevel === 'undefined' || input.CreditLevel == null) ? null :  input.CreditLevel ) + ","
                + ( (typeof input.BillingStatus === 'undefined' || input.BillingStatus == null) ? null :  "'" + input.BillingStatus + "'" ) + ","
                + ( (typeof input.VpaCode === 'undefined' || input.VpaCode == null) ? null :  "'" + input.VpaCode + "'" ) + ","
				+ ( (typeof input.billingCurrency === 'undefined' || input.billingCurrency == null) ? null :  "'" + input.billingCurrency + "'" ) + ","
				+ ( (typeof input.invoicingLanguage === 'undefined' || input.invoicingLanguage == null) ? null :  "'" + input.invoicingLanguage + "'" ) + ","
                + ( (typeof input.UserBillingInfoId === 'undefined' || input.UserBillingInfoId == null) ? null :  "'" + input.UserBillingInfoId + "'" ) + ","
                + ( (typeof input.ownerId === 'undefined' || input.ownerId == null) ? null :  "'" + input.ownerId + "'" ) + ","
				+ ( (typeof input.paymentterm === 'undefined' || input.paymentterm == null) ? null :  "'" + input.paymentterm + "'" )+ ","
				+ ( (typeof input.payMethod === 'undefined' || input.payMethod == null) ? null :  "'" + input.payMethod + "'" )+ ","
				+ ( (typeof input.AllowedToTransact === 'undefined' || input.AllowedToTransact == null) ? null :  input.AllowedToTransact )	 + ","
				+ ( (typeof input.invoiceMailStatus === 'undefined' || input.invoiceMailStatus == null) ? 1 :  input.invoiceMailStatus  )	   + ","
				+ ( (typeof input.BillingTerm === 'undefined' || input.BillingTerm == null) ? null :  "'" + input.BillingTerm + "'"  )   + ","
                + ( (typeof input.commissionId === 'undefined' || input.commissionId == null) ? null :  "'" + input.commissionId + "'"  ) + ","
				+ ( (typeof input.CommissionPaymentDate === 'undefined' || input.CommissionPaymentDate == null) ? null : "'"+ input.CommissionPaymentDate +"'") + ","
				+ ( (typeof input.ChannelCode === 'undefined' || input.ChannelCode == null) ? null : "'"+ input.ChannelCode +"'")	 + ","
				+ ( (typeof input.accountVat === 'undefined' || input.accountVat == null) ? null :  "'" + input.accountVat + "'"  ) 
				+ ")";

            trace.info(fedAdminUpdateBillingSettings);

            return conn.query(fedAdminUpdateBillingSettings, function (err, result) {
                if (err) {
                    trace.warn('Error in fetching the data from DB '+ err);
                    return reject ('Error in fetching the data from DB');
                }
                else {
                    return fulfill(result[0]);
                }
            });
        }
        else {
            trace.warn('MySql DB connection is Empty');
            return reject ('MySql DB connection is Empty');
        }
    });
};

var getBillingStatusByOwnerId = function(ownerid, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
	
		var billingStatusWithId = "call SP_GetTheBillingStatusOfUser('"+ ownerid +"')";
		
		conn.query(billingStatusWithId, function(err, result)
		{
		
			if(err) {
				trace.error('Error in fetching the data fron DB');
                trace.error(err);
                return callback('Error in fetching the data fron DB',null);
			}
			else
			{
				return callback(null,result[0]);
			}
		});
	}
	else {
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

var getPricingForInstances = function(ownerId,instanceIds, conn, callback){
	 trace.info('Entered getPricingForInstances >>>>>>>>>>');
	       if(conn){
 		
				var getPriceListQuery = "SELECT rs.ownerid,rs.ResourceKey,rs.workloadname, \
										ROUND(IFNULL(RSDC.chargeAmount,0) / IFNULL(RSDC.sizeinGBytes,0),4) AS costPrice,\
										ROUND(IFNULL(RSDL.chargeAmount,0) / IFNULL(RSDL.sizeinGBytes,0),4) AS unitPrice,\
										RSDL.sizeinGBytes AS Quantity,\
										RSDL.chargeAmount,\
										ROUND(IFNULL(RSDA.chargeAmount,0)) AS onetimecost\
										FROM resourcesubscription rs \
										INNER JOIN ResourceSubscriptionDetail RSDL ON RS.Id = RSDL.ResourceSubscriptionID \
										AND IFNULL(RSDL.IsDefault, 0) = 1 \
										AND RSDL.Pricereferenceid='1' \
										INNER JOIN ResourceSubscriptionDetail RSDC ON RS.Id = RSDC.ResourceSubscriptionID \
										AND IFNULL(RSDC.IsDefault, 0) = 1 \
										AND RSDC.Pricereferenceid='3' \
										INNER JOIN ResourceSubscriptionDetail RSDA ON RS.Id = RSDA.ResourceSubscriptionID \
										AND IFNULL(RSDA.IsDefault, 0) = 1 \
										AND RSDA.Pricereferenceid='4' \
										LEFT JOIN UserEmail UE ON UE.ownerId = RS.ownerId \
										AND IFNULL(UE.isAdmin, FALSE)= TRUE \
										WHERE UE.ownerId ='"
										+ownerId +
										"'AND FIND_IN_SET(rs.ResourceKey ,'" 
										+ instanceIds + 
										"');";
			        	
	        	 trace.info('PriceListQuery >>>>>>>>>>'+getPriceListQuery);
				
	        	   conn.query(getPriceListQuery, function(err, result){
					 trace.info('result:>>'+JSON.stringify(result));
					 callback(err,result);	
	                
            });
        }
}
/*

var getPaymentStatus = function(orderId,ownerId,chargeAmount,conn, callback){
	 trace.info('Entered getPaymentStatus >>>>>>>>>>');
	       if(conn){
 			var name='invoice';
 			var paidAmount=10;

				if(

           UPDATE paymentorder SET pendingamount=chargeAmount-200 WHERE id='896c10f1-b7c8-11e6-bfd5-000d3a237bac';
	        	   conn.query(getPriceListQuery, function(err, result){
					 trace.info('result:>>'+JSON.stringify(result));
					 callback(err,result);

            });
        }
}

*/



// To update the user as fraudulent
var updateFraudulentUser =  function(fraudulent, conn, callback ) {
	trace.info('::::::::::::: billingInformationApiMySql.js : updateFraudulentUser() :::::::::::::');	
	if(conn !== '') { 
		
		var test = false;
		
		var updateQueryString = "call SP_ApiUpdateFraudulentUserById('"+fraudulent.ownerId+"')";
		
		trace.info('DB Call Method : '+updateQueryString);		
		conn.query(updateQueryString, function(err, result) {		
			if(err){
				trace.warn('DB Connection Failed Error : '+err);
				return callback(err,'');
			}
			else {
				trace.info('Response : '+result[0]);
				return callback('',result[0]); 
			}			
		});	
	}
	else {
		trace.warn('updateFraudulentUser DB connection is Empty');
	}	
}

var getInvoiceReportingByOrderNumber = function(paymentOrderDto, conn, callback)
{
	
	if(conn !== '') { 
		var ordernumber = paymentOrderDto.OrderNumber || paymentOrderDto.orderNumber;
		var test = false;
		if(paymentOrderDto.accounttype && (paymentOrderDto.accounttype).toLowerCase()=='reseller'){
			var billingInformationWithOrderNumber = "call SP_ResellerInvoiceReport('"+ ordernumber +"')";
		}else{
			var billingInformationWithOrderNumber = "call SP_InvoiceReport('"+ ordernumber +"')";
		}
			
			conn.query(billingInformationWithOrderNumber, function(err, result)
			{
		
				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
					var reqObj = {};
					reqObj.channelcode = result[1][0].channelcode;
					reqObj.accountType = result[1][0].accountType;
					reqObj.parentId = result[1][0].parentId;
					for (var i = 0; i<result[0].length;i++){
						var countrycode = result[1][0].countrycode;
						var reconDescription = result[0][i].reconDescription; 
						if (countrycode == 'JP'){
							if (reconDescription == 'Monthly Cost')
								result[0][i].reconDescription = translation.JP.MonthlyCost;
							if (reconDescription == 'Penalty Fee')
								result[0][i].reconDescription = translation.JP.PenaltyFee;
							if (reconDescription == 'Initial Cost')
								result[0][i].reconDescription = translation.JP.InitialCost;
							if (reconDescription == 'Free Period')
								result[0][i].reconDescription = translation.JP	.FreePeriod;
						}
					}
					return getAccountDetails(reqObj).then(function (invoiceInfo){
						result.push(invoiceInfo);
					callback(err,result);
					});
					callback(err,result);	
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};


function getAccountDetails(req){
	return new promise (function (onfulfill, onreject) {
		var optionsgetAccountDetails = {};
		var channelcode = req.channelcode;
		var accountType = req.accountType;
		var parentId = req.parentId;
		var headers = {
				"Content-Type": "application/json",
				"ownerId":"cccccccc-cccc-cccc-0000-cccccccccccc",
				"cn-services-internal":"resource:a491ccbd-ea0b-11e4-b6f6-000c298a79e5"
			};
		if (accountType == 'reseller')	{			
				optionsgetAccountDetails = {
				host: config.authServiceHost,
				port: config.authServicePort,
				path: '/api/authentication/account/' + parentId+'?params=account',
				method: 'GET',
				headers: headers
			};
		}
		else {
			optionsgetAccountDetails = {
					host: config1.authServiceHost,
					port: config1.authServicePort,
					path: '/api/authentication/parentdetails?channelCode='+channelcode,
					method: 'GET',
					headers: headers
			};
		}	
		return restservices.getCall(optionsgetAccountDetails).then(function (parentdetails) {
					var invoiceInfo = parentdetails.additionalattributes.InvoiceInfo;
					return onfulfill(invoiceInfo);
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
};

exports.getInstanceDetails = function getInstanceDetails(conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
			var billingInstanceDetails = "call sp_getinstancedetailsforrecon()";
			
			conn.query(billingInstanceDetails, function(err, result)
			{
		
				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
					callback(err,result[0]);	
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};
// getPaymentTypes
exports.getPaymentTypes = function getPaymentTypes(conn, callback)
{
	trace.info('Inside the getPaymentTypes method');
	if(conn !== '') { 
		
			var getPaymentTypesQuery = "select id,name from paymentproviderinfo";
	
			conn.query(getPaymentTypesQuery, function(err, result)
			{
		
				if(err){
					trace.info('Error in fetching the data fron DB');
				}
				else
				{
					trace.info('Result from getPaymentTypes method:'+JSON.stringify(result));
					callback(err,result);	
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};
exports.getUsersWithCreditLevelOrBillingstatus = function(CreditLevel,BillingStatus, conn, callback)
{
	if(conn !== '') { 
		
		var test = false;
		
			var UsersWithCreditLevelOrBillingstatus = "call sp_userdetailswithcreditlevelorbillingstatus('"+ CreditLevel +"','"+ BillingStatus +"')";
			
			conn.query(UsersWithCreditLevelOrBillingstatus, function(err, result)
			{
		
				if(err){
					trace.error('Error in fetching the data fron DB');
					callback(err);
				}
				else
				{
					callback('',result[0]);	
				}
			});
	}
	else {
	trace.info('MySql DB connection is Empty');
	}
};

function getByAccountIds(accountids, conn){
    return new promise(function(fulfill,reject) {
        if(conn){
            //var billingDetailsWithIds = "call SP_ApiBillingInformationDetailsByIds('"+ accountids +"')";
			var decimalprecision = config.decimalprecision;
			var billingDetailsWithIds = "SELECT UBI.Id AS userBillingInfoId,\
										UBI.ownerId, \
										CAST((CASE UBI.billingFrequency WHEN 0 THEN 7 ELSE UBI.billingFrequency END) AS CHAR(10)) AS billingFrequency, \
										CAST(UBI.CreditWorthinessLevelId AS CHAR(10)) AS creditlevel, \
										UBI.BillingStatus AS billingstatus, \
										DATE_FORMAT(UBI.NextBillingDate,'%Y-%m-%d') AS nextBillingDate, \
										vpa.vpacode  AS vpaCode, \
										commision.commisioncode  AS commisionCode, \
										uemail.AccountName AS accountName, \
										FORMAT(CAST(ROUND(COALESCE(UBI.MaxCreditLimit, 0),2) AS CHAR(10)),'"+decimalprecision+ "',func_getcurrencylocale()) AS maxCreditLimit, \
										CAST(ROUND(COALESCE(UBI.CreditLimitUsed, 0),2) AS CHAR(10)) AS creditLimitUsed, \
										FORMAT(CAST( ROUND(COALESCE(UBI.MaxCreditLimit, 0) - COALESCE(UBI.CreditLimitUsed, 0),2) AS CHAR(10)),'"+decimalprecision+ "',func_getcurrencylocale()) AS availableLimit, \
										FORMAT(CAST( ROUND( ((COALESCE(CreditLimitUsed,0)) * 100) / (COALESCE(UBI.MaxCreditLimit,0)),2) AS CHAR(10)),'"+decimalprecision+ "',func_getcurrencylocale()) AS creditUsedPercentage, \
										UBI.PaymentTerm AS paymentterm, \
										UBI.PayMethod AS PayMethod, \
										UBI.billingFrequencyType AS billingFrequencyType, \
										UBI.Vat AS vat \
										FROM userbillinginfo UBI \
										LEFT JOIN VPACode VPA ON VPA.ID = UBI.vpaid \
										LEFT JOIN commisioncode commision ON commision.ID = UBI.commisionid \
										LEFT JOIN useremail uemail ON uemail.ownerId = UBI.ownerId \
										WHERE FIND_IN_SET (UBI.OwnerId, '"+ accountids + "');";
				
            trace.info(billingDetailsWithIds);

            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
					// trace.info('result: ' + JSON.stringify(result));
					
                    return fulfill(result);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function insertBillingAddress(billingAddress, conn){
    // TODO not implemented fully
    return new promise(function(fulfill,reject) {
        if(conn){
            var billingAddress = "call SP_CreateBillingAddress('"+ billingAddress +"')";
            trace.info(billingAddress);

            return conn.query(billingAddress, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    trace.debug(JSON.stringify(result[0]));
                    //TODO read the result, if Error returns then reject it
                    return fulfill(result[0]);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function updateBillingAddress(billingAddress, conn){
    // TODO not implemented fully
    return new promise(function(fulfill,reject) {
        if(conn){
        
            var query = "call SP_UpdateBillingAddress('"+ billingAddress.ownerId +"',"+
            billingAddress.isDefault +",'"+
            billingAddress.billingAddressId +"')";
            trace.info(query);

            return conn.query(query, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    trace.debug(JSON.stringify(result[0]));
                    return fulfill(result[0]);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function updateuserproperties(vatDetails, conn){
    
    return new promise(function(fulfill,reject) {
        if(conn){
        
            var query = "call sp_updateuserpropertiesinbilling('"+ vatDetails.ownerId +"',"+
            vatDetails.vatId +",'"+
            vatDetails.vatVerificationStatus +"')";
            trace.info(query);

            return conn.query(query, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    trace.debug(JSON.stringify(result[0]));
                    return fulfill(result[0]);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}


function getById(accountids, conn){
    return new promise(function(fulfill,reject) {
        if(conn){
            var billingDetailsWithIds = "call SP_ApiBillingInformationWithId('"+ accountids +"')";
            trace.info(billingDetailsWithIds);

            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    return fulfill(result[0]);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function getByIds(queryParams, conn){
	var accountIds = queryParams.accountIds;
	var filter = queryParams.filter;
	var limit = queryParams.limit;
	var offset = queryParams.offset;

    return new promise(function(fulfill,reject) {
        if(conn){
        	var billingDetailsWithIds = "call SP_ApiBillingInformationWithIds('"+ accountIds +"','"+ limit +"','"+ offset +"')";
            trace.info(billingDetailsWithIds);
            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data from DB');
                }else{
					
					trace.debug('result:>> '+ JSON.stringify(result[1]));
					
					return fulfill(result);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function getDetailedInformationByOrderNumber(orderNumber, conn){
    return new promise(function(fulfill,reject) {
        if(conn){
            var billingDetailsWithIds = "call SP_ApiDetailedBillingInformationWithOrderNumber('"+ orderNumber +"')";
            trace.info(billingDetailsWithIds);

            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    return fulfill(result);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function getDetailedResellerInformationByOrderNumber(orderNumber, conn){
    return new promise(function(fulfill,reject) {
        if(conn){
            var billingDetailsWithIds = "call SP_ApiDetailedResellerInvoiceWithOrderNumber('"+ orderNumber +"')";
            trace.info(billingDetailsWithIds);

            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
                    return fulfill(result);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

function getOrderIdsByOrderNumber(orderNo, conn){
	 trace.info('Entered getOrderIdsByOrderNumber >>>>>>>>>>');
	  return new promise(function(fulfill,reject) {
	        if(conn){
	        	var getOrderId = "SELECT Id FROM paymentorder PO WHERE  PO.OrderNumber = '"+ orderNo +"'";
	        	
	        	 trace.info('orderId >>>>>>>>>>'+getOrderId);
	        	 return conn.query(getOrderId, function(err, result){
	                 if(err){
	                     return reject('Error in fetching the data fron DB');
	                 }else{
	                     trace.debug(JSON.stringify(result[0].Id));
	                     return fulfill(result[0].Id);
	                 }
	        	 });
	        }
	  });
	
}

function updateBillingStatusManually(orderId, conn){
	 trace.info('Entered updateBillingStatusManually >>>>>>>>>>');
	  return new promise(function(fulfill,reject) {
	        if(conn){
	        	 var manualStatusUpdate = "SET @Error = 0; call SP_UpdateBillingTablesOnResponse('"+ orderId +"','NULL','Success',30, @Error, 0)";
                 trace.info('manualStatusUpdate >>>>>>>>>>'+manualStatusUpdate);

	        	 return conn.query(manualStatusUpdate, function(err, result){
	                 if(err){
	                     return reject('Error in fetching the data fron DB');
	                 }else{
	                     trace.debug(JSON.stringify(result[0]));
	                     return fulfill(result[0]);
	                 }
	        	 });
	        }
	  });
	
}

var getRevenueSummary = function(startDate,endDate,channelCode, conn, callback){
	 trace.info('Entered revenueSummary >>>>>>>>>>');
	       if(conn){
	
				var getRevenuesQuery = "select SUM(chargeAmount) AS revenue,YEAR(createTime) AS 'year' , \
							MONTH(createTime) AS 'month' FROM  paymentorder WHERE chargeAmount > 0 \
							AND createTime 	BETWEEN '"+startDate+"' and '"+ endDate +
							"' GROUP BY YEAR(createTime),MONTH(createTime)";
									
			        	
	        	 trace.info('revenueQuery >>>>>>>>>>'+getRevenuesQuery);
				
	        	   conn.query(getRevenuesQuery, function(err, result){
					 trace.info('result:>>'+JSON.stringify(result));
					 callback(err,result);	
	                
            });
        }
};

// api to get accounts count for the given time period
// SELECT COUNT(DISTINCT UE.ownerid) AS 'NO_OF_ACCOUNTS_CREATED' FROM useremail UE
// INNER JOIN userbillinginfo UBI ON UBI.ownerid = UE.ownerid
// WHERE UBI.createTime BETWEEN '2016-04-13' AND '2016-04-20'
var getAccountsCount = function(startDate,endDate,channelCode, conn, callback){
	 trace.info('Entered getAccountsCount >>>>>>>>>>');
	       if(conn){
	
				var getAccountsCountQuery = "SELECT COUNT(DISTINCT UE.ownerid) AS 'NO_OF_ACCOUNTS_CREATED' \
				FROM useremail UE INNER JOIN userbillinginfo UBI ON UBI.ownerid = UE.ownerid \
				 WHERE UBI.createTime \
						BETWEEN '"+startDate+"' and '"+ endDate +	"'" ;
							
									
			        	
	        	 trace.info('getAccountsCountQuery >>>>>>>>>>'+getAccountsCountQuery);
				
	        	   conn.query(getAccountsCountQuery, function(err, result){
					 trace.info('result:>>'+JSON.stringify(result));
					 callback(err,result);	
	                
            });
        }
};

// api to get orders count for the given time period
// SELECT COUNT(*) AS 'NO_OF_ORDERS_CREATED' FROM paymentorder WHERE createTime BETWEEN  '2016-04-13' AND '2016-04-20'
var getOrdersCount = function(startDate,endDate,channelCode, conn, callback){
	 trace.info('Entered getOrdersCount >>>>>>>>>>');
	       if(conn){
	
			var getOrderCountQuery = "select COUNT(*) AS 'NO_OF_ORDERS_CREATED' FROM paymentorder WHERE createTime \ BETWEEN '"+startDate+	"' and '"+ endDate + "'" ;
									
			        	
	        	 trace.info('getOrderCountQuery >>>>>>>>>>'+getOrderCountQuery);
				
	        	   conn.query(getOrderCountQuery, function(err, result){
					 trace.info('result:>>'+JSON.stringify(result));
					 callback(err,result);	
	                
            });
        }
};

var getTopAccountByrevenue= function(startDate,endDate,channelCode, conn, callback){
	trace.info('getTopAccountSummary >>>>>>>>>>' + channelCode);
	if(conn){

		var getOrderCountQuery = "SELECT AD.AccountName AS accountName,SUM(PO.chargeAmount) amount  FROM useremail AD, paymentorder PO";
		getOrderCountQuery +=" WHERE  PO.ownerid = AD.ownerid AND PO.chargeAmount>0 and PO.createTime BETWEEN '"+startDate+	"' and '"+ endDate + "'";
		getOrderCountQuery +=" GROUP BY  AD.AccountName ORDER BY amount DESC  limit 5" ;


		trace.info('getTopAccountSummary >>>>>>>>>>' + getOrderCountQuery);

		conn.query(getOrderCountQuery, function(err, result){
			trace.info('result:>>'+JSON.stringify(result));
			callback(err,result);

		});
	}
};

var getTopAccountSummary= function(startDate,endDate,channelCode,accountnames, conn, callback){
	trace.info('getTopAccountSummary >>>>>>>>>>' + channelCode);
	if(conn){
		var getOrderCountQuery = "SELECT SUM(PO.chargeAmount) AS revenue,COUNT(PO.orderNumber) AS orders,AD.AccountName AS Accounts FROM useremail AD";
		getOrderCountQuery += " LEFT JOIN paymentorder PO ON PO.ownerid = AD.ownerid";
		getOrderCountQuery += " WHERE PO.chargeAmount>0 AND  PO.createTime BETWEEN '"+startDate+	"' and '"+ endDate + "'";
		getOrderCountQuery += " AND AD.AccountName in ('" +accountnames.join("','")+ "')";
		getOrderCountQuery += " GROUP BY  AD.AccountName";
		getOrderCountQuery += " ORDER BY SUM(PO.chargeAmount) DESC";


		trace.info('getTopAccountSummary >>>>>>>>>>' + getOrderCountQuery);

		conn.query(getOrderCountQuery, function(err, result){
			trace.info('result:>>'+JSON.stringify(result));
			callback(err,result);

		});
	}
};
var getResourceCostbyAccount = function(startDate,endDate,channelCode, accountid, providername, conn, callback){
	trace.info(accountid + ' getResourceCostbyAccount >>>>>>>>>>' + channelCode);
	var orderstr = "desc";// by default getting latest data top
	var pricereferenceid = 3; //pricereferenceid = 3 for Cost price
	if(conn){
		var costquery = "SELECT RS.createtime,RS.workloadid,UE.AccountName accountname, RS.provider,RS.description resourcename,RSD.sizeinGBytes qty,sum(RUP.amountafterdiscount) cost";
		costquery += " FROM resourcesubscription RS, resourceusageprocessed RUP,resourcesubscriptiondetail RSD,useremail UE";
		costquery += " WHERE RS.id=RUP.resourcesubscriptionid and RS.id=RSD.resourcesubscriptionid AND RS.ownerid=UE.ownerid AND UE.channelcode='"+channelCode+"' AND";
		costquery += " RS.status='Active' AND RUP.pricereferenceid=3 AND RUP.unitprice>0 and RS.createtime between '"+startDate+	"' and '"+ endDate + "'";
		if(typeof accountid !== "undefined"){
			costquery += " AND UE.ownerid ='"+accountid+"'";
		}
		if(typeof providername !== "undefined"){
			costquery += " And RS.provider ='"+providername+"'";
		}
		costquery += " group by RS.id order by RS.createtime " + orderstr;


		trace.info('getResourceCostbyAccount >>>>>>>>>>' + costquery);

		conn.query(costquery, function(err, result){
			trace.info('got results at getResourceCostbyAccount');
			callback(err,result);
		});
	}
};
//getting resource list by revenue for reports in magento
var getResourceByRevenue = function(startDate,endDate,channelCode, resourcename, provider, conn, callback){
	trace.info(resourcename + ' getResourceByRevenue >>>>>>>>>>' + channelCode);
	var orderstr = "desc";// by default getting latest data top
	var pricereferenceid = 3; //pricereferenceid = 3 for Cost price
	if(conn){
		var costquery = "SELECT RS.id,RS.description resourcename,RS.provider,RSD.sizeinGBytes quantity, SUM(RUP.amountafterdiscount) cost";
		costquery += " FROM resourcesubscription RS, resourceusageprocessed RUP,resourcesubscriptiondetail RSD,useremail UE";
		costquery += " WHERE RS.id=RUP.resourcesubscriptionid AND RS.id=RSD.resourcesubscriptionid AND RS.ownerid=UE.ownerid AND UE.channelcode='"+channelCode+"' AND";
		costquery += " RS.status='Active' AND RUP.pricereferenceid=3 AND RUP.unitprice>0  AND RS.createtime BETWEEN '"+startDate+"' and '"+ endDate + "'";
		if(typeof resourcename !== "undefined"){
			costquery += " AND RS.description ='"+resourcename+"'";
		}
		if(typeof provider !== "undefined"){
			costquery += " And RS.provider ='"+provider+"'";
		}
		costquery += " GROUP BY RS.id";
		var listpricequery = "SELECT RS.id,RS.description resourcename,RS.provider,RSD.sizeinGBytes quantity, SUM(RUP.amountafterdiscount) cost";
		listpricequery += " FROM resourcesubscription RS, resourceusageprocessed RUP,resourcesubscriptiondetail RSD,useremail UE";
		listpricequery += " WHERE RS.id=RUP.resourcesubscriptionid AND RS.id=RSD.resourcesubscriptionid AND RS.ownerid=UE.ownerid AND UE.channelcode='"+channelCode+"' AND";
		listpricequery += " RS.status='Active' AND RUP.pricereferenceid=1 AND RUP.unitprice>0  AND RS.createtime BETWEEN '"+startDate+"' and '"+ endDate+"'";
		if(typeof resourcename !== "undefined"){
			listpricequery += " AND RS.description ='"+resourcename+"'";
		}
		if(typeof provider !== "undefined"){
			listpricequery += " And RS.provider ='"+provider+"'";
		}
		listpricequery += " GROUP BY RS.id";
		var finalQuery = "SELECT cost.*, sell.cost listprice FROM ( "+ costquery+") cost left join ";
		finalQuery += "( "+ listpricequery+") sell ON cost.id = sell.id ORDER BY listprice DESC";

		trace.info('getResourceByRevenue >>>>>>>>>>' + finalQuery);

		conn.query(finalQuery, function(err, result){
			trace.info('getResourceByRevenue result:>>'+JSON.stringify(result));
			callback(err,result);
		});
	}
};

//store usage api data after calculations
var storeUsageData = function(usageQuery, conn, callback)
{
	//trace.info(' inside storeUsageData');
	if(conn !== '') { 
		
		var test = false;
		
			//trace.info(' inside conn storeUsageData');		
			conn.query(usageQuery, function(err, result)
			{
				//trace.info('inside conn storeUsageData result >>>'+result);	
				if(err){
					trace.info('Error in inserting data in DB');
				}
				else
				{
					callback(err,result[0]);	
				}
			});
	}
	else {
		trace.info('MySql DB connection is Empty');
	}
};


exports.getAzureCustomers = function(conn, reqQuery, callback){
	
	trace.info('Entered getAzureCustomers >>>>>>>>>>');
	if(conn){
			
		var getCustomersQuery = "SELECT y as Years, m as Months, count(Customers) as Customers \
								 FROM ( SELECT MONTH(reported_start_time) AS m, YEAR(reported_start_time) AS y, ownerId as Customers \
								 FROM usagedata \
								 WHERE meter_name = 'Compute Hours' \
								 GROUP BY  y, m, ownerId) a \
								 GROUP BY  y, m ORDER BY y, m";				
			        	
	    trace.info('getCustomersQuery >>>>>>>>>>'+getCustomersQuery);
				
	    conn.query(getCustomersQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {
    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

//usage cost report
exports.getAzureUsage = function(conn, reqQuery, callback){
	
	trace.info('Entered getAzureUsage >>>>>>>>>>');
	
	if(conn){	
		/*var ownerfil = "";
		if(reqQuery && reqQuery.ownerId){
			ownerfil = " WHERE ud.ownerid = '"+reqQuery.ownerId+"'";
		}*/	
								 
		/* 
		SELECT aa.Years, aa.Months, SUM(usge* meterrate) AS usge FROM (SELECT SUM(quantity) AS usge,MAX(rcd.MeterRatesVal) AS Meterrate, YEAR(reported_start_time) AS Years, MONTH(reported_start_time) AS Months, meter_name 
			FROM usagedata ud LEFT JOIN ratecarddata rcd ON ud.meter_id = rcd.meterid 
			WHERE 1 AND ud.ownerId = '2aabb91a-6e26-4e19-b7c9-9675044b7833' AND ud.reported_start_time >= '2016-10-1'
			GROUP BY Years, Months,meter_name) aa  
		GROUP BY aa.Years, aa.Months  ORDER BY aa.Years, aa.Months;
		*/
			
		var usageQuery = "SELECT aa.Years, aa.Months, SUM(usge* meterrate) AS usge FROM (SELECT SUM(quantity) AS usge,MAX(rcd.MeterRatesVal) AS Meterrate, YEAR(reported_start_time) AS Years, MONTH(reported_start_time) AS Months, meter_name \
							FROM usagedata ud LEFT JOIN ratecarddata rcd ON ud.meter_id = rcd.meterid \
							WHERE 1"
							
		if(reqQuery){
			if(reqQuery.ownerId)
				usageQuery += " AND ud.ownerId = '"+reqQuery.ownerId+"'";
			if(reqQuery.provider)
				usageQuery += " AND ud.provider = '"+reqQuery.provider+"'";
			if(reqQuery.fromDate)
				usageQuery += " AND ud.reported_start_time >= '"+reqQuery.fromDate+"'";
		}						
			
		usageQuery += " GROUP BY Years, Months,meter_name) aa  GROUP BY aa.Years, aa.Months  ORDER BY aa.Years, aa.Months";		
							
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {
    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

//Azure Usage cost breakdown
exports.getAzureUsageBreakdown = function(conn, reqQuery, callback) {
	
	trace.info('Entered getAzureUsageBreakdown >>>>>>>>>>');
	
	if(conn){	
		/*var ownerfil = "";
		if(reqQuery && reqQuery.ownerId){
			ownerfil = " WHERE ud.ownerid = '"+reqQuery.ownerId+"'";
		}*/
		var usageQuery = "SELECT SUM(quantity) AS usge,rcd.MeterRatesVal AS Meterrate, rcd.meterName AS MeterName FROM \
						  usagedata ud LEFT JOIN ratecarddata rcd ON ud.meter_id = rcd.meterid \
						  WHERE 1"
						  
		if(reqQuery){
			if(reqQuery.ownerId)
				usageQuery += " AND ud.ownerId = '"+reqQuery.ownerId+"'";
			if(reqQuery.provider)
				usageQuery += " AND ud.provider = '"+reqQuery.provider+"'";
			if(reqQuery.fromDate)
				usageQuery += " AND ud.reported_start_time >= '"+reqQuery.fromDate+"'";
		}	
		
		usageQuery += " GROUP BY Meterrate,MeterName";			        	
									    	 
			        	
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {
    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

exports.getAzureRunningCost = function(conn, reqQuery, callback){
	
	trace.info('Entered getAzureUsage >>>>>>>>>>');
	
	if(conn){	
	
		var costQuery = "SELECT SUM(usge* meterrate) as Amount, DATE(reported_start_time) AS Date FROM \
								 ( SELECT SUM(ud.quantity) AS usge, MAX(rcd.MeterRatesVal) as Meterrate, ud.reported_start_time \
								 FROM usagedata ud INNER JOIN ratecarddata rcd ON ud.meter_id = rcd.meterid \
								 WHERE 1";
		
		if(reqQuery){
			if(reqQuery.ownerId)
				costQuery += " AND ud.ownerId = '"+reqQuery.ownerId+"'";
			if(reqQuery.provider)
				costQuery += " AND ud.provider = '"+reqQuery.provider+"'";
			if(reqQuery.fromDate)
				costQuery += " AND ud.reported_start_time >= '"+reqQuery.fromDate+"'";
		}	
		
		costQuery += " GROUP BY reported_start_time, meter_name) a GROUP BY DATE(reported_start_time) ORDER BY reported_start_time";
			        	
	    trace.info('costQuery >>>>>>>>>>'+costQuery);
				
	    conn.query(costQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	
	    	for (var i = 0; i < result.length; i++) {
	    		result[i].Date = new Date(result[i].Date).getFullYear()+'-'+(new Date(result[i].Date).getMonth()+1)+'-'+new Date(result[i].Date).getDate()
	    	}
	    	
	    	callback(err,result);	                
	    });
       
	} else {
    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}


//loading all agents commision reports with MTD and YTD
var getAllAgentsCommision = function(conn, reqQuery, callback){
	
	trace.info('Entered getAllAgentsCommision >>>>>>>>>>');
	
	if(conn){	
		var usageQuery = "SELECT mtd.*, ytd.yamount FROM (SELECT adr.stateProvinceCode,ue.accounttype, ue.accountname,ue.ownerid,ue.accountstatus, SUM(chargeAmount) AS mamount FROM paymentorder po "+
		                    "LEFT JOIN useremail ue ON ue.ownerid= po.ownerid "+
							"LEFT JOIN userPaymentInfo upi ON upi.ownerid= po.ownerid "+
							"LEFT JOIN address adr ON adr.id= upi.addressid "+
							"WHERE upi.isdefault =1 and ue.accounttype='agent' AND ue.channelcode='"+reqQuery.channelcode+"' "+
							"AND po.invoicedate BETWEEN DATE_FORMAT(NOW() ,'%Y-%m-01') AND NOW()"+
							"GROUP BY ue.accounttype,ue.ownerid,ue.accountstatus) "+
							"mtd LEFT JOIN"+
							"(SELECT adr.stateProvinceCode,ue.accounttype,ue.accountname,ue.ownerid,ue.accountstatus, SUM(chargeAmount) AS yamount FROM paymentorder po "+
							"LEFT JOIN useremail ue ON ue.ownerid= po.ownerid "+
							"LEFT JOIN userPaymentInfo upi ON upi.ownerid= po.ownerid "+
							"LEFT JOIN address adr ON adr.id= upi.addressid "+
							"WHERE upi.isdefault =1 and ue.accounttype='agent' AND ue.channelcode='"+reqQuery.channelcode+"' AND po.invoicedate >= DATE_FORMAT(NOW() ,'%Y-01-01') "+
							"GROUP BY ue.accounttype,ue.ownerid,ue.accountstatus"+
							") ytd ON mtd.ownerid = ytd.ownerid";			
				
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

//loading agent invocies by agent id
var getAgentInvoices = function(conn, reqQuery, callback){
	
	trace.info('Entered getAgentInvoices >>>>>>>>>>');
	
	if(conn){         
		
		var usageQuery = "SELECT po.id AS orderid, po.chargeAmount, DATE_FORMAT(po.invoicedate, '%Y-%m-%d %T') AS invoicedate, DATE_FORMAT(po.CommisionPaymentDueDate, '%Y-%m-%d %T') as duedate, po.ordernumber, po.orderstatus FROM paymentorder po "+
			"LEFT JOIN useremail ue ON ue.ownerid= po.ownerid WHERE PO.isAuthorization =0 "+
			" AND ue.ownerid='"+reqQuery.ownerId+"' order by po.updatetime DESC";			
				
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

//loading agent commisionAccountBreakdown by paymentorderid
var commisionAccountBreakdown = function(conn, reqQuery, callback){
	
	trace.info('Entered commisionAccountBreakdown >>>>>>>>>>');
	
	if(conn){
			
	var usageQuery = "SELECT poe.paymentorderid,poe.customerid,po.ownerid,ue.name,ue.accountname,ue.accounttype,SUM(poe.Amount) AS chargeamount FROM paymentorderelement poe "+ 
							"INNER JOIN paymentorder po ON po.id=poe.paymentorderid "+
							"INNER JOIN useremail ue ON ue.ownerid=poe.customerId "+
							"WHERE po.isAuthorization=0 AND  poe.paymentorderid='"+reqQuery.paymentorderid+"' "+
							"GROUP BY poe.customerId,chargeamount DESC";
				
				
				
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}

//loading agent commisionAccountResourceBreakdown by paymentorderid
var commisionAccountResourceBreakdown = function(conn, reqQuery, callback){
	
	trace.info('Entered commisionAccountResourceBreakdown >>>>>>>>>>');
	
	if(conn){
		
		var usageQuery = "SELECT poe.resourceinstanceid, rs.description,poe.quantity, poe.unitprice AS revenue, poe.amount AS commision, poe.Description AS reconDescription, poe.commisionbase FROM paymentorderelement poe "+
							"LEFT JOIN paymentorder po ON po.id=poe.paymentorderid "+
							"LEFT JOIN resourcesubscription rs ON rs.ResourceKey = poe.resourceinstanceid "+
							"WHERE poe.paymentorderid='"+reqQuery.paymentorderid+"' AND poe.customerId = '"+reqQuery.customerId+"'"+
							"ORDER BY revenue DESC";			
				
	    trace.info('usageQuery >>>>>>>>>>'+usageQuery);
				
	    conn.query(usageQuery, function(err, result){
	    	
	    	trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}
var commisionMonthlyBreakdown = function(conn, paymentorderid, callback){
	
	trace.info('Entered commisionAccountBreakdown >>>>>>>>>>'+paymentorderid);
	
	if(conn){
			
	var usageQuery =  "call SP_getmonthlycommission('"+ paymentorderid +"')";	

	    conn.query(usageQuery, function(err, result){
	    	
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}


var commisionclientBreakdown = function(conn, paymentorderid,customerId, callback){
	
	trace.info('Entered commisionAccountBreakdown >>>>>>>>>>'+paymentorderid+'>>>>>>>'+customerId);
	
	if(conn){
		
		var usageQuery = "call SP_commisionClientbreakdown('"+ paymentorderid +"','"+ customerId +"')";

		
	    conn.query(usageQuery, function(err, result){
	    	
	    	//trace.info('result:>>'+JSON.stringify(result));
	    	callback(err,result);	                
	    });
       
	} else {    	   
		trace.warn('MySql DB connection is Empty');
        return callback ('MySql DB connection is Empty',null);
	}
}
function getaccounttype(orderNo, conn,callback){
	 trace.info('Entered getaccounttypeByOrderNumber >>>>>>>>>>');
	  return new promise(function(fulfill,reject) {
	        if(conn){
	        	//var getOrderId = "SELECT Id FROM paymentorder PO WHERE  PO.OrderNumber = '"+ orderNo +"'";
	        	var getaccountype =	"SELECT accounttype FROM useremail WHERE ownerid = (SELECT ownerid FROM paymentorder WHERE ordernumber ='"+ orderNo +"')";

	        	 trace.info('orderId >>>>>>>>>>'+getaccountype);
	        	 return conn.query(getaccountype, function(err, result){
	                 if(err){
	                     return callback('Error in fetching the data fron DB');
	                 }else{
	                     trace.debug(JSON.stringify(result[0]));
	                     return callback(result[0]);
	                 }
	        	 });
	        }
	  });
	
}
function updateRenewaldate(input,conn, callback){
	trace.info('billinginfomysql/updateRenewaldate');
	if(conn){
		var updatequery = "UPDATE resourcesubscription SET subscriptionendtime = '"+input.renewalDate+"' WHERE workloadid ='"+input.workloadId+"' AND providerinstanceid='"+input.providerInstanceId+"';";
        trace.info('updatequery'+updatequery);
		 return conn.query(updatequery, function(err, result){
	                 if(err){
	                     return callback('Error in updating the renewaldate in SQL');
	                 }else{
	                     trace.debug(result);
	                     return callback('Number of renewal dates updated: '+result.affectedRows);
	                 }
	        	 });
  
	}else{
		 return callback('connectionfailed');
	}
};

function updateSubscriptionPrices(input,conn, callback){
	trace.info('billinginfomysql/updateSubscriptionPrices');
	if(conn){
		var updatequery = "call SP_RetrieveAllActiveSubscriptions('"+ input.workloadId +"','"+ input.instanceId +"')";
        trace.info('updatequery'+updatequery);
		 return conn.query(updatequery, function(err, result){
	                 if(err){
	                     return callback('Error in updating the renewaldate in SQL');
	                 }else{
	                     return callback(null,result[0][0]);
	                 }
	        	 });
  
	}else{
		 return callback('connectionfailed');
	}
};

var updatevatinfo = function(updateBillingSettings,conn){
	return new promise(function(fulfill,reject) {
        if (conn) {

            var vatinfoquery = "call SP_VatInfo('"
			+updateBillingSettings.Vatpercent+"',"+ ((typeof updateBillingSettings.CountryCode === null) ? null : "'"+ updateBillingSettings.CountryCode) +"','" +updateBillingSettings.UserChannelCode+"')";
			trace.info(vatinfoquery);

			return conn.query(vatinfoquery, function (err, result) {
                if (err) {
                    trace.warn('Error in fetching the data from DB '+ err);
                    return reject ('Error in fetching the data from DB');
                }
                else {
					trace.info("VATINFOOOO"+JSON.stringify(result))
                    return fulfill(result);
                }
            });
        
	}else {
            trace.warn('MySql DB connection is Empty');
            return reject ('MySql DB connection is Empty');
        }
	});
		
};




var billingInvoiceData =  function (requestpar, conn) {
	return new promise(function(fulfill,reject) {
	trace.info('::::::::::::: CsvInvoiceData /billingInvoiceData:::::::::::::');
		if(conn) {	
			var selectQueryString = "CALL SP_UserInvoiceData('" + requestpar.ownerId +  "','"+requestpar.month+ "','"+requestpar.year+"')";
			trace.info('selectQueryString : '+selectQueryString);
			
			conn.query(selectQueryString, function(err, result) {
				if(err){
					trace.warn('DB Connection Failed Error : '+err);
					return reject(err);
				}
				else {
					//trace.info('result : '+JSON.stringify(result[0])+'\n');
					return fulfill(result[0]);
				}
			});	
		}
		else {
			trace.info('getSubscriptionFeed DB connection is Empty');
		}
	});
};

var billingAccoutInvoiceData =  function (requestpar, conn) {
	return new promise(function(fulfill,reject) {
	trace.info('::::::::::::: Account CsvInvoiceData /billingInvoiceData:::::::::::::');
		if(conn) {	
			var selectQueryString = "CALL SP_AccountInvoiceCSV('" + requestpar.ownerId +  "','"+requestpar.month+ "','"+requestpar.year+"')";
			trace.info('selectQueryString : '+selectQueryString);
			
			conn.query(selectQueryString, function(err, result) {
				if(err){
					trace.warn('DB Connection Failed Error : '+err);
					return reject(err);
				}
				else {
					//trace.info('result : '+JSON.stringify(result[0])+'\n');
					return fulfill(result[0]);
				}
			});	
		}
		else {
			trace.info('getSubscriptionFeed DB connection is Empty');
		}
	});
};


var AccountInvoicesList =  function (ownerid, conn,callback) {
	
	trace.info('::::::::::::: billinginfoapimysql.js/AccountInvoicesList:::::::::::::');
		if(conn) {	
			var selectQueryString = "CALL SP_AccountInvoicesList('" + ownerid +  "')";
			trace.info('selectQueryString : '+selectQueryString);
			
			conn.query(selectQueryString, function(err, result) {
				 trace.info('result of SP_AccountInvoicesList '+result);
				 if(err){
					trace.warn('DB Connection Failed Error : '+err);
					return callback(err);
				}
				else {
					trace.info('result : '+JSON.stringify(result[0])+'\n');
					return callback(result[0]);
				}
			});	
		}
		else {
			trace.info('getSubscriptionFeed DB connection is Empty');
		}
	
};
var userInvoicesList =  function (ownerid, conn,callback) {
	
	trace.info('::::::::::::: billinginfoapimysql.js/userInvoicesList:::::::::::::');
		if(conn) {	
			var selectQueryString = "CALL SP_userInvoicesList('" + ownerid +  "')";
			trace.info('selectQueryString : '+selectQueryString);
			
			conn.query(selectQueryString, function(err, result) {
				 trace.info('result of SP_AccountInvoicesList '+result);
				 if(err){
					trace.warn('DB Connection Failed Error : '+err);
					return callback(err);
				}
				else {
					trace.info('result : '+JSON.stringify(result[0])+'\n');
					return callback(result[0]);
				}
			});	
		}
		else {
			trace.info('getSubscriptionFeed DB connection is Empty');
		}
	
};





function getaccounttypeByOwnerid(ownerid, conn,callback){
	  return new promise(function(fulfill,reject) {
	        if(conn){
	        	//var getOrderId = "SELECT Id FROM paymentorder PO WHERE  PO.OrderNumber = '"+ orderNo +"'";
	        	var getaccountype =	"SELECT accounttype FROM useremail WHERE ownerid ='"+ ownerid +"' ORDER BY accounttype DESC LIMIT 1";

	        	 trace.info('orderId >>>>>>>>>>'+getaccountype);
	        	 return conn.query(getaccountype, function(err, result){
	                 if(err){
						 return callback('Error in fetching the data fron DB');
	                 }else{
	                     return callback(result[0]);
	                 }
	        	 });
	        }
	  });
	
};

var getsalesreportBychannelcode = function(channelcode, conn, callback)
{
	if(conn !== '') { 
		
			var test = false;
		
			var getsalesreportBychannelcode = "CALL SP_SalesReport('"+ channelcode+"')";
			
			conn.query(getsalesreportBychannelcode, function(err, result)
			
			{
				if(err) {
					trace.info('Error in fetching data from DB');
				}else
				{
					trace.info('enter: pro1111>>>>>>>'+JSON.stringify(getsalesreportBychannelcode));
					trace.info('enter: pro1111>>>>>>>'+JSON.stringify(result));

					return callback(err,result[0]);	
				}
			
			});
	}
	else {
	trace.warn('MySql DB connection is Empty');
	}
}



var updateCustomerCreditLimit = function(CustomerCreditLimit, ownerId, conn, callback)
{
	if(conn !== '') { 
				
			var updateCustomerCreditLimit = "CALL SP_UpdateCustomerCreditLimit('"+ CustomerCreditLimit+"','"+ownerId+"')";
			trace.info('updateCustomerCreditLimit'+updateCustomerCreditLimit);
			conn.query(updateCustomerCreditLimit, function(err, result)
			
			{
				if(err) {
					trace.info('Error in fetching data from DB');
				}else
				{
					trace.info('enter: updateCustomerCreditLimit>>>>>>>'+JSON.stringify(updateCustomerCreditLimit));
					trace.info('enter: updateCustomerCreditLimit>>>>>>>'+JSON.stringify(result));

					return callback(err,result);	
				}
			
			});
	}
	else {
	trace.warn('MySql DB connection is Empty');
	}
}

var updateApprovalStatus = function(requestparams, conn, callback)
{
	if(conn !== '') {

		var test = false;

		var updateApprovalStatus = "call SP_UpdateApprovalStatus('"+requestparams.orderNumber+"','"+ requestparams.approvalStatus +"')";
		trace.info('The updatePayment Query:::::'+JSON.stringify(updateApprovalStatus));
		conn.query(updateApprovalStatus, function(err, result)
			{
				if(err) {

				trace.info('Error in updating the data fron DB');

				}
				else {
				trace.info('++++++++'+JSON.stringify(result[0]));
				callback(err,result[0]);

				}
			});
	}
	else {
		trace.info('MySql DB connection is Empty');
	}
};

function updateworkloaddetails(workloaddetails, conn, callback)
{
	trace.info('billinginfomysql/updateworkloaddetails');
	if (conn)
	{
		var updateQuery = "call SP_ApiUpdateWorkloadDetails('"+workloaddetails.workloadId+"','"+workloaddetails.workloadName+"')";
		conn.query(updateQuery, function(err, result)
			{
		
				if(err){
					trace.error('Error in updating the workloadDetails');
					callback(err);
				}
				else
				{
					callback('',result);	
				}
			});
	}
	else 
	{
		trace.info('MySql DB connection is Empty');
	}
};


function csvInformationWithOrderNumber(orderNumber, conn){
    return new promise(function(fulfill,reject) {
        if(conn){
            var billingDetailsWithIds = "call SP_csvInformationWithOrderNumber('"+ orderNumber +"')";
            trace.info(billingDetailsWithIds);

            return conn.query(billingDetailsWithIds, function(err, result){
                if(err){
                    return reject('Error in fetching the data fron DB');
                }else{
				trace.info('getInvoiceReportingByOrderNumber>>>>>'+JSON.stringify(result[0]));

                    return fulfill(result[0]);
                }
            });
        }else{
            return reject('connection is empty');
        }
    });
}

exports.csvInformationWithOrderNumber = csvInformationWithOrderNumber;
exports.updateApprovalStatus= updateApprovalStatus;
exports.updateCustomerCreditLimit = updateCustomerCreditLimit;
exports.getsalesreportBychannelcode = getsalesreportBychannelcode;

exports.getaccounttypeByOwnerid = getaccounttypeByOwnerid;
exports.userInvoicesList = userInvoicesList;
exports.AccountInvoicesList = AccountInvoicesList;
exports.billingInvoiceData = billingInvoiceData;
exports.billingAccoutInvoiceData = billingAccoutInvoiceData;
		
exports.updateSubscriptionPrices = updateSubscriptionPrices;
exports.updateRenewaldate = updateRenewaldate;
exports.getaccounttype = getaccounttype;
exports.commisionMonthlyBreakdown = commisionMonthlyBreakdown;
exports.commisionclientBreakdown = commisionclientBreakdown;

exports.getByIdAndDate = getByIdAndDate;
exports.getById = getById;
exports.getByOrderNumber = getByOrderNumber;
exports.getByOwnerId = getByOwnerId;
exports.getByAccountId = getByAccountId;
exports.getNoLocalePriceByAccountId = getNoLocalePriceByAccountId;
exports.getAvailableCreditAmountById = getAvailableCreditAmountById;
exports.getBillingSettingsByOwnerId = getBillingSettingsByOwnerId;
exports.updateBillingSettings = updateBillingSettings;
exports.getBillingStatusByOwnerId = getBillingStatusByOwnerId;
exports.updateFraudulentUser = updateFraudulentUser;
exports.getInvoiceReportingByOrderNumber = getInvoiceReportingByOrderNumber;
exports.getByAccountIds = getByAccountIds;
exports.insertBillingAddress = insertBillingAddress;
exports.updateBillingAddress = updateBillingAddress;
exports.updateuserproperties = updateuserproperties;
exports.getDetailedInformationByOrderNumber = getDetailedInformationByOrderNumber;
exports.getByIds = getByIds;
exports.updateBillingStatusManually = updateBillingStatusManually;
exports.getOrderIdsByOrderNumber = getOrderIdsByOrderNumber;
exports.getPricingForInstances = getPricingForInstances;
exports.getRevenueSummary = getRevenueSummary;
exports.getAccountsCount = getAccountsCount;
exports.getOrdersCount = getOrdersCount;
exports.getTopAccountByrevenue = getTopAccountByrevenue;
exports.getTopAccountSummary = getTopAccountSummary;
exports.getResourceCostbyAccount = getResourceCostbyAccount;
exports.getResourceByRevenue = getResourceByRevenue;
exports.storeUsageData = storeUsageData;
exports.getPaymentGatewayConfigurationStatus = getPaymentGatewayConfigurationStatus;
exports.updatePaymentDetails= updatePaymentDetails;
exports.getAllAgentsCommision = getAllAgentsCommision;
exports.getAgentInvoices = getAgentInvoices;
exports.commisionAccountBreakdown = commisionAccountBreakdown;
exports.commisionAccountResourceBreakdown = commisionAccountResourceBreakdown;
// exports.getPaymentStatus=getPaymentStatus;
exports.getDetailedResellerInformationByOrderNumber = getDetailedResellerInformationByOrderNumber;
exports.updatevatinfo = updatevatinfo;
