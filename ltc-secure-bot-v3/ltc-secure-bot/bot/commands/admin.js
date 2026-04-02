'use strict';
const { EmbedBuilder } = require('discord.js');
const api    = require('../apiClient');
const config = require('../../config');

module.exports = {
  name: 'admin',
  aliases: ['adm'],
  description: 'Admin-only commands',
  usage: '=admin <earnings|sweep|poll>',

  async execute(message, args) {
    if (message.author.id !== config.admin.discordId) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Access Denied')
            .setDescription('This command is restricted to bot administrators.')
            .setTimestamp(),
        ],
      });
    }

    const sub = (args[0] || '').toLowerCase();

    switch (sub) {
      case 'earnings': return _earnings(message);
      case 'sweep':    return _sweep(message);
      case 'poll':     return _poll(message);
      default:
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.info)
              .setTitle('🛠️ Admin Commands')
              .addFields(
                { name: '=admin earnings', value: 'View fee earnings & hot wallet balance' },
                { name: '=admin sweep',    value: 'Manually sweep hot → cold wallet' },
                { name: '=admin poll',     value: 'Manually trigger deposit poll' },
              )
              .setTimestamp(),
          ],
        });
    }
  },
};

async function _earnings(message) {
  const busy = await message.reply({
    embeds: [
      new EmbedBuilder().setColor(config.colors.info).setDescription('⏳ Fetching earnings...').setTimestamp(),
    ],
  });

  try {
    const { data } = await api.get('/admin/earnings');
    const { totalPendingFees, breakdown, hotWalletBalance } = data;

    const breakdownLines = breakdown.map((b) => {
      const label = b._id === 'deposit_fee' ? '📥 Deposit fees' : '📤 Withdraw fees';
      return `${label}: \`${b.total.toFixed(8)} LTC\` total — \`${b.pending.toFixed(8)}\` uncollected (${b.count} txs)`;
    }).join('\n') || 'No fees collected yet';

    await busy.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.ltcBlue)
          .setTitle('💼 Fee Earnings Report')
          .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
          .addFields(
            { name: '💰 Total Uncollected Fees', value: `\`${totalPendingFees.toFixed(8)} LTC\`` },
            { name: '📊 Breakdown',              value: breakdownLines },
            { name: '🔥 Hot Wallet Balance',     value: `\`${hotWalletBalance.toFixed(8)} LTC\``, inline: true },
            { name: '🔥 Hot Wallet Address',     value: `\`${data.hotWalletAddress}\``,           inline: false },
            { name: '🧊 Cold Wallet',            value: `\`${data.coldWalletAddress}\`` },
            {
              name: '⚙️ Sweep Thresholds',
              value: `Auto-sweep when hot > \`${config.hotWallet.maxLtc} LTC\` — keeps \`${config.hotWallet.minLtc} LTC\` in hot`,
            }
          )
          .setFooter({ text: 'Auto-sweep runs every hour' })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    await busy.edit({
      embeds: [
        new EmbedBuilder().setColor(config.colors.error).setTitle('❌ Error').setDescription(err.message).setTimestamp(),
      ],
    });
  }
}

async function _sweep(message) {
  const busy = await message.reply({
    embeds: [
      new EmbedBuilder().setColor(config.colors.info).setDescription('⏳ Initiating sweep...').setTimestamp(),
    ],
  });

  try {
    const { data } = await api.post('/admin/sweep');

    let embed;
    if (data.success) {
      embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle('✅ Sweep Complete')
        .addFields(
          { name: '💸 Swept', value: `\`${data.amount.toFixed(8)} LTC\``, inline: true },
          { name: '🔗 TX',    value: `[SoChain](${data.explorerUrl})`,     inline: true },
        )
        .setTimestamp();
    } else {
      embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle('⏭️ Sweep Skipped')
        .setDescription(data.reason || JSON.stringify(data))
        .setTimestamp();
    }
    await busy.edit({ embeds: [embed] });
  } catch (err) {
    await busy.edit({
      embeds: [
        new EmbedBuilder().setColor(config.colors.error).setTitle('❌ Sweep Failed').setDescription(err.message).setTimestamp(),
      ],
    });
  }
}

async function _poll(message) {
  const busy = await message.reply({
    embeds: [
      new EmbedBuilder().setColor(config.colors.info).setDescription('⏳ Polling deposit addresses...').setTimestamp(),
    ],
  });
  try {
    await api.post('/admin/poll');
    await busy.edit({
      embeds: [
        new EmbedBuilder().setColor(config.colors.success).setTitle('✅ Poll Complete').setDescription('Deposit addresses checked.').setTimestamp(),
      ],
    });
  } catch (err) {
    await busy.edit({
      embeds: [
        new EmbedBuilder().setColor(config.colors.error).setTitle('❌ Poll Failed').setDescription(err.message).setTimestamp(),
      ],
    });
  }
}
