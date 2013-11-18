/**
 * @module gateway sample
 */

var hubiquitus = require("hubiquitus-core");
var gateway = require(__dirname + "/../../lib/gateway");

var logger = hubiquitus.logger;
logger.level = "info";

// gateway creation; does'nt provide implementation : will use default in-memory one
var gat = gateway.createGateway();
gat.start();

gat.on("started", function () {
  logger.info("gateway started");
});

gat.on("error", function (err) {
  logger.err(err);
});
