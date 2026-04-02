'use strict';
const { EmbedBuilder } = require('discord.js');
const api    = require('../apiClient');
const config = require('../../config');

// Per-user cooldown (in-memory)
const cooldowns = new Map();
const COOLDOWN_MS = 60_000;

module.exports = {
  name: 'withdraw',
  aliases: ['wd', 'cashout'],
  description: 'Withdraw LTC to an external address',
  usage: '=withdraw <amount> <ltc_address>',

  async execute(message, args) {
    // Usage check
    if (args.length < 2) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.warning)
            .setTitle('📖 Usage: =withdraw <amount> <ltc_address>')
            .addFields(
              { name: 'Example', value: '`=withdraw 0.1 LdP8Qox1VAhCzLJNqrr74YovaWYyNBUWvL`' },
              { name: 'Minimum', value: `\`${config.fees.minWithdrawLtc} LTC\`` },
              { name: 'Fee',     value: `\`${config.fees.withdrawPercent}%\`` },
              { name: 'Security', value: '🔒 Transactions signed locally — your funds never exposed' }
            )
            .setTimestamp(),
        ],
      });
    }

    // Cooldown check
    const lastUse = cooldowns.get(message.author.id);
    if (lastUse && Date.now() - lastUse < COOLDOWN_MS) {
      const secs = Math.ceil((COOLDOWN_MS - (Date.now() - lastUse)) / 1000);
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.warning)
            .setTitle('⏳ Cooldown')
            .setDescription(`Wait **${secs}s** before withdrawing again.`)
            .setTimestamp(),
        ],
      });
    }

    const amount    = parseFloat(args[0]);
    const toAddress = args[1];

    if (isNaN(amount) || amount <= 0) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('❌ Invalid amount')
            .setTimestamp(),
        ],
      });
    }

    // Fee preview
    const feeAmt  = parseFloat((amount * config.fees.withdrawPercent / 100).toFixed(8));
    const netSend = parseFloat((amount - feeAmt).toFixed(8));

    // Confirmation embed
    const confirmEmbed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle('⚠️ Confirm Withdrawal')
      .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
      .addFields(
        { name: '📤 Deducted from Balance', value: `\`${amount.toFixed(8)} LTC\``, inline: true },
        { name: '💸 Fee (0.25%)',            value: `\`${feeAmt.toFixed(8)} LTC\``,  inline: true },
        { name: '✅ You Will Receive',        value: `\`${netSend.toFixed(8)} LTC\``, inline: true },
        { name: '📬 Destination',             value: `\`${toAddress}\`` },
        { name: '🔒 Security',               value: 'Transaction will be **signed locally** on our server. Your private key is **never sent** to any external service.' }
      )
      .setDescription('React ✅ to confirm · ❌ to cancel · *Expires in 30s*')
      .setFooter({ text: '⚠️ Verify the address — withdrawals cannot be reversed' })
      .setTimestamp();

    const msg = await message.reply({ embeds: [confirmEmbed] });
    await msg.react('✅');
    await msg.react('❌');

    const filter = (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === message.author.id;

    try {
      const collected = await msg.awaitReactions({ filter, max: 1, time: 30_000, errors: ['time'] });
      const reaction  = collected.first();

      if (reaction.emoji.name === '❌') {
        return msg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.error)
              .setTitle('❌ Withdrawal Cancelled')
              .setTimestamp(),
          ],
        });
      }

      // Set cooldown before processing
      cooldowns.set(message.author.id, Date.now());

      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.info)
            .setDescription('⏳ Building & signing transaction locally... Please wait.')
            .setTimestamp(),
        ],
      });

      try {
        const { data } = await api.post('/withdraw', {
          discordId: message.author.id,
          toAddress,
          amountLtc: amount,
        });

        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.success)
              .setTitle('✅ Withdrawal Successful!')
              .setThumbnail('https://cryptologos.cc/logos/litecoin-ltc-logo.png')
              .addFields(
                { name: '📤 Deducted',   value: `\`${amount.toFixed(8)} LTC\``,      inline: true },
                { name: '💸 Fee',         value: `\`${feeAmt.toFixed(8)} LTC\``,     inline: true },
                { name: '✅ Sent',        value: `\`${netSend.toFixed(8)} LTC\``,    inline: true },
                { name: '📬 To',          value: `\`${toAddress}\`` },
                { name: '🔗 Transaction', value: `[View on SoChain](${data.explorerUrl})` },
                { name: '🔒 Signed',      value: 'Transaction signed locally • private key never exposed' }
              )
              .setFooter({ text: 'LTC Tip Bot • Secure local signing' })
              .setTimestamp(),
          ],
        });
      } catch (err) {
        cooldowns.delete(message.author.id); // Remove cooldown on failure
        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.error)
              .setTitle('❌ Withdrawal Failed')
              .setDescription(err.message)
              .setTimestamp(),
          ],
        });
      }

    } catch {
      // Timeout
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.error)
            .setTitle('⏰ Timed Out')
            .setDescription('No response in 30s — withdrawal cancelled.')
            .setTimestamp(),
        ],
      });
    }
  },
};
