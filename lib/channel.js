/**
 * @module channel
 */

var hubiquitus = require("hubiquitus-core");
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var _ = require("lodash");

exports.createChannel = function (id, getSubscribers, onSubscribe) {
  return new Channel(id, getSubscribers, onSubscribe);
};

function Channel(id, getSubscribers, onSubscribe) {
  EventEmitter.call(this);

  var _this = this;

  this.id = id;

  /* subsribers management */

  var subscribers = [];

  this.getSubscribers = getSubscribers || function () {
    return subscribers;
  };

  this.onSubscribe = onSubscribe || function (subscriber, mode) {
    if (mode === "bare" && hubiquitus.utils.aid.isFull(subscriber))
      subscriber = hubiquitus.utils.aid.bare(subscriber);
    subscribers.push(subscriber);
  };
  this.on("subscribe", onSubscribe);

  hubiquitus.events.on("actor removed", function (aid) {
    _.remove(_this.getSubscribers(), function (currentAid) {
      return aid === currentAid;
    });
  });

  /* channel actors management */

  hubiquitus.addActor(this.id, publish);
  hubiquitus.addActor(this.id + "#subscribe", subscribe);

  function publish(from, content) {
    var ctx = this;
    _.forEach(_this.getSubscribers(), function (subscriber) {
      ctx.send(subscriber, content);
    });
  }

  function subscribe(from, content) {
    _this.emit("subsribe", from, content.mode || "full");
  }
}

util.inherits(Channel, EventEmitter);
