/**
 * @module gateway
 */

var hubiquitus = require("hubiquitus-core");
var logger = hubiquitus.logger;
var socketIo = require("socket.io");
var EventEmitter = require("events").EventEmitter;
var _ = require("lodash");
var tv4 = require("tv4");
var schemas = require("./schemas");

var events = new EventEmitter();
events.setMaxListeners(0);
var defaultPort = 8888;
var authTimeout = 30000;

/**
 * Create a gateway
 * @param port {number} listenning port
 * @param session {function} session actor
 * @param auth {function} authentication function
 * @returns {Gateway}
 */
exports.createGateway = function (port, session, auth) {
  if (!_.isFunction(session)) {
    return logger.error("invalid session actor");
  }
  if (!_.isFunction(auth)) {
    logger.warn("invalid authentication procedure; use default implementation instead");
    auth = null;
  }
  return new Gateway(port, auth, session);
};

/**
 * Gateway constructor
 * @param port {number} listenning port
 * @param [auth] {function} authentication function
 * @param [session] {function} session actor
 * @constructor
 */
function Gateway(port, session, auth) {
  var _this = this;

  port = port || defaultPort;
  auth = auth || basicAuth;
  session = session || basicSession;

  var io = socketIo.listen(port);

  io.sockets.on("connection", function (socket) {

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

/* basic implementations */

function basicAuth(socket, username) {
  if (_.isString(username) && !_.isEmpty(username)) {
    socket.identity = username;
  } else {
    socket.disconnect();
  }
}

function basicSession(from, content, date, cb) {
  var msgid = hubiquitus.utils.uuid();
  cb && events.once("response|" + msgid, function (response) {
    cb(response.payload.err, response.from, response.payload.content);
  });
  this.socket.emit({id: msgid, from: from, to: this.socket.identity, payload: {content: content}});
}
