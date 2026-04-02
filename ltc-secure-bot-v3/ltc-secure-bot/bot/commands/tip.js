'use strict';
const { EmbedBuilder } = require('discord.js');
const api    = require('../apiClient');
const config = require('../../config');

module.exports = {
  name: 'tip',
  aliases: ['send', 'give'],
  description: 'Tip LTC to another Discord user (no fee)',
  usage: '=tip @user <amount>',

  async execute(message, args) {
    if (args.length < 2) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.warning)
            .setTitle('📖 Usage: =tip @user <amount>')
            .addFields(
              { name: 'Example', value: '`=tip @Alice 0.01`' },
              { name: 'Note',    value: 'Tips are instant and completely free.' }
            )
            .setTimestamp(),
        ],
      });
    }

    const target = message.mentions.users.first();
    if (!target) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Please mention a valid user')
            .setDescription('Example: `=tip @Alice 0.01`')
            .setTimestamp(),
        ],
      });
    }

    if (target.bot) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Cannot tip a bot')
            .setTimestamp(),
        ],
      });
    }

    const amount = parseFloat(args[1]);
    if (isNaN(amount) || amount <= 0) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Invalid amount')
            .setDescription('Enter a positive number, e.g. `0.01`')
            .setTimestamp(),
        ],
      });
    }

    // Ensure sender has a wallet
    await api.post('/user/create', {
      discordId:       message.author.id,
      discordUsername: message.author.username,
    });

    const processing = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.info)
          .setDescription(`⏳ Sending \`${amount} LTC\` to **${target.username}**...`)
          .setTimestamp(),
      ],
    });

    try {
      await api.post('/tip', {
        fromDiscordId: message.author.id,
        toDiscordId:   target.id,
        amountLtc:     amount,
        fromUsername:  message.author.username,
        toUsername:    target.username,
      });

      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('🎉 Tip Sent!')
        .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
        .setDescription(`**${message.author.username}** → **${target.username}**`)
        .addFields(
          { name: '💸 Amount', value: `\`${amount.toFixed(8)} LTC\``, inline: true },
          { name: '🏦 Fee',    value: '`None` ✅',                     inline: true },
        )
        .setFooter({ text: '⚡ Instant off-chain transfer' })
        .setTimestamp();

      await processing.edit({ embeds: [embed] });

      // DM recipient
      try {
        await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.success)
              .setTitle('🎁 You received a tip!')
              .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
              .setDescription(
                `**${message.author.username}** tipped you in **${message.guild?.name ?? 'Discord'}**`
              )
              .addFields({ name: '💰 Amount', value: `\`${amount.toFixed(8)} LTC\`` })
              .setFooter({ text: '=balance to check wallet • =withdraw to cash out' })
              .setTimestamp(),
          ],
        });
      } catch { /* DMs may be closed */ }

    } catch (err) {
      await processing.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Tip Failed')
            .setDescription(err.message)
            .addFields({ name: 'Need funds?', value: 'Use `=balance` to see your deposit address' })
            .setTimestamp(),
        ],
      });
    }
  },
};
