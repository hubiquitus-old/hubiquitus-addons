/**
 * @module gateway
 */

var hubiquitus = require('hubiquitus-core');
var logger = hubiquitus.logger('hubiquitus:addons:gateway');
var sockjs = require('sockjs');
var http = require('http');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var tv4 = require('tv4');
var schemas = require('./schemas');

var events = new EventEmitter();
events.setMaxListeners(0);

var defaultPort = 8888;
var defaultPath = '/hubiquitus';
var loginTimeout = 30000;

/**
 * Create a gateway
 * @param [session] {function} session actor
 * @param [login] {function} loginentication function
 * @returns {Gateway}
 */
exports.createGateway = function (session, login) {
  if (!_.isFunction(session)) {
    logger.warn('invalid session actor; use default implementation instead');
    session = null;
  }
  if (!_.isFunction(login)) {
    logger.warn('invalid login procedure; use default implementation instead');
    login = null;
  }
  return new Gateway(login, session);
};

/**
 * Gateway constructor
 * @param [login] {function} loginentication function
 * @param [session] {function} session actor
 * @constructor
 */
function Gateway(session, login) {
  EventEmitter.call(this);

  var _this = this;

  login = login || basicLogin;
  session = session || basicSession;

  _this.sock = sockjs.createServer();

  _this.sock.on('connection', function (sock) {
    logger.debug('connection from ' + sock.remoteAddress + ' (using ' + sock.protocol + ')');

    sock.loginTimeout = setTimeout(function () {
      logger.warn('authentication delay timeout !');
      logout(sock);
    }, loginTimeout);

    sock.on('data', function (data) {
      var msg = decode(data);
      if (msg && msg.type) {
        switch (msg.type) {
          case 'req':
            sock.identity ? processReq(sock, msg) : enqueueReq(sock, msg);
            break;
          case 'res':
            sock.identity && processRes(sock, msg);
            break;
          case 'login':
            processLogin(sock, msg.authData);
            break;
          default:
            logger.warn('received unknown message type', msg);
        }
      } else {
        logger.warn('received malformat data', msg);
      }
    });

    sock.on('close', function () {
      logout(sock);
    });
  });

  function processLogin(sock, data) {
    if (sock.identity) logout(sock);
    login(sock, data, function (err, identity) {
      if (!err) {
        sock.identity = identity + '/' + hubiquitus.utils.uuid();
        clearTimeout(sock.loginTimeout);
        logger.debug('login success from ' + sock.remoteAddress + '; identifier : ' + identity);
        var feedBack = {type: 'login', content: {id: sock.identity}};
        sock.write(encode(feedBack));
        _this.emit('connected', sock.identity);
        processQueue(sock);
        hubiquitus.addActor(sock.identity, session, {sock: sock});
      } else {
        logger.warn('login error', err);
        logout(sock);
      }
    });
  }

  function processReq(sock, req) {
    if (tv4.validate(req, schemas.message)) {
      logger.trace('processing request', req);
      var cb = null;
      if (req.cb) cb = function (err, res) {
        if (err === 'TIMEOUT') return; // timeout is delegated to client side
        res.id = req.id;
        res.type = 'res';
        sock.write(encode(res));
      };
      hubiquitus.send(sock.identity, req.to, req.content, cb);
    } else {
      logger.warn('received malformat request', {err: tv4.error, req: req});
    }
  }

  function processRes(sock, res) {
    logger.debug('processing response', res);
    if (tv4.validate(res, schemas.message)) {
      events.emit('res|' + sock.identity + '|' + res.id, res);
    } else {
      logger.warn('received malformat response', {err: tv4.error, res: res});
    }
  }

  function enqueueReq(sock, req) {
    sock.queue = sock.queue || [];
    sock.queue.push(req);
  }

  function processQueue(sock) {
    if (!sock.queue) return;
    logger.debug('processing ' + sock.identity + ' queue (' + sock.queue.length + ' elements)');
    sock.queue && _.forEach(sock.queue, function (req) {
      processReq(sock, req);
    });
  }

  function logout(sock) {
    _this.emit('disconnected', sock.identity);
    sock.identity && hubiquitus.removeActor(sock.identity);
    sock.close();
  }
}

util.inherits(Gateway, EventEmitter);

/**
 * Start the gateway
 * @param [server] {Server} server
 * @param [params] {object} parameters
 */
Gateway.prototype.start = function (server, params) {
  var _this = this;
  params = params || {};
  server = server || http.createServer();
  _this.sock.installHandlers(server, {prefix: params.path || defaultPath});

  server.on('error', function (err) {
    logger.debug('error', err);
    _this.emit('error', err);
  });

  server.on('listening', function () {
    logger.debug('started');
    _this.emit('started');
  });

  server.on('close', function () {
    logger.debug('stopped');
    _this.emit('stopped');
  });

  server.listen(params.port || defaultPort);
};

/* basic implementations */

function basicLogin(sock, data, cb) {
  if (_.isString(data.username) && !_.isEmpty(data.username)) {
    cb && cb(null, data.username);
  } else {
    cb && cb('invalid identifier ' + data.username);
  }
}

function basicSession(req) {
  var reply = req.reply;
  delete req.reply;
  reply && events.once('res|' + this.sock.identity + '|' + req.id, function (res) {
    reply(res.err, res.content);
  });
  req.to = this.sock.identity;
  req.type = 'req';
  this.sock.write(encode(req));
}

/* encoding & decoding */

function encode(data) {
  var encodedData = null;
  try {
    encodedData = JSON.stringify(data);
  } catch (err) {
    logger.warn('failed encoding data', data);
  }
  return encodedData;
}

function decode(data) {
  var decodedData = null;
  try {
    decodedData = JSON.parse(data);
  } catch (err) {
    logger.warn('failed decoding data', data);
  }
  return decodedData;
}
