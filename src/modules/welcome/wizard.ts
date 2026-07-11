/**
 * modules/welcome/wizard.ts
 *
 * /welcome setup → guided menu covering everything the old flat subcommands
 * did (setup, disable, dm, leave, autorole, alt, background, cardimage,
 * avatarbg, preview) — same underlying Repo.updateSettings() calls, just
 * click-through instead of typed options. The old subcommands are removed;
 * this is the only way to configure welcome/leave messages now.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder,
  EmbedBuilder, MessageFlags, TextChannel, TextInputStyle,
  ChatInputCommandInteraction, GuildMember, AttachmentBuilder,
} from 'discord.js';
import * as Repo from './repository';
import { createWelcomeCard } from './card';
import { isSafeHttpsUrl } from '../../utils/validators';
import { success, error } from '../../utils/embeds';
import {
  createSession, getSession, endSession, touchSession, parseWizardId, buildWizardId,
  navRow, promptModal, renderTo, expiredView, noPermissionView,
  WizardComponentInteraction, WizardView,
} from '../../utils/wizardKit';
import { logConfigChange } from '../audit/configAudit';

const PREFIX = 'ww';
const VALID_HEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export function isWelcomeWizardComponent(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

export async function startWelcomeWizard(ix: ChatInputCommandInteraction): Promise<void> {
  const sessionId = createSession(PREFIX, ix.guildId!, ix.user.id);
  await ix.reply({ ...renderMainMenu(sessionId, ix.guildId!), flags: MessageFlags.Ephemeral });
}

// ── Main menu ──────────────────────────────────────────────────────────────────

function renderMainMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);

  const embed = new EmbedBuilder()
    .setTitle('👋 Welcome-System — Setup')
    .setColor('#5865f2')
    .addFields(
      { name: 'Beitritt',      value: s.enabled ? `✅ <#${s.channel_id}>` : '❌ Aus', inline: true },
      { name: 'Austritt',      value: s.leave_enabled ? (s.leave_channel_id ? `✅ <#${s.leave_channel_id}>` : '✅ (kein Channel)') : '❌ Aus', inline: true },
      { name: 'DM',            value: s.dm_enabled ? '✅ An' : '❌ Aus', inline: true },
      { name: 'Auto-Rollen',   value: [s.autorole_id && `Sofort: <@&${s.autorole_id}>`, s.autorole_delay_id && `Verzögert: <@&${s.autorole_delay_id}> (${s.autorole_delay_min}min)`, s.autorole_after_verify && `Nach Verify: <@&${s.autorole_after_verify}>`].filter(Boolean).join('\n') || 'Keine' },
      { name: 'Alt-Erkennung', value: s.alt_enabled ? `✅ < ${s.alt_min_age_days} Tage → ${s.alt_action}` : '❌ Aus', inline: true },
      { name: 'Karten-Design', value: [s.background_url && 'Hintergrund gesetzt', s.card_image_url && 'Banner gesetzt', s.avatar_bg_enabled && 'Avatar-Hintergrund an'].filter(Boolean).join(', ') || 'Standard', inline: true },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'join', 'menu')).setLabel('👋 Beitritt').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'leave', 'menu')).setLabel('🚪 Austritt').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'dm', 'menu')).setLabel('💬 DM').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', 'menu')).setLabel('🎭 Auto-Rollen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'menu')).setLabel('🔰 Alt-Erkennung').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'card', 'menu')).setLabel('🖼️ Karten-Design').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'preview', 'show')).setLabel('👁️ Vorschau').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'nav', 'close')).setLabel('❌ Schließen').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

// ── Join ───────────────────────────────────────────────────────────────────────

function renderJoinMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('👋 Beitritts-Nachricht').setColor('#5865f2')
    .addFields(
      { name: 'Status',  value: s.enabled ? '✅ An' : '❌ Aus', inline: true },
      { name: 'Channel', value: s.channel_id ? `<#${s.channel_id}>` : '—', inline: true },
      { name: 'Karte',   value: s.use_card ? 'An' : 'Aus', inline: true },
      { name: 'Nachricht', value: s.message || '*(Standard)*' },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'join', 'channel')).setLabel('Channel wählen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'join', 'text')).setLabel('Text bearbeiten').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'join', 'toggle')).setLabel(s.enabled ? 'Deaktivieren' : 'Aktivieren').setStyle(s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row, navRow(PREFIX, sessionId, 'menu')] };
}

function renderJoinChannelStep(sessionId: string): WizardView {
  const embed = new EmbedBuilder().setTitle('👋 Beitritts-Channel').setColor('#5865f2').setDescription('Channel wählen.');
  const select = new ChannelSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'join', 'setchannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
  return { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(PREFIX, sessionId, 'join:menu')] };
}

// ── Leave ──────────────────────────────────────────────────────────────────────

function renderLeaveMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('🚪 Austritts-Nachricht').setColor('#5865f2')
    .addFields(
      { name: 'Status',  value: s.leave_enabled ? '✅ An' : '❌ Aus', inline: true },
      { name: 'Channel', value: s.leave_channel_id ? `<#${s.leave_channel_id}>` : '*(gleicher wie Beitritt)*', inline: true },
      { name: 'Nachricht', value: s.leave_message || '*(Standard)*' },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'leave', 'channel')).setLabel('Channel wählen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'leave', 'text')).setLabel('Text bearbeiten').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'leave', 'toggle')).setLabel(s.leave_enabled ? 'Deaktivieren' : 'Aktivieren').setStyle(s.leave_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row, navRow(PREFIX, sessionId, 'menu')] };
}

function renderLeaveChannelStep(sessionId: string): WizardView {
  const embed = new EmbedBuilder().setTitle('🚪 Austritts-Channel').setColor('#5865f2').setDescription('Channel wählen.');
  const select = new ChannelSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'leave', 'setchannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
  return { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(PREFIX, sessionId, 'leave:menu')] };
}

// ── DM ─────────────────────────────────────────────────────────────────────────

function renderDmMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('💬 Willkommens-DM').setColor('#5865f2')
    .addFields(
      { name: 'Status', value: s.dm_enabled ? '✅ An' : '❌ Aus', inline: true },
      { name: 'Nachricht', value: s.dm_message || '*(Standard)*' },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'dm', 'text')).setLabel('Text bearbeiten').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'dm', 'toggle')).setLabel(s.dm_enabled ? 'Deaktivieren' : 'Aktivieren').setStyle(s.dm_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row, navRow(PREFIX, sessionId, 'menu')] };
}

// ── Auto-roles ─────────────────────────────────────────────────────────────────

function renderAutoroleMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('🎭 Auto-Rollen').setColor('#5865f2')
    .addFields(
      { name: 'Sofort',      value: s.autorole_id ? `<@&${s.autorole_id}>` : '—', inline: true },
      { name: 'Verzögert',   value: s.autorole_delay_id ? `<@&${s.autorole_delay_id}> (${s.autorole_delay_min}min)` : '—', inline: true },
      { name: 'Nach Verify', value: s.autorole_after_verify ? `<@&${s.autorole_after_verify}>` : '—', inline: true },
    );
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', 'instant')).setLabel('Sofort-Rolle').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', 'delayed')).setLabel('Verzögerte Rolle').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', 'verify')).setLabel('Verify-Rolle').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row1, navRow(PREFIX, sessionId, 'menu')] };
}

function renderRoleSelectStep(sessionId: string, kind: 'instant' | 'delayed' | 'verify', title: string): WizardView {
  const embed = new EmbedBuilder().setTitle(title).setColor('#5865f2').setDescription('Rolle wählen, oder entfernen.');
  const select = new RoleSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', `set${kind}`)).setPlaceholder('Rolle wählen');
  const clear = new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'autorole', `set${kind}`, 'clear')).setLabel('Entfernen').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(clear), navRow(PREFIX, sessionId, 'autorole:menu')] };
}

// ── Alt detection ────────────────────────────────────────────────────────────

function renderAltMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('🔰 Alt-Erkennung').setColor('#5865f2')
    .addFields(
      { name: 'Status',       value: s.alt_enabled ? '✅ An' : '❌ Aus', inline: true },
      { name: 'Min. Alter',   value: `${s.alt_min_age_days} Tage`, inline: true },
      { name: 'Aktion',       value: s.alt_action === 'kick' ? 'Auto-Kick' : 'Nur loggen', inline: true },
      { name: 'Log-Channel',  value: s.alt_log_channel_id ? `<#${s.alt_log_channel_id}>` : '—' },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'toggle')).setLabel(s.alt_enabled ? 'Deaktivieren' : 'Aktivieren').setStyle(s.alt_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'config')).setLabel('Konfigurieren').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'channel')).setLabel('Log-Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'action')).setLabel(`Aktion: ${s.alt_action === 'kick' ? 'Kick' : 'Log'}`).setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, navRow(PREFIX, sessionId, 'menu')] };
}

// ── Card design ────────────────────────────────────────────────────────────────

function renderCardMenu(sessionId: string, guildId: string): WizardView {
  const s = Repo.getSettings(guildId);
  const embed = new EmbedBuilder().setTitle('🖼️ Karten-Design').setColor('#5865f2')
    .addFields(
      { name: 'Hintergrund',       value: s.background_url ? '✅ Gesetzt' : '— Standard', inline: true },
      { name: 'Banner (rechts)',   value: s.card_image_url ? '✅ Gesetzt' : '—', inline: true },
      { name: 'Avatar-Hintergrund', value: s.avatar_bg_enabled ? '✅ An' : '❌ Aus', inline: true },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'card', 'background')).setLabel('Hintergrund-URL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'card', 'cardimage')).setLabel('Banner-URL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'card', 'avatarbg')).setLabel(s.avatar_bg_enabled ? 'Avatar-BG: An' : 'Avatar-BG: Aus').setStyle(s.avatar_bg_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, navRow(PREFIX, sessionId, 'menu')] };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

function renderPath(sessionId: string, guildId: string, path: string): WizardView {
  if (!path || path === 'menu') return renderMainMenu(sessionId, guildId);
  const [section, action] = path.split(':');
  switch (`${section}:${action}`) {
    case 'join:menu':     return renderJoinMenu(sessionId, guildId);
    case 'leave:menu':    return renderLeaveMenu(sessionId, guildId);
    case 'dm:menu':       return renderDmMenu(sessionId, guildId);
    case 'autorole:menu': return renderAutoroleMenu(sessionId, guildId);
    case 'alt:menu':      return renderAltMenu(sessionId, guildId);
    case 'card:menu':     return renderCardMenu(sessionId, guildId);
    default:              return renderMainMenu(sessionId, guildId);
  }
}

export async function handleWelcomeWizardComponent(interaction: WizardComponentInteraction): Promise<void> {
  const { sessionId, section, action, args } = parseWizardId(interaction.customId);
  const session = getSession(PREFIX, sessionId);

  if (!session) { await renderTo(interaction, expiredView()); return; }
  if (interaction.user.id !== session.userId) { await renderTo(interaction, noPermissionView()); return; }
  touchSession(PREFIX, sessionId);
  const gid = session.guildId;

  if (section === 'nav') {
    if (action === 'back') { await renderTo(interaction, renderPath(sessionId, gid, args.join(':') || 'menu')); return; }
    if (action === 'close') {
      endSession(PREFIX, sessionId);
      if (interaction.isButton()) await interaction.update({ embeds: [success('Geschlossen', 'Setup beendet.')], components: [] }).catch(() => {});
      return;
    }
    return;
  }

  if (section === 'preview' && action === 'show' && interaction.isButton()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member as GuildMember;
    const s = Repo.getSettings(gid);
    try {
      const buf = await createWelcomeCard(member, s.background_url, s.card_image_url, s.avatar_bg_enabled === 1);
      const att = new AttachmentBuilder(buf, { name: 'welcome-preview.png' });
      const e = new EmbedBuilder().setColor((s.color || '#5865f2') as `#${string}`).setTitle('👁️ Vorschau').setImage('attachment://welcome-preview.png');
      await interaction.editReply({ embeds: [e], files: [att] });
    } catch {
      await interaction.editReply({ content: 'Vorschau fehlgeschlagen.' });
    }
    return;
  }

  // ── Join ───────────────────────────────────────────────────────────────────
  if (section === 'join') {
    if (action === 'menu') { await renderTo(interaction, renderJoinMenu(sessionId, gid)); return; }
    if (action === 'channel' && interaction.isButton()) { await renderTo(interaction, renderJoinChannelStep(sessionId)); return; }
    if (action === 'setchannel' && interaction.isChannelSelectMenu()) {
      Repo.updateSettings(gid, { enabled: 1, channel_id: interaction.values[0] });
      await renderTo(interaction, renderJoinMenu(sessionId, gid));
      return;
    }
    if (action === 'toggle' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { enabled: s.enabled ? 0 : 1 });
      logConfigChange(gid, interaction.user.id, 'welcome_join_toggled', s.enabled ? 'off' : 'on');
      await renderTo(interaction, renderJoinMenu(sessionId, gid));
      return;
    }
    if (action === 'text' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'join', 'textmodal'), 'Beitritts-Text', [
        { id: 'message', label: '{user}/{username}/{server}/{membercount}', style: TextInputStyle.Paragraph, maxLength: 2000, value: s.message ?? '' },
        { id: 'color', label: 'Farbe (Hex)', maxLength: 7, value: s.color ?? '#5865f2' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      if (values.color && !VALID_HEX.test(values.color)) {
        await submit.reply({ embeds: [error('Ungültige Farbe', 'Hex-Format, z.B. #5865f2.')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { message: values.message.trim() || null, color: values.color || '#5865f2' });
      await renderTo(submit, renderJoinMenu(sessionId, gid));
      return;
    }
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  if (section === 'leave') {
    if (action === 'menu') { await renderTo(interaction, renderLeaveMenu(sessionId, gid)); return; }
    if (action === 'channel' && interaction.isButton()) { await renderTo(interaction, renderLeaveChannelStep(sessionId)); return; }
    if (action === 'setchannel' && interaction.isChannelSelectMenu()) {
      Repo.updateSettings(gid, { leave_channel_id: interaction.values[0] });
      await renderTo(interaction, renderLeaveMenu(sessionId, gid));
      return;
    }
    if (action === 'toggle' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { leave_enabled: s.leave_enabled ? 0 : 1 });
      logConfigChange(gid, interaction.user.id, 'welcome_leave_toggled', s.leave_enabled ? 'off' : 'on');
      await renderTo(interaction, renderLeaveMenu(sessionId, gid));
      return;
    }
    if (action === 'text' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'leave', 'textmodal'), 'Austritts-Text', [
        { id: 'message', label: '{user}/{server}', style: TextInputStyle.Paragraph, maxLength: 2000, value: s.leave_message ?? '' },
        { id: 'color', label: 'Farbe (Hex)', maxLength: 7, value: s.leave_color ?? '#ed4245' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      if (values.color && !VALID_HEX.test(values.color)) {
        await submit.reply({ embeds: [error('Ungültige Farbe', 'Hex-Format, z.B. #ed4245.')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { leave_message: values.message.trim() || null, leave_color: values.color || '#ed4245' });
      await renderTo(submit, renderLeaveMenu(sessionId, gid));
      return;
    }
  }

  // ── DM ─────────────────────────────────────────────────────────────────────
  if (section === 'dm') {
    if (action === 'menu') { await renderTo(interaction, renderDmMenu(sessionId, gid)); return; }
    if (action === 'toggle' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { dm_enabled: s.dm_enabled ? 0 : 1 });
      await renderTo(interaction, renderDmMenu(sessionId, gid));
      return;
    }
    if (action === 'text' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'dm', 'textmodal'), 'DM-Text', [
        { id: 'message', label: 'Nachricht ({user})', style: TextInputStyle.Paragraph, maxLength: 2000, value: s.dm_message ?? '' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      Repo.updateSettings(gid, { dm_message: values.message.trim() || null });
      await renderTo(submit, renderDmMenu(sessionId, gid));
      return;
    }
  }

  // ── Auto-roles ─────────────────────────────────────────────────────────────
  if (section === 'autorole') {
    if (action === 'menu') { await renderTo(interaction, renderAutoroleMenu(sessionId, gid)); return; }
    if (action === 'instant' && interaction.isButton()) { await renderTo(interaction, renderRoleSelectStep(sessionId, 'instant', '🎭 Sofort-Rolle')); return; }
    if (action === 'delayed' && interaction.isButton()) { await renderTo(interaction, renderRoleSelectStep(sessionId, 'delayed', '🎭 Verzögerte Rolle')); return; }
    if (action === 'verify' && interaction.isButton()) { await renderTo(interaction, renderRoleSelectStep(sessionId, 'verify', '🎭 Verify-Rolle')); return; }

    if (action === 'setinstant') {
      const roleId = args[0] === 'clear' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : undefined);
      if (roleId === undefined) return;
      Repo.updateSettings(gid, { autorole_id: roleId });
      await renderTo(interaction, renderAutoroleMenu(sessionId, gid));
      return;
    }
    if (action === 'setdelayed') {
      const roleId = args[0] === 'clear' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : undefined);
      if (roleId === undefined) return;
      if (roleId === null) {
        Repo.updateSettings(gid, { autorole_delay_id: null, autorole_delay_min: 0 });
        await renderTo(interaction, renderAutoroleMenu(sessionId, gid));
        return;
      }
      const result = await promptModal(interaction as any, buildWizardId(PREFIX, sessionId, 'autorole', 'delaymodal'), 'Verzögerung', [
        { id: 'minutes', label: 'Minuten bis Rollenvergabe', required: true, maxLength: 5, value: '60' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      const minutes = parseInt(values.minutes, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
        await submit.reply({ embeds: [error('Ungültiger Wert', '1–10080 Minuten (7 Tage).')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { autorole_delay_id: roleId, autorole_delay_min: minutes });
      await renderTo(submit, renderAutoroleMenu(sessionId, gid));
      return;
    }
    if (action === 'setverify') {
      const roleId = args[0] === 'clear' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : undefined);
      if (roleId === undefined) return;
      Repo.updateSettings(gid, { autorole_after_verify: roleId });
      await renderTo(interaction, renderAutoroleMenu(sessionId, gid));
      return;
    }
  }

  // ── Alt detection ──────────────────────────────────────────────────────────
  if (section === 'alt') {
    if (action === 'menu') { await renderTo(interaction, renderAltMenu(sessionId, gid)); return; }
    if (action === 'toggle' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { alt_enabled: s.alt_enabled ? 0 : 1 });
      await renderTo(interaction, renderAltMenu(sessionId, gid));
      return;
    }
    if (action === 'action' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { alt_action: s.alt_action === 'kick' ? 'log' : 'kick' });
      await renderTo(interaction, renderAltMenu(sessionId, gid));
      return;
    }
    if (action === 'config' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'alt', 'configmodal'), 'Alt-Erkennung', [
        { id: 'days', label: 'Mindestalter in Tagen', required: true, maxLength: 3, value: String(s.alt_min_age_days) },
      ]);
      if (!result) return;
      const { values, submit } = result;
      const days = parseInt(values.days, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        await submit.reply({ embeds: [error('Ungültiger Wert', '1–365 Tage.')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { alt_min_age_days: days });
      await renderTo(submit, renderAltMenu(sessionId, gid));
      return;
    }
    if (action === 'channel' && interaction.isButton()) {
      const embed = new EmbedBuilder().setTitle('🔰 Log-Channel').setColor('#5865f2').setDescription('Channel wählen.');
      const select = new ChannelSelectMenuBuilder().setCustomId(buildWizardId(PREFIX, sessionId, 'alt', 'setchannel')).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
      await renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(PREFIX, sessionId, 'alt:menu')] });
      return;
    }
    if (action === 'setchannel' && interaction.isChannelSelectMenu()) {
      Repo.updateSettings(gid, { alt_log_channel_id: interaction.values[0] });
      await renderTo(interaction, renderAltMenu(sessionId, gid));
      return;
    }
  }

  // ── Card design ────────────────────────────────────────────────────────────
  if (section === 'card') {
    if (action === 'menu') { await renderTo(interaction, renderCardMenu(sessionId, gid)); return; }
    if (action === 'avatarbg' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      Repo.updateSettings(gid, { avatar_bg_enabled: s.avatar_bg_enabled ? 0 : 1 });
      await renderTo(interaction, renderCardMenu(sessionId, gid));
      return;
    }
    if (action === 'background' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'card', 'bgmodal'), 'Hintergrund-URL', [
        { id: 'url', label: 'HTTPS-Bild-URL (leer = zurücksetzen)', maxLength: 500, value: s.background_url ?? '' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      const url = values.url.trim() || null;
      if (url && !isSafeHttpsUrl(url)) {
        await submit.reply({ embeds: [error('Ungültige URL', 'Nur HTTPS-Bild-URLs (PNG/JPG/GIF/WEBP).')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { background_url: url });
      await renderTo(submit, renderCardMenu(sessionId, gid));
      return;
    }
    if (action === 'cardimage' && interaction.isButton()) {
      const s = Repo.getSettings(gid);
      const result = await promptModal(interaction, buildWizardId(PREFIX, sessionId, 'card', 'imgmodal'), 'Banner-URL', [
        { id: 'url', label: 'HTTPS-Bild-URL (leer = entfernen)', maxLength: 500, value: s.card_image_url ?? '' },
      ]);
      if (!result) return;
      const { values, submit } = result;
      const url = values.url.trim() || null;
      if (url && !isSafeHttpsUrl(url)) {
        await submit.reply({ embeds: [error('Ungültige URL', 'Nur HTTPS-Bild-URLs (PNG/JPG/GIF/WEBP).')], flags: MessageFlags.Ephemeral });
        return;
      }
      Repo.updateSettings(gid, { card_image_url: url });
      await renderTo(submit, renderCardMenu(sessionId, gid));
      return;
    }
  }
}
