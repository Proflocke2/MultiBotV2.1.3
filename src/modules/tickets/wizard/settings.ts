/**
 * modules/tickets/wizard/settings.ts
 *
 * Everything that used to live under /settings ticket — log channel,
 * archive channel, transcript format, cooldown, max open, DM on close,
 * name pattern, branding, autoclose, support hours, exit survey.
 *
 * One overview screen with all current values, plus buttons that each open
 * a focused edit step (channel select, modal, or toggle) for one setting
 * at a time — same underlying Repo.updateSettings() calls as the old command.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, MessageFlags,
} from 'discord.js';
import * as Repo from '../repository';
import { error } from '../../../utils/embeds';
import { buildCustomId, getSession } from './session';
import { navRow, promptModal, renderTo, WizardComponentInteraction, WizardView } from './helpers';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function renderSettingsOverview(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);

  const supportHoursValue = s.support_hours_enabled
    ? (s.support_hours_start && s.support_hours_end ? `✅ ${s.support_hours_start}–${s.support_hours_end} UTC` : '✅ Aktiv (keine Zeiten gesetzt)')
    : '❌ Aus';
  const autocloseValue = s.autoclose_enabled ? `✅ Nach ${s.autoclose_hours}h Inaktivität` : '❌ Aus';

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Ticket-Einstellungen')
    .setColor('#5865f2')
    .addFields(
      { name: 'Log-Channel',     value: s.log_channel_id ? `<#${s.log_channel_id}>` : '—', inline: true },
      { name: 'Archiv-Channel',  value: s.archive_channel_id ? `<#${s.archive_channel_id}>` : '—', inline: true },
      { name: 'Transkript',      value: s.transcript_format.toUpperCase(), inline: true },
      { name: 'Cooldown',        value: s.cooldown_seconds === 0 ? 'Aus' : `${s.cooldown_seconds}s`, inline: true },
      { name: 'Max. offen/User', value: String(s.max_open), inline: true },
      { name: 'DM bei Schließen', value: s.dm_on_close ? '✅' : '❌', inline: true },
      { name: 'Branding entfernt', value: s.remove_branding ? '✅' : '❌', inline: true },
      { name: 'Umfrage',         value: s.survey_enabled ? '✅' : '❌', inline: true },
      { name: 'Name-Muster',     value: `\`${s.name_pattern}\``, inline: true },
      { name: 'Autoclose',       value: autocloseValue },
      { name: 'Support-Zeiten (UTC)', value: supportHoursValue },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'logchannel')).setLabel('Log-Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'archivechannel')).setLabel('Archiv-Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'general')).setLabel('Grundeinstellungen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'toggles')).setLabel('Ein/Aus-Optionen').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'autoclose')).setLabel('Autoclose').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'supporthours')).setLabel('Support-Zeiten').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, navRow(sessionId, 'menu')] };
}

export async function handleSettingsSection(interaction: WizardComponentInteraction, sessionId: string, action: string): Promise<void> {
  const session = getSession(sessionId)!;
  const gid = session.guildId;

  if (action === 'logchannel' && interaction.isButton()) {
    const embed = new EmbedBuilder().setTitle('Log-Channel').setColor('#5865f2').setDescription('Channel wählen, oder per Button leeren.');
    const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'set', 'setlogchannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
    const clear = new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'setlogchannel', 'clear')).setLabel('Leeren').setStyle(ButtonStyle.Secondary);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(clear), navRow(sessionId, 'set:overview')] });
  }
  if (action === 'setlogchannel') {
    const channelId = interaction.isChannelSelectMenu() ? interaction.values[0] : null;
    Repo.updateSettings(gid, { log_channel_id: channelId });
    return renderTo(interaction, renderSettingsOverview(sessionId, gid));
  }

  if (action === 'archivechannel' && interaction.isButton()) {
    const embed = new EmbedBuilder().setTitle('Archiv-Channel').setColor('#5865f2').setDescription('Channel wählen, oder per Button leeren.');
    const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'set', 'setarchivechannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
    const clear = new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'setarchivechannel', 'clear')).setLabel('Leeren').setStyle(ButtonStyle.Secondary);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(clear), navRow(sessionId, 'set:overview')] });
  }
  if (action === 'setarchivechannel') {
    const channelId = interaction.isChannelSelectMenu() ? interaction.values[0] : null;
    Repo.updateSettings(gid, { archive_channel_id: channelId });
    return renderTo(interaction, renderSettingsOverview(sessionId, gid));
  }

  if (action === 'general' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    const result = await promptModal(interaction, buildCustomId(sessionId, 'set', 'generalmodal'), 'Grundeinstellungen', [
      { id: 'cooldown', label: 'Cooldown in Sekunden (0 = aus)', required: true, maxLength: 5, value: String(s.cooldown_seconds) },
      { id: 'max_open', label: 'Max. offene Tickets pro User', required: true, maxLength: 3, value: String(s.max_open) },
      { id: 'name_pattern', label: 'Name-Muster ({username}/{id})', required: true, maxLength: 60, value: s.name_pattern },
      { id: 'transcript_format', label: 'Transkript-Format (txt/html)', required: true, maxLength: 4, value: s.transcript_format },
    ]);
    if (!result) return;
    const { values, submit } = result;

    const cooldown = parseInt(values.cooldown, 10);
    const maxOpen  = parseInt(values.max_open, 10);
    if (isNaN(cooldown) || cooldown < 0 || cooldown > 3600) {
      await submit.reply({ embeds: [error('Ungültiger Cooldown', '0–3600 Sekunden.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (isNaN(maxOpen) || maxOpen < 1 || maxOpen > 100) {
      await submit.reply({ embeds: [error('Ungültiger Wert', 'Max. offene Tickets: 1–100.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!values.name_pattern.includes('{username}') && !values.name_pattern.includes('{id}')) {
      await submit.reply({ embeds: [error('Ungültiges Muster', 'Muss `{username}` oder `{id}` enthalten.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!['txt', 'html'].includes(values.transcript_format)) {
      await submit.reply({ embeds: [error('Ungültiges Format', '`txt` oder `html`.')], flags: MessageFlags.Ephemeral });
      return;
    }

    Repo.updateSettings(gid, {
      cooldown_seconds: cooldown, max_open: maxOpen, name_pattern: values.name_pattern,
      transcript_format: values.transcript_format as Repo.TicketSettings['transcript_format'],
    });
    return renderTo(submit, renderSettingsOverview(sessionId, gid));
  }

  if (action === 'toggles' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    const embed = new EmbedBuilder().setTitle('Ein/Aus-Optionen').setColor('#5865f2').setDescription('Klicken zum Umschalten.');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'toggledm')).setLabel(`DM bei Schließen: ${s.dm_on_close ? 'An' : 'Aus'}`).setStyle(s.dm_on_close ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'togglebranding')).setLabel(`Branding entfernt: ${s.remove_branding ? 'An' : 'Aus'}`).setStyle(s.remove_branding ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'set', 'togglesurvey')).setLabel(`Umfrage: ${s.survey_enabled ? 'An' : 'Aus'}`).setStyle(s.survey_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    return renderTo(interaction, { embeds: [embed], components: [row, navRow(sessionId, 'set:overview')] });
  }
  if (action === 'toggledm' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    Repo.updateSettings(gid, { dm_on_close: !s.dm_on_close });
    return handleSettingsSection(interaction, sessionId, 'toggles');
  }
  if (action === 'togglebranding' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    Repo.updateSettings(gid, { remove_branding: !s.remove_branding });
    return handleSettingsSection(interaction, sessionId, 'toggles');
  }
  if (action === 'togglesurvey' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    Repo.updateSettings(gid, { survey_enabled: !s.survey_enabled });
    return handleSettingsSection(interaction, sessionId, 'toggles');
  }

  if (action === 'autoclose' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    const result = await promptModal(interaction, buildCustomId(sessionId, 'set', 'autoclosemodal'), 'Autoclose', [
      { id: 'enabled', label: 'Aktiv? (ja/nein)', required: true, maxLength: 4, value: s.autoclose_enabled ? 'ja' : 'nein' },
      { id: 'hours', label: 'Stunden Inaktivität (1-720)', required: true, maxLength: 3, value: String(s.autoclose_hours) },
    ]);
    if (!result) return;
    const { values, submit } = result;
    const enabled = values.enabled.trim().toLowerCase() === 'ja';
    const hours = parseInt(values.hours, 10);
    if (isNaN(hours) || hours < 1 || hours > 720) {
      await submit.reply({ embeds: [error('Ungültiger Wert', '1–720 Stunden.')], flags: MessageFlags.Ephemeral });
      return;
    }
    Repo.updateSettings(gid, { autoclose_enabled: enabled, autoclose_hours: hours });
    return renderTo(submit, renderSettingsOverview(sessionId, gid));
  }

  if (action === 'supporthours' && interaction.isButton()) {
    const s = Repo.getSettings(gid);
    const result = await promptModal(interaction, buildCustomId(sessionId, 'set', 'supporthoursmodal'), 'Support-Zeiten (UTC)', [
      { id: 'enabled', label: 'Aktiv? (ja/nein)', required: true, maxLength: 4, value: s.support_hours_enabled ? 'ja' : 'nein' },
      { id: 'start', label: 'Start (HH:MM)', maxLength: 5, value: s.support_hours_start ?? '' },
      { id: 'end', label: 'Ende (HH:MM)', maxLength: 5, value: s.support_hours_end ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    const enabled = values.enabled.trim().toLowerCase() === 'ja';
    if (values.start && !TIME_REGEX.test(values.start)) {
      await submit.reply({ embeds: [error('Ungültige Startzeit', 'Format HH:MM, z.B. 09:00.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (values.end && !TIME_REGEX.test(values.end)) {
      await submit.reply({ embeds: [error('Ungültige Endzeit', 'Format HH:MM, z.B. 18:00.')], flags: MessageFlags.Ephemeral });
      return;
    }
    Repo.updateSettings(gid, { support_hours_enabled: enabled, support_hours_start: values.start || null, support_hours_end: values.end || null });
    return renderTo(submit, renderSettingsOverview(sessionId, gid));
  }

  if (action === 'overview') return renderTo(interaction, renderSettingsOverview(sessionId, gid));
}
