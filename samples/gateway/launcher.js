/**
 * @module gateway sample
 */

var hubiquitus = require('hubiquitus-core');
var gateway = require(__dirname + '/../../lib/gateway');

var logger = hubiquitus.logger('hubiquitus:addons:samples');
hubiquitus.logger.enable('hubiquitus:addons:*');
hubiquitus.logger.level('hubiquitus:addons:*', 'trace');
hubiquitus.logger.enable('hubiquitus:core:*');
hubiquitus.logger.level('hubiquitus:core:*', 'warn');

hubiquitus.start()
  .addActor('ping', function (req) {
    logger.info(this.id + '> from ' + req.from + ' : ' + req.content);
    req.reply(null, req.content);
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
