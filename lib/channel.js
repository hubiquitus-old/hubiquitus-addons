/**
 * @module channel
 */

var hubiquitus = require("hubiquitus-core");
var logger = hubiquitus.logger;
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var _ = require("lodash");

/**
 * Create a channel from an implementation
 * @param id {string} channel id
 * @param [channelImpl] {object} implementation
 * @returns {Channel}
 */
exports.createChannel = function (id, channelImpl) {
  if (_.isObject(channelImpl)) {
    if (!_.isFunction(channelImpl.subscribers) ||
        !_.isFunction(channelImpl.onSubscribe) ||
        !_.isFunction(channelImpl.onUnsubscribe)) {
      logger.warn("invalid channel implementation provided; use default implementation instead (in memory)");
      channelImpl = createInMemoryChannel();
    }
  } else {
    channelImpl = createInMemoryChannel();
  }
  return new Channel(id, channelImpl);
};

/**
 * Remove a channel
 * @param id {string} channel to remove aid
 */
exports.removeChannel = function (id) {
  hubiquitus.removeActor(id);
  hubiquitus.removeActor(id + "#subscribe");
  hubiquitus.removeActor(id + "#unsubscribe");
};

/**
 * Channel constructor
 * @param id {string} channel id
 * @param [channelImpl] {object} implementation
 * @constructor
 */
function Channel(id, channelImpl) {
  EventEmitter.call(this);
  this.setMaxListeners(0);

  var _this = this;

  _this.id = id;

  /* subsribers management */

  var subscribers = channelImpl.subscribers;
  var onSubscribe = channelImpl.onSubscribe;
  var onUnsubscribe = channelImpl.onUnsubscribe;
  hubiquitus.events.on("actor removed", onUnsubscribe);

  /* channel actors management */

  hubiquitus.addActor(_this.id, publish);
  hubiquitus.addActor(_this.id + "#subscribe", subscribe);
  hubiquitus.addActor(_this.id + "#unsubscribe", unsubscribe);

  function publish(from, content) {
    _this.emit("onMessage", from, content);
    var ctx = this;
    _.forEach(subscribers(), function (subscriber) {
      ctx.send(subscriber, content);
    });
  }

  function subscribe(from, content) {
    onSubscribe(from, content.mode || "full");
  }

  function unsubscribe(from) {
    onUnsubscribe(from);
  }
}

util.inherits(Channel, EventEmitter);

/* in memory channel implementation */

function createInMemoryChannel() {
  var inMemorySubscribers = [];

  function subscribers() {
    return inMemorySubscribers;
  }

  function onSubscribe(subscriber, mode) {
    if (mode === "bare" && hubiquitus.utils.aid.isFull(subscriber))
      subscriber = hubiquitus.utils.aid.bare(subscriber);
    if (!_.contains(subscribers(), subscriber)) {
      inMemorySubscribers.push(subscriber);
    }
  }

  function onUnsubscribe(aid) {
    _.remove(subscribers(), function (subscriber) {
      return aid === subscriber;
    });
  }

  return {
    subscribers: subscribers,
    onSubscribe: onSubscribe,
    onUnsubscribe: onUnsubscribe
  };
}
