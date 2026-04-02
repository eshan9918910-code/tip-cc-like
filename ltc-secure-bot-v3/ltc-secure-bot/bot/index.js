'use strict';
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../server/middleware/logger');

// ── Discord client ────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Expose client globally so deposit poller can DM users
global.discordClient = client;

// ── Load commands ─────────────────────────────────────
client.commands = new Collection();
const cmdDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  client.commands.set(cmd.name, cmd);
  if (cmd.aliases) cmd.aliases.forEach((a) => client.commands.set(a, cmd));
  logger.debug(`Loaded command: ${cmd.name}`);
}
logger.info(`Loaded ${client.commands.size} command entries`);

// ── Per-user global cooldown (3s) ─────────────────────
const globalCooldown = new Map();
const GLOBAL_CD_MS   = 3000;

// ── Events ────────────────────────────────────────────
client.once('ready', () => {
  logger.info(`✅ Bot ready: ${client.user.tag}`);
  client.user.setActivity('=help | ⚡ LTC Tips', { type: 3 });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.discord.prefix)) return;

  const args        = message.content.slice(config.discord.prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  if (!commandName) return;

  const command = client.commands.get(commandName);
  if (!command) return;

  // Global per-user cooldown
  const lastCmd = globalCooldown.get(message.author.id);
  if (lastCmd && Date.now() - lastCmd < GLOBAL_CD_MS) {
    const secs = ((GLOBAL_CD_MS - (Date.now() - lastCmd)) / 1000).toFixed(1);
    const warn = await message.reply(`⏳ Slow down! Wait **${secs}s**`);
    setTimeout(() => warn.delete().catch(() => {}), 3000);
    return;
  }
  globalCooldown.set(message.author.id, Date.now());

  try {
    await command.execute(message, args);
  } catch (err) {
    logger.error(`Command [${commandName}] error: ${err.message}`);
    message.reply('❌ An unexpected error occurred. Please try again.').catch(() => {});
  }
});

client.on('error', (err) => logger.error('Discord error:', err.message));
client.on('warn',  (msg) => logger.warn('Discord warn:', msg));

// ── Graceful shutdown ─────────────────────────────────
const shutdown = () => {
  logger.info('Bot shutting down...');
  client.destroy();
  process.exit(0);
};
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── Login ─────────────────────────────────────────────
client.login(config.discord.token).catch((err) => {
  logger.error('Discord login failed:', err.message);
  process.exit(1);
});
