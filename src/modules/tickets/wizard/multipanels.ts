/**
 * modules/tickets/wizard/multipanels.ts
 *
 * Multi-panel management — combine up to 5 existing panels into one message
 * with a panel-picker select menu. A panel needs at least one category to
 * be eligible (same rule the old /multipanel command enforced).
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags, TextChannel, TextInputStyle,
} from 'discord.js';
import * as Repo from '../repository';
import { buildMultiPanelEmbed, buildMultiPanelComponents } from '../builder';
import { refreshMultiPanelMessage } from '../service';
import { success, error } from '../../../utils/embeds';
import { buildCustomId, getSession, touchSession } from './session';
import { navRow, promptModal, renderTo, WizardComponentInteraction, WizardView } from './helpers';

const MAX_PANELS = 25;

export function renderMultiPanelList(sessionId: string, guildId: string): WizardView {
  const multis = Repo.listMultiPanels(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🧩 Multi-Panels')
    .setColor('#5865f2')
    .setDescription(multis.length === 0 ? 'Noch keine Multi-Panels.' : 'Multi-Panel zum Bearbeiten wählen, oder ein neues erstellen.');

  const components: ActionRowBuilder<any>[] = [];
  if (multis.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'multi', 'pick'))
      .setPlaceholder('Multi-Panel auswählen')
      .addOptions(multis.slice(0, 25).map(m => ({
        label: m.name.slice(0, 100),
        value: String(m.id),
        description: `[${m.id}] ${(JSON.parse(m.panel_ids) as number[]).length} Panel(s) • ${m.message_id ? 'gesendet' : 'nicht gesendet'}`.slice(0, 100),
      })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'create')).setLabel('➕ Neues Multi-Panel').setStyle(ButtonStyle.Success),
  ));
  components.push(navRow(sessionId, 'menu'));

  return { embeds: [embed], components };
}

export function renderMultiPanelDetail(sessionId: string, multiId: number): WizardView {
  const multi = Repo.getMultiPanel(multiId);
  if (!multi) return { embeds: [error('Nicht gefunden', 'Dieses Multi-Panel existiert nicht mehr.')], components: [navRow(sessionId, 'multi:list')] };

  const ids = JSON.parse(multi.panel_ids) as number[];
  const panels = ids.map(id => Repo.getPanel(id)).filter((p): p is Repo.Panel => p !== null);

  const embed = new EmbedBuilder()
    .setTitle(`🧩 Multi-Panel: ${multi.name}`)
    .setColor((multi.color as any) || '#5865f2')
    .addFields(
      { name: 'ID',        value: `\`${multi.id}\``, inline: true },
      { name: 'Titel',     value: multi.title, inline: true },
      { name: 'Gesendet',  value: multi.message_id ? `<#${multi.channel_id}>` : 'Noch nicht', inline: true },
      { name: 'Beschreibung', value: multi.description || '*(keine)*' },
      { name: `Panels (${panels.length}/${MAX_PANELS})`, value: panels.length > 0 ? panels.map(p => `• **${p.title}** \`[${p.id}]\``).join('\n') : '*Keine — füge welche hinzu.*' },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'edittext', multiId)).setLabel('✏️ Text').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'addpanel', multiId)).setLabel('➕ Panel hinzufügen').setStyle(ButtonStyle.Secondary).setDisabled(panels.length >= MAX_PANELS),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'send', multiId)).setLabel('📤 Senden').setStyle(ButtonStyle.Success).setDisabled(panels.length === 0),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'delete', multiId)).setLabel('🗑️ Löschen').setStyle(ButtonStyle.Danger),
  );

  const components: ActionRowBuilder<any>[] = [row1];

  if (panels.length > 0) {
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'multi', 'removepanel', multiId))
      .setPlaceholder('Panel entfernen…')
      .addOptions(panels.slice(0, 25).map(p => ({ label: p.title.slice(0, 100), value: String(p.id) })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect));
  }

  components.push(navRow(sessionId, 'multi:list'));
  return { embeds: [embed], components };
}

function renderAddPanelStep(sessionId: string, multiId: number): WizardView {
  const multi = Repo.getMultiPanel(multiId)!;
  const existingIds = new Set(JSON.parse(multi.panel_ids) as number[]);
  const guildId = getSession(sessionId)!.guildId;

  const candidates = Repo.listPanels(guildId).filter(p => !existingIds.has(p.id) && Repo.listCategories(p.id).length > 0);

  const embed = new EmbedBuilder().setTitle('➕ Panel hinzufügen').setColor('#5865f2')
    .setDescription(candidates.length === 0
      ? 'Keine passenden Panels verfügbar (brauchen mind. 1 Kategorie und dürfen noch nicht im Multi-Panel sein).'
      : 'Panel(s) auswählen (Mehrfachauswahl möglich).');

  const components: ActionRowBuilder<any>[] = [];
  if (candidates.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'multi', 'addpanelpick', multiId))
      .setPlaceholder('Panel(s) wählen')
      .setMinValues(1)
      .setMaxValues(Math.min(candidates.length, MAX_PANELS - existingIds.size))
      .addOptions(candidates.slice(0, 25).map(p => ({ label: p.title.slice(0, 100), value: String(p.id), description: `[${p.id}] ${Repo.listCategories(p.id).length} Kategorie(n)`.slice(0, 100) })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(navRow(sessionId, `multi:detail:${multiId}`));
  return { embeds: [embed], components };
}

export async function handleMultiPanelSection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const session = getSession(sessionId)!;
  const gid = session.guildId;

  if (action === 'pick' && interaction.isStringSelectMenu()) {
    return renderTo(interaction, renderMultiPanelDetail(sessionId, Number(interaction.values[0])));
  }

  if (action === 'create' && interaction.isButton()) {
    const result = await promptModal(interaction, buildCustomId(sessionId, 'multi', 'createmodal'), 'Neues Multi-Panel', [
      { id: 'name', label: 'Interner Name', required: true, maxLength: 100, value: 'Support' },
      { id: 'title', label: 'Titel (im Embed sichtbar)', required: true, maxLength: 256, value: 'Support — Kategorie wählen' },
      { id: 'description', label: 'Beschreibung (optional)', style: TextInputStyle.Paragraph, maxLength: 1000 },
    ]);
    if (!result) return;
    const { values, submit } = result;
    const multi = Repo.createMultiPanel({ guild_id: gid, name: values.name || 'Support', title: values.title || values.name, description: values.description.trim() || null, color: '#5865f2' });
    return renderTo(submit, renderMultiPanelDetail(sessionId, multi.id));
  }

  const multiIdArg = args[0] ? Number(args[0]) : undefined;
  if (multiIdArg === undefined) return;

  if (action === 'edittext' && interaction.isButton()) {
    const multi = Repo.getMultiPanel(multiIdArg);
    if (!multi) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'multi', 'edittextmodal', multiIdArg), 'Multi-Panel-Text bearbeiten', [
      { id: 'name', label: 'Interner Name', required: true, maxLength: 100, value: multi.name },
      { id: 'title', label: 'Titel', required: true, maxLength: 256, value: multi.title },
      { id: 'description', label: 'Beschreibung', style: TextInputStyle.Paragraph, maxLength: 1000, value: multi.description ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.updateMultiPanel(multiIdArg, { name: values.name, title: values.title, description: values.description.trim() || null });
    const updated = Repo.getMultiPanel(multiIdArg)!;
    if (updated.message_id && updated.channel_id) await refreshMultiPanelMessage(interaction.guild!, updated).catch(() => {});
    return renderTo(submit, renderMultiPanelDetail(sessionId, multiIdArg));
  }

  if (action === 'addpanel' && interaction.isButton()) {
    return renderTo(interaction, renderAddPanelStep(sessionId, multiIdArg));
  }
  if (action === 'addpanelpick' && interaction.isStringSelectMenu()) {
    const multi = Repo.getMultiPanel(multiIdArg);
    if (!multi) return;
    const existingIds = JSON.parse(multi.panel_ids) as number[];
    const toAdd = interaction.values.map(Number).filter(id => !existingIds.includes(id));
    const merged = [...existingIds, ...toAdd].slice(0, MAX_PANELS);
    Repo.updateMultiPanelPanels(multiIdArg, merged);
    const updated = Repo.getMultiPanel(multiIdArg)!;
    if (updated.message_id && updated.channel_id) await refreshMultiPanelMessage(interaction.guild!, updated).catch(() => {});
    touchSession(sessionId);
    return renderTo(interaction, renderMultiPanelDetail(sessionId, multiIdArg));
  }

  if (action === 'removepanel' && interaction.isStringSelectMenu()) {
    const multi = Repo.getMultiPanel(multiIdArg);
    if (!multi) return;
    const remaining = (JSON.parse(multi.panel_ids) as number[]).filter(id => id !== Number(interaction.values[0]));
    Repo.updateMultiPanelPanels(multiIdArg, remaining);
    const updated = Repo.getMultiPanel(multiIdArg)!;
    if (updated.message_id && updated.channel_id) await refreshMultiPanelMessage(interaction.guild!, updated).catch(() => {});
    return renderTo(interaction, renderMultiPanelDetail(sessionId, multiIdArg));
  }

  if (action === 'send' && interaction.isButton()) {
    const embed = new EmbedBuilder().setTitle('📤 Multi-Panel senden').setColor('#5865f2').setDescription('Ziel-Channel wählen.');
    const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'multi', 'sendto', multiIdArg)).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(sessionId, `multi:detail:${multiIdArg}`)] });
  }
  if (action === 'sendto' && interaction.isChannelSelectMenu()) {
    const multi = Repo.getMultiPanel(multiIdArg);
    if (!multi) return;
    const ids = JSON.parse(multi.panel_ids) as number[];
    const panels = ids.map(id => Repo.getPanel(id)).filter((p): p is Repo.Panel => p !== null);
    if (panels.length === 0) return renderTo(interaction, { embeds: [error('Keine Panels', 'Füge zuerst mindestens ein Panel hinzu.')], components: [navRow(sessionId, `multi:detail:${multiIdArg}`)] });

    try {
      const channel = await interaction.guild!.channels.fetch(interaction.values[0]) as TextChannel;
      const msg = await channel.send({ content: multi.content ?? undefined, embeds: [buildMultiPanelEmbed(multi, panels)], components: buildMultiPanelComponents(multi, panels) as any });
      Repo.updateMultiPanelMessage(multi.id, channel.id, msg.id);
      return renderTo(interaction, { embeds: [success('✅ Gesendet', `Multi-Panel in <#${channel.id}> gepostet.`)], components: [navRow(sessionId, `multi:detail:${multiIdArg}`)] });
    } catch (err) {
      console.error('[TicketWizard] send multipanel failed:', err);
      return renderTo(interaction, { embeds: [error('Senden fehlgeschlagen', 'Fehlende Bot-Berechtigungen im Ziel-Channel?')], components: [navRow(sessionId, `multi:detail:${multiIdArg}`)] });
    }
  }

  if (action === 'delete' && interaction.isButton()) {
    Repo.deleteMultiPanel(multiIdArg);
    return renderTo(interaction, { embeds: [success('🗑️ Gelöscht', 'Multi-Panel wurde entfernt.')], components: [navRow(sessionId, 'multi:list')] });
  }
}
