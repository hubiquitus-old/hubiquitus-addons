/**
 * @module channel sample
 */

var hubiquitus = require("hubiquitus-core");
var channel = require(__dirname + "/../../lib/channel");

var logger = hubiquitus.logger;
logger.level = "info";

// channel creation; does'nt provide implementation : will use default in-memory one
var chan = channel.createChannel("chan");

// starting hubiquitus with 1 publisher and 2 subscribers
hubiquitus.start()
  .addActor("pub", publisher)
  .addActor("sub1", subscriber)
  .addActor("sub2", subscriber);

// subscribe sub1 and sub2 to chan through actor chan#subscribe
hubiquitus.send("sub1", "chan#subscribe");
hubiquitus.send("sub2", "chan#subscribe");

// ask publisher to publish every 500 ms
setInterval(function () {
  logger.info("ASK PUBLISHER TO PUBLISH");
  hubiquitus.send("god", "pub", "go !");
}, 500);

// add a new subscriber after a delay
setTimeout(function () {
  logger.info("ADDING A SUBSCRIBER");
  hubiquitus.addActor("sub3", subscriber);
  hubiquitus.send("sub3", "chan#subscribe");
}, 2000);

// remove a subsriber after a delay
setTimeout(function () {
  logger.info("REMOVING A SUBSCRIBER");
  hubiquitus.removeActor("sub3");
}, 4000);

// publisher actor code
function publisher(from, content) {
  logger.info(this.id + "> from " + from + " : " + content);
  logger.info(this.id + "> sending hi to subs");
  this.send("chan", "hi");
}

// subscriber actor code
function subscriber(from, content) {
  logger.info(this.id + "> from " + from + " : " + content);
}
