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

  _this.sock.on('connection', function (socket) {
    logger.debug('connection from ' + socket.remoteAddress + ' (using ' + socket.protocol + ')');

    socket.loginTimeout = setTimeout(function () {
      logger.warn('authentication delay timeout !');
      logout(socket);
    }, loginTimeout);

    socket.on('data', function (data) {
      var msg = decode(data);
      if (msg && msg.type) {
        switch (msg.type) {
          case 'req':
            socket.identity ? processReq(socket, msg) : enqueueReq(socket, msg);
            break;
          case 'res':
            socket.identity && processRes(msg);
            break;
          case 'login':
            processLogin(socket, msg.authData);
            break;
          default:
            logger.warn('received unknown message type', msg);
        }
      } else {
        logger.warn('received malformat data', msg);
      }
    });

    socket.on('close', function () {
      logout(socket);
    });
  });

  function processLogin(socket, data) {
    if (socket.identity) logout(socket);
    login(socket, data, function (err, identity) {
      if (!err) {
        socket.identity = identity + '/' + hubiquitus.utils.uuid();
        clearTimeout(socket.loginTimeout);
        logger.debug('login success from ' + socket.remoteAddress + '; identifier : ' + identity);
        var feedBack = {type: 'login', content: {id: socket.identity}};
        socket.write(encode(feedBack));
        _this.emit('connected', socket.identity);
        processQueue(socket);
        hubiquitus.addActor(socket.identity, session, {socket: socket});
      } else {
        logger.warn('login error', err);
        logout(socket);
      }
    });
  }

  function processReq(socket, req) {
    if (tv4.validate(req, schemas.message)) {
      logger.trace('processing request', req);
      hubiquitus.send(socket.identity, req.to, req.content, function (err, res) {
        if (err === 'TIMEOUT') return; // timeout is delegated to client side
        res.id = req.id;
        res.type = 'res';
        socket.write(encode(res));
      });
    } else {
      logger.warn('received malformat request', {err: tv4.error, req: req});
    }
  }

  function processRes(res) {
    logger.debug('processing response', res);
    if (tv4.validate(res, schemas.message)) {
      events.emit('res|' + res.id, res);
    } else {
      logger.warn('received malformat response', {err: tv4.error, res: res});
    }
  }

  function enqueueReq(socket, req) {
    socket.queue = socket.queue || [];
    socket.queue.push(req);
  }

  function processQueue(socket) {
    if (!socket.queue) return;
    logger.debug('processing ' + socket.identity + ' queue (' + socket.queue.length + ' elements)');
    socket.queue && _.forEach(socket.queue, function (req) {
      processReq(socket, req);
    });
  }

  function logout(socket) {
    _this.emit('disconnected', socket.identity);
    socket.identity && hubiquitus.removeActor(socket.identity);
    socket.close();
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

function basicLogin(socket, data, cb) {
  if (_.isString(data.username) && !_.isEmpty(data.username)) {
    cb && cb(null, data.username);
  } else {
    cb && cb('invalid identifier ' + data.username);
  }
}

function basicSession(req) {
  var msgid = hubiquitus.utils.uuid();
  req.reply && events.once('res|' + msgid, function (res) {
    req.reply(res.err, res.content);
  });
  var msg = {id: msgid, from: req.from, to: this.socket.identity, content: req.content, type: 'req'};
  this.socket.write(encode(msg));
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
