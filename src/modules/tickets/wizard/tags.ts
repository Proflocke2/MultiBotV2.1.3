/**
 * modules/tickets/wizard/tags.ts
 *
 * Tag (saved-reply) MANAGEMENT — create/edit/delete/list. Deliberately
 * doesn't include "use a tag", since that's a fast, high-frequency action
 * staff need mid-conversation inside an actual ticket — burying it behind
 * a multi-click admin wizard would make it slower to use, not easier. That
 * stays a lightweight live command: /ticket tag name:<x>.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder, MessageFlags, TextInputStyle,
} from 'discord.js';
import * as Repo from '../repository';
import { success, error } from '../../../utils/embeds';
import { buildCustomId, getSession } from './session';
import { navRow, promptModal, renderTo, WizardComponentInteraction, WizardView } from './helpers';

export function renderTagList(sessionId: string, guildId: string): WizardView {
  const tags = Repo.listTags(guildId);

  const embed = new EmbedBuilder()
    .setTitle('💬 Tags (Quick Replies)')
    .setColor('#5865f2')
    .setDescription('Gespeicherte Antworten, die Staff live in einem Ticket per `/ticket tag` nutzen kann.')
    .addFields(tags.length > 0
      ? tags.slice(0, 25).map(t => ({ name: t.name, value: t.content.slice(0, 100) + (t.content.length > 100 ? '…' : '') }))
      : [{ name: 'Keine Tags', value: '*Erstelle eins über den Button unten.*' }]);

  const components: ActionRowBuilder<any>[] = [];
  if (tags.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(sessionId, 'tag', 'pick'))
      .setPlaceholder('Tag bearbeiten/löschen')
      .addOptions(tags.slice(0, 25).map(t => ({ label: t.name.slice(0, 100), value: t.name })));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'tag', 'create')).setLabel('➕ Neuer Tag').setStyle(ButtonStyle.Success),
  ));
  components.push(navRow(sessionId, 'menu'));

  return { embeds: [embed], components };
}

function renderTagDetail(sessionId: string, guildId: string, name: string): WizardView {
  const tag = Repo.getTag(guildId, name);
  if (!tag) return { embeds: [error('Nicht gefunden', 'Dieser Tag existiert nicht mehr.')], components: [navRow(sessionId, 'tag:list')] };

  const embed = new EmbedBuilder().setTitle(`💬 Tag: ${tag.name}`).setColor('#5865f2').addFields(
    { name: 'Inhalt', value: tag.content.slice(0, 1024) },
    { name: 'Erstellt von', value: `<@${tag.created_by}>`, inline: true },
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'tag', 'edit', name)).setLabel('✏️ Bearbeiten').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'tag', 'remove', name)).setLabel('🗑️ Löschen').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row, navRow(sessionId, 'tag:list')] };
}

export async function handleTagSection(interaction: WizardComponentInteraction, sessionId: string, action: string, args: string[]): Promise<void> {
  const session = getSession(sessionId)!;
  const gid = session.guildId;

  if (action === 'list') return renderTo(interaction, renderTagList(sessionId, gid));

  if (action === 'pick' && interaction.isStringSelectMenu()) {
    return renderTo(interaction, renderTagDetail(sessionId, gid, interaction.values[0]));
  }

  if (action === 'create' && interaction.isButton()) {
    const result = await promptModal(interaction, buildCustomId(sessionId, 'tag', 'createmodal'), 'Neuer Tag', [
      { id: 'name', label: 'Name (eindeutig)', required: true, maxLength: 50 },
      { id: 'content', label: 'Inhalt', style: TextInputStyle.Paragraph, required: true, maxLength: 1500 },
    ]);
    if (!result) return;
    const { values, submit } = result;
    const created = Repo.createTag({ guild_id: gid, name: values.name.trim(), content: values.content, created_by: interaction.user.id });
    if (!created) {
      await submit.reply({ embeds: [error('Name vergeben', `Ein Tag namens **${values.name}** existiert bereits.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    return renderTo(submit, renderTagDetail(sessionId, gid, created.name));
  }

  const name = args[0];
  if (!name) return;

  if (action === 'edit' && interaction.isButton()) {
    const tag = Repo.getTag(gid, name);
    if (!tag) return;
    const result = await promptModal(interaction, buildCustomId(sessionId, 'tag', 'editmodal', name), `Tag bearbeiten: ${name}`, [
      { id: 'content', label: 'Inhalt', style: TextInputStyle.Paragraph, required: true, maxLength: 1500, value: tag.content },
    ]);
    if (!result) return;
    const { values, submit } = result;
    Repo.updateTag(gid, name, values.content);
    return renderTo(submit, renderTagDetail(sessionId, gid, name));
  }

  if (action === 'remove' && interaction.isButton()) {
    Repo.deleteTag(gid, name);
    return renderTo(interaction, { embeds: [success('🗑️ Gelöscht', `Tag **${name}** wurde entfernt.`)], components: [navRow(sessionId, 'tag:list')] });
  }
}
