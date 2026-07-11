/**
 * /suggest — Community suggestions.
 *   submit ← post a new suggestion (needs suggestions_enabled + a channel set)
 *   config ← admin: channel, decision role, anonymous toggle
 *   list   ← ephemeral overview of pending suggestions
 *
 * Voting (👍/👎) and approve/deny happen entirely via buttons on the posted
 * embed — see modules/suggestions/handler.ts.
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, ChannelType,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import { requireAdmin } from '../../utils/guards';
import * as Repo from '../../modules/suggestions/repository';
import { handleSuggestionSubmit } from '../../modules/suggestions/handler';

const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Community suggestions')

  .addSubcommand(s =>
    s.setName('submit')
      .setDescription('Submit a new suggestion')
      .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true).setMaxLength(1000)),
  )

  .addSubcommand(s =>
    s.setName('config')
      .setDescription('Configure the suggestions feature (Server verwalten erforderlich)')
      .addBooleanOption(o => o.setName('enabled').setDescription('On or off'))
      .addChannelOption(o =>
        o.setName('channel').setDescription('Channel suggestions get posted to')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption(o => o.setName('viewer_role').setDescription('Role allowed to approve/deny suggestions'))
      .addBooleanOption(o => o.setName('anonymous').setDescription("Hide the author's name on posted suggestions")),
  )

  .addSubcommand(s => s.setName('list').setDescription('Show pending suggestions'));

export default {
  data,
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    // ── submit ─────────────────────────────────────────────────────────────
    if (sub === 'submit') {
      const text = interaction.options.getString('text', true).trim();

      const result = await handleSuggestionSubmit(interaction.guild!, interaction.user.id, text);
      if (result.ok === false) {
        await interaction.reply({ embeds: [error('Vorschlag nicht gesendet', result.reason)], ephemeral: true });
        return;
      }

      await interaction.reply({
        embeds: [success('Vorschlag eingereicht', 'Dein Vorschlag wurde gepostet — danke fürs Mitdenken!')],
        ephemeral: true,
      });
      return;
    }

    // ── config ─────────────────────────────────────────────────────────────
    if (sub === 'config') {
      if (!await requireAdmin(interaction)) return;

      const enabled    = interaction.options.getBoolean('enabled');
      const channel    = interaction.options.getChannel('channel');
      const viewerRole = interaction.options.getRole('viewer_role');
      const anonymous  = interaction.options.getBoolean('anonymous');

      if (enabled !== null)   Repo.setConfigValue(guildId, 'suggestions_enabled', enabled ? 1 : 0);
      if (channel)             Repo.setConfigValue(guildId, 'suggestions_channel', channel.id);
      if (viewerRole)          Repo.setConfigValue(guildId, 'suggestions_viewer_role', viewerRole.id);
      if (anonymous !== null)  Repo.setConfigValue(guildId, 'suggestions_anonymous', anonymous ? 1 : 0);

      const cfg = Repo.getConfig(guildId);
      await interaction.reply({
        embeds: [success('Einstellungen aktualisiert',
          `**Aktiviert:** ${cfg.enabled ? '✅ Ja' : '❌ Nein'}\n` +
          `**Channel:** ${cfg.channel ? `<#${cfg.channel}>` : 'Nicht gesetzt'}\n` +
          `**Entscheider-Rolle:** ${cfg.viewerRole ? `<@&${cfg.viewerRole}>` : 'Nicht gesetzt — jeder kann abstimmen, niemand kann entscheiden'}\n` +
          `**Anonym:** ${cfg.anonymous ? '✅ Ja' : '❌ Nein'}`,
        )],
        ephemeral: true,
      });
      return;
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const cfg = Repo.getConfig(guildId);
      const pending = Repo.listPending(guildId, 15);

      if (pending.length === 0) {
        await interaction.reply({ embeds: [info('Keine offenen Vorschläge', 'Aktuell liegt nichts zur Entscheidung vor.')], ephemeral: true });
        return;
      }

      const lines = pending.map(s => {
        const author  = cfg.anonymous ? '*Anonym*' : `<@${s.author_id}>`;
        const snippet = s.content.length > 80 ? `${s.content.slice(0, 80)}…` : s.content;
        return `**#${s.id}** 👍 ${s.upvotes} · 👎 ${s.downvotes} — ${snippet} *(${author})*`;
      });

      await interaction.reply({
        embeds: [info(`⏳ Offene Vorschläge (${pending.length})`, lines.join('\n').slice(0, 4000))],
        ephemeral: true,
      });
      return;
    }
  },
};
