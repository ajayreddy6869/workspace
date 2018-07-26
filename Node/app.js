var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var session = require('cookie-session')
var bodyParser = require('body-parser');
var passport = require('passport');
var flash = require('connect-flash');
var favicon = require('serve-favicon');
var expressSession = require('express-session');
var methodOverride = require('method-override');
var auditLogsModel = require("./schemas/auditLogs");

// Database
// set up database for express session
var MongoStore = require('connect-mongo')(expressSession);
var mongoose = require("mongoose");
var config = require('./config');
const option = {
	socketTimeoutMS: 30000,
	keepAlive: true,
	reconnectTries: 30000
};

// mongoose.connect('mongodb://10.148.71.161/firelinerdb');
//mongoose.connect('mongodb://localhost/firelinerdb',option);
 mongoose.connect('mongodb://localhost/firelinersandboxdb');

var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

/** GLOBAL VARIABLES**/
//apps root. will be used in other files in the app loaded from this file
// root = __dirname;
global.FREETRIAL_DAYS = 15;
global.root=__dirname;
global.LOGGER = require(__dirname+"/utils/logger");
global.lambdaConfig = {
	"lambdaUrls" : {
		"lambdafunctions" : {
			"EC2List" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/ListEC2",
			"ClassicELBList" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/ListClassicELBs",
			"ListVPCs" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/ListVPCs",
			"ListSubnets" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/ListSubnets",
			"ListNACLs" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/ListNACLs",
			"ListSecurityGroups" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/ListSecurityGroups",
			"AddSecurityGroupRule" : "https://ghka1jnhvc.execute-api.us-west-1.amazonaws.com/prod/AddSecurityGroupRule",
			"AddOrDeleteRuleToSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/AddOrDeleteRuleToSecurityGroup",
			"AttachOrDetachSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/AttachOrDetachSecurityGroup",
			"CreateSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/CreateSecurityGroup",
			"CreateTagsForSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/CreateTagsForSecurityGroup",
			"CloneSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/CopySecurityGroup",
			"DeleteSecurityGroup" : "https://ghka1jnhvc.execute-api.eu-west-2.amazonaws.com/prod/DeleteSecuityGroup ",
		}
	}
};

/*global.LOGGER = {};
global.LOGGER.get = function(name)
{
  return console;
};
*/
var logger = LOGGER.get('default');

//Initialize scheduler and reload all schedules from DB
logger.info("Initializing the scheduler...");
var initScheduler = require("./models/InitScheduler");
initScheduler.initScheduler(function(err){
  if(err)
  {
    logger.error("Scheduler initialize failed:"+err.message);
    logger.error(err.stack.split("\n"));
  }
  else
  {
    logger.info("Scheduler initialize success");
  }
});

var routes = require('./routes/index');
var users = require('./routes/users');
var torubleshoot = require('./routes/torubleshoot');
require('./models/lambdaClient');

process.on('uncaughtException', function(err){
	  logger.error('uncaughtException:'+err.message);
	  logger.error(err, err.stack.split("\n"));
	});


	/******************************************************************************
	 * Set up passport in the app
	 ******************************************************************************/

	//-----------------------------------------------------------------------------
	// To support persistent login sessions, Passport needs to be able to
	// serialize users into and deserialize users out of the session.  Typically,
	// this will be as simple as storing the user ID when serializing, and finding
	// the user by ID when deserializing.
	//-----------------------------------------------------------------------------
	passport.serializeUser(function(user, done) {
	  done(null, user.oid);
	});

	passport.deserializeUser(function(oid, done) {
	  findByOid(oid, function (err, user) {
	    done(err, user);
	  });
	});

	// array to hold logged in users
	var users = [];

	var findByOid = function(oid, fn) {
	  for (var i = 0, len = users.length; i < len; i++) {
	    var user = users[i];
	   logger.info('we are using user: ', user);
	    if (user.oid === oid) {
	      return fn(null, user);
	    }
	  }
	  return fn(null, null);
	};

	//-----------------------------------------------------------------------------
	// Use the OIDCStrategy within Passport.
	//
	// Strategies in passport require a `verify` function, which accepts credentials
	// (in this case, the `oid` claim in id_token), and invoke a callback to find
	// the corresponding user object.
	//
	// The following are the accepted prototypes for the `verify` function
	// (1) function(iss, sub, done)
	// (2) function(iss, sub, profile, done)
	// (3) function(iss, sub, profile, access_token, refresh_token, done)
	// (4) function(iss, sub, profile, access_token, refresh_token, params, done)
	// (5) function(iss, sub, profile, jwtClaims, access_token, refresh_token, params, done)
	// (6) prototype (1)-(5) with an additional `req` parameter as the first parameter
	//
	// To do prototype (6), passReqToCallback must be set to true in the config.
	//-----------------------------------------------------------------------------
	passport.use(new OIDCStrategy({
	    identityMetadata: config.creds.identityMetadata,
	    clientID: config.creds.clientID,
	    responseType: config.creds.responseType,
	    responseMode: config.creds.responseMode,
	    redirectUrl: config.creds.redirectUrl,
	    allowHttpForRedirectUrl: config.creds.allowHttpForRedirectUrl,
	    clientSecret: config.creds.clientSecret,
	    validateIssuer: config.creds.validateIssuer,
	    isB2C: config.creds.isB2C,
	    issuer: config.creds.issuer,
	    passReqToCallback: config.creds.passReqToCallback,
	    scope: config.creds.scope,
	    loggingLevel: config.creds.loggingLevel,
	    nonceLifetime: config.creds.nonceLifetime,
	    nonceMaxAmount: config.creds.nonceMaxAmount,
	    useCookieInsteadOfSession: config.creds.useCookieInsteadOfSession,
	    cookieEncryptionKeys: config.creds.cookieEncryptionKeys,
	    clockSkew: config.creds.clockSkew,
	  },
	  function(iss, sub, profile, accessToken, refreshToken, done) {
	    if (!profile.oid) {
	      return done(new Error("No oid found"), null);
	    }
	    // asynchronous verification, for effect...
	    process.nextTick(function () {
	      findByOid(profile.oid, function(err, user) {
	        if (err) {
	          return done(err);
	        }
	        if (!user) {
	          // "Auto-registration"
	          users.push(profile);
	          return done(null, profile);
	        }
	        return done(null, user);
	      });
	    });
	  }
	));

var app = express();

// view engine setup
app.set('views', path.join(__dirname, './public/views'));
app.set('view engine', 'jade');

//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride());
app.use(cookieParser());

// app.use(session({ keys: [ 'secret1', 'secret2', 'secret3' ] }))
// set up session middleware
// if (false) {
// if (config.useMongoDBSessionStore) {
//   mongoose.connect(config.databaseUri);
//   app.use(express.session({
//     secret: 'secret',
//     cookie: {maxAge: config.mongoDBSessionMaxAge * 1000},
//     store: new MongoStore({
//       mongooseConnection: mongoose.connection,
//       clear_interval: config.mongoDBSessionMaxAge
//     })
//   }));
// } else {
  app.use(expressSession({ secret: 'keyboard cat', resave: true, saveUninitialized: false }));
// }
app.use(express.static(path.join(__dirname, 'public')));
app.use(favicon(path.join(__dirname, 'public', 'favicon.gif')));


// Make our db accessible to our router
// app.use(function(req,res,next){
//     req.db = db;
//     next();
// });

app.use(passport.initialize());
app.use(passport.session());

// var initPassport = require("./passport/strategy");
//
// initPassport(passport);

//-----------------------------------------------------------------------------
// Set up the route controller
//
// 1. For 'login' route and 'returnURL' route, use `passport.authenticate`.
// This way the passport middleware can redirect the user to login page, receive
// id_token etc from returnURL.
//
// 2. For the routes you want to check if user is already logged in, use
// `ensureAuthenticated`. It checks if there is an user stored in session, if not
// it will call `passport.authenticate` to ask for user to log in.
//-----------------------------------------------------------------------------
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  res.redirect('/login');
};

// '/account' is only available to logged in user
app.get('/account', ensureAuthenticated, function(req, res) {
  res.render('account', { user: req.user });
});

app.get('/login',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
      {
        response: res,                      // required
        resourceURL: config.resourceURL,    // optional. Provide a value if you want to specify the resource.
        customState: 'my_state',            // optional. Provide a value if you want to provide custom state value.
        failureRedirect: '/'
      }
    )(req, res, next);
  },
  function(req, res) {
    logger.info('Login was called in the Sample');
    res.redirect('/');
});

// 'GET returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// query (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.get('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
      {
        response: res,                      // required
        failureRedirect: '/'
      }
    )(req, res, next);
  },
  function(req, res) {
    logger.info('We received a return from AzureAD.');
    res.redirect('/');
  });

// 'POST returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// body (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.post('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
      {
        response: res,                      // required
        failureRedirect: '/'
      }
    )(req, res, next);
  },
  function(req, res) {
		logger.info('We received a return from AzureAD.');
		if(req.user && req.user._raw){
			saveUser(req);
		}
    res.redirect('/');
  });

	var saveUser = function (req) {
		try {      
			var user = JSON.parse(req.user._raw);
			var auditDetails = {};
			auditDetails.username =  user.preferred_username || null;
			auditDetails.name = user.name || null;
			var newAuditLog = new auditLogsModel(auditDetails);
			newAuditLog.save(); 			  
		}
		catch (exception) {
			console.log(exception);
		}
	}

// 'logout' route, logout from passport, and destroy the session with AAD.
app.get('/logout', function(req, res){
	console.log(req);
  req.session.destroy(function(err) {
    req.logOut();
    res.redirect(config.destroySessionUrl);
  });
});

app.use('/', routes);
app.use('/troubleshoot', torubleshoot);
// app.use('/users', users);
app.use(flash());

/// catch 404 and forwarding to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
