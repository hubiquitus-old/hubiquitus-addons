/**
 * @module gateway
 */

var hubiquitus = require('hubiquitus-core');
var logger = hubiquitus.logger;
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

    setTimeout(function () {
      logger.warn('gateway authentication delay timeout !');
      logout(socket);
    }, loginTimeout);

    socket.on('data', function (data) {
      var message;
      try {
        message = JSON.parse(data);
      } catch (err) {
        return logger.warn('gateway failed to parse incomming message', data);
      }
      if (message && message.type) {
        switch (message.type) {
          case 'message':
            socket.identity ? processMessage(socket, message) : enqueueMessage(socket, message);
            break;
          case 'response':
            socket.identity && processResponse(message);
            break;
          case 'login':
            processLogin(socket, message.login);
            break;
          default:
            logger.warn('gateway received unknown message type', message);
        }
      } else {
        logger.warn('gateway received malformat data', message);
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
        socket.identity = identity;
        _this.emit('connected', socket.identity);
        processQueue(socket);
        hubiquitus.addActor(socket.identity, session, {socket: socket});
      } else {
        logger.warn('gateway login error', err);
      }
    });
  }

  function processMessage(socket, message) {
    if (tv4.validate(message, schemas.message)) {
      logger.trace('gateway processing message', message);
      hubiquitus.send(message.from || socket.identity, message.to, message.payload.content, function (err, content) {
        if (err === 'TIMEOUT') return; // timeout is delegated to client side
        var response = {id: message.id, from: message.to, to: socket.identity, payload: {err: err, content: content}, type: 'response'};
        socket.write(JSON.stringify(response));
      });
    } else {
      logger.warn('gateway received malformat message', {err: tv4.error, message: message});
    }
  }

  function processResponse(response) {
    logger.trace('gateway processing response', response);
    if (tv4.validate(response, schemas.message)) {
      events.emit('response|' + response.id, response);
    } else {
      logger.warn('gateway received malformat message', {err: tv4.error, response: response});
    }
  }

  function enqueueMessage(socket, message) {
    socket.queue = socket.queue || [];
    socket.queue.push(message);
  }

  function processQueue(socket) {
    if (!socket.queue) return;
    logger.trace('gateway processing ' + socket.identity + ' queue (' + socket.queue.length + ' elements)');
    socket.queue && _.forEach(socket.queue, function (message) {
      processMessage(socket, message);
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
    logger.trace('gateway error', err);
    _this.emit('error', err);
  });

  server.on('listening', function () {
    logger.trace('gateway started');
    _this.emit('started');
  });

  server.on('close', function () {
    logger.trace('gateway stopped');
    _this.emit('stopped');
  });

  server.listen(params.port || defaultPort);
};

/* basic implementations */

function basicLogin(socket, username, cb) {
  if (_.isString(username) && !_.isEmpty(username)) {
    cb && cb(null, username);
  } else {
    cb && cb('invalid identifier ' + username);
  }
}

function basicSession(from, content, reply) {
  var msgid = hubiquitus.utils.uuid();
  reply && events.once('response|' + msgid, function (response) {
    reply(response.payload.err, response.from, response.payload.content);
  });
  var message = {id: msgid, from: from, to: this.socket.identity, payload: {content: content}, type: 'message'};
  this.socket.write(JSON.stringify(message));
}
