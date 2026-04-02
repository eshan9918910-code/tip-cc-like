'use strict';
const { EmbedBuilder } = require('discord.js');
const api    = require('../apiClient');
const config = require('../../config');

module.exports = {
  name: 'balance',
  aliases: ['bal', 'wallet', 'w'],
  description: 'Show your LTC balance and deposit address',

  async execute(message) {
    // Ensure user exists
    await api.post('/user/create', {
      discordId:       message.author.id,
      discordUsername: message.author.username,
    });

    const { data: user } = await api.get(`/user/${message.author.id}`);

    const embed = new EmbedBuilder()
      .setColor(config.colors.ltcBlue)
      .setTitle('⚡ Your LTC Wallet')
      .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
      .setDescription(`**${message.author.username}** • Litecoin Wallet`)
      .addFields(
        {
          name: '💰 Available Balance',
          value: `\`\`\`${user.balance.toFixed(8)} LTC\`\`\``,
        },
        {
          name: '📥 Your Deposit Address',
          value: `\`\`\`${user.ltcAddress}\`\`\``,
        },
        {
          name: '📊 Deposited',
          value: `\`${user.totalDeposited.toFixed(8)} LTC\``,
          inline: true,
        },
        {
          name: '📤 Withdrawn',
          value: `\`${user.totalWithdrawn.toFixed(8)} LTC\``,
          inline: true,
        },
        {
          name: '🎁 Tips Sent',
          value: `\`${user.totalTipped.toFixed(8)} LTC\``,
          inline: true,
        },
        {
          name: '🎁 Tips Received',
          value: `\`${user.totalReceived.toFixed(8)} LTC\``,
          inline: true,
        },
        {
          name: '📋 Fee Schedule',
          value: [
            `• Deposit fee: \`1%\` — Min: \`${config.fees.minDepositLtc} LTC\``,
            `• Withdraw fee: \`0.25%\` — Min: \`${config.fees.minWithdrawLtc} LTC\``,
            `• Tips: **Free** ✅`,
          ].join('\n'),
        }
      )
      .setFooter({ text: 'Deposits require 2 confirmations • All signing done locally 🔒' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};
