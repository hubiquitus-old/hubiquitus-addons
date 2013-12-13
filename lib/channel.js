/**
 * @module channel
 */

var hubiquitus = require('hubiquitus-core');
var logger = hubiquitus.logger('hubiquitus:addons:channel');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var _ = require('lodash');

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
      logger.warn('invalid channel implementation provided; use default implementation instead (in memory)');
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
  hubiquitus.removeActor(id + '#subscribe');
  hubiquitus.removeActor(id + '#unsubscribe');
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

  this.id = id;

  /* subsribers management */

  var subscribers = channelImpl.subscribers;
  var onSubscribe = channelImpl.onSubscribe;
  var onUnsubscribe = channelImpl.onUnsubscribe;
  hubiquitus.on('actor removed', onUnsubscribe);

  /* channel actors management */

  hubiquitus.addActor(this.id, publish);
  hubiquitus.addActor(this.id + '#subscribe', subscribe);
  hubiquitus.addActor(this.id + '#unsubscribe', unsubscribe);

  function publish(req) {
    _this.emit('onMessage', req.from, req.content);
    var ctx = this;
    _.forEach(subscribers(), function (item) {
      ctx.send(item, req.content);
    });
  }

  function subscribe(req) {
    var mode = 'full';
    if (req.content && req.content.mode) mode = req.content.mode;
    onSubscribe(req.from, mode, function (err) {
      req.reply(err);
    });
  }

  function unsubscribe(req) {
    var mode = 'full';
    if (req.content && req.content.mode) mode = req.content.mode;
    onUnsubscribe(req.from, mode, function (err) {
      req.reply(err);
    });
  }
}

util.inherits(Channel, EventEmitter);

/* in memory channel implementation */

function createInMemoryChannel() {
  var inMemorySubscribers = [];

  function subscribers() {
    return inMemorySubscribers;
  }

  function onSubscribe(aid, mode, cb) {
    if (mode === 'bare' && hubiquitus.utils.aid.isFull(aid)) {
      aid = hubiquitus.utils.aid.bare(aid);
    }
    if (!_.contains(subscribers(), aid)) {
      inMemorySubscribers.push(aid);
    }
    cb && cb();
  }

  function onUnsubscribe(aid, mode, cb) {
    if (mode === 'bare' && hubiquitus.utils.aid.isFull(aid)) {
      aid = hubiquitus.utils.aid.bare(aid);
    }
    _.remove(subscribers(), function (item) {
      return aid === item;
    });
    cb && cb();
  }

  return {
    subscribers: subscribers,
    onSubscribe: onSubscribe,
    onUnsubscribe: onUnsubscribe
  };
}
