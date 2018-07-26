// BEGIN: initialize tracing
var cjson = require('cjson');
var yaml_config = require('node-yaml-config');
var yamlfiles = cjson.load(__dirname + '/loadyamlinput.json');
yamlfiles.directoryPath = __dirname;
var config = require('../common/loadyamlfiles').loadYamlFiles(yamlfiles);
var trace = require('cnextcommon').ftrace2(config.traceLevel);
var mysql = require('./mysqlrestService.js');
var restservices = require('../common/rest-client.js');

//packages
var fs = require('fs'); 
var express = require('express');
var http = require('http');
require('date-utils');

var uuid = require('node-uuid');
var async = require("async");
var query = require('querystring');
var querystring = require('querystring');
var url_parse = require('url').parse;
var qs_parse  = require('querystring').parse;
var nodemailer = require("nodemailer");
var	xml2js = require('xml2js');
var billingInfo = require ('./billingInformationApiMySql.js');
var invoiceNotificationMysql = require ('./invoiceNotificationMysql.js');
var fillInvoiceSubDetails = require('./fillInvoiceSubDetails.js');
var dbconnection = require('./mysqlconnection');
var promise = require('bluebird');
var phantom = require('phantom');
var xmlFileName = 'invoiceMailAttachment.xml';
var billTo = '';	

// unit testing
/*var invoiceNumber  = '10e3245c';
var billToEmail  = 'supporttesting@computenext.com';*/

var conn = '',conn_err = '';
var warningMsg = 'Warning: Problem with creating invoice file'
var euCountryCodes = ['AT','BE','BG','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB'];   
dbconnection.execute(function(err,response) {
 conn = response;
 conn_err = err;   
});

// unit testing
/*createInvoiceFile(billToEmail, invoiceNumber,function(err, result){
	
	if(err) trace.info(err);
	
});*/
function getPaymentOrder(paymentOrderId, getByStatus, conn){
	
	return new promise(function(fulfill, reject){
		
		invoiceNotificationMysql.getPaymentOrderDto(paymentOrderId, getByStatus, conn, function(err, res) {
									
			if(err) {
			
				trace.warn('getPaymentOrderDto error : '+err);
				return reject(err);
			}
			trace.info('getPaymentOrderDto result : ' + JSON.stringify(res));
			return fulfill(res);
		});
	});
};

//function createInvoiceFile(billToEmail, invoiceNumber, fileFormat, callback){
function createInvoiceFile(resultArray, paymentOrderDto){
	trace.info(paymentOrderDto);
	return new promise(function(fulfill, reject){
		var channelOwnerId = paymentOrderDto.OwnerId;
		getConfigByChannel(channelOwnerId).then(function(channelConfig){
			if(!channelConfig){
				trace.warn('channelcode_unavailable');
				return null;
			} else {
				//channelConfig_global = channelConfig;
				return channelConfig;
			};
		}).then(function(channelConfig){
		
			var billToEmail = paymentOrderDto.Name; 
			var invoiceNumber = paymentOrderDto.OrderNumber || paymentOrderDto.orderNumber;
			trace.info(invoiceNumber);
			var fileFormat = channelConfig.desiredInvoiceFormat;
			var supportedFormatsArray = (channelConfig.supportedInvoiceFormats).split(',');
			var invoiceDocGenResultObj = {};		
			if(supportedFormatsArray.indexOf(fileFormat) === -1) return fulfill('fileFormat not supported');
			
			billingInfo.getInvoiceReportingByOrderNumber(paymentOrderDto, conn, function(err,result){
				trace.info(result);
				if (err){
					trace.warn(err);
					invoiceDocGenResultObj.orderNumber = invoiceNumber;
					invoiceDocGenResultObj.docGenStatus = 'error';
					resultArray.push(invoiceDocGenResultObj);
					return fulfill(resultArray);
				}
				if(result && result[0].length <= 0){
					trace.warn(warningMsg + ' : ' + invoiceNumber + ' : ' + 'no record found for the invoice in billing db');
					invoiceDocGenResultObj.orderNumber = invoiceNumber;
					invoiceDocGenResultObj.docGenStatus = 'error';
					resultArray.push(invoiceDocGenResultObj);
					return fulfill(resultArray);
				}
					
				var invoiceHeader = result[1];
				
				var ownerId = invoiceHeader[0].ownerId;
				
				if(!billToEmail) billToEmail = invoiceHeader[0].email;
								
				return getUserNameFromBillingService(ownerId, conn, function(errGetCall,respGetCall){
				
					if(!errGetCall){
					
						var userDetails = respGetCall;
							billTo = billToEmail;
						
						if(typeof userDetails.Name != 'undefined' && userDetails.Name != '' ){
							
							billTo = userDetails.Name;
						}else{
							trace.warn(warningMsg + ' : ' + invoiceNumber + ' : ' + ' user name not found in billing service');
							invoiceDocGenResultObj.orderNumber = invoiceNumber;
							invoiceDocGenResultObj.docGenStatus = 'error';
							resultArray.push(invoiceDocGenResultObj);
							return fulfill(resultArray);
						}
						readingEmailXml(channelConfig, paymentOrderDto, billTo, result, function(err,populatedHtml){

							return fs.writeFile(channelConfig.customerInvoicePath + invoiceNumber + '.html',populatedHtml,function(errWriting,resultWriting){	

								if (errWriting) {
								
									trace.warn(warningMsg + ' : ' + invoiceNumber + ' : '+  errWriting);
									
									invoiceDocGenResultObj.orderNumber = invoiceNumber;
									invoiceDocGenResultObj.docGenStatus = 'error';
									resultArray.push(invoiceDocGenResultObj);
									return fulfill(resultArray);

								}else {
								
									phantom.create(function(ph){

										ph.createPage(function(page) {
										  
											page.set('paperSize', {
												
												format: 'A4'
													  
											},function() {
											
												// continue with page setup
												page.open(channelConfig.htmlFileOpenPath+invoiceNumber+'.html', function(status) {
													
													if(status === 'success'){
													
														page.render(channelConfig.customerInvoicePath+invoiceNumber+'.pdf', function(){
														  
															trace.info('Page Rendered');
															
															result = 'Page Rendered';
															
															ph.exit();
															
															//return callback(null, result)
															invoiceDocGenResultObj.orderNumber = invoiceNumber;
															invoiceDocGenResultObj.docGenStatus = 'success';
															resultArray.push(invoiceDocGenResultObj);
															return fulfill(resultArray);
															
														});
													}
													else{
														trace.warn(warningMsg + ' : ' + 'Error in phantom.page.open() ' + status);
														//return callback('Failed');	
														invoiceDocGenResultObj.orderNumber = invoiceNumber;
														invoiceDocGenResultObj.docGenStatus = 'error';
														resultArray.push(invoiceDocGenResultObj);
														return fulfill(resultArray);
													}
												});
											});
												
										});
						
									},{
										dnodeOpts: {weak: false}
									});
								}
							});	
						});	// 
						
					} else {
							trace.warn('Error in fetching the user name for invoice attachment: ' + errGetCall);//new
							
							//return callback(errGetCall);// new
							return fulfill(errGetCall);
						}
					});
		    });	
		
		});
		
    });

};

// getting the xml file name along with the file path and call the Xml Parser
function readingEmailXml(channelConfig,paymentOrderDto,billTo,invoiceInfo, callback){

	console.log('-------------- enter : reading the xml Email file --------------');
	
	
	try{    trace.info('channelConfig>>>>>>>>>>>>>>'+JSON.stringify(channelConfig));
	trace.info('paymentOrderDto.InvoiceReportTempStatus>>>>>>>>>>>>>>   '+paymentOrderDto.InvoiceReportTempStatus);			
			if(paymentOrderDto.code && (paymentOrderDto.code).toLowerCase()=="ecpw") // based on payment type template will be chosen used for ECPay payment gateway
				var invoiceMailAttachmentTemplatePath = invoiceconfig.paymentTransactionTemplateFolder + '' + invoiceconfig.paymentTransactionTemplatePrefix + '' + 'ecpayweb_invoice' + '.xml';
			else
				var invoiceMailAttachmentTemplatePath = getInvoiceMailAttachmentPath(channelConfig, paymentOrderDto.InvoiceReportTempStatus);
			trace.info('invoiceMailAttachmentTemplatePath>>>>>>>>>>>>>>'+invoiceMailAttachmentTemplatePath);
			return XMLParsing(invoiceMailAttachmentTemplatePath,function(errXML,resultXML){
			
				if(errXML){
					trace.warn(warningMsg + ' : ' + errXML);
					return callback(errXML);
				}
				messagebody = '<?xml version="1.0" encoding="utf-8"?>';
				
				messagebody += resultXML.content;
				var invoiceAddrInfo = invoiceInfo[3] || {};
				var invoiceSubDetails = invoiceInfo[0];
				
					trace.info('subdetails  >>>>>>>>>>>',invoiceSubDetails);
				
				var invoiceHeader = invoiceInfo[1];
				
				var invoiceSubDetailsloadingFunction = channelConfig.invoiceSubDetailsloadingFunction;
				var previousDetails = invoiceInfo[2];

				switch(invoiceSubDetailsloadingFunction) {
					case 'getInvoiceSubDetails':
						var rowDetails = fillInvoiceSubDetails.getInvoiceSubDetails(invoiceSubDetails);
						break;
					case 'getInvoiceSubDetails_abtis':
						var rowDetails = fillInvoiceSubDetails.getInvoiceSubDetails_abtis(invoiceSubDetails);
						break;
					case 'getInvoiceSubDetails_transparity':
						var rowDetails = fillInvoiceSubDetails.getInvoiceSubDetails_transparity(invoiceSubDetails);
					case 'getKioskInvoiceSubDetails':
                     trace.log('inside>>>>>>>>>>>>>>getKioskInvoiceSubDetails');
						var rowDetails = fillInvoiceSubDetails.getKioskInvoiceSubDetails(invoiceSubDetails, channelConfig.curSymbolPlace);
						break;
					default:
						var rowDetails = fillInvoiceSubDetails.getKioskInvoiceSubDetails(invoiceSubDetails, channelConfig.curSymbolPlace);
				};
				var countryCode = invoiceHeader[0].countrycode;
				var channelCode = invoiceHeader[0].channelcode;
				trace.info('channelCode & countryCode >>>' + channelCode+" & "+countryCode);
				var currSymb = invoiceHeader[0].currencysymbol || "";
				var couponDiscountAmount = 0;
				if (invoiceHeader[0].couponDiscountAmount != 0){
					couponDiscountAmount = '-'+invoiceHeader[0].couponDiscountAmount;
				}
				if(channelConfig.curSymbolPlace == 'left'){
					messagebody = messagebody.toString().replace('${chargeAmount}',currSymb  + ' '+ invoiceHeader[0].chargeAmount);
					messagebody = messagebody.toString().replace('${couponDiscountAmount}',currSymb  + ' '+ couponDiscountAmount);
					messagebody = messagebody.toString().replace('${chargeAmount}',currSymb  + ' '+ invoiceHeader[0].chargeAmount);
					messagebody = messagebody.toString().replace('${amount}',currSymb  + ' '+ invoiceHeader[0].amount);
					messagebody = messagebody.toString().replace('${vatAmount}',currSymb  + ' '+ invoiceHeader[0].vatAmount);
				}else{
					messagebody = messagebody.toString().replace('${chargeAmount}',invoiceHeader[0].chargeAmount + ' ' + currSymb);
					messagebody = messagebody.toString().replace('${couponDiscountAmount}',invoiceHeader[0].couponDiscountAmount  + ' ' + currSymb);
					messagebody = messagebody.toString().replace('${amount}',invoiceHeader[0].amount  + ' ' + currSymb);
					messagebody = messagebody.toString().replace('${amount}',invoiceHeader[0].amount  + ' ' + currSymb);
					messagebody = messagebody.toString().replace('${vatAmount}',invoiceHeader[0].vatAmount  + ' ' + currSymb);
				}
				messagebody = messagebody.toString().replace('${billToAccountName}', invoiceHeader[0].accountname || "");
				messagebody = messagebody.toString().replace('${billToUserName}', billTo || "");
				messagebody = messagebody.toString().replace('${rowdetails}',rowDetails );

				//messagebody = messagebody.toString().replace('${invoiceDate}',invoiceHeader[0].InvoiceCreateTime || "");
				messagebody = messagebody.toString().replace('${email}',invoiceHeader[0].email || "");
				messagebody = messagebody.toString().replace('${invoiceDueDate}',invoiceHeader[0].paymentDueDate || "");
				messagebody = messagebody.toString().replace('${invoiceDueDate}',invoiceAddrInfo.payment_duedate || "");
				messagebody = messagebody.toString().replace('${billedyear}',invoiceHeader[0].billedYear || "");
				messagebody = messagebody.toString().replace('${billedmonth}',invoiceHeader[0].billedMonth || "");
				messagebody = messagebody.toString().replace('${invoiceDueDays}',invoiceHeader[0].paymentDueDays);
				messagebody = messagebody.toString().replace('${invoiceDate}',invoiceHeader[0].invoiceDate || "");
				messagebody = messagebody.toString().replace('${computeNextInvoiceNo}',invoiceHeader[0].orderNumber || "");
				messagebody = messagebody.toString().replace('${orderNumber}',invoiceHeader[0].orderNumber || "");
				messagebody = messagebody.toString().replace('${invoiceNumber}',invoiceHeader[0].orderNumber || "");
				messagebody = messagebody.toString().replace('${vatId}',invoiceHeader[0].vatId || "");
				messagebody = messagebody.toString().replace('${vatPercentage}',invoiceHeader[0].VatPercentage || "");
				messagebody = messagebody.toString().replace('${address1}',invoiceHeader[0].address1 || "");
				messagebody = messagebody.toString().replace('${companyname}',invoiceAddrInfo.company || "");
				messagebody = messagebody.toString().replace('${companyadd1}',invoiceAddrInfo.address1 || "");
				messagebody = messagebody.toString().replace('${companyadd2}',invoiceAddrInfo.address2 || "");
				messagebody = messagebody.toString().replace('${companystate}',invoiceAddrInfo.state || "");
				messagebody = messagebody.toString().replace('${companyzip}',invoiceAddrInfo.zip || "");
				messagebody = messagebody.toString().replace('${companyphone}',invoiceAddrInfo.phone || "");
				messagebody = messagebody.toString().replace('${companyfax}',invoiceAddrInfo.fax || "");
				messagebody = messagebody.toString().replace('${department}',(invoiceAddrInfo.department || "")+' '+(invoiceAddrInfo.person_sname || "")+' '+(invoiceAddrInfo.person_name || ""));
				messagebody = messagebody.toString().replace('${companymail}',invoiceAddrInfo.email_id || "");		
				messagebody = messagebody.toString().replace('${note}',invoiceAddrInfo.note || "");
				messagebody = messagebody.toString().replace('${accountnumber}',(invoiceAddrInfo.payee_account_no)?(invoiceAddrInfo.payee_account_no).replace(/\r\n/g,'<br />') : "");			
				var addr2 = ""; 
				if(invoiceHeader[0].address2){
					addr2 = invoiceHeader[0].address2 +"<br>";
				}
				messagebody = messagebody.toString().replace('${address2}',addr2);
				messagebody = messagebody.toString().replace('${city_zip}',invoiceHeader[0].city_zip || "");
				messagebody = messagebody.toString().replace('${state_zip}',invoiceHeader[0].state_zip || "");
				messagebody = messagebody.toString().replace('${city}',invoiceHeader[0].city || "");
				messagebody = messagebody.toString().replace('${stateprovincecode}',invoiceHeader[0].stateprovincecode || "");
				messagebody = messagebody.toString().replace('${countrycode}',invoiceHeader[0].countrycode || "");
				messagebody = messagebody.toString().replace('${referenceaccountid}',invoiceHeader[0].referenceaccountid || "");
				messagebody = messagebody.toString().replace('${tenDaysDue}',invoiceHeader[0].tenDaysDue || "");
				var payMethod = invoiceHeader[0].payMethod;	

				/*if(!payMethod && invoiceconfig.defaultPayMethod){
					payMethod = invoiceconfig.defaultPayMethod;
				}*/		
				//Added payment dueDate and payMethod
	
				var PreviousMonthsOutStandingAmountLabel = "";
				var PreviousMonthsOutStandingAmount = "";
				if(previousDetails!=null && previousDetails[0] !=null){
					trace.info('previousDetails PreviousMonthsOutStandingAmountStandingAmount >>>>>>>>>>>',previousDetails[0].PreviousMonthsOutStandingAmount);
					PreviousMonthsOutStandingAmountLabel = 'PreviousMonthsOutStandingAmount:';
					PreviousMonthsOutStandingAmount = previousDetails[0].PreviousMonthsOutStandingAmount + ' ' + invoiceHeader[0].currencysymbol
				}
				messagebody = messagebody.toString().replace('${PreviousMonthsOutStandingAmountLabel}',PreviousMonthsOutStandingAmountLabel);
				messagebody = messagebody.toString().replace('${PreviousMonthsOutStandingAmount}',PreviousMonthsOutStandingAmount);
				messagebody = messagebody.toString().replace('${invoiceFromDate}',invoiceHeader[0].invoiceFromDate || "");
				messagebody = messagebody.toString().replace('${invoiceToDate}',invoiceHeader[0].invoiceToDate || "");
				
		
				messagebody = messagebody.toString().replace('${payMethod}',payMethod || "");

				var paymentDueDate = '';
				var sepaExtraInfo ='';
				var paymentDueDays = invoiceHeader[0].paymentDueDays;	
					if(payMethod != null &&  payMethod !='' && payMethod =='SEPA'){
						paymentDueDate = invoiceHeader[0].paymentDueDate+ ' per '+payMethod;
						if(channelCode == 'ABTIS'){
							sepaExtraInfo = '<br>Sofern Sie SEPA als Zahlungsmethode hinterlegt haben, wird der Betrag automatisch eingezogen.';
						}	
					}else{
						paymentDueDate = invoiceHeader[0].paymentDueDate;
					}				   
				messagebody = messagebody.toString().replace('${paymentDueDate}',paymentDueDate || "");
				messagebody = messagebody.toString().replace('${sepaExtraInfo}',sepaExtraInfo);
				var vatText1 = "";
				var vatText2 = "";
				if(channelCode == 'ABTIS' && countryCode !== 'DE'){
					vatText1 = "Rechnung enthält keine deutsche Umsatzsteuer, gem. §4 Nr. 1 b in Verbindung mit §6 a UStG.";
					if(euCountryCodes.indexOf(countryCode) != -1){	// In EU
						vatText2 = "Steuerfreie innergemeinschaftliche Lieferung.";
					}else{
						vatText2 = "Übergang der Steuerschuld auf den Leistungsempfänger (Art. 196 MwStSystRL)";
					}
				}
				messagebody = messagebody.toString().replace('${vatText1}',vatText1 || "");
				messagebody = messagebody.toString().replace('${vatText2}',vatText2 || "");
				
				var reqObj = {};
				reqObj.ownerId = invoiceHeader[0].ownerId;
				var accountManager = '';
				getAccountDetails(reqObj,function (err,accountdetails){
				if (accountdetails && accountdetails.externalreferences && accountdetails.externalreferences.accountmanager){
					accountManager = accountdetails.externalreferences.accountmanager;
				}
				messagebody = messagebody.toString().replace('${accountmanager}',accountManager || "");
				return callback ('', messagebody);
				});
				
				return callback ('', messagebody);
				
			});
		
	}
	catch(e){
		trace.debug('Error in reading the CCExpiryMailTemplate :' + e.message);
		return callback ('Error in reading the CCExpiryMailTemplate','');
	}
	
}

// to read and parse the details in xml file
function XMLParsing(filePath,callback){
	
	var readData = '';
	var xmlContent = {}; 
	var parser = new xml2js.Parser();
	trace.info(filePath);
	fs.readFile(filePath, function(err, data) {
		
	    parser.parseString(data, function (err, result) {

			xmlContent.content = result.EmailTemplate.content;
							
	    });
		
	    return callback ('',xmlContent);
	});
}

function getUserNameFromBillingService(ownerId, conn, callback){
	 if(conn !== '') { 
	  
		  var test = false;
		  
		  var userDetails = "call sp_getuserdetails('"+ ownerId +"')";
		   
		   conn.query(userDetails, function(err, result)
		   {
		  
				if(err){
					
					trace.error('Error in fetching the data from DB');
					
					return callback(err);
				}
				else
				{
					 if(typeof result[0] != 'undefined' && typeof result[0][0] != 'undefined'){
					 
						return callback(null,result[0][0]); 
					 }
					 else {
					  
						  trace.info('data not found for user');
						  
						  return callback('data not found for user');
					 }
				}
		   });
	 }
	 else {
		 
		trace.error('MySql DB connection is Empty');
		
		return callback('MySql DB connection is Empty');
	 }
};

function updateInvoicingStatus(result, mailSendingStatusObj){
	var mysqlUpdateStatusObj = {};
	orderNumber = mailSendingStatusObj.orderNumber ;
	statuscategory = mailSendingStatusObj.statuscategory;
	status = mailSendingStatusObj.docGenStatus;
	return new promise(function(fulfill, reject){
		invoiceNotificationMysql.updateInvoicingStatus(mailSendingStatusObj.conn, orderNumber, statuscategory, status).then(function(updateStatus){
			mysqlUpdateStatusObj.orderNumber = orderNumber;
			mysqlUpdateStatusObj.status = updateStatus;
			result.push(mysqlUpdateStatusObj);
			return fulfill(result);
		});
	});
};

function getInvoiceMailAttachmentPath(channelConfig, InvoiceReportTempStatus){
	trace.info('-------Entered getInvoiceMailAttachmentPath ----------' );
		trace.info('Before $$$$$$$$$$$$$$$$$$$$$$$$$  '+channelConfig.paymentTransactionTemplateFolder+ channelConfig.invoicingLanguage+'\\'+channelConfig.invoiceMailAttachmentPrefix +InvoiceReportTempStatus);
	
	trace.info(' %%%%%%%%%%%%%channelConfig.invoicingLanguage%%%%%%%%%%  '+channelConfig.invoicingLanguage);
	trace.info(' %%%%%%%%%%%%%channelConfig.invoiceMailAttachmentPrefix%%%%%%%%%%  '+channelConfig.invoiceMailAttachmentPrefix);
		trace.info(' %%%%%%%%%%%%%channelConfig.mailTempStatus%%%%%%%%%%   '+InvoiceReportTempStatus);
	if(channelConfig.UseDefaultInvoiceMailAttachmentTemplate == 'yes' || channelConfig.UseDefaultInvoiceMailAttachmentTemplate == 'undefined') InvoiceReportTempStatus = 'default'; 
	//return channelConfig.paymentTransactionTemplateFolder + '' + channelConfig.invoiceMailAttachmentPrefix + '' + InvoiceReportTempStatus + '.xml';
	//trace.info('$$$$$$$$$$$$$$$$$$$$$$$$$'+channelConfig.paymentTransactionTemplateFolder + channelConfig.invoicingLanguage + '\\' + channelConfig.paymentTransactionTemplatePrefix + '' + mailTempStatus);
	return channelConfig.paymentTransactionTemplateFolder + channelConfig.invoicingLanguage + '\\' + channelConfig.invoiceMailAttachmentPrefix + '' + InvoiceReportTempStatus + '.xml';
};

function getConfigByChannel(ownerId){
	var channelConfig = null;
	return mysql.getChannelCurrency(ownerId, conn).then(function(result){
			trace.info('getChannelCurrency Result:' + JSON.stringify(result));
			if(result && result.length > 0){
			
				channelCode = result[0].channelCode;
				currencyCode = result[0].currencyCode;
				localeCode = result[0].localeCode;
				invoicingLanguage = result[0].invoicingLanguage;
				
				trace.info('channel/currency: ' + channelCode + '/' + currencyCode);
				channelConfig = config[channelCode];
				
				channelConfig.localeCode = localeCode;
				channelConfig.invoicingLanguage = invoicingLanguage;
				
				trace.info(channelConfig);
				return channelConfig;
			} else{ 
				trace.warn('channelcode_unavailable');
				return null;
			}	
	});
};

// ************FUNCTIONS USED TO GENERATE AGENT PDF*****************//

function readingAgentXmltemplate(customerdetails, callback){

	console.log('-------------- enter : reading the xml Email file --------------');
		
	try{
		trace.info('customer/resource details based on request parameters'+JSON.stringify(customerdetails));
			
			if(customerdetails.customername){
			return XMLParsing('commisionMonthlyBreakdown.xml',function(errXML,resultXML){
				
				if(errXML){
					trace.warn(warningMsg + ' : ' + errXML);
					return callback(errXML);
				}
				
				messagebody = '<?xml version="1.0" encoding="utf-8"?>';
				
				messagebody += resultXML.content;
				
				messagebody = messagebody.toString().replace('${chargeamount}',customerdetails.Totalamount || "");
				messagebody = messagebody.toString().replace('${Month}',customerdetails.Month || "");
				messagebody = messagebody.toString().replace('${accountname}',customerdetails.customername || "");
				messagebody = messagebody.toString().replace('${chargeamount}',customerdetails.chargeamount || "");
			    messagebody = messagebody.toString().replace('${rowdetails}',rowDetails );
	
				return callback ('', messagebody);
				
			});
		
	}
			else {
				
				
				return XMLParsing('commisionclientBreakdown.xml',function(errXML,resultXML){
					
				
				if(errXML){
					trace.warn(warningMsg + ' : ' + errXML);
					return callback(errXML);
				}
				
				
				messagebody = '<?xml version="1.0" encoding="utf-8"?>';
				
				messagebody += resultXML.content;
				
				messagebody = messagebody.toString().replace('${Amount}',customerdetails.amount || "");
				messagebody = messagebody.toString().replace('${customername}',customerdetails.name || "");
				messagebody = messagebody.toString().replace('${Month}',customerdetails.Month || "");
				messagebody = messagebody.toString().replace('${description}',customerdetails.description || "");
				messagebody = messagebody.toString().replace('${quantity}',customerdetails.quantity || "");
				messagebody = messagebody.toString().replace('${reconDescription}',customerdetails.reconDescription || "");
				messagebody = messagebody.toString().replace('${revenue}',customerdetails.revenue || "");
				messagebody = messagebody.toString().replace('${commisionbase}',customerdetails.commisionbase || "");
				messagebody = messagebody.toString().replace('${commision}',customerdetails.commision || "");
			    messagebody = messagebody.toString().replace('${rowdetails}',rowDetails );
	
				return callback ('', messagebody);
				
			});
			}
	}
	catch(e){
		trace.debug('Error in reading the CCExpiryMailTemplate :' + e.message);
		return callback ('Error in reading the CCExpiryMailTemplate','');
	}
	
}
		
	function XMLParsing(filePath,callback){
	
			var readData = '';
			var xmlContent = {}; 
			var parser = new xml2js.Parser();
			trace.info(filePath);
				
				fs.readFile(filePath, function(err, data) {
					
					parser.parseString(data, function (err, result) {

						xmlContent.content = result.EmailTemplate.content;
										
					});
					
					return callback ('',xmlContent);
				});
}
	

function getAccountDetails(req,callback){
	var optionsgetAccountDetails = {};
	var ownerid = req.ownerId;
	var headers = {
			"Content-Type": "application/json",
			"ownerId":"cccccccc-cccc-cccc-0000-cccccccccccc",
			"cn-services-internal":"resource:a491ccbd-ea0b-11e4-b6f6-000c298a79e5"
		};		
		optionsgetAccountDetails = {
			host: config.authServiceHost,
			port: config.authServicePort,
			path: '/api/authentication/account/' + ownerid+'?params=account',
			method: 'GET',
			headers: headers
		};	
	return restservices.getCall(optionsgetAccountDetails).then(function (accountdetails) {
				return callback(null,accountdetails);
	}).catch(function (error) {
		trace.warn('common.Catch:' + error);
		if (error.stack) {
			trace.error(error.stack);
		}
		return callback(error);
	}).error(function (err) {
		trace.error('all errors:' + err);
		if (err.stack) {
			trace.error(err.stack);
		}
		return callback(err);
	});
};


exports.readingAgentXmltemplate = readingAgentXmltemplate;
exports.createInvoiceFile = createInvoiceFile;
exports.updateInvoicingStatus = updateInvoicingStatus;
exports.getPaymentOrder = getPaymentOrder;