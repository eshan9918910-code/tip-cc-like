// Root entry point — required by Pterodactyl's ts-node startup resolver
// Boots both the API server and Discord bot in a single process
'use strict';

require('./server/index.js');
require('./bot/index.js');
