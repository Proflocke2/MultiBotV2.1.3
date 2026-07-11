/**
 * modules/moderation/antiNukeWizard.ts
 *
 * Guided menu for Anti-Nuke — covers everything the old `/security antinuke`
 * subcommand group did (setup, whitelist, unwhitelist, whitelist-list,
 * incidents, status) via clicks instead of typed options/user IDs. Same
 * underlying antiNuke.ts functions throughout.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType, UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags, ChatInputCommandInteraction, TextInputStyle,
} from 'discord.js';
import {
  getAntiNukeConfig, updateAntiNukeConfig,
  addToWhitelist, removeFromWhitelist, getWhitelist, getIncidents, isWhitelisted,
} from './antiNuke';
import { success, error, info } from '../../utils/embeds';
import {
  createSession, getSession, endSession, touchSession, parseWizardId, buildWizardId,
  navRow, promptModal, renderTo, expiredView, noPermissionView,
  WizardComponentInteraction, WizardView,
} from '../../utils/wizardKit';
import { logConfigChange } from '../audit/configAudit';

const PREFIX = 'anw';
const ACTIONS: Array<'ban' | 'kick' | 'strip'> = ['ban', 'kick', 'strip'];

export function isAntiNukeWizardComponent(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

export async function startAntiNukeWizard(ix: ChatInputCommandInteraction): Promise<void> {
  const sessionId = createSession(PREFIX, ix.guildId!, ix.user.id);
  await ix.reply({ ...renderMainMenu(sessionId, ix.guildId!), flags: MessageFlags.Ephemeral });
}

function renderMainMenu(sessionId: string, guildId: string): WizardView {
  const cfg = getAntiNukeConfig(guildId);
  const wl = getWhitelist(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Anti-Nuke — Setup')
    .setColor(cfg.enabled ? '#57f287' : '#ed4245')
    .setDescription('Schützt vor kompromittierten Staff-Accounts (Massen-Löschungen, -Bans, Webhook-Spam).')
    .addFields(
      { name: 'Status',       value: cfg.enabled ? '✅ Aktiv' : '❌ Inaktiv', inline: true },
      { name: 'Aktion',       value: cfg.action, inline: true },
      { name: 'Log-Channel',  value: cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : '—', inline: true },
      { name: 'Zeitfenster',  value: `${cfg.window_seconds}s`, inline: true },
      { name: 'Limits',       value: `Kanäle: ${cfg.channel_delete_limit} • Rollen: ${cfg.role_delete_limit} • Bans: ${cfg.ban_limit} • Webhooks: ${cfg.webhook_limit}` },
      { name: 'Whitelist',    value: `${wl.length} Eintrag/-träge`, inline: true },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'main', 'toggle')).setLabel(cfg.enabled ? 'Deaktivieren' : 'Aktivieren').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'main', 'action')).setLabel(`Aktion: ${cfg.action}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'main', 'channel')).setLabel('Log-Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'main', 'limits')).setLabel('Limits').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'wl', 'menu')).setLabel('👥 Whitelist').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'incidents', 'show')).setLabel('📋 Vorfälle').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'nav', 'close')).setLabel('❌ Schließen').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function renderWhitelistMenu(sessionId: string, guildId: string): WizardView {
  const wl = getWhitelist(guildId);
  const embed = new EmbedBuilder().setTitle('👥 Anti-Nuke Whitelist').setColor('#5865f2')
    .setDescription('Diese User sind von Anti-Nuke-Aktionen ausgenommen (z.B. Bots, vertrauenswürdige Co-Admins). Der Server-Owner ist immer automatisch ausgenommen.')
    .addFields({ name: `Aktuell (${wl.length})`, value: wl.length > 0 ? wl.map(e => `<@${e.user_id}> — hinzugefügt von <@${e.added_by}> <t:${e.added_at}:R>`).join('\n') : '*Keine Einträge*' });

  const components: ActionRowBuilder<any>[] = [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'wl', 'add')).setPlaceholder('User zur Whitelist hinzufügen…'),
    ),
  ];
  if (wl.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildWizardId(PREFIX, sessionId, 'wl', 'remove'))
      .setPlaceholder('User von der Whitelist entfernen…')
      .addOptions(wl.slice(0, 25).map(e => ({ label: e.user_id, value: e.user_id })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(navRow(PREFIX, sessionId, 'menu'));
  return { embeds: [embed], components };
}

function renderIncidents(guildId: string): EmbedBuilder {
  const incidents = getIncidents(guildId);
  const embed = new EmbedBuilder().setColor('#ed4245').setTitle('📋 Anti-Nuke — Vorfälle');
  if (incidents.length === 0) {
    embed.setDescription('Keine Vorfälle bisher.');
  } else {
    embed.setDescription(incidents.map(i => `**#${i.id}** <t:${i.created_at}:R>\n<@${i.attacker_id}> — ${i.event_type} (${i.count}x) → **${i.action_taken}**`).join('\n\n'));
  }
  return embed;
}

export async function handleAntiNukeWizardComponent(interaction: WizardComponentInteraction): Promise<void> {
  const { sessionId, section, action, args } = parseWizardId(interaction.customId);
  const session = getSession(PREFIX, sessionId);

  if (!session) { await renderTo(interaction, expiredView()); return; }
  if (interaction.user.id !== session.userId) { await renderTo(interaction, noPermissionView()); return; }
  touchSession(PREFIX, sessionId);
  const gid = session.guildId;

  if (section === 'nav') {
    if (action === 'back') { await renderTo(interaction, renderMainMenu(sessionId, gid)); return; }
    if (action === 'close') {
      endSession(PREFIX, sessionId);
      if (interaction.isButton()) await interaction.update({ embeds: [success('Geschlossen', 'Setup beendet.')], components: [] }).catch(() => {});
      return;
    }
    return;
  }

  if (section === 'incidents' && action === 'show' && interaction.isButton()) {
    await renderTo(interaction, { embeds: [renderIncidents(gid)], components: [navRow(PREFIX, sessionId, 'menu')] });
    return;
  }

  if (section === 'main') {
    if (action === 'toggle' && interaction.isButton()) {
      const cfg = getAntiNukeConfig(gid);
      updateAntiNukeConfig(gid, { enabled: cfg.enabled ? 0 : 1 });
      logConfigChange(gid, interaction.user.id, 'antinuke_toggled', cfg.enabled ? 'off' : 'on');
      await renderTo(interaction, renderMainMenu(sessionId, gid));
      return;
    }
    if (action === 'action' && interaction.isButton()) {
      const cfg = getAntiNukeConfig(gid);
      const idx = ACTIONS.indexOf(cfg.action as any);
      const next = ACTIONS[(idx + 1) % ACTIONS.length];
      updateAntiNukeConfig(gid, { action: next });
      logConfigChange(gid, interaction.user.id, 'antinuke_action_changed', next);
      await renderTo(interaction, renderMainMenu(sessionId, gid));
      return;
    }
    if (action === 'channel' && interaction.isButton()) {
      const embed = new EmbedBuilder().setTitle('🛡️ Log-Channel').setColor('#5865f2').setDescription('Channel für Anti-Nuke-Alarme wählen.');
      const select = new ChannelSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'main', 'setchannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
      await renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(PREFIX, sessionId, 'menu')] });
      return;
    }
    if (action === 'setchannel' && interaction.isChannelSelectMenu()) {
      updateAntiNukeConfig(gid, { log_channel_id: interaction.values[0] });
      logConfigChange(gid, interaction.user.id, 'antinuke_log_channel_changed', `<#${interaction.values[0]}>`);
      await renderTo(interaction, renderMainMenu(sessionId, gid));
      return;
    }
    if (action === 'limits' && interaction.isButton()) {
      const cfg = getAntiNukeConfig(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'main', 'limitsmodal'), 'Anti-Nuke Limits', [
        { id: 'window', label: 'Zeitfenster (Sekunden, 5-60)', required: true, maxLength: 3, value: String(cfg.window_seconds) },
        { id: 'chdel', label: 'Max. Kanal-Löschungen (1-20)', required: true, maxLength: 3, value: String(cfg.channel_delete_limit) },
        { id: 'roledel', label: 'Max. Rollen-Löschungen (1-20)', required: true, maxLength: 3, value: String(cfg.role_delete_limit) },
        { id: 'bans', label: 'Max. Bans (1-30)', required: true, maxLength: 3, value: String(cfg.ban_limit) },
        { id: 'webhooks', label: 'Max. Webhook-Erstellungen (1-20)', required: true, maxLength: 3, value: String(cfg.webhook_limit) },
      ]);
      if (!result) return;
      const { values, submit } = result;

      const window   = parseInt(values.window, 10);
      const chdel    = parseInt(values.chdel, 10);
      const roledel  = parseInt(values.roledel, 10);
      const bans     = parseInt(values.bans, 10);
      const webhooks = parseInt(values.webhooks, 10);

      const checks: Array<[boolean, string]> = [
        [isNaN(window) || window < 5 || window > 60, 'Zeitfenster: 5–60 Sekunden.'],
        [isNaN(chdel) || chdel < 1 || chdel > 20, 'Kanal-Löschungen: 1–20.'],
        [isNaN(roledel) || roledel < 1 || roledel > 20, 'Rollen-Löschungen: 1–20.'],
        [isNaN(bans) || bans < 1 || bans > 30, 'Bans: 1–30.'],
        [isNaN(webhooks) || webhooks < 1 || webhooks > 20, 'Webhooks: 1–20.'],
      ];
      const failed = checks.find(([bad]) => bad);
      if (failed) {
        await submit.reply({ embeds: [error('Ungültiger Wert', failed[1])], flags: MessageFlags.Ephemeral });
        return;
      }

      updateAntiNukeConfig(gid, {
        window_seconds: window, channel_delete_limit: chdel, role_delete_limit: roledel,
        ban_limit: bans, webhook_limit: webhooks,
      });
      logConfigChange(gid, submit.user.id, 'antinuke_limits_changed', `window=${window}s ch=${chdel} role=${roledel} ban=${bans} webhook=${webhooks}`);
      await renderTo(submit, renderMainMenu(sessionId, gid));
      return;
    }
  }

  if (section === 'wl') {
    if (action === 'menu') { await renderTo(interaction, renderWhitelistMenu(sessionId, gid)); return; }
    if (action === 'add' && interaction.isUserSelectMenu()) {
      const userId = interaction.values[0];
      if (userId === interaction.guild?.ownerId) {
        await renderTo(interaction, { embeds: [info('Bereits ausgenommen', 'Der Server-Owner ist automatisch von Anti-Nuke ausgenommen.')], components: [navRow(PREFIX, sessionId, 'menu')] });
        return;
      }
      addToWhitelist(gid, userId, interaction.user.id);
      logConfigChange(gid, interaction.user.id, 'antinuke_whitelist_added', `<@${userId}>`);
      await renderTo(interaction, renderWhitelistMenu(sessionId, gid));
      return;
    }
    if (action === 'remove' && interaction.isStringSelectMenu()) {
      const userId = interaction.values[0];
      if (isWhitelisted(gid, userId)) removeFromWhitelist(gid, userId);
      logConfigChange(gid, interaction.user.id, 'antinuke_whitelist_removed', `<@${userId}>`);
      await renderTo(interaction, renderWhitelistMenu(sessionId, gid));
      return;
    }
  }
}
