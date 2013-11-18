/**
 * @module gateway
 */

var hubiquitus = require("hubiquitus-core");
var logger = hubiquitus.logger;
var sockjs = require("sockjs");
var http = require("http");
var util = require("util");
var EventEmitter = require("events").EventEmitter;
var _ = require("lodash");
var tv4 = require("tv4");
var schemas = require("./schemas");

var events = new EventEmitter();
events.setMaxListeners(0);

var defaultPort = 8888;
var defaultPath = "/";
var authTimeout = 30000;

/**
 * Create a gateway
 * @param [session] {function} session actor
 * @param [auth] {function} authentication function
 * @returns {Gateway}
 */
exports.createGateway = function (session, auth) {
  if (!_.isFunction(session)) {
    logger.warn("invalid session actor; use default implementation instead");
    session = null;
  }
  if (!_.isFunction(auth)) {
    logger.warn("invalid authentication procedure; use default implementation instead");
    auth = null;
  }
  return new Gateway(auth, session);
};

/**
 * Gateway constructor
 * @param [auth] {function} authentication function
 * @param [session] {function} session actor
 * @constructor
 */
function Gateway(session, auth) {
  EventEmitter.call(this);

  var _this = this;

  auth = auth || basicAuth;
  session = session || basicSession;

  _this.io = sockjs.createServer();

  _this.io.on("connection", function (socket) {

    setTimeout(function () {
      !socket.identity && socket.disconnect();
    }, authTimeout);

    socket.on("auth", function (data) {
      auth(socket, data);
      if (socket.identity) {
        processQueue(socket);
        hubiquitus.addActor(socket.identity, session, {socket: socket});
      }
    });

    socket.on("message", function (message) {
      socket.identity
        ? processMessage(socket, message)
        : enqueueMessage(socket, message);
    });

    socket.on("response", function (message) {
      socket.identity && processResponse(message);
    });

    socket.on("disconnect", function () {
      socket.identity && hubiquitus.removeActor(socket.identity);
    });
  });

  function processMessage(socket, message) {
    if (tv4.validate(message, schemas.message)) {
      hubiquitus.send(socket.identity, message.to, message.payload.content, message.timeout, function (err, from, content) {
        if (err === "TIMEOUT") return; // timeout is delegated to client side
        socket.emit("response", {id: message.id, from: from, to: socket.identity, payload: {err: err, content: content}});
      });
    } else {
      logger.warn("gateway received malformat message", {err: tv4.error, message: message});
    }
  }

  function processResponse(response) {
    if (tv4.validate(response, schemas.message)) {
      events.emit("response|" + response.id, response);
    } else {
      logger.warn("gateway received malformat response", {err: tv4.error, message: response});
    }
  }

  function enqueueMessage(socket, message) {
    socket.queue = socket.queue || [];
    socket.queue.push(message);
  }

  function processQueue(socket) {
    socket.queue && _.forEach(socket.queue, function (message) {
      processMessage(socket, message);
    });
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
  _this.io.installHandlers(server, {prefix: params.path || defaultPath});

  server.on("error", function (err) {
    logger.trace("gateway error", err);
    _this.emit("error", err);
  });

  server.on("listening", function () {
    logger.trace("gateway started");
    _this.emit("started");
  });

  server.on("close", function () {
    logger.trace("gateway stopped");
    _this.emit("stopped");
  });

  server.listen(params.port || defaultPort);
};

/* basic implementations */

function basicAuth(socket, username) {
  if (_.isString(username) && !_.isEmpty(username)) {
    socket.identity = username;
  } else {
    socket.disconnect();
  }
}

function basicSession(from, content, reply) {
  var msgid = hubiquitus.utils.uuid();
  reply && events.once("response|" + msgid, function (response) {
    reply(response.payload.err, response.from, response.payload.content);
  });
  this.socket.emit({id: msgid, from: from, to: this.socket.identity, payload: {content: content}});
}
