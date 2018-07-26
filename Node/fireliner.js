"use strict";
var nodes = new vis.DataSet(Nodes);
var edges = new vis.DataSet(Edges);
var portsData;

var canvas;
var ctx;
var rect = {},
  drag = false;
var drawingSurfaceImageData;
var network = null;
var data = {
  nodes: nodes,
  edges: edges
};

var externalNodes = [];
var statistics = [];

var troubleShootMode = false;

function draw(data, viewType) {
  destroy();
  var container = $("#mynetwork");
  var options = {
    physics: {
      forceAtlas2Based: {
        gravitationalConstant: -26,
        centralGravity: 0.005,
        springLength: 150,
        springConstant: 0.18
      },
      barnesHut: {
        gravitationalConstant: -80000,
        springConstant: 0.001,
        springLength: 150
      },
      maxVelocity: 50, //500,
      minVelocity: 0.1,
      solver: 'forceAtlas2Based',
      timestep: 0.35,
      stabilization: {
        enabled: true,
        iterations: 200,
        updateInterval: 5
      }
    },
    layout: {
      randomSeed: 2, //2
      improvedLayout: true
    },
    interaction: {
      dragView: true,
      multiselect: false
    },
    nodes: {
      mass: 3,
      shape: 'box',
      size: 300,
      font: {
        size: 20,
        color: '#000000',
        face: 'arial'
      },
      borderWidth: 0.5,
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.5)',
        size: 3,
        x: 2,
        y: 2
      },
      // physics: true
    },
    edges: {
      width: 1,
      length: 200
    },
    groups: {
      'CIDR': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue800',
          size: 80,
          color: '#f39c12'
        },
        shadow: {
          enabled: false
        }
      },
      'ELB': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue803',
          size: 80,
          color: '#5cb85c'
        },
        shadow: {
          enabled: false
        }
      },
      'GLOBAL-CIDR': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue800',
          size: 100,
          color: '#dd4b39'
        },
        shadow: {
          enabled: false
        }
      },
      'NON-CIDR': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue801',
          size: 80,
          color: '#5cb85c'
        },
        shadow: {
          enabled: false
        }
      },
      'EXTENDED-NON-CIDR': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue801',
          size: 80,
          color: '#3c8dbc'
        },
        shadow: {
          enabled: false
        }
      },
      'EXTERNAL-NON-CIDR': {
        shape: 'icon',
        icon: {
          face: 'fontello',
          code: '\ue801',
          size: 60,
          color: '#222d32'
        },
        shadow: {
          enabled: false
        }
      }
    },
    manipulation: {
      deleteEdge: function (data, callback) {
        var edgeData = edges.get(data.edges[0]);
        edgeData.action = 'delete';
        editEdgeWithoutDrag(edgeData, callback);
        document.getElementById('edge-operation').innerHTML = "Delete Connection";
        // onDeleteConnection(edges.get(data.edges[0]), function (resp) {
        //   if (resp) {
        //     var labels = edgeData.label.split(',');
        //     var indexPos = labels.indexOf(resp.label);
        //     if (labels.length > 1 && indexPos != -1) {
        //       labels.splice(indexPos, 1);
        //       edgeData.label = labels.join();
        //       edges.update(edgeData);
        //     } else {
        //       edges.remove(data.edges[0]);
        //     }
        //   } {
        //     callback(resp);
        //   }
        // });
      },
      addNode: function (data, callback) {
        // filling in the popup DOM elements
        document.getElementById('node-operation').innerHTML = "Add Node";
        editNode(data, clearNodePopUp, callback);
      },
      editNode: function (data, callback) {
        // filling in the popup DOM elements
        document.getElementById('node-operation').innerHTML = "Edit Node";
        editNode(data, cancelNodeEdit, callback);
      },
      addEdge: function (data, callback) {
        if (data.from == data.to) {
          var r = confirm("Do you want to connect the node to itself?");
          if (r != true) {
            callback(null);
            return;
          }
        }
        document.getElementById('edge-operation').innerHTML = "Add Edge";
        data.action = 'add';
        editEdgeWithoutDrag(data, callback);
      },
      editEdge: {
        editWithoutDrag: function(data, callback) {
          var currentEdge = edges._getItem(data.id);
          document.getElementById('edge-operation').innerHTML = (currentEdge.type === 'recommendation')? "Review Recommendation" : "Edit Edge";
          if((currentEdge.type === 'recommendation')){
            data.action = 'add';
            editEdgeWithoutDrag(data,callback);
          }
          else{
            alert("edit functionality is not yet available");
            callback(null);
          }
        }
      }
    }
  };
  container.on("mousemove", function (e) {
    if (drag) {
      restoreDrawingSurface();
      rect.w = (e.pageX - this.offsetLeft) - rect.startX;
      rect.h = (e.pageY - this.offsetTop) - rect.startY;

      ctx.setLineDash([5]);
      ctx.strokeStyle = "rgb(0, 102, 0)";
      ctx.strokeRect(rect.startX, rect.startY, rect.w, rect.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
      ctx.fillRect(rect.startX, rect.startY, rect.w, rect.h);
    }
  });
  container.on("mousedown", function (e) {
    if (e.button == 2) {
      selectedNodes = e.ctrlKey ? network.getSelectedNodes() : null;
      saveDrawingSurface();
      var that = this;
      rect.startX = e.pageX - this.offsetLeft;
      rect.startY = e.pageY - this.offsetTop;
      drag = true;
      container[0].style.cursor = "crosshair";
    }
  });
  container.on("mouseup", function (e) {
    if (e.button == 2) {
      restoreDrawingSurface();
      drag = false;

      container[0].style.cursor = "default";
      selectNodesFromHighlight();
    }
  });
  document.body.oncontextmenu = function () {
    return false;
  };
  network = new vis.Network(container[0], data, options);
  network.selectionHandler.canvas.body.view.scale = 0;
  // if (viewType == "appView") {
  var nodeIds = nodes.getIds();
  nodeIds.forEach(function (element) {
    if (network.getConnectedEdges(element).length <= 0) {
      nodes.update({
        id: element,
        hidden: true
      });
    }
  });
  // }
  network.on("selectNode", function (params) {
    if (params.nodes.length == 1) {
      if (network.isCluster(params.nodes[0]) == true) {
        network.openCluster(params.nodes[0]);
      }
    }
  });
  network.on("dragEnd", function (params) {
    network.stopSimulation();
  });
  network.on('doubleClick', function (properties) {
    var currentNode = properties.nodes;
    var connectedEdges = properties.edges;
    if (currentNode.length > 0 && $('#apps option:selected').val() == 'All') {
      var currentNodeObj = nodes.get(currentNode[0]);
      var applicationName = (currentNodeObj && currentNodeObj.tags) ? (currentNodeObj.tags.ApplicationName || 'undefined') : 'undefined'
      makeClusters(applicationName);
    }
  });
  network.on('startStabilizing', function () {
    $('#stopSimulation').show();
  })
  network.on("stabilizationProgress", function (params) {
    document.getElementById('loadingBar').style.display = 'block';
    document.getElementById('loadingBar').style.opacity = 1;
    var maxWidth = 496;
    var minWidth = 20;
    var widthFactor = params.iterations / params.total;
    var width = Math.max(minWidth, maxWidth * widthFactor);
    document.getElementById('bar').style.width = width + 'px';
    document.getElementById('text').innerHTML = Math.round(widthFactor * 100) + '%';
  });
  network.once("stabilizationIterationsDone", function () {
    // network.stopSimulation();
    document.getElementById('text').innerHTML = '100%';
    document.getElementById('bar').style.width = '496px';
    document.getElementById('loadingBar').style.opacity = 0;
    // really clean the dom element
    // showOrHideApplicationsByRegions("us-east-1", false);  

    setTimeout(function () {
      document.getElementById('loadingBar').style.display = 'none';
    }, 500);
    if (viewType === 'appView') {
      // network.stopSimulation();
    }
  });
  network.on('stabilized', function () {
    $('#stopSimulation').hide();
  })
  network.on('click', function (properties) {
    network.stopSimulation();
    var currentNode = properties.nodes;
    var connectedEdges = properties.edges;
    if (currentNode.length > 0) {
      if (network.isCluster(currentNode[0]))
        return false;
      else
        showCurrentNodeDetails(currentNode, connectedEdges)
    } else if (connectedEdges.length > 0) {
      var currentEdgeProperties = {};
      if (connectedEdges[0] && connectedEdges[0].indexOf('clusterEdge:') != -1) {
        var clusterEdgeProperties = network.clustering.body.edges[connectedEdges[0]];
        var clusteredEdgeIds = [];
        if (clusterEdgeProperties.from.isCluster) {
          $.each(clusterEdgeProperties.clusteringEdgeReplacingIds, function (i, item) {
            clusteredEdgeIds = clusteredEdgeIds.concat(network.clustering.body.edges[item].clusteringEdgeReplacingIds);
          });
        } else {
          clusteredEdgeIds = clusterEdgeProperties.clusteringEdgeReplacingIds;
        }
        var clusteredEdges = edges.get({
          filter: function (item) {
            return (clusteredEdgeIds.indexOf(item.id) != -1);
          }
        });
        currentEdgeProperties.from = clusterEdgeProperties.from.options.label;
        currentEdgeProperties.to = clusterEdgeProperties.to.options.label;
        var labels = [],
          protocols = [];
        $.each(clusteredEdges, function (i, item) {
          let label = isNaN(parseInt(item.label)) ? item.label : parseInt(item.label);
          if (labels.indexOf(label) == -1) {
            labels.push(label)
          }
          if (protocols.indexOf(item.protocol) == -1) {
            protocols.push(item.protocol)
          }
        });
        currentEdgeProperties.label = labels.join();
        currentEdgeProperties.protocol = protocols.join();
      } else {
        currentEdgeProperties = edges.get(connectedEdges)[0];
      }
      var networkDetailsHeader;
      if (currentEdgeProperties.type === 'recommendation') {
        var requiredKeys = ['from', 'label','protocol', 'requestCount', 'accuracy'];
        networkDetailsHeader = 'Selected - ' + currentEdgeProperties['to'] + '(' + currentEdgeProperties['label'] + ')';
      } else {
        var requiredKeys = ['from', 'to', 'label', 'protocol'];
        networkDetailsHeader = 'Network details';
      }
      var networkDetails;
      var keysMap = {
        from: 'Source',
        label: 'Port',
        to: 'Destination',
        protocol: 'Protocol',
        accuracy: 'Accuracy',
        requestCount: 'Inbound Profile'
      }
      currentEdgeProperties.from = currentEdgeProperties.from.split('_')[0] ;
      for (var e in currentEdgeProperties) {
        // var networkDetailsValue = (e === 'accuracy') ? Math.round(Number(currentEdgeProperties[e])) + '%' : currentEdgeProperties[e];
        // var networkDetailsValue = (e === 'accuracy') ? Math.round(Number(currentEdgeProperties[e])) + '%' : currentEdgeProperties[e];
        if(e === 'accuracy' ){
          if(currentEdgeProperties[e] != undefined && currentEdgeProperties[e] != '-'){
            var networkDetailsValue = Math.round(Number(currentEdgeProperties[e])) + '%';
          }else{
            var networkDetailsValue = '-'
          }
        }else{
          var networkDetailsValue = currentEdgeProperties[e];
        }
        if (requiredKeys.indexOf(e) > -1) {
          if (e === 'requestCount') {
            var networkDetailsKey = keysMap[e] + ' <a data-toggle="tooltip" data-placement="top" title="#Inbound Flow Logs from source to destination"><i class="fa fa-info-circle" aria-hidden="true"></i></a>';
          } else if (e === 'totalRequestCount') {
            var networkDetailsKey = keysMap[e] + ' <a data-toggle="tooltip" data-placement="top" title="#Total Inbound Flow Logs to destination"><i class="fa fa-info-circle" aria-hidden="true"></i></a>';
          } else if (e === 'label') {
            var currentNetworkPorts = networkDetailsValue.split(',');
            networkDetailsValue = '';
            currentNetworkPorts.forEach(function (port) {
              var portDesc = portsData.filter(function (e) {
                if (e.port == port) {
                  return e
                }
                if (typeof e.port === 'string' && e.port.indexOf('-') > -1) {
                  var range = e.port.split('-');
                  if (port >= Number(range[0]) && port <= Number(range[1])) {
                    return e
                  }
                }
              });
              if (portDesc.length > 0) {
                var description = 'DESCRIPTION: '+portDesc[0].description
              } else {
                var description = 'unknown'
              }
              // console.log(portDesc[0].description)
              // networkDetailsValue = networkDetailsValue + port + '<a data-toggle="tooltip" data-placement="top" title="'+ portDesc[0].description +'"><i class="fa fa-info-circle" aria-hidden="true"></i></a> '
              networkDetailsValue = networkDetailsValue + '<a data-toggle="tooltip" data-placement="top" title="' + description + '">' + port + '</a> ' + ', '
            })
          networkDetailsValue = networkDetailsValue.replace(/,\s*$/, "");
            var networkDetailsKey = keysMap[e];
            // var networkDetailsKey = keysMap[e] + ' <a data-toggle="tooltip" data-placement="top" title="'+ portDesc[0].description +'"><i class="fa fa-info-circle" aria-hidden="true"></i></a>';
          } else {
            var networkDetailsKey = keysMap[e];
          }
          networkDetails = networkDetails + '<tr><td>' + networkDetailsKey + '</td><td>' + networkDetailsValue + '</td></tr>';
        }
      }
      var selectednetworkStats = statistics.filter(function (item) {
        return item.from === currentEdgeProperties.from && item.to === currentEdgeProperties.to;
      });
      var networkStats = '';
      var linkStatsContent = '';
      // $("#linkStats").popover({placement:'left',html:'true',title:'',content:''});
      for (var i = 0; i < selectednetworkStats.length; i++) {
        networkStats = networkStats + '<tr><td>' + selectednetworkStats[i].from + '</td><td>' + selectednetworkStats[i].to + '</td><td>' + selectednetworkStats[i].label + '</td><td>' + selectednetworkStats[i].protocol + '</td><td>' + selectednetworkStats[i].count + '</td></tr>';
      }
      document.getElementById('totalStatsCount').innerHTML = selectednetworkStats.length;
      document.getElementById('server-details').style.display = 'none';
      document.getElementById('network-details').style.display = 'block';
      document.getElementById('network-details-heading').innerHTML = networkDetailsHeader;
      if (selectednetworkStats.length === 0) {
        linkStatsContent = '<p>No records found</p>'
      } else {
        linkStatsContent = '<table> <tr> <th>Source</th> <th>Destination</th> <th>Port</th> <th>Protocol</th> <th>#Inbound profile</th> </tr> ' + networkStats + '</table>';
      }
      $("#network-details-table").html(networkDetails);
      $('#linkStats').attr('data-content', linkStatsContent);
      $('[data-toggle="tooltip"]').tooltip();
    } else {
      document.getElementById('server-details').style.display = 'none';
      document.getElementById('network-details').style.display = 'none';
    }

  });

  canvas = network.canvas.frame.canvas;
  ctx = canvas.getContext('2d');
}

//initializers
function init(data, viewType) {
  draw(data, viewType);
}

//manipulations
function editNode(data, cancelAction, callback) {
  document.getElementById('node-label').value = data.label;
  document.getElementById('node-saveButton').onclick = saveNodeData.bind(this, data, callback);
  document.getElementById('node-cancelButton').onclick = cancelAction.bind(this, callback);
  document.getElementById('node-popUp').style.display = 'block';
}

// Callback passed as parameter is ignored
function clearNodePopUp() {
  document.getElementById('node-saveButton').onclick = null;
  document.getElementById('node-cancelButton').onclick = null;
  document.getElementById('node-popUp').style.display = 'none';
}

function cancelNodeEdit(callback) {
  clearNodePopUp();
  callback(null);
}

function saveNodeData(data, callback) {
  data.label = document.getElementById('node-label').value;
  clearNodePopUp();
  callback(data);
}

function editEdgeWithoutDrag(data, callback) {
  data.type = (edges._getItem(data.id) === null) ? null : edges._getItem(data.id).type;
  document.getElementById('edge-from').value = (typeof data.from === 'object') ? data.from.id :data.from;
  document.getElementById('edge-to').value = (typeof data.to === 'object') ? data.to.id :data.to;
  document.getElementById('edge-popUp').style.display = 'block';
  document.getElementById('edge-protocol').value = (edges._getItem(data.id) === null) ? null : edges._getItem(data.id).protocol.toLowerCase();
  document.getElementById('edge-cancelButton').onclick = cancelEdgeEdit.bind(this,callback);

  if(data.action === 'delete'){
    var label = data.label.split(',');
    var options = '';
    label.forEach(element => {
      options += '<option value="' + element + '">' + element + '</option>';
    });
    $("#edge-labels").empty().append(options);
    document.getElementById('edge-label-block').style.display = 'none';
    document.getElementById('edge-labels-block').style.display = 'block';
    document.getElementById('edge-saveButton').innerHTML = 'Delete';
    document.getElementById('edge-saveButton').onclick = saveEdgeData.bind(this, data, callback);
    document.getElementById('edge-rejectButton').onclick = null; 
    document.getElementById('edge-rejectButton').style.display = 'none';
  }else if(data.action === 'add'){
    document.getElementById('edge-label-block').style.display = 'block';
    document.getElementById('edge-labels-block').style.display = 'none';
    document.getElementById('edge-label').value = (data.label === undefined) ? null : data.label;
    document.getElementById('edge-saveButton').innerHTML = (data.type === 'recommendation') ? 'Accept' : 'Save';
    document.getElementById('edge-saveButton').onclick = saveEdgeData.bind(this, data, callback);
    document.getElementById('edge-rejectButton').onclick = (data.type === 'recommendation') ? rejectEdgeData.bind(this, data, callback) : null; 
    document.getElementById('edge-rejectButton').style.display = (data.type === 'recommendation') ? 'block' : 'none';
  }

}

function clearEdgePopUp() {
  document.getElementById('edge-saveButton').onclick = null;
  document.getElementById('edge-cancelButton').onclick = null;
  document.getElementById('edge-popUp').style.display = 'none';
}

function cancelEdgeEdit(callback) {
  clearEdgePopUp();
  callback(null);
}

function rejectEdgeData(data,callback){
  if (typeof data.to === 'object')
    data.to = data.to.id
  if (typeof data.from === 'object')
    data.from = data.from.id
  data.label = document.getElementById('edge-label').value;
  data.protocol = document.getElementById('edge-protocol').value;
  httpRequest('/rejectRecommendation',data)
  .then(function (result){
    document.getElementById('appRecommendations').innerHTML = Number(document.getElementById('appRecommendations').innerHTML) -1;
    clearEdgePopUp();
    callback(null);
    edges.remove(data.id);
  }) 
  .catch(function(error){
    console.log(error);
    clearEdgePopUp();
    callback(null);
  })
}

function saveEdgeData(data, callback) {
  if (typeof data.to === 'object')
    data.to = data.to.id
  if (typeof data.from === 'object')
    data.from = data.from.id
  data.label = document.getElementById('edge-label').value;
  if(data.action === 'delete'){
    data.label = document.getElementById('edge-labels').value;
  }
  data.protocol = document.getElementById('edge-protocol').value;
  var currentEdges = edges.get({
    filter: function (edge) {
      return (edge.from == data.from && edge.to == data.to && edge.protocol == data.protocol && edge.type != "recommendation");
    }
  });
  if(currentEdges.length > 0 && (','+currentEdges[0].label+',').includes(','+data.label+',') && data.action === 'add'){
    alert("connection already exsists");
    return false;
  }
  if(data.label.split('-').length > 1){
    data.fromPort = data.label.split('-')[0];
    data.toPort = data.label.split('-')[1];
  }else{
    data.fromPort = data.label;
    data.toPort = data.label;
  }
  data.arrows = "to";
  var fromNode = nodes.get(data.from);
  if(fromNode.group != null && fromNode.group === 'ELB'){
    data.from = fromNode.privateIPAddress;
    data.sourceInstanceId = fromNode.id;
    data.group = 'ELB'
  }
  httpRequest('/addOrDeleteConnection',data)
    .then(function (result){
      clearEdgePopUp();
      if(data.type === 'recommendation'){
        edges.remove(data.id);
      }
      if(currentEdges.length > 0 ){
        if(data.action === 'add'){
          currentEdges[0].label = currentEdges[0].label + ',' + data.label;
          edges.update(currentEdges[0])
          callback(null);
        }
        else{
          if(currentEdges[0].label.split(',').length > 1){
            currentEdges[0].label = (','+currentEdges[0].label).replace((','+data.label),'').replace(/^,|,$/g,'');
            // currentEdges[0].label = currentEdges[0].label.replace(data.label,'').replace(/^,|,$/g,'');
            edges.update(currentEdges[0]);
            callback(null);
          }else{
            edges.remove(data.id);
            callback(null);
          }
        }
      }else{
        edges.update(data);
        callback(null);
      }
    }) 
    .catch(function(error){
      console.log(error);
      clearEdgePopUp();
      callback(null);
    })
}



function makeClusters(applicationName) {
  var options = {
    joinCondition: function (nodeOptions) {
      return (nodeOptions.tags && nodeOptions.tags.ApplicationName == applicationName);
    },
    clusterNodeProperties: {
      id: 'cid_' + applicationName,
      borderWidth: 3,
      label: applicationName,
      shape: 'icon',
      icon: {
        face: 'fontello',
        code: '\ue804',
        size: 80,
        color: '#39cccc'
      },
      allowSingleNodeCluster: true
    }
  }
  // network.cluster(options); 
}

function showPopoverToEditNodeDetails(id, value) {
  var currentNode = nodes.get(value);
  if (id === 'label') {
    var inputValue = (currentNode[id] === undefined) ? '' : currentNode[id];
  } else {
    var inputValue = (currentNode.tags === undefined) ? '' : currentNode.tags[id];
  }
  $("#" + id).popover({
    placement: 'bottom',
    html: 'true',
    title: '<input type="text" name="' + id + '" value="' + inputValue + '">',
    content: '<a class="pull-right color-danger" onclick="$(&quot;#' + id + '&quot;).popover(&quot;hide&quot;);"><i class="fa fa-times" aria-hidden="true"></i></a>' +
      '<a class="pull-right color-success"><i class="fa fa-check" aria-hidden="true" onclick="changeCurrentNodeDetails(' + id + ')"></i></a>',
  });
  $('#' + id).popover('show');
}

//node
function showCurrentNodeDetails(currentNode, connectedEdges) {
  var Name = '-',
    appName = '-',
    type = '-',
    networkProperties = [],
    alerts = {
      critical: 0,
      major: 0
    };

  var currentNodeProperties = nodes.get(currentNode)[0];
  currentNodeProperties.id = currentNodeProperties.id.split('_')[0];
  if (currentNodeProperties.LoadBalancerIPAddresses) {
    var ipAddress = currentNodeProperties.LoadBalancerIPAddresses.join();
  } else {
    var ipAddress = currentNodeProperties.id || '-';
  }
  var instanceid = currentNodeProperties.instanceId || '-';
  if (['CIDR', 'GLOBAL-CIDR', 'EXTERNAL-NON-CIDR'].indexOf(currentNodeProperties.group) > -1) {
    var label = (currentNodeProperties.label || '-') + ' <a id="label" class="editNodeDetails" value="' + ipAddress + '"><i class="fa fa-pencil" aria-hidden="true"></i></a>';
  } else {
    var label = (currentNodeProperties.label || '-')
  }
  var sgs;
  var type = (currentNodeProperties.group === 'NON-CIDR' || currentNodeProperties.group === 'EXTERNAL-NON-CIDR') ? 'Server' : currentNodeProperties.group;
  var publicIPAddress = currentNodeProperties.publicIPAddress || '-';

  if (currentNodeProperties.tags) {
    // Name = (currentNodeProperties.tags.Name || '-') + ' <a id="Name"  class="editNodeDetails" value="'+ ipAddress +'"><i class="fa fa-pencil" aria-hidden="true"></i></a>';
    Name = (currentNodeProperties.tags.Name || '-');
    appName = ('<a id="byAppName" value=' + currentNodeProperties.tags.ApplicationName + ' >' + currentNodeProperties.tags.ApplicationName + '</a>' || '-');
    // appName = ('<a id="byAppName" value='+currentNodeProperties.tags.ApplicationName+' >'+currentNodeProperties.tags.ApplicationName+'</a>' || '-') + ' <a id="ApplicationName" class="editNodeDetails" value="'+ ipAddress +'"><i class="fa fa-pencil" aria-hidden="true"></i></a>';
  } else {
    Name = '-';
    // Name = '<a id="Name" class="editNodeDetails" value="'+ ipAddress +'"><i class="fa fa-pencil" aria-hidden="true"></i></a>' ;
    appName = '-';
    // appName = '<a id="ApplicationName" class="editNodeDetails" value="'+ ipAddress +'"><i class="fa fa-pencil" aria-hidden="true"></i></a>';
  }
  var scheme = (currentNodeProperties.Scheme) ? '<tr><td>Scheme:</td><td>' + currentNodeProperties.Scheme + '</td></tr>' : '';
  if (currentNodeProperties.securityGroups && currentNodeProperties.securityGroups.length > 0) {
    currentNodeProperties.securityGroups.forEach(function (sg) {
      sgs = sgs + "<tr><td>" + sg.securityGroupId + "</td><td><a onclick='onSecurityGrps(" + JSON.stringify(sg) + ")'>" + sg.securityGroupName + "</a></td></tr>";
    })
  }
  $.each(connectedEdges, function (i, item) {
    var edgeProperties = edges.get(item);
    if (edgeProperties.color && edgeProperties.color.color == "#dd4b39") {
      alerts.critical++;
    }
    if (edgeProperties.color && edgeProperties.color.color == "#f39c12") {
      alerts.major++;
    }
  });
  document.getElementById('server-details').style.display = 'block';
  document.getElementById('network-details').style.display = 'none';
  var totalAlerts = alerts.critical + alerts.major;
  $("#server-details-table").html('<tr><td>Private IP:</td><td>' + ipAddress + '</td></tr><tr><td>Id:</td><td>' + instanceid + '</td></tr><tr><td>Public IP:</td><td>' + publicIPAddress + '</td></tr><tr><td>Application:</td><td>' + appName + '</td></tr><tr><td>Type:</td><td>' + type + '</td></tr><tr><td>Name:</td><td>' + Name + '</td></tr><tr><td>Label:</td><td>' + label + '</td></tr>'+scheme+'<tr><td><span class="badge bg-red">Critical Alerts</span></td><td>' + alerts.critical + '</td></tr><tr><td><span class="badge bg-yellow">Major Alerts</span></td><td>' + alerts.major + '</td></tr>');
  $("#sg-details-table").html('<tr><th>Id</th><th>Name</th></tr>' + sgs)

  $('.editNodeDetails').click(function () {
    var id = $(this).attr('id');
    var value = $(this).attr('value');
    showPopoverToEditNodeDetails(id, value)
  })
}

function changeCurrentNodeDetails(value) {
  var fieldToChange = $(value).attr('id');
  var nodeToChange = $(value).attr('value');
  var newValue = $("input[name=" + fieldToChange + "]").val();
  var changedNode = nodes.get(nodeToChange);
  var data = {
    instanceId: nodeToChange,
    tag: fieldToChange,
    value: newValue
  }
  if (fieldToChange === 'label') {
    if (changedNode[fieldToChange] === newValue) {
      return false;
    }
    changedNode[fieldToChange] = newValue;
  } else {
    if (changedNode.tags === undefined) {
      changedNode.tags = {}
    }
    if (changedNode.tags[fieldToChange] === newValue) {
      return false;
    }
    changedNode.tags[fieldToChange] = newValue;
  }

  $.ajax({
    type: 'POST',
    url: "/editInstanceTags",
    data: data,
    timeout: 600000,
    success: function (result) {
      nodes.update(changedNode);
      var currentNode = [nodeToChange]
      var connectedEdges = network.getSelectedEdges(nodeToChange);
      showCurrentNodeDetails(currentNode, connectedEdges)
      hideOrShowAlerts('success', fieldToChange + ' successfully updated');
    },
    error: function (error) {
      hideOrShowAlerts('error', 'OOPS! failed to update label');
      return false
    }
  });
}

function clearPopUp() {
  document.getElementById('saveButton').onclick = null;
  document.getElementById('cancelButton').onclick = null;
  document.getElementById('node-popUp').style.display = 'none';
}



function changeLabel(lableId, selectId) {
  document.getElementById(lableId).value = document.getElementById(selectId).value;
}



//highlight
function saveDrawingSurface() {
  drawingSurfaceImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function restoreDrawingSurface() {
  ctx.putImageData(drawingSurfaceImageData, 0, 0);
}

function selectNodesFromHighlight() {
  var fromX, toX, fromY, toY;
  var nodesIdInDrawing = [];
  var xRange = getStartToEnd(rect.startX, rect.w);
  var yRange = getStartToEnd(rect.startY, rect.h);
  var allNodes = nodes.get();
  for (var i = 0; i < allNodes.length; i++) {
    var curNode = allNodes[i];
    var nodePosition = network.getPositions([curNode.id]);
    var nodeXY = network.canvasToDOM({
      x: nodePosition[curNode.id].x,
      y: nodePosition[curNode.id].y
    });
    if (xRange.start <= nodeXY.x && nodeXY.x <= xRange.end && yRange.start <= nodeXY.y && nodeXY.y <= yRange.end) {
      nodesIdInDrawing.push(curNode.id);
    }
  }
  network.selectNodes(nodesIdInDrawing);
}

function getStartToEnd(start, theLen) {
  return theLen > 0 ? {
    start: start,
    end: start + theLen
  } : {
    start: start + theLen,
    end: start
  };
}

function setDefaultLocale() {
  var defaultLocal = navigator.language;
  var select = document.getElementById('locale');
  select.selectedIndex = 0; // set fallback value
  for (var i = 0, j = select.options.length; i < j; ++i) {
    if (select.options[i].getAttribute('value') === defaultLocal) {
      select.selectedIndex = i;
      break;
    }
  }
}

function destroy() {
  if (network !== null) {
    network.destroy();
    network = null;
  }
}

function onAppChange(selectedApps) {
  resetTodefaults();
  document.getElementById('loader').style.display = 'block';
  $.post('/getSpecificApplication', {
    id: selectedApps
  }).done(function (out) {
    nodes = new vis.DataSet(out.nodes);
    edges = new vis.DataSet(out.links);
    // document.getElementById('appConnections').innerHTML = '';
    document.getElementById('appConnections').innerHTML = Number(out.statsCount.appConnections).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // document.getElementById('appConnections').innerHTML = Number(document.getElementById('appConnections').innerHTML) + Number(out.statsCount.appConnections);
    document.getElementById('appRecommendations').innerHTML = Number(out.statsCount.recommendationsLength).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // document.getElementById('appRecommendations').innerHTML = Number(document.getElementById('appRecommendations').innerHTML) + Number(out.statsCount.recommendationsLength);
    statistics = statistics.concat(out.statistics)
    data = {
      nodes: nodes,
      edges: edges
    };
    init(data, "appView");
    // init(data, "DCView");
    if ($("#apps").val().indexOf('All') != -1) {
      for (let index = 0; index < Apps.length; index++) {
        setTimeout(() => {
          makeClusters(Apps[index].applicationName)
        }, 0);
      }
    }
    document.getElementById('loader').style.display = 'none';
    if (selectedApps.indexOf('All') > -1) {
      document.getElementById("extendedReommendationsBlock").style.display = 'block';
      document.getElementById("generateRecommendationsBlock").style.display = 'none';
    } else {
      document.getElementById("extendedReommendationsBlock").style.display = 'block';
      document.getElementById("generateRecommendationsBlock").style.display = 'block';
    }
    // setTimeout(function(){
    //   showHideLinksBycolor()
    // },2000);
  }).fail(function () {
    console.log("AJAX call failed for navigating the fireliner features");
  });
}

function highlightNodes(searchValue) {
  var searchedNode = nodes.get({
    filter: function (node) {
      if (node.id == searchValue || node.instanceId === searchValue) {
        return node;
      }
    }
  });
  if (!searchedNode[0]) {
    var message = 'Server with ' + searchValue + ' does not exist! Try again'
    hideOrShowAlerts('error', message)
    return false
  }
  var searchedId = searchedNode[0].id;
  network.selectNodes([searchedId]);
  var selectednodes = network.getSelectedNodes(searchedId);
  var edgesOfSelectedNodes = network.getSelectedEdges(selectednodes);
  network.focus(selectednodes, {
    scale: network.getScale(selectednodes) + 0.6,
    animation: {
      duration: 1000,
    }
  })
  var currentNode = selectednodes;
  var connectedEdges = edgesOfSelectedNodes;

  showCurrentNodeDetails(currentNode, connectedEdges);
  return false;
}

function showRecommendations() {
  var fromto = edges.get({
    filter: function (item) {
      return (item.type == "recommendation");
    }
  });
  $.each(fromto, function (index) {
    if ($('#toogleRecommendations').is(":checked")) {
      fromto[index].hidden = false;
    } else {
      fromto[index].hidden = true;
    }

    // if(nids.indexOf(fromto[index].to)> -1 && nodes.get(fromto[index].to).group === 'NON-CIDR'){
    //   externalNodes.push({'id':fromto[index].from,'privateIPAddress':fromto[index].from,'group':'EXTERNAL-NON-CIDR','region':'unknown','user':'unknown','label':fromto[index].from})    
    // }
  });
  edges.update(fromto);
  // if ($('#toogleRecommendations').is(":checked")){
  //   nodes.update(externalNodes);
  // }else{
  //   nodes.remove(externalNodes);
  // }
}

function showHideLinksBycolor(color) {
  var fromto = edges.get({
    filter: function (item) {
      return (item.color.color == color);
    }
  });
  $.each(fromto, function (index) {
    fromto[index].hidden = true;

    // if(nids.indexOf(fromto[index].to)> -1 && nodes.get(fromto[index].to).group === 'NON-CIDR'){
    //   externalNodes.push({'id':fromto[index].from,'privateIPAddress':fromto[index].from,'group':'EXTERNAL-NON-CIDR','region':'unknown','user':'unknown','label':fromto[index].from})    
    // }
  });
  edges.update(fromto);
  // if ($('#toogleRecommendations').is(":checked")){
  //   nodes.update(externalNodes);
  // }else{
  //   nodes.remove(externalNodes);
  // }
}

function generateRecommendations() {
  $('#generateRecommendations').html('<i class="fa fa-circle-o-notch fa-spin"></i>Generating...');
  document.getElementById('generateRecommendations').disabled = true;
  var estimatedResponseTime = 150000
  var currentAppNodes = []
  nodes.get({
    filter: function (node) {
      if (node.id.split('/').length <= 1 && node.group === 'NON-CIDR') {
        currentAppNodes.push(node.id)
      }
    }
  });
  $.ajax({
    type: 'POST',
    url: "/generateRecommendations",
    data: {
      data: currentAppNodes
    },
    timeout: 600000,
    success: function (resultData) {
      var generatedRecommendations = resultData.data;
      generatedRecommendations.forEach(function (recommendation) {
        if (currentAppNodes.indexOf(recommendation.to) > -1) {
          externalNodes.push({
            'id': recommendation.from,
            'privateIPAddress': recommendation.from,
            'group': 'EXTERNAL-NON-CIDR',
            'region': 'unknown',
            'user': 'unknown',
            'label': recommendation.from
          })
        }
      })
      if (externalNodes.length > 0) {
        nodes.update(externalNodes);
      }
      $('#generatedRecommendationsDetails').html(' <tr><td>' + 'Total Recommendations' + '</td><td>' + resultData.data.length + '</td></tr> <tr><td>' + '#Inbound Connections' + '</td><td>' + externalNodes.length + '</td></tr> <tr><td>' + '#Outbound Connections' + '</td><td>' + 0 + '</td></tr>')
      $('#generateRecommendations').html('Done! Generate Again');
      $('#toogleRecommendations').prop('checked', true);
      document.getElementById('generateRecommendations').disabled = false;
      edges.update(resultData.data);
    },
    error: function (error) {
      var message = 'Failed to fetch recommendations from sumo logic';
      $('#generateRecommendations').html('Failed! Generate Again');
      document.getElementById('generateRecommendations').disabled = false;
      hideOrShowAlerts('error', message);
      return false
    }
  });
}

function getApplicationNames(Apps) {
  $.each(Apps, function (i, item) {
    $('#apps').append($('<option>', {
      "value": item.applicationName,
      "text": item.applicationName,
      "data-tokens": item.applicationName,
      "style": "display:none"
    }));
  });
  var currentApp = nodes.get({
    filter: function (node) {
      return node.group === 'NON-CIDR'
    }
  });
  document.getElementById('apps').value = currentApp[0].tags.ApplicationName;
}

function showOrHideApplicationsByRegionsOrLabel(type, name, value) {
  var regionNodes = nodes.get({
    filter: function (item) {
      return (name.indexOf(item[type]) > -1);
    }
  });
  $.each(regionNodes, function (index) {
    if (name.indexOf(regionNodes[index][type]) > -1) {
      regionNodes[index].hidden = !value;
    }
  });
  if (type === 'region') {
    $.each(Apps, function (i, item) {
      if (name.indexOf(item.region) > -1 && !value && !$("#apps option[value='" + item.applicationName + "']").is(':selected')) {
        $("#apps option[value='" + item.applicationName + "']").remove();
      } else if (name.indexOf(item.region) > -1 && !$("#apps option[value='" + item.applicationName + "']").is(':selected')) {
        $('#apps').append($('<option>', {
          "value": item.applicationName,
          "text": item.applicationName,
          "data-tokens": item.applicationName
        }));
      }
    });
  }
  nodes.update(regionNodes);
  // hideIsolatedNodes();
}

function hideIsolatedNodes() {
  var nodeIds = nodes.getIds();
  nodeIds.forEach(function (element) {
    var connectedEdges = network.getConnectedEdges(element);
    // var hiddenEdges = 
    var hidden = connectedEdges.map(function (e) {
      // console.log(edges.get(e))
      if (edges.get(e).hidden == true) {
        return edges.get(e);
      }
    })
    console.log(hidden)
    if (connectedEdges.length <= 0 || hidden.length <= 0) {
      nodes.update({
        id: element,
        hidden: true
      });
    }
  });

  // var nodesToHide = edges.get({
  //   filter: function (item) {
  //     if (nodes.get(item.to) != null && nodes.get(item.to).hidden === true) {
  //       return nodes.get(item.from);
  //     }
  //   }
  // });
  // $.each(nodesToHide, function (index) {
  //   nodesToHide[index].hidden = true;
  // });
  // nodes.update(nodesToHide);
}

function onSecurityGrps(sg) {
  $.ajax({
    type: 'GET',
    url: "/securitygrprules",
    data: {
      securityGroupId: sg.securityGroupId,
      securityGroupName: sg.securityGroupName
    },
    success: function (out) {
      $('#main-content').html(out);
    },
    error: function (error) {
      console.log("AJAX call failed for fetching security group rules");
    }
  });
}

function resetTodefaults() {
  $('#generateRecommendations').html('Refresh');
  document.getElementById('generateRecommendations').disabled = false;
  // $('#region1').prop('checked', true);
  document.getElementById('server-details').style.display = 'none';
  document.getElementById('network-details').style.display = 'none';
  $('#extendedAppView').prop('checked', false).change();
  $('#toogleRecommendations').prop('checked', false).change();
  $('#generatedRecommendationsDetails').html('');
  $('.region').prop('checked', true).change();
}

function showOrHideNodesByLabel(label, value) {
  var labelNodes = nodes.get({
    filter: function (item) {
      return (item.group === label);
    }
  });
  $.each(labelNodes, function (index) {
    if (labelNodes[index].group === label) {
      labelNodes[index].hidden = !value;
    }
  });
  nodes.update(labelNodes)
}


function restoreALL() {
  // $('#loader').show();
  $('#apps').select2({
    // maximumSelectionLength: 2;
  });

  $('[data-toggle="tooltip"]').tooltip();
  $('[data-toggle="popover"]').popover();
  statistics = statistics.concat(Statistics)
  init(data, "DCView");
  // onAppChange();
  resetTodefaults();
  getApplicationNames(Apps);

  $('#apps').on("select2:select", function (e) {
    var selectedApps = $("#apps").val();
    onAppChange(selectedApps)
  });
  $('#apps').on("select2:unselect", function (e) {
    var selectedApps = $("#apps").val();
    if (selectedApps.length < 1) {
      $("#apps").select2("val", [e.params.data.id]);
      return false;
    }
    onAppChange(selectedApps)
  });
  $('#byAppName').click(function () {
    console.log($(this).attr('id'))
  });

  $("#troubleshootMode").change(function () {
    var value = $(this).is(":checked");
    troubleshootMode(value);
    // $('#extendedAppView').prop('checked',value).change();
  });
  $("#exitTroubleshootMode").click(function () {
    // troubleshootMode(false);
    $('#troubleshootMode').prop('checked', false).change();
  });

  $("#toogleRecommendations").change(function () {
    var value = $(this).is(":checked");
    showRecommendations();
    // $('#extendedAppView').prop('checked',value).change();
  });

  $("#extendedAppView").change(function () {
    var region = ['EXTERNAL-NON-CIDR', 'EXTENDED-NON-CIDR']
    var value = $(this).is(":checked");
    if (value) {
      region.forEach(function (r) {
        $('#' + r + '-label').css('text-decoration', 'none');
        $('#' + r).attr('value', 'show');
      })
    } else {
      region.forEach(function (r) {
        $('#' + r + '-label').css('text-decoration', 'Line-Through');
        $('#' + r).attr('value', 'hide');
      })
    }
    showOrHideApplicationsByRegionsOrLabel('group', region, value);
  });

  $("#generateRecommendations").click(function () {
    generateRecommendations();
  });

  $('#stopSimulation').click(function () {
    network.stopSimulation();
  })

  $('.region').click(function () {
    var region = [$(this).attr('value')];
    var value = $(this).is(":checked");
    showOrHideApplicationsByRegionsOrLabel('region', region, value);
  });

  $('.network-label').click(function () {
    var label = $(this).attr('id');
    var value;
    var hidden = [];
    $('.network-label').each(function () {
      if (this.value === 'hide') {
        hidden.push(this.id);
      }
    });
    if ($(this).attr('value') === 'show') {
      value = false;
      $('#' + label + '-label').css('text-decoration', 'Line-Through');
      $(this).attr('value', 'hide');
      hidden.push(label);
    } else {
      $(this).attr('value', 'show');
      $('#' + label + '-label').css('text-decoration', 'none');
      value = true;
      hidden.splice(hidden.indexOf(label), 1)
    }
    if (hidden.indexOf('EXTENDED-NON-CIDR') > -1 && hidden.indexOf('EXTERNAL-NON-CIDR') > -1 && $('#extendedAppView').is(":checked")) {
      $('#extendedAppView').prop('checked', false);
    }
    if (hidden.indexOf('EXTENDED-NON-CIDR') < 0 && hidden.indexOf('EXTERNAL-NON-CIDR') < 0) {
      $('#extendedAppView').prop('checked', true);
    }
    $(this).prop('checked', !value);
    showOrHideApplicationsByRegionsOrLabel('group', [label], value);
  });

  $('#notifi-close-btn').on('click', function () {
    $('.notification').hide();
  });

  $("#searchNodes").keyup(function (event) {
    if (event.keyCode === 13) {
      var searchVal = $("#searchNodes").val();
      highlightNodes(searchVal);
    }
  });

  $("#searchNodesBtn").on('click', function () {
    var searchVal = $("#searchNodes").val();
    highlightNodes(searchVal);
  });

  $(document).on('click', function (e) {
    $('[data-toggle="popover"],[data-original-title]').each(function () {
      //the 'is' for buttons that trigger popups
      //the 'has' for icons within a button that triggers a popup
      if (!$(this).is(e.target) && $(this).has(e.target).length === 0 && $('.popover').has(e.target).length === 0) {
        (($(this).popover('hide').data('bs.popover') || {}).inState || {}).click = false // fix for BS 3.3.6
      }
    });
  });
  $.getJSON("/scripts/portsanddesc.json", function (json) {
    // console.log(json); // this will show the info it in firebug console
    portsData = json;
    // console.log(portsData);
  });
  // $('#chat-box').slimScroll({
  //   height: '250px'
  // });


  // $('#datasources').collapse({
  //   toggle: false
  // });
  $('#troubleshootModeBlock').hide();
  // troubleshootMode(true);
  document.getElementById('appConnections').innerHTML = StatsCount.appConnections.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");;
  document.getElementById('appRecommendations').innerHTML = StatsCount.recommendationsLength.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");;
}

$(document).ready(function () {
  restoreALL();
});

$(window).ready(function () {
  $('#loading').hide();
});


//on or off troubleshootmode
function troubleshootMode(value) {
  if (value) {
    $('body').removeClass('skin-blue');
    $('body').addClass('skin-yellow');
    window.scrollTo(0, document.body.scrollHeight);
    troubleShootMode = !troubleShootMode;
    $('#troubleshootModeBlock').show();
    // saveStateOfApp(true);
    var troubleshootLogs = {
      id: makeid(userId),
      user: userId,
      stateChanges: [

      ]
    };
    tsmode.setLogs(troubleshootLogs);
    tsmode.setStateLogs({
      updatedTime: new Date(),
      title: 'State Saved',
      description: 'Initial state of the application is saved',
      action: 'save',
      revert: true,
      changeLogs: [

      ]
    })
    $("#saveStateOfApp").on('click', function () {
      saveStateOfApp()
    });
    // $("#analyseFlowLogs").on('click', function () {
    //   analyseFlowLogs()
    // });
  } else {
    $('body').addClass('skin-blue');
    $('body').removeClass('skin-yellow');
    $('html,body').scrollTop(0);
    $('#troubleshootModeBlock').hide();
    tsmode.setLogs('');
    troubleShootMode = !troubleShootMode;
    $('#changeLogsBlock').html('');
    $('#stateChangeBlock').html('');
  }
}

function saveStateOfApp() {
  var currentChangeLogs = tsmode.getLogs();
  console.log(currentChangeLogs);
  $.ajax({
    type: 'POST',
    url: "/troubleshoot/commitChanges",
    data: {
      data: currentChangeLogs
    },
    timeout: 300000,
    beforeSend: function () {

    },
    success: function (resultData) {

    },
    error: function (error) {

    }
  });
  // var changeLog = {
  //   updatedTime: new Date(),
  //   title: 'State Saved',
  //   description: 'State of the application has been saved',
  //   action: 'save',
  //   revert: true,
  //   changeLogs: [

  //   ]
  // }
  // tsmode.setStateLogs(changeLog);
}

function updateChangeLogs(log) {
  var logIcons = {
    save: 'fa-floppy-o',
    revert: 'fa-refresh',
    add: 'fa-plus-square-o ',
    edit: 'fa-pencil-square-o',
    delete: 'fa-trash-o'
  }
  var iconColor = {
    save: 'color-success',
    add: 'color-primary',
    delete: 'color-danger'
  }
  var changeLog = '<div class="item"><i aria-hidden="true" class="fa ' + logIcons[log.action] + ' ' + iconColor[log.action] + '"></i>' +
    // '<p class="message"><small class="text-muted pull-right"><i class="fa fa-clock-o"></i> 5:15</small>' + log.description + '</p>' +
    '<small class="message">' + log.description + '</small>' +
    '</div>'
  $('#changeLogsBlock').append(changeLog);
}

function updateStateChange(log, id) {
  var stateChangeLog = '<li class="time-label"><span class="bg-yellow">' + id + '_' + log.stateChangeId + '</span></li>' +
    // '<li><i class="fa fa-caret-square-o-up bg-blue"></i><div class="timeline-item"><span class="time"><i class="fa fa-clock-o"></i> 12:05</span>' +
    '<li><i class="fa fa-caret-square-o-up bg-blue"></i><div class="timeline-item">' +
    '<h3 class="timeline-header"><a>' + log.title + '</a> </h3>' +
    '<div class="timeline-body">' + log.description + '</div>' +
    '<div class="timeline-footer"><a class="btn btn-primary btn-xs" disabled=' + !log.revert + '>Get back to this state</a></div>' +
    '</div>' +
    '</li>'
  $('#stateChangeBlock').append(stateChangeLog);
}

function analyseFlowLogs() {
  $('#analyseFlowLogs').html('<i class="fa fa-circle-o-notch fa-spin"></i> Fetching flow logs ...');
  setTimeout(function () {
    $('#analyseFlowLogsBlock').show(500);
    $('#analyseFlowLogs').html('Flow logs fetched');
  }, 2000)
}

function makeid(id) {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" + id.split('-').join('');

  for (var i = 0; i < 10; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}
var tsmode = {
  logs: '',
  setLogs: function (value) {
    this.logs = value
  },
  getLogs: function () {
    return this.logs;
  },
  setStateLogs: function (data) {
    var currentLength = this.logs.stateChanges.length;
    data.stateChangeId = currentLength + 1;
    this.logs.stateChanges.push(data);
    updateStateChange(data, this.logs.id);
    updateChangeLogs(data);
    $('#saveStateOfApp').prop('disabled', true);
  },
  setChangeLogs: function (data) {
    var currentLength = this.logs.stateChanges[this.logs.stateChanges.length - 1].changeLogs.length;
    data.changeId = currentLength + 1;
    this.logs.stateChanges[this.logs.stateChanges.length - 1].changeLogs.push(data);
    updateChangeLogs(data);
    $('#saveStateOfApp').prop('disabled', false);
  }
}
// var data = {
//   _externalNodes : [],
//   _externalLinks : [],
//   get : function( name ){ return this[ '_' + name ]; },
//   set : function( name, value ){ this[ '_' + name ] = value; }
// }


// window.onbeforeunload = function (event) {
//   var message = 'Important: Please click on \'Save\' button to leave this page.';
//   if (typeof event == 'undefined') {
//       event = window.event;
//   }
//   if (event) {
//       event.returnValue = message;
//   }
//   return message;
// };

// $(function () {
//   $("a").not('#lnkLogOut').click(function () {
//       window.onbeforeunload = null;
//   });
//   $(".btn").click(function () {
//       window.onbeforeunload = null;
// });
// });


function httpRequest(url,data) {
  return new Promise(function(resolve,reject){
    $.ajax({
      type: 'POST',
      url: url,
      data: {
        data: data,
        userId: JSON.parse(userData).preferred_username
      },
      beforeSend: function () {
        $('#loader').show();
      },
      success: function (response) {
        $('#loader').hide();
        hideOrShowAlerts(response.status, response.message);
        // cb(null,response)
        return resolve(response)
      },
      error: function (error) {
        $('#loader').hide();
        hideOrShowAlerts('warning', error.message);
        return reject(error);
        // cb(error)
      }
    });
  })
}