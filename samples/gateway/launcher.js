/**
 * @module gateway sample
 */

var hubiquitus = require('hubiquitus-core');
var gateway = require(__dirname + '/../../lib/gateway');

var logger = hubiquitus.logger;
logger.level = 'info';

hubiquitus.start()
  .addActor('ping', function (from, content, reply) {
    logger.info(this.id + '> from ' + from + ' : ' + content);
    reply(null, content);
  });

// gateway creation; does'nt provide implementation : will use default in-memory one
var gat = gateway.createGateway();

gat.on('started', function () {
  logger.info('gateway started');
});

gat.on('error', function (err) {
  logger.err(err);
});

gat.on('connected', function (aid) {
  logger.info(aid + ' connected !');
});

gat.on('disconnected', function (aid) {
  logger.info(aid + ' disconnected !');
});

gat.start();
