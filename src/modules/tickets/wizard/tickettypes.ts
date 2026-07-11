/**
 * modules/tickets/wizard/tickettypes.ts
 *
 * Reusable category templates (ticket_types table) — a saved
 * label/emoji/color/channel/role/welcome combo you can stamp onto new
 * categories quickly instead of re-entering everything each time.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags,
} from 'discord.js';
import * as Repo from '../repository';
import { success, error } from '../../../utils/embeds';
import { buildCustomId, getSession, touchSession } from './session';
import { navRow, promptModal, renderTo, WizardComponentInteraction, WizardView } from './helpers';

export function renderTypeList(sessionId: string, guildId: string): WizardView {
  const types = Repo.listTicketTypes(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Ticket-Vorlagen')
    .setColor('#5865f2')
    .setDescription('Wiederverwendbare Kategorie-Vorlagen (Label/Emoji/Farbe/Kanal/Rolle) für schnelleres Anlegen neuer Kategorien.')
    .addFields(types.length > 0
      ? types.map(t => ({ name: `${t.emoji ?? '🎫'} ${t.label}`, value: `ID: \`${t.custom_id}\` • <#${t.category_id}>${t.support_role_id ? ` • <@&${t.support_role_id}>` : ''}`, inline: false }))
      : [{ name: 'Keine Vorlagen', value: '*Erstelle eine über den Button unten.*' }]);

  const components: ActionRowBuilder<any>[] = [];
  if (types.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'type', 'pick'))
      .setPlaceholder('Vorlage zum Löschen wählen')
      .addOptions(types.slice(0, 25).map(t => ({ label: t.label.slice(0, 100), value: t.custom_id, description: `ID: ${t.custom_id}`.slice(0, 100) })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'type', 'create')).setLabel('➕ Neue Vorlage').setStyle(ButtonStyle.Success),
  ));
  components.push(navRow(sessionId, 'menu'));

  return { embeds: [embed], components };
}

function renderCreateChannelStep(sessionId: string): WizardView {
  const embed = new EmbedBuilder().setTitle('➕ Vorlage erstellen (2/3)').setColor('#5865f2').setDescription('Discord-Kategorie wählen.');
  const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'type', 'createchannel')).setPlaceholder('Kategorie wählen').addChannelTypes(ChannelType.GuildCategory);
  return { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(sessionId, 'type:list')] };
}

function renderCreateRoleStep(sessionId: string): WizardView {
  const embed = new EmbedBuilder().setTitle('➕ Vorlage erstellen (3/3)').setColor('#5865f2').setDescription('Support-Rolle wählen. Optional.');
  const select = new RoleSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'type', 'createrole')).setPlaceholder('Rolle wählen');
  const skip = new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'type', 'createrole', 'skip')).setLabel('Überspringen').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(skip), navRow(sessionId, 'type:list')] };
}

export async function handleTicketTypeSection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const session = getSession(sessionId)!;
  const gid = session.guildId;

  if (action === 'create' && interaction.isButton()) {
    const result = await promptModal(interaction, buildCustomId(sessionId, 'type', 'createmodal'), 'Vorlage erstellen (1/3)', [
      { id: 'custom_id', label: 'Interne ID (kurz, ohne Leerzeichen)', required: true, maxLength: 50 },
      { id: 'label', label: 'Label', required: true, maxLength: 100 },
      { id: 'emoji', label: 'Emoji (optional)', maxLength: 20 },
      { id: 'color', label: 'Farbe (primary/secondary/success/danger)', maxLength: 10, value: 'primary' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    if (!['primary', 'secondary', 'success', 'danger'].includes(values.color || 'primary')) {
      await submit.reply({ embeds: [error('Ungültige Farbe', 'primary, secondary, success oder danger.')], flags: MessageFlags.Ephemeral });
      return;
    }
    session.data.pendingType = { customId: values.custom_id.trim().replace(/\s+/g, '-'), label: values.label, emoji: values.emoji.trim() || null, color: values.color || 'primary' };
    touchSession(sessionId);
    return renderTo(submit, renderCreateChannelStep(sessionId));
  }

  if (action === 'createchannel' && interaction.isChannelSelectMenu()) {
    const pending = session.data.pendingType as any;
    if (!pending) return;
    pending.categoryId = interaction.values[0];
    touchSession(sessionId);
    return renderTo(interaction, renderCreateRoleStep(sessionId));
  }

  if (action === 'createrole') {
    const pending = session.data.pendingType as any;
    if (!pending) return;
    const roleId = args[0] === 'skip' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : null);

    Repo.upsertTicketType({
      custom_id: pending.customId, guild_id: gid, label: pending.label, emoji: pending.emoji,
      color: pending.color, category_id: pending.categoryId, support_role_id: roleId, welcome_message: null,
    });
    delete session.data.pendingType;

    return renderTo(interaction, { embeds: [success('✅ Vorlage erstellt', `**${pending.label}** wurde gespeichert.`)], components: [navRow(sessionId, 'type:list')] });
  }

  if (action === 'pick' && interaction.isStringSelectMenu()) {
    const customId = interaction.values[0];
    const type = Repo.getTicketType(gid, customId);
    if (!type) return renderTo(interaction, renderTypeList(sessionId, gid));
    Repo.deleteTicketType(gid, customId);
    return renderTo(interaction, { embeds: [success('🗑️ Gelöscht', `Vorlage **${type.label}** wurde entfernt.`)], components: [navRow(sessionId, 'type:list')] });
  }

  if (action === 'list') return renderTo(interaction, renderTypeList(sessionId, gid));
}
