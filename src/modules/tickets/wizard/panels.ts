/**
 * modules/tickets/wizard/panels.ts
 *
 * Panel + Category + Form-question management — all nested under "🎫 Panels"
 * in the main menu, since categories and form questions only ever make
 * sense in the context of a specific panel.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags, TextChannel, TextInputStyle,
} from 'discord.js';
import * as Repo from '../repository';
import { buildPanelEmbed, buildPanelComponents } from '../builder';
import { refreshPanelMessage } from '../service';
import { success, error, info } from '../../../utils/embeds';
import { buildCustomId, getSession, touchSession } from './session';
import { navRow, promptModal, renderTo, WizardComponentInteraction, WizardView } from './helpers';

const VALID_HEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const MAX_CATEGORIES = 25;

// ── Panel list ─────────────────────────────────────────────────────────────────

export function renderPanelList(sessionId: string, guildId: string): WizardView {
  const panels = Repo.listPanels(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🎫 Panels')
    .setColor('#5865f2')
    .setDescription(panels.length === 0
      ? 'Noch keine Panels. Erstelle eins über den Button unten.'
      : 'Panel zum Bearbeiten wählen, oder ein neues erstellen.');

  const components: ActionRowBuilder<any>[] = [];

  if (panels.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'panel', 'pick'))
      .setPlaceholder('Panel auswählen')
      .addOptions(panels.slice(0, 25).map(p => ({
        label: p.title.slice(0, 100),
        value: String(p.id),
        description: `[${p.id}] ${p.mode} • ${Repo.listCategories(p.id).length} Kategorie(n) • ${p.message_id ? 'gesendet' : 'nicht gesendet'}`.slice(0, 100),
      })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'create')).setLabel('➕ Neues Panel').setStyle(ButtonStyle.Success),
  ));
  components.push(navRow(sessionId, 'menu'));

  return { embeds: [embed], components };
}

// ── Panel detail ───────────────────────────────────────────────────────────────

export function renderPanelDetail(sessionId: string, panelId: number): WizardView {
  const panel = Repo.getPanel(panelId);
  if (!panel) return { embeds: [error('Nicht gefunden', 'Dieses Panel existiert nicht mehr.')], components: [navRow(sessionId, 'panel:list')] };

  const cats = Repo.listCategories(panelId);
  const formCount = Repo.listFormQuestions(panelId).length;

  const embed = new EmbedBuilder()
    .setTitle(`🎫 Panel: ${panel.title}`)
    .setColor((panel.color as any) || '#5865f2')
    .addFields(
      { name: 'ID',          value: `\`${panel.id}\``, inline: true },
      { name: 'Modus',       value: panel.mode,         inline: true },
      { name: 'Gesendet',    value: panel.message_id ? `<#${panel.channel_id}>` : 'Noch nicht', inline: true },
      { name: 'Beschreibung', value: panel.description || '*(keine)*' },
      { name: `Kategorien (${cats.length}/${MAX_CATEGORIES})`, value: cats.length > 0
        ? cats.map(c => `${c.emoji ?? '🎫'} **${c.label}** \`[${c.id}]\` → <#${c.category_id}>${c.support_role_id ? ` • <@&${c.support_role_id}>` : ''}`).join('\n')
        : '*Keine — füge eine hinzu.*' },
      { name: 'Formular-Fragen', value: String(formCount), inline: true },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'edittext', panelId)).setLabel('✏️ Text').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'editstyle', panelId)).setLabel('🎨 Aussehen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'send', panelId)).setLabel('📤 Senden').setStyle(ButtonStyle.Success).setDisabled(cats.length === 0),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'delete', panelId)).setLabel('🗑️ Löschen').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'add', panelId)).setLabel('➕ Kategorie').setStyle(ButtonStyle.Secondary).setDisabled(cats.length >= MAX_CATEGORIES),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'list', panelId)).setLabel(`📂 Kategorien (${cats.length})`).setStyle(ButtonStyle.Secondary).setDisabled(cats.length === 0),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'form', 'panel', panelId)).setLabel(`📝 Formular (${formCount})`).setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, navRow(sessionId, 'panel:list')] };
}

// ── Category list / detail ──────────────────────────────────────────────────────

export function renderCategoryList(sessionId: string, panelId: number): WizardView {
  const panel = Repo.getPanel(panelId);
  const cats = panel ? Repo.listCategories(panelId) : [];

  const embed = new EmbedBuilder()
    .setTitle(`📂 Kategorien — ${panel?.title ?? '?'}`)
    .setColor('#5865f2')
    .setDescription(cats.length === 0 ? 'Keine Kategorien.' : 'Kategorie zum Bearbeiten wählen.');

  const components: ActionRowBuilder<any>[] = [];
  if (cats.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'cat', 'pick', panelId))
      .setPlaceholder('Kategorie auswählen')
      .addOptions(cats.slice(0, 25).map(c => ({
        label: `${c.label}`.slice(0, 100),
        value: String(c.id),
        description: `[${c.id}] → #${c.category_id}`.slice(0, 100),
        emoji: c.emoji ?? undefined,
      })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(navRow(sessionId, `panel:detail:${panelId}`));

  return { embeds: [embed], components };
}

export function renderCategoryDetail(sessionId: string, catId: number): WizardView {
  const cat = Repo.getCategory(catId);
  if (!cat) return { embeds: [error('Nicht gefunden', 'Diese Kategorie existiert nicht mehr.')], components: [navRow(sessionId, 'menu')] };

  const embed = new EmbedBuilder()
    .setTitle(`📂 Kategorie: ${cat.label}`)
    .setColor('#5865f2')
    .addFields(
      { name: 'ID',            value: `\`${cat.id}\``, inline: true },
      { name: 'Button-Text',   value: cat.button_text || '*(= Label)*', inline: true },
      { name: 'Farbe',         value: cat.color, inline: true },
      { name: 'Discord-Kategorie', value: `<#${cat.category_id}>`, inline: true },
      { name: 'Support-Rolle', value: cat.support_role_id ? `<@&${cat.support_role_id}>` : 'Keine', inline: true },
      { name: 'Willkommensnachricht', value: cat.welcome_message || '*(keine)*' },
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'edittext', catId)).setLabel('✏️ Text').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'editcolor', catId)).setLabel('🎨 Farbe').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'editwelcome', catId)).setLabel('💬 Willkommen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'remove', catId)).setLabel('🗑️ Entfernen').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'editchannel', catId)).setLabel('📁 Kanal ändern').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'editrole', catId)).setLabel('👥 Rolle ändern').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, navRow(sessionId, `cat:list:${cat.panel_id}`)] };
}

// ── Add-category flow (label modal → channel select → role select) ─────────────

function renderAddCategoryChannelStep(sessionId: string, panelId: number): WizardView {
  const embed = new EmbedBuilder().setTitle('➕ Kategorie hinzufügen (2/3)').setColor('#5865f2')
    .setDescription('Discord-Kategorie wählen, in der die Ticket-Channels erstellt werden.');
  const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'addchannel', panelId)).setPlaceholder('Discord-Kategorie wählen').addChannelTypes(ChannelType.GuildCategory);
  return { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(sessionId, `panel:detail:${panelId}`)] };
}

function renderAddCategoryRoleStep(sessionId: string, panelId: number): WizardView {
  const embed = new EmbedBuilder().setTitle('➕ Kategorie hinzufügen (3/3)').setColor('#5865f2')
    .setDescription('Support-Rolle wählen (bekommt Zugriff auf Tickets dieser Kategorie). Optional.');
  const select = new RoleSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'addrole', panelId)).setPlaceholder('Support-Rolle wählen');
  const skip = new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'addrole', panelId, 'skip')).setLabel('Überspringen').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(skip), navRow(sessionId, `panel:detail:${panelId}`)] };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function handlePanelSection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const session = getSession(sessionId)!;
  const gid = session.guildId;

  if (action === 'pick' && interaction.isStringSelectMenu()) {
    const id = Number(interaction.values[0]);
    return renderTo(interaction, renderPanelDetail(sessionId, id));
  }

  if (action === 'create' && interaction.isButton()) {
    const result = await promptModal(interaction, buildCustomId(sessionId, 'panel', 'createmodal'), 'Neues Panel', [
      { id: 'title', label: 'Titel', required: true, maxLength: 256, value: 'Support' },
      { id: 'description', label: 'Beschreibung (optional)', style: TextInputStyle.Paragraph, maxLength: 1000 },
      { id: 'color', label: 'Farbe (Hex, z.B. #5865f2)', maxLength: 7, value: '#5865f2' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    if (values.color && !VALID_HEX.test(values.color)) {
      await submit.reply({ embeds: [error('Ungültige Farbe', 'Hex-Format erwartet, z.B. `#5865f2`.')], flags: MessageFlags.Ephemeral });
      return;
    }
    const panel = Repo.createPanel({
      guild_id: gid, title: values.title || 'Support', description: values.description.trim() || null,
      color: values.color || '#5865f2', mode: 'auto' as Repo.Panel['mode'],
    });
    touchSession(sessionId);
    return renderTo(submit, renderPanelDetail(sessionId, panel.id));
  }

  const panelIdArg = args[0] ? Number(args[0]) : undefined;

  if (action === 'edittext' && interaction.isButton() && panelIdArg) {
    const panel = Repo.getPanel(panelIdArg);
    if (!panel) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'panel', 'edittextmodal', panelIdArg), 'Panel-Text bearbeiten', [
      { id: 'title', label: 'Titel', required: true, maxLength: 256, value: panel.title },
      { id: 'description', label: 'Beschreibung', style: TextInputStyle.Paragraph, maxLength: 1000, value: panel.description ?? '' },
      { id: 'content', label: 'Text über dem Panel (optional)', style: TextInputStyle.Paragraph, maxLength: 1000, value: panel.content ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.updatePanel(panelIdArg, { title: values.title, description: values.description.trim() || null, content: values.content.trim() || null });
    const updated = Repo.getPanel(panelIdArg)!;
    if (updated.message_id && updated.channel_id) await refreshPanelMessage(interaction.guild!, updated).catch(() => {});
    return renderTo(submit, renderPanelDetail(sessionId, panelIdArg));
  }

  if (action === 'editstyle' && interaction.isButton() && panelIdArg) {
    const panel = Repo.getPanel(panelIdArg);
    if (!panel) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'panel', 'editstylemodal', panelIdArg), 'Panel-Aussehen bearbeiten', [
      { id: 'color', label: 'Farbe (Hex)', required: true, maxLength: 7, value: panel.color },
      { id: 'mode', label: 'Modus (auto/button/dropdown)', required: true, maxLength: 10, value: panel.mode },
      { id: 'footer', label: 'Footer-Text (optional)', maxLength: 256, value: panel.footer ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    if (!VALID_HEX.test(values.color)) {
      await submit.reply({ embeds: [error('Ungültige Farbe', 'Hex-Format erwartet, z.B. `#5865f2`.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!['auto', 'button', 'dropdown'].includes(values.mode)) {
      await submit.reply({ embeds: [error('Ungültiger Modus', 'Erlaubt: `auto`, `button`, `dropdown`.')], flags: MessageFlags.Ephemeral });
      return;
    }
    Repo.updatePanel(panelIdArg, { color: values.color, mode: values.mode as Repo.Panel['mode'], footer: values.footer.trim() || null });
    const updated = Repo.getPanel(panelIdArg)!;
    if (updated.message_id && updated.channel_id) await refreshPanelMessage(interaction.guild!, updated).catch(() => {});
    return renderTo(submit, renderPanelDetail(sessionId, panelIdArg));
  }

  if (action === 'send' && interaction.isButton() && panelIdArg) {
    const embed = new EmbedBuilder().setTitle('📤 Panel senden').setColor('#5865f2').setDescription('Ziel-Channel wählen.');
    const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'panel', 'sendto', panelIdArg)).setPlaceholder('Channel wählen').addChannelTypes(ChannelType.GuildText);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(sessionId, `panel:detail:${panelIdArg}`)] });
  }
  if (action === 'sendto' && interaction.isChannelSelectMenu() && panelIdArg) {
    const panel = Repo.getPanel(panelIdArg);
    if (!panel) return;
    const cats = Repo.listCategories(panel.id);
    if (cats.length === 0) {
      return renderTo(interaction, { embeds: [error('Keine Kategorien', 'Füge zuerst mindestens eine Kategorie hinzu.')], components: [navRow(sessionId, `panel:detail:${panelIdArg}`)] });
    }
    try {
      const channel = await interaction.guild!.channels.fetch(interaction.values[0]) as TextChannel;
      const msg = await channel.send({ content: panel.content ?? undefined, embeds: [buildPanelEmbed(panel)], components: buildPanelComponents(panel, cats) as any });
      Repo.updatePanelMessage(panel.id, channel.id, msg.id);
      return renderTo(interaction, { embeds: [success('✅ Gesendet', `Panel in <#${channel.id}> gepostet.`)], components: [navRow(sessionId, `panel:detail:${panelIdArg}`)] });
    } catch (err) {
      console.error('[TicketWizard] send panel failed:', err);
      return renderTo(interaction, { embeds: [error('Senden fehlgeschlagen', 'Fehlende Bot-Berechtigungen im Ziel-Channel?')], components: [navRow(sessionId, `panel:detail:${panelIdArg}`)] });
    }
  }

  if (action === 'delete' && interaction.isButton() && panelIdArg) {
    Repo.deletePanel(panelIdArg);
    return renderTo(interaction, { embeds: [success('🗑️ Gelöscht', 'Panel wurde entfernt.')], components: [navRow(sessionId, 'panel:list')] });
  }
}

export async function handleCategorySection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const panelIdArg = args[0] ? Number(args[0]) : undefined;

  if (action === 'list' && panelIdArg !== undefined) return renderTo(interaction, renderCategoryList(sessionId, panelIdArg));

  if (action === 'pick' && interaction.isStringSelectMenu()) {
    const catId = Number(interaction.values[0]);
    return renderTo(interaction, renderCategoryDetail(sessionId, catId));
  }

  if (action === 'add' && interaction.isButton() && panelIdArg !== undefined) {
    const result = await promptModal(interaction, buildCustomId(sessionId, 'cat', 'addmodal', panelIdArg), 'Kategorie hinzufügen (1/3)', [
      { id: 'label', label: 'Name', required: true, maxLength: 100, value: 'Support' },
      { id: 'button_text', label: 'Button-Text (optional)', maxLength: 80 },
      { id: 'emoji', label: 'Emoji (optional)', maxLength: 20 },
    ]);
    if (!result) return;
    const { values, submit } = result;
    const session = getSession(sessionId)!;
    session.data.pendingCategory = { panelId: panelIdArg, label: values.label || 'Support', buttonText: values.button_text.trim() || null, emoji: values.emoji.trim() || null };
    touchSession(sessionId);
    return renderTo(submit, renderAddCategoryChannelStep(sessionId, panelIdArg));
  }

  if (action === 'addchannel' && interaction.isChannelSelectMenu() && panelIdArg !== undefined) {
    const session = getSession(sessionId)!;
    const pending = session.data.pendingCategory as any;
    if (!pending) return;
    pending.categoryId = interaction.values[0];
    touchSession(sessionId);
    return renderTo(interaction, renderAddCategoryRoleStep(sessionId, panelIdArg));
  }

  if (action === 'addrole' && panelIdArg !== undefined) {
    const session = getSession(sessionId)!;
    const pending = session.data.pendingCategory as any;
    if (!pending) return;
    const roleId = args[1] === 'skip' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : null);

    const existing = Repo.listCategories(panelIdArg);
    if (existing.length >= MAX_CATEGORIES) {
      delete session.data.pendingCategory;
      return renderTo(interaction, { embeds: [error('Limit erreicht', `Max. ${MAX_CATEGORIES} Kategorien pro Panel.`)], components: [navRow(sessionId, `panel:detail:${panelIdArg}`)] });
    }

    const cat = Repo.addCategory({
      panel_id: panelIdArg, guild_id: session.guildId, label: pending.label,
      button_text: pending.buttonText, emoji: pending.emoji, color: 'primary' as Repo.Category['color'],
      category_id: pending.categoryId, support_role_id: roleId, welcome_message: null,
    });
    delete session.data.pendingCategory;

    const panel = Repo.getPanel(panelIdArg);
    if (panel) await refreshPanelMessage(interaction.guild!, panel).catch(() => {});

    return renderTo(interaction, renderCategoryDetail(sessionId, cat.id));
  }

  const catIdArg = action !== 'list' && action !== 'add' && action !== 'addchannel' && action !== 'addrole' ? (args[0] ? Number(args[0]) : undefined) : undefined;

  if (action === 'edittext' && interaction.isButton() && catIdArg) {
    const cat = Repo.getCategory(catIdArg);
    if (!cat) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'cat', 'edittextmodal', catIdArg), 'Kategorie-Text bearbeiten', [
      { id: 'label', label: 'Name', required: true, maxLength: 100, value: cat.label },
      { id: 'button_text', label: 'Button-Text (optional)', maxLength: 80, value: cat.button_text ?? '' },
      { id: 'emoji', label: 'Emoji (optional)', maxLength: 20, value: cat.emoji ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.updateCategory(catIdArg, { label: values.label, button_text: values.button_text.trim() || null, emoji: values.emoji.trim() || null });
    const panel = Repo.getPanel(cat.panel_id);
    if (panel) await refreshPanelMessage(interaction.guild!, panel).catch(() => {});
    return renderTo(submit, renderCategoryDetail(sessionId, catIdArg));
  }

  if (action === 'editcolor' && interaction.isButton() && catIdArg) {
    const cat = Repo.getCategory(catIdArg);
    if (!cat) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'cat', 'editcolormodal', catIdArg), 'Kategorie-Farbe', [
      { id: 'color', label: 'primary / secondary / success / danger', required: true, maxLength: 10, value: cat.color },
    ]);
    if (!result) return;
    const { values, submit } = result;
    if (!['primary', 'secondary', 'success', 'danger'].includes(values.color)) {
      await submit.reply({ embeds: [error('Ungültige Farbe', 'Erlaubt: primary, secondary, success, danger.')], flags: MessageFlags.Ephemeral });
      return;
    }
    Repo.updateCategory(catIdArg, { color: values.color as Repo.Category['color'] });
    const panel = Repo.getPanel(cat.panel_id);
    if (panel) await refreshPanelMessage(interaction.guild!, panel).catch(() => {});
    return renderTo(submit, renderCategoryDetail(sessionId, catIdArg));
  }

  if (action === 'editwelcome' && interaction.isButton() && catIdArg) {
    const cat = Repo.getCategory(catIdArg);
    if (!cat) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'cat', 'editwelcomemodal', catIdArg), 'Willkommensnachricht', [
      { id: 'welcome', label: 'Nachricht ({user}, {channel}, {category})', style: TextInputStyle.Paragraph, maxLength: 1500, value: cat.welcome_message ?? '' },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.updateCategory(catIdArg, { welcome_message: values.welcome.trim() || null });
    return renderTo(submit, renderCategoryDetail(sessionId, catIdArg));
  }

  if (action === 'editchannel' && interaction.isButton() && catIdArg) {
    const embed = new EmbedBuilder().setTitle('📁 Discord-Kategorie ändern').setColor('#5865f2').setDescription('Neue Kategorie wählen.');
    const select = new ChannelSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'setchannel', catIdArg)).setPlaceholder('Kategorie wählen').addChannelTypes(ChannelType.GuildCategory);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select), navRow(sessionId, `cat:detail:${catIdArg}`)] });
  }
  if (action === 'setchannel' && interaction.isChannelSelectMenu() && catIdArg) {
    Repo.updateCategory(catIdArg, { category_id: interaction.values[0] });
    return renderTo(interaction, renderCategoryDetail(sessionId, catIdArg));
  }

  if (action === 'editrole' && interaction.isButton() && catIdArg) {
    const embed = new EmbedBuilder().setTitle('👥 Support-Rolle ändern').setColor('#5865f2').setDescription('Neue Rolle wählen, oder entfernen.');
    const select = new RoleSelectMenuBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'setrole', catIdArg)).setPlaceholder('Rolle wählen');
    const clear = new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'cat', 'setrole', catIdArg, 'clear')).setLabel('Rolle entfernen').setStyle(ButtonStyle.Secondary);
    return renderTo(interaction, { embeds: [embed], components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(clear), navRow(sessionId, `cat:detail:${catIdArg}`)] });
  }
  if (action === 'setrole' && catIdArg) {
    const roleId = args[1] === 'clear' ? null : (interaction.isRoleSelectMenu() ? interaction.values[0] : undefined);
    if (roleId === undefined) return;
    Repo.updateCategory(catIdArg, { support_role_id: roleId });
    return renderTo(interaction, renderCategoryDetail(sessionId, catIdArg));
  }

  if (action === 'remove' && interaction.isButton() && catIdArg) {
    const cat = Repo.getCategory(catIdArg);
    if (!cat) return;
    Repo.deleteCategory(catIdArg);
    const panel = Repo.getPanel(cat.panel_id);
    if (panel) await refreshPanelMessage(interaction.guild!, panel).catch(() => {});
    return renderTo(interaction, { embeds: [success('🗑️ Entfernt', `Kategorie **${cat.label}** wurde entfernt.`)], components: [navRow(sessionId, `panel:detail:${cat.panel_id}`)] });
  }
}

// ── Form questions ─────────────────────────────────────────────────────────────

export function renderFormList(sessionId: string, panelId: number): WizardView {
  const panel = Repo.getPanel(panelId);
  const questions = Repo.listFormQuestions(panelId);

  const embed = new EmbedBuilder()
    .setTitle(`📝 Formular — ${panel?.title ?? '?'}`)
    .setColor('#5865f2')
    .setDescription('Diese Fragen werden beim Öffnen eines Tickets als Modal gestellt (max. 5).')
    .addFields(questions.length > 0
      ? questions.map((q, i) => ({ name: `${i + 1}. ${q.label}`, value: `${q.style} • ${q.required ? 'Pflicht' : 'Optional'}` }))
      : [{ name: 'Keine Fragen', value: '*Füge eine hinzu.*' }]);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'form', 'add', panelId)).setLabel('➕ Frage hinzufügen').setStyle(ButtonStyle.Success).setDisabled(questions.length >= 5),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'form', 'clear', panelId)).setLabel('🗑️ Alle löschen').setStyle(ButtonStyle.Danger).setDisabled(questions.length === 0),
  );

  return { embeds: [embed], components: [row, navRow(sessionId, `panel:detail:${panelId}`)] };
}

export async function handleFormSection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const panelId = args[0] ? Number(args[0]) : undefined;
  if (panelId === undefined) return;

  if (action === 'panel') return renderTo(interaction, renderFormList(sessionId, panelId));

  if (action === 'add' && interaction.isButton()) {
    const existing = Repo.listFormQuestions(panelId);
    if (existing.length >= 5) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'form', 'addmodal', panelId), 'Formular-Frage hinzufügen', [
      { id: 'label', label: 'Frage', required: true, maxLength: 45 },
      { id: 'placeholder', label: 'Hinweistext (optional)', maxLength: 100 },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.addFormQuestion({
      panel_id: panelId, label: values.label, placeholder: values.placeholder.trim() || null,
      style: 'short' as Repo.FormQuestion['style'], required: true, min_length: 0, max_length: 1000,
    });
    return renderTo(submit, renderFormList(sessionId, panelId));
  }

  if (action === 'clear' && interaction.isButton()) {
    Repo.clearFormQuestions(panelId);
    return renderTo(interaction, renderFormList(sessionId, panelId));
  }
}
