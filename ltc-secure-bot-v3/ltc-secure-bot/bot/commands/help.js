'use strict';
const { EmbedBuilder } = require('discord.js');
const config = require('../../config');

module.exports = {
  name: 'help',
  aliases: ['h', 'commands'],
  description: 'List all commands',

  async execute(message) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.ltcBlue)
      .setTitle('⚡ LTC Tip Bot — Commands')
      .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
      .setDescription('A secure, production-ready Litecoin tipping system for Discord.')
      .addFields(
        {
          name: '💼 Wallet',
          value: '`=balance` — View balance, deposit address & stats',
        },
        {
          name: '🎁 Tips (free, instant)',
          value: [
            '`=tip @user <amount>`',
            'Example: `=tip @Alice 0.01`',
          ].join('\n'),
        },
        {
          name: '📤 Withdrawals',
          value: [
            '`=withdraw <amount> <ltc_address>`',
            'Example: `=withdraw 0.1 LdP8Qox1VAhCzLJNqrr74YovaWYyNBUWvL`',
          ].join('\n'),
        },
        {
          name: '📋 Fees',
          value: [
            `• Deposit: \`1%\`  — Min: \`${config.fees.minDepositLtc} LTC\``,
            `• Withdraw: \`0.25%\` — Min: \`${config.fees.minWithdrawLtc} LTC\``,
            '• Tips: **Free** ✅',
          ].join('\n'),
        },
        {
          name: '🔒 Security',
          value: [
            '• Deposits need 2 confirmations',
            '• Withdraw requires emoji confirmation',
            '• All transactions signed **locally** — private key never sent externally',
            '• 60s withdraw cooldown per user',
          ].join('\n'),
        }
      )
      .setFooter({ text: 'LTC Tip Bot • Local signing via bitcoinjs-lib • Powered by SoChain' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};
