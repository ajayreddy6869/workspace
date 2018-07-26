var express = require('express');
var router = express.Router();
// var https = require('https');
// var passport = require('passport');
var authhelpers = require('../passport/authhelpers');
var async = require("async");
var events = require('events');
var _ = require("underscore");
var unique = require("array-unique");
var moment = require("moment");
var usersModel = require("../schemas/users");
// var eventEmitter = new events.EventEmitter();
// var lambdaClient = require("../models/lambdaClient");
var recommendations = require("../schemas/recommendations");
// var recommendationsModule = require("../models/recommendation");
var vpcflowlogshistory = require("../schemas/vpcflowlogshistory.js");
var logger = LOGGER.get('default');
var moment = require('moment');
var _ = require('underscore');
var instances = require("../schemas/instances");
var securityGroupsModel = require("../schemas/securityGroups");
var awsDiscoveryHandler = require("../discovery/AwsDiscoveryHandler");
var protocolnumbers = require("../public/scripts/protocolnumbers.json");
var links = require("../schemas/links");
var alerts = require("../schemas/alerts");
var changeMgmt = require("../schemas/changemgmt");
var request = require("request");
var log = LOGGER.get('api');
var sgeditor = require('../models/sgeditor');

var customSecurityGroupName = "gis-fireliner-"
var config = require('../config');

var renderPage = function (req, res, param, renderPage) {
  try {
    instances.aggregate([
      {
        $group: {
          _id: { ApplicationName: '$tags.ApplicationName' },
          region: { '$first': '$region' },
          count: { $sum: 1 },
        }
      },
      {
        $project: {
          _id: 0,
          applicationName: '$_id.ApplicationName',
          region: '$region'
        }
      }
    ])
      .then((result) => {
        // var apps = result[0].applicationNames;
        var apps = result;
        apps.forEach((app) => {
          if (Object.keys(app).length <= 1) {
            apps.splice(apps.indexOf(app), 1)
          }
          if (app.applicationName === '' || app.applicationName === 'undefined' || app.applicationName === null) {
            app.applicationName = 'undefined';
          }
          if (Object.keys(app).length > 1) {
            app.applicationName = app.applicationName.trim();
          }
        })
        apps = _.sortBy(apps, 'applicationName');
        getDataByApplications([apps[0].applicationName])
          .then((result) => {
            if (req.user) {
              getUser(req, function (err, userData) {
                res.render(renderPage, { Nodes: result.nodes, Edges: result.links, Statistics: result.statistics, Stats: result.statsCount, Apps: apps, user: req.user, isAdmin: userData.isAdmin || 'no' });
              });
            } else {
              res.render(renderPage, { Nodes: result.nodes, Edges: result.links, Statistics: result.statistics, Stats: result.statsCount, Apps: apps, user: req.user, isAdmin: 'no' });
            }
          }).catch((error) => {
            console.log(error);
            res.render('error', {});
          })
      })
      .catch((error) => {
        console.log(error);
        res.render('error', {});
      })
  }
  catch (exception) {
    console.log(exception)
    res.render('error', {});
  }

}

var getUser = function (req, callback) {
  try {
    var preferred_username = (req.user._raw) ? JSON.parse(req.user._raw).preferred_username : '';
    usersModel.findOne({ username: preferred_username }).lean().exec(function (err, user) {
      if (err) {
        log.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch link data from db " + " :: user :: " + userId + " :: file :: " + __filename);
        return callback(err, {});
      }
      if (user) {
        return callback(null, user);
      } else {
        return callback(null, {});
      }
    });
  }
  catch (exception) {
    console.log(exception);
  }
}

router.get('/', function (req, res, next) {
  renderPage(req, res, "", "layout");
});

router.get('/getlogs', function (req, res, next) {
  var logs = require("../models/testAlgorithm");
  logs.getVPCFlowLogs();
});

router.get('/applications', function (req, res, next) {
  renderPage(req, res, "", "liner");
});

router.post('/getSpecificApplication', function (req, res, next) {
  var app = req.body.id;
  getDataByApplications(app)
    .then((result) => {
      res.send(result);
    }).catch((error) => {
      res.render('error', {});
    })
});

var getDataByApplications = function (app) {
  return new Promise(function (fulfill, reject) {
    try {
      var link = [];
      var nids = [];
      var elbs = [], elbIps = [], ELBSourceLinks = [], ELBDestLinks = [];
      var extendedNids = [];
      var query = {};
      // var query = { region: { $ne: "us-east-1" } };
      if (app.indexOf("All") < 0) {
        var query = { $or: [{ 'tags.ApplicationName': { $in: app } }, { 'group': 'CIDR' }, { 'group': 'GLOBAL-CIDR' }] };
      }
      instances.find(query, {}).lean(true)
        .then((nodes) => {
          nodes.forEach((node) => {
            node.hidden = false;
            if (node.group == 'ELB') {
              node.id = node.instanceId;
              elbIps = elbIps.concat(node.LoadBalancerIPAddresses);
              elbs.push(node);
            }
            nids.push(node.id)
          });
          async.parallel({
            one: function (callback) {
              links.find({ $and: [{ to: { $in: nids } }, { from: { $nin: elbIps } }] }, {}).lean(true).exec(function (err, link) {
                if (err) {
                  console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the source and destination ports " + __filename);
                  res.render('error', {});
                }
                else {
                  var connectionsCount = 0
                  for (var l = 0; l < link.length; l++) {
                    if (nids.indexOf(link[l].to) > -1 && nids.indexOf(link[l].from) < 0 && extendedNids.indexOf(link[l].from) < 0) {
                      extendedNids.push(link[l].from);
                    }
                    if (nids.indexOf(link[l].to) > -1 && link[l].from.indexOf('/') > -1) {
                      connectionsCount = connectionsCount + Math.pow(2, (32 - link[l].from.split('/')[1]));
                    }
                    if (nids.indexOf(link[l].to) > -1 && link[l].from.indexOf('/') < 0) {
                      connectionsCount = connectionsCount++;
                    }
                  }
                  callback(null, { links: link, appConnections: connectionsCount });
                }
              });
            },
            two: function (callback) {
              var fromRecomm = [];
              // recommendations.find({ to: { $in: nids }, action: /accept/i }, {}).lean(true)
              recommendations.aggregate(
                [
                  { $match: { $and: [{ action: 'ACCEPT' }, { to: { $in: nids } }] } },
                  {
                    "$project": {
                      from: '$from',
                      to: '$to',
                      label: '$label',
                      protocol: '$protocol',
                      requestCount: '$count',
                      action: '$action',
                      arrows: 'to',
                    }
                  }
                ]
              )
                .exec(function (err, links) {
                  if (err) {
                    console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the source and destination ports " + __filename);
                    res.render('error', {});
                  }
                  else {
                    var properties = { color: { "color": "grey", "highlight": "grey" }, length: 200, hidden: true, type: "recommendation", dashes: true, width: 4 };
                    var recommendations = [];
                    for (var k = 0; k < links.length; k++) {
                      // if (nids.indexOf(links[k].to) > -1) {
                      // if (nids.indexOf(links[k].to) > -1 && links[k].accuracy >= 50) {
                      Object.assign(links[k], properties);
                      if (elbIps.indexOf(links[k].from) > -1) {
                        for (var l = 0; l < elbs.length; l++) {
                          if (elbs[l].LoadBalancerIPAddresses.indexOf(links[k].from) > -1) {
                            links[k].origFrom = links[k].from;
                            links[k].from = elbs[l].instanceId;
                            break;
                          }
                        }
                      }
                      if (typeof links[k].protocol === 'number') {
                        links[k].protocol = (links[k].protocol === '-' || links[k].protocol === undefined) ? null : _.findWhere(protocolnumbers, { protocolNumber: Number(links[k].protocol) }).protocolKeyword.toLowerCase();
                      }
                      let flag = true;
                      recommendations.forEach((reclink) => {
                        if (links[k].from === reclink.from && links[k].to === reclink.to && links[k].protocol === reclink.protocol && links[k].label === reclink.label)
                          flag = false;
                      });
                      if (flag)
                        recommendations.push(links[k])
                      if (extendedNids.indexOf(links[k].from) < 0 && nids.indexOf(links[k].from) < 0) {
                        // if (fromRecomm.indexOf(links[k].from) < 0 && extendedNids.indexOf(links[k].from) < 0 && nids.indexOf(links[k].from) < 0) {
                        extendedNids.push(links[k].from)
                      }
                      // }
                    }
                    callback(null, { links: recommendations, fromRecomm: fromRecomm });
                  }
                });
            },
            three: function (callback) {
              var fromRecomm = [];
              // recommendations.find({ to: { $in: nids }, action: /accept/i }, {}).lean(true)
              vpcflowlogshistory.aggregate(
                [
                  { $match: { $and: [{ action: /accept/i }, { to: { $in: nids } }] } },
                  // { $match: { $and: [{ action: 'ACCEPT' }, { to: { $in: nids } }] } },
                  // { $match: { action: /accept/i } },
                  {
                    "$project": {
                      from: '$from',
                      to: '$to',
                      label: '$label',
                      protocol: '$protocol',
                      count: '$count',
                    }
                  }
                ]
              )
                .exec(function (err, stats) {
                  if (err) {
                    console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the source and destination ports " + __filename);
                    res.render('error', {});
                  }
                  else {
                    callback(null, stats);
                  }
                });
            },
            four: function (callback) {
              async.forEach(elbs, function (elb, next) {
                links.find({ from: { $in: elb.LoadBalancerIPAddresses } }, { _id: 0 }).lean(true).exec(function (err, elblinks) {
                  if (err) {
                    console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the ELB links " + __filename);
                    res.render('error', {});
                  }
                  else {
                    elblinks.forEach((elblink) => {
                      let flag = true;
                      elblink.from = elb.instanceId;
                      elblink.length = 150;
                      elblink.color = { "color": "#5cb85c", "highlight": "#5cb85c" };
                      ELBSourceLinks.forEach((elbsoulink) => {
                        if (elblink.from === elbsoulink.from && elblink.to === elbsoulink.to && elblink.protocol === elbsoulink.protocol)
                          flag = false;
                      });
                      if (flag)
                        ELBSourceLinks.push(elblink);
                    });
                    return next();
                  }
                });
              }, function (err) {
                callback(null, { links: ELBSourceLinks });
              });
            },
            five: function (callback) {
              async.forEach(elbs, function (elb, next) {
                links.find({ to: { $in: elb.LoadBalancerIPAddresses } }, { _id: 0 }).lean(true).exec(function (err, elblinks) {
                  if (err) {
                    console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the ELB links " + __filename);
                    res.render('error', {});
                  }
                  else {
                    elblinks.forEach((elblink) => {
                      let flag = true;
                      elblink.to = elb.instanceId;
                      elblink.length = 150;
                      link.hidden = false;
                      if (elblink.from === "0.0.0.0/0") {
                        if (elb.Scheme == "internet-facing")
                          elblink.color = { "color": "#f39c12", "highlight": "#f39c12" };
                        else
                          elblink.color = { "color": "#dd4b39", "highlight": "#dd4b39" };
                      }
                      else if (elblink.from.indexOf("/") > -1 || elblink.label.indexOf("*") > -1) {
                        elblink.color = { "color": "#f39c12", "highlight": "#f39c12" };
                      }
                      else {
                        elblink.color = { "color": "#5cb85c", "highlight": "#5cb85c" };
                      }
                      ELBDestLinks.forEach((elbdeslink) => {
                        if (elblink.from === elbdeslink.from && elblink.to === elbdeslink.to && elblink.protocol === elbdeslink.protocol)
                          flag = false;
                      });
                      if (flag)
                        ELBDestLinks.push(elblink);
                    });
                    return next();
                  }
                });
              }, function (err) {
                callback(null, { links: ELBDestLinks });
              });
            }
          }, function (err, results) {
            // var extendedNids = results.one.extendedNids.concat(results.two.fromRecomm);
            instances.find({ id: { $in: extendedNids } }, {}).lean(true)
              .then((exNodes) => {
                var extendedNodes = [];
                exNodes.forEach((node) => {
                  if (extendedNids.indexOf(node.id) > -1) {
                    node.group = 'EXTENDED-' + node.group;
                    node.hidden = true;
                    extendedNodes.push(node);
                    extendedNids.splice(extendedNids.indexOf(node.id), 1);
                  }
                })
                extendedNids.forEach((nid) => {
                  extendedNodes.push({ group: 'EXTERNAL-NON-CIDR', id: nid, label: nid, region: 'unknown', hidden: true })
                })
                results.one.links.forEach((link) => {
                  link.length = 150;
                  link.hidden = false;
                  if (link.from === "0.0.0.0/0") {
                    link.color = { "color": "#dd4b39", "highlight": "#dd4b39" };
                  }
                  else if (link.from.indexOf("/") > -1 || link.label.indexOf("*") > -1) {
                    link.color = { "color": "#f39c12", "highlight": "#f39c12" };
                  }
                  else {
                    link.color = { "color": "#5cb85c", "highlight": "#5cb85c" };
                  }
                })
                var edges = ((results.one.links.concat(results.two.links)).concat(results.four.links)).concat(results.five.links);
                fulfill({ nodes: nodes.concat(extendedNodes), links: edges, statistics: results.three, statsCount: { 'appConnections': results.one.appConnections, 'recommendationsLength': results.two.links.length } });
              })
              .catch((error) => {
                console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the source and destination ports " + __filename);
                res.render('error', {});
              })
          })
        })
        .catch((error) => {
          console.error(error + "\n" + Date() + " Custom-Error : ( unable to fetch the source and destination ports " + __filename);
          res.render('error', {});
        })
    }
    catch (exception) {
      console.log(exception);
      reject(exception, null)
    }
  })
}

// var removeIsolatedGlobalCIDRs = function(link_doc, callback){
//   process.nextTick(function () {
//     instances.find({'tags.ApplicationName':this.app, id:link_doc.to}).lean(true).exec(function(err, node){
//       if(node.length>0){
//         var nodes = {id:node[0].id, label:node[0].label, group:node[0].group};
//         callback(null, nodes);
//       }
//     });
//   });
// }

router.get('/alerts', function (req, res) {
  alerts.find({}, { '_id': 0 }).lean(true).exec(function (err, alerts) {
    if (err) {
      console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the alerts " + __filename);
      res.render('error', {});
    }
    else {
      res.render("alerts", { alerts: alerts, moment: moment });
    }
  });
});

router.get('/securitygroups', function (req, res) {
  securityGroupsModel.aggregate([{
    "$lookup": {
      "from": "instances",
      "localField": "securityGroupId",
      "foreignField": "securityGroups.securityGroupId",
      "as": "instances"
    }
  },]).exec(function (err, secGroups) {
    if (err) {
      console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the alerts " + __filename);
      res.render('error', {});
    }
    else {
      res.render("securityGroups", { secGroups: secGroups });
    }
  });
});

router.get('/changeMgmt', function (req, res) {
  changeMgmt.find({}).lean(true).exec(function (err, changeMgmtDtls) {
    if (err) {
      console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the change mgmt details " + __filename);
      res.render('error', {});
    }
    else {
      res.render('auditview', { changeMgmtDtls: changeMgmtDtls, moment: moment, isAdmin: req.query.isAdmin });
    }
  });
});


router.post('/addOrDeleteConnection', (req,res)=>{
  let data = req.body.data;
  let userId = req.body.userId;
  var from = {function: "addOrDeleteConnection", userId : userId , date: new Date()};
  if(data.group != undefined && data.group === 'ELB'){
    var elbs = data.from.split(',');
    log.debug("Add or delete security group rule data from elb :: ", elbs, " ::  From :  ", from);
    log.debug("")
    async.forEach(elbs, (elb,callback)=>{
      data.from = elb;
      addOrUpdateConnection(data,userId)
        .then((result)=>{
          callback(null,result);
        })
        .catch((error)=>{
          callback(null,error);
        })
    },(errors,results)=>{
      if(errors){
        log.error("Api call to "+ data.action +" security group rule data from elb failed :: ", errors, " ::  From :  ", from);
        res.send({status:errors.status, message:errors.message})
      }else{
        let successResponses = [];
        results.forEach((result)=>{
          if(result.status === 'success'){
            successResponses.push(result)
          }
        })
        if (data.origAction != 'revert') {
          createChangeMgmt(results[0].data, data, userId);
        }
        log.error("Api call to "+ data.action +" security group rule data from elb successfull :: ", results, " ::  From :  ", from);
        res.send({ status: results[0].status, message: results[0].message  });
      }
    })
  }else{
    log.debug(data.action + " rule to security group :: ", data, " ::  From :  ", from)
    addOrUpdateConnection(data, userId)
      .then((results)=>{
        if (data.origAction != 'revert') {
          createChangeMgmt(results.data, data, userId);
        }
        res.send({ status:results.status, message:results.message });
      })
      .catch((error)=>{
        res.send({ status: results.status, message: error.message });
      })
  }
})

var addOrUpdateConnection = function (data, userId) {
  var from = {function: "addOrUpdateConnection", userId : userId, date: new Date()};
  return new Promise(function (resolve, reject) {
    try {
      log.debug("Add or delete security group rule data :: ", data, " ::  From :  ", from);
      instances.aggregate([
        { "$match": { "id": data.to } },
        { "$unwind": "$securityGroups" },
        { "$unwind": "$securityGroups.securityGroupId" },
        {
          "$lookup": {
            "from": "securityGroups",
            "localField": "securityGroups.securityGroupId",
            "foreignField": "securityGroupId",
            "as": "securitygroups"
          }
        },
        { "$unwind": "$securitygroups" },
        {
          "$group": {
            '_id': '$_id',
            'region': { '$first': '$region' },
            'instanceId': { '$first': '$instanceId' },
            'id': { '$first': '$id' },
            'vpcId': { '$first': '$vpcId' },
            'securityGroups': { '$addToSet': '$securityGroups' },
            'securityGroupsData': { '$push': '$securitygroups' },
            'tags': { '$first': '$tags' }
          }
        }
      ]).then((result) => {
        log.info("Fetched instance and security group details of to ip :: ", data.to ," ::  From :  ", from);
        var instanceData = result[0];
        let sg = {};
            sg.region = instanceData.region;
            sg.vpcId = instanceData.vpcId;
            sg.applicationName = (instanceData.tags && instanceData.tags.ApplicationName) ? instanceData.tags.ApplicationName : '';
        let initialCustomSgLength = 1;
        let instanceSGLength = instanceData.securityGroups.length;
        data.from = (data.from.split('/').length > 1) ? data.from : data.from + '/32'; 
        data.description = 'Inbound rule added by fireliner user - ' + userId + ' on ' + new Date();
        if(data.action === 'delete'){
          instanceData.securityGroupsData.forEach((sgData)=>{
            let cidrIp = (data.from.split('/').length > 1) ? data.from : data.from + '/32';
            let inboundRuleSG = _.findWhere(sgData.inboundRules, {fromPort:parseInt(data.fromPort),toPort:parseInt(data.toPort),ipProtocol:data.protocol,cidrIp:cidrIp});
            if(inboundRuleSG){
              sg.securityGroupId = sgData.securityGroupId;
            }
          })
          if(sg.securityGroupId){
            log.debug(data.action + " rule to security group  :: ", sg, " ::  From :  ", from);
            sgeditor.addOrDeleteRuleToSg(data,sg)
              .then((result1) => {
                log.info(data.action + " rule to security group success :: ", result1.data, " ::  From :  ", from);
                return sgeditor.addOrDeleteLink(data);
              })
              .then((result2) => {
                log.info(data.action + " link from db successfull :: ", result2.data, " ::  From :  ", from);
                return resolve({status:'success', message:  data.action+ " connection from  " + data.from + "  to  " + data.to +"  successfull." , data:sg});
              })
              .catch((error) => {
                log.error(data.action + " connection failed :: ", error , " ::  From :  ", from);
                return resolve({status:'error', message:"Failed to " + data.action + " connection from " + data.from + " to " + data.to +"." , error:error, data:sg});
              });
          }else{
            log.info(data.action + " rule, security group not found for  :: ", data, " ::  From :  ", from);
            return resolve({status:'error', message:"Failed to " + data.action + " connection from " + data.from + " to " + data.to +". No security group found on the rule." , error:null});
          }
        }
        else{
          createOrUpdateSG(initialCustomSgLength, instanceSGLength);
        }

        function createOrUpdateSG(initialCustomSgLength, instanceSGLength) {
          let sgCustomName = customSecurityGroupName + instanceData.id.split('.').join('-') + "-" + initialCustomSgLength;
          sg.securityGroupName = sgCustomName;
          var existingSecurityGroups = _.where(instanceData.securityGroups, { securityGroupName: sg.securityGroupName });
          var existingSecurityGroupIndoundRules = _.where(instanceData.securityGroupsData, { securityGroupName: sg.securityGroupName });
          if (existingSecurityGroups.length === 1 && instanceSGLength <= 5 && existingSecurityGroupIndoundRules[0].inboundRules.length >= 50) {
            return createOrUpdateSG((initialCustomSgLength + 1), (instanceSGLength + 1));
          }
          if (existingSecurityGroups.length === 1 && instanceSGLength <= 5 && existingSecurityGroupIndoundRules[0].inboundRules.length < 50) {
            sg.securityGroupId = existingSecurityGroups[0].securityGroupId;

            sgeditor.addOrDeleteRuleToSg(data,sg)
              .then((result1) => {
                log.info(data.action + " rule to security group success :: ", result1.data, " ::  From :  ", from);
                return sgeditor.addOrDeleteLink(data);
              })
              .then((result2) => {
                log.info(data.action + " link from db successfull :: ", result2.data, " ::  From :  ", from);
                return resolve({status:'success', message:+ data.action+ " connection from  " + data.from + "  to  " + data.to +"  successfull." , data:sg});
              })
              .catch((error) => {
                log.error(data.action + " connection failed :: ", error , " ::  From :  ", from);
                return resolve({status:'error', message:"Failed to " + data.action + " connection from " + data.from + " to " + data.to +"." , data:sg});
              });
          }
          if (existingSecurityGroups.length < 1 && instanceSGLength < 5) {
            sg.description = "Created by fireliner user - " + userId + ' on ' + new Date();
            log.debug(" Create new security group :: ", sg, " ::  From :  ", from);
            sgeditor.createNewSG(sg)
                .then((result) => {
                  result.data.sg.action = 'attach';
                  result.data.sg.instanceId = instanceData.instanceId;
                  log.info("Create new security group successfully :: ", result.data.sg, " ::  From :  ", from);
                  log.debug(result.data.sg.action + " security group to instance  :: ", sg, " ::  From :  ", from);
                  return sgeditor.attachOrDetachSG(result.data.sg)
                })
                .then((result1) => {
                  log.info("Attach sg to instance successfull :: ", result1.data.sg, " ::  From :  ", from);
                  data.from = (data.from.split('/').length > 1) ? data.from : data.from + '/32'; 
                  log.debug(data.action + " rule to security group  :: ", result1.data.sg, " ::  From :  ", from);
                  return sgeditor.addOrDeleteRuleToSg(data,result1.data.sg)
                })
                .then((result2) => {
                  log.info(data.action + " rule to security group success :: ", result2.data, " ::  From :  ", from);
                  return sgeditor.addOrDeleteLink(data);
                })
                .then((result3) => {
                  log.info(data.action + " link from db successfull :: ", result3.data, " ::  From :  ", from);
                  return resolve({status:'success', message: data.action+ " connection from  " + data.from + "  to  " + data.to +"  successfull." , data:sg});
                })
                .catch((error) => {
                  log.error(data.action + " connection failed :: ", error , " ::  From :  ", from);
                  return resolve({status:'error', message:"Failed to " + data.action + " connection from " + data.from + " to " + data.to +"." , data:sg});
                });
          }
          if (instanceSGLength >= 5) {
            log.error("Maximun security groups reached :: ", sg , " ::  From :  ", from);
            return reject({ status: "error", message: "maximun security groups reached, delete few to insert new connection" });
          }
        }
      })
        .catch((err) => {
          log.error(data.action + " connection failed :: ", err , " ::  From :  ", from);
          return reject({ status: "failed", message: "Failed to fetch instance details" ,error: err });
        });
    }
    catch (exception) {
      log.error(data.action + " connection failed :: ", exception , " ::  From :  ", from);
      // log.error(exception + "\n" + Date() + " Custom-Error : ( some exception occured while adding a security group " + " :: user :: " + userId + " :: file :: " + __filename);
      return reject({ status: "error", message: "Exception occured while adding a security group", error:exception });
    }
  });
}

var createChangeMgmt = function (sgData, con, userId) {
  log.debug("----------------create new change management called -------------");
  var changeMgmtDetails = {};
  changeMgmtDetails.from = con.sourceInstId || con.from;
  changeMgmtDetails.to = con.destiInstId || con.to;
  changeMgmtDetails.fromPort = con.fromPort || con.label;
  changeMgmtDetails.toPort = con.toPort || con.label;
  changeMgmtDetails.cidr = con.cidr || '';
  changeMgmtDetails.protocol = con.protocol;
  changeMgmtDetails.securityGroupId = sgData.securityGroupId;
  changeMgmtDetails.region = sgData.region || '';
  changeMgmtDetails.applicationName = sgData.applicationName || '';
  changeMgmtDetails.status = 'Audit pending';
  changeMgmtDetails.action = con.action;
  changeMgmtDetails.createdBy = userId;
  changeMgmtDetails.origFrom = con.origFrom;
  var newchangeMgmt = new changeMgmt(changeMgmtDetails);
  newchangeMgmt.save();
}



router.post('/deleteConnection', function (req, response) {
  try {
    var connection = req.body.data;
    var sourceArray = (connection.from) ? connection.from.split(',') : [];
    if (sourceArray.length > 1) {
      var functionsList = sourceArray.map(function (from, i) {
        var body = JSON.parse(JSON.stringify(req.body));
        body.data.from = from;
        body.data.origFrom = connection.from;
        body.action = body.action || ((sourceArray.length - 1 === i) ? 'Delete connection' : 'elb');
        return function (cb) {
          deleteConnection(body).then((res) => {
            cb(null, res)
          }).catch((err) => {
            cb(err, err);
          })
        }
      });
      async.parallel(functionsList, function (err, result) {
        var check = '', errMsg = null;
        for (var i = 0; i < result.length; i++) {
          if (result[i].status == "failed") {
            check = "failed";
            errMsg = result[i].message;
            break;
          }
        }
        if (check != "failed") {
          response.status(200).json({ "status": "success", "message": "Connection deleted sucessfully." });
        }
        else {
          response.status(400).json({ "status": "error", "message": errMsg || "OOPS! something went wrong, try again" });
        }
      })
    } else {
      deleteConnection(req.body).then((res) => {
        response.status(200).json({ "status": "success", "message": "Connection deleted sucessfully." });
      }).catch((err) => {
        response.status(400).json(err);
      });
    }
  } catch (exception) {
    log.error(err + "\n" + Date() + " Custom-Error : ( some exception occured while adding a security group " + " :: user :: " + userId + " :: file :: " + __filename);
    response.status(400).json({ "status": "error", "message": "OOPS! something went wrong, try again" });
  }
});

var deleteConnection = function (body) {
  return new Promise(function (fulfill, reject) {
    try {
      var connection = body.data;
      var userId = body.userId || '';
      var con = {};
      con.cidr = (!connection.from.split('/')[1]) ? connection.from.split('/')[0] + "/32" : connection.from;
      con.from = connection.from;
      con.to = connection.to;
      con.protocol = connection.protocol.toLowerCase();
      con.label = connection.label;
      con.action = body.action || 'Delete connection';
      con.sourceInstId = connection.sourceInstId || null;
      con.origFrom = connection.origFrom || null;
      var inboundQuery = {
        "fromPort": parseInt(con.label), "toPort": parseInt(con.label),
        "ipProtocol": con.protocol, "cidrIp": con.cidr
      }
      if (con.protocol == "all" || con.label == "*") {
        inboundQuery = {
          "fromPort": null, "toPort": null,
          "ipProtocol": "-1", "cidrIp": con.cidr
        }
      }
      instances.aggregate([
        { "$match": { "id": connection.to } },
        { "$unwind": "$securityGroups" },
        { "$unwind": "$securityGroups.securityGroupId" },
        {
          "$lookup": {
            "from": "securityGroups",
            "localField": "securityGroups.securityGroupId",
            "foreignField": "securityGroupId",
            "as": "securitygroups"
          }
        },
        { "$unwind": "$securitygroups" },
        {
          "$match": {
            'securitygroups.inboundRules': {
              "$elemMatch": inboundQuery
            }
          }
        },
      ]).then((result) => {
        log.info("Sucessfully fetched instance details from db", " ::  From :  " + " :: user :: " + userId + " :: file :: " + __filename);
        var instanceData = result[0];
        if (instanceData) {
          con.securityGroupId = instanceData.securitygroups.securityGroupId;
          con.region = instanceData.region;
          deleteRule(con, userId)
            .then((resp) => {
              if (con.action != 'revert' && con.action != 'elb') {
                createChangeMgmt(instanceData, con, userId);
              }
              log.info("Sucessfully deleted Connection" + " :: user :: " + userId + " :: file :: " + __filename);
              fulfill({ "status": "success", "message": "Connection deleted sucessfully." });
            })
            .catch((err) => {
              log.error(err + "\n" + Date() + " Custom-Error : ( unable to deleted the connection " + " :: user :: " + userId + " :: file :: " + __filename);
              reject({ "status": "failed", "message": "OOPS! something went wrong, try again" });
            });
        } else {
          log.error(Date() + " The specified inboundRule already deleted before " + " :: user :: " + userId + " :: file :: " + __filename);
          reject({ "status": "failed", "message": 'The specified inboundRule "source: ' + con.from + ', destination: ' + con.to + ', port: ' + con.label + '" does not exists.' });
        }
      })
        .catch((err) => {
          log.error(err + "\n" + Date() + " Custom-Error : ( failed to fetch instance details from Db " + " :: user :: " + userId + " :: file :: " + __filename);
          reject({ "status": "failed", "message": "OOPS! something went wrong, try again" });
        });
    }
    catch (exception) {
      console.log(exception);
      reject({ "status": "failed", "message": "OOPS! something went wrong, try again" });
    }
  });
}

router.post('/approvechmgmt', function (req, res) {
  try {
    var reqData = req.body.data;
    var userId = req.body.userId || '';
    var updatedJson = {
      'status': 'Approved',
      'comments': {
        'approvedBy': userId,
        'approvedDate': new Date().toISOString()
      }
    };
    changeMgmt.update({ _id: reqData._id }, { $set: updatedJson }, function (err, result) {
      if (err) {
        console.error(err + "\n" + Date() + " Custom-Error : ( unable to approve the change mgmt details " + " :: user :: " + userId + " :: file :: " + __filename);
        res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
      }
      else {
        changeMgmt.find({}).lean(true).exec(function (err, changeMgmtDtls) {
          if (err) {
            console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the change mgmt details " + " :: user :: " + userId + " :: file :: " + __filename);
            res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
          }
          else {
            res.render('auditview', { changeMgmtDtls: changeMgmtDtls, moment: moment, sucmessage: 'inboundRule approved successfully', isAdmin: req.body.isAdmin });
          }
        });
      }
    });
  }
  catch (exception) {
    console.log(exception);
    res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
  }
});

router.post('/revertaddconnection', function (req, res) {
  try {
    var reqData = req.body.data;
    var userId = req.body.userId || '';
    var url = config.creds.domain + '/addOrDeleteConnection';
    request.post({
      url: url,
      body: req.body,
      json: true
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var comments = {
          'approvedBy': (reqData.comments && reqData.comments.approvedBy) ? reqData.comments.approvedBy : null,
          'approvedDate': (reqData.comments && reqData.comments.approvedDate) ? reqData.comments.approvedDate : null,
          'revertedBy': userId,
          'revertedDate': new Date().toISOString()
        };
        changeMgmt.update({ _id: reqData._id }, { $set: { 'status': 'Reverted', 'comments': comments } }, function (err, result) {
          if (err) {
            console.error(err + "\n" + Date() + " Custom-Error : ( unable to reject the change mgmt details " + " :: user :: " + userId + " :: file :: " + __filename);
            res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
          }
          else {
            changeMgmt.find({}).lean(true).exec(function (err, changeMgmtDtls) {
              if (err) {
                console.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch the change mgmt details " + " :: user :: " + userId + " :: file :: " + __filename);
                res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
              }
              else {
                res.render('auditview', { changeMgmtDtls: changeMgmtDtls, moment: moment, sucmessage: 'inboundRule rejected successfully', isAdmin: req.body.isAdmin });
              }
            });
          }
        });

      } else {
        var errorMsg = "OOPS! something went wrong, try again";
        log.error(error + "\n" + Date() + " Custom-Error : ( unable to revert the add connection " + " :: user :: " + userId + " :: file :: " + __filename);
        if (response.body.message) {
          errorMsg = response.body.message;
        }
        res.status(400).json({ "status": "error", "message": errorMsg });
      }
    });
  }
  catch (exception) {
    console.log(exception);
    res.status(400).json({ "status": "error", "message": 'OOPS! something went wrong, try again' });
  }
});

var deleteRule = function (reqData, userId) {

  return new Promise(function (fulfill, reject) {
    try {
      var ruleData = {
        securityGroupId: reqData.securityGroupId,
        protocol: (reqData.protocol == 'all') ? -1 : reqData.protocol,
        fromPort: (reqData.label == '*') ? -1 : reqData.label,
        toPort: (reqData.label == '*') ? -1 : reqData.label,
        action: "delete",
        cidr: reqData.cidr,
        region: reqData.region
      };
      var inboundRule = {
        "fromPort": parseInt(reqData.label),
        "toPort": parseInt(reqData.label),
        "ipProtocol": reqData.protocol,
        "cidrIp": reqData.cidr,
      };
      awsDiscoveryHandler.addOrDeleteRuleToSecurityGroup(ruleData)
        .then((res) => {
          log.info("Sucessfully deleted inboundRule using lamda client" + " :: user :: " + userId + " :: file :: " + __filename);
          securityGroupsModel.update({ securityGroupId: reqData.securityGroupId }, { $pull: { inboundRules: inboundRule } }, { upsert: true })
            .then((res) => {
              log.debug("----------------Sucessfully removed inbound inboundRule from security group-------------" + " :: user :: " + userId + " :: file :: " + __filename);
              deleteLink(reqData, userId)
                .then((res) => {
                  log.info("Sucessfully deleted new link " + " :: user :: " + userId + " :: file :: " + __filename);
                  fulfill(res)
                })
                .catch((err) => {
                  log.error(err + "\n" + Date() + " Custom-Error : ( unable to delete a link " + " :: user :: " + userId + " :: file :: " + __filename);
                  reject(err)
                });
            })
            .catch((err) => {
              log.error(err + "\n" + Date() + " Custom-Error : ( unable to update SecurityGroup " + " :: user :: " + userId + " :: file :: " + __filename);
              reject(err);
            })
        })
        .catch((err) => {
          reject(err)
        });
    } catch (exception) {
      log.error(exception + "\n" + Date() + " Custom-Error : ( exception occured while deleting inboundRule " + " :: user :: " + userId + " :: file :: " + __filename);
      reject(exception)
    }
  });

}

var deleteLink = function (connection, userId) {
  return new Promise(function (fulfill, reject) {
    try {
      var ports = [];
      links.findOne({ from: connection.from, to: connection.to, protocol: connection.protocol }).lean().exec(function (err, link) {
        if (err) {
          log.error(err + "\n" + Date() + " Custom-Error : ( unable to fetch link data from db " + " :: user :: " + userId + " :: file :: " + __filename);
          reject(err);
        } if (link && link !== null) {
          ports = link.label.split(',').map(function (key) {
            return isNaN(parseInt(key)) ? key : parseInt(key);
          });
          let lable = isNaN(parseInt(connection.label)) ? connection.label : parseInt(connection.label);
          var indexPos = ports.indexOf(lable);
          if (ports.length > 1 && indexPos != -1) {
            ports.splice(indexPos, 1);
            links.update({ _id: link._id }, { $set: { label: ports.join() } }, { upsert: true }, function (err, result) {
              if (err) {
                log.error(err + "\n" + Date() + " Custom-Error : ( unable to update link data in db " + " :: user :: " + userId + " :: file :: " + __filename);
                reject(err);
              } else {
                log.info("Sucessfully link updated in DB" + " :: user :: " + userId + " :: file :: " + __filename);
                fulfill(result);
              }
            })
          } else if (indexPos != -1) {
            links.remove({ _id: link._id }, function (err, result) {
              if (err) {
                log.error(err + "\n" + Date() + " Custom-Error : ( unable to delete link data in db " + " :: user :: " + userId + " :: file :: " + __filename);
                reject(err);
              } else {
                log.info("Sucessfully deleted link in DB" + " :: user :: " + userId + " :: file :: " + __filename);
                fulfill(result);
              }
            })
          } else {
            log.info("Requested port not assigned to link before");
            fulfill("Requested port not assigned to link before");
          }
        } else {
          log.info("Link does not exists in DB.");
          fulfill("Link does not exists in DB.");
        }
      })
    } catch (exception) {
      log.error(exception + "\n" + Date() + " Custom-Error : ( exception occured while creating links " + " :: user :: " + userId + " :: file :: " + __filename);
      reject(exception);
    }
  })
}
module.exports = router;
