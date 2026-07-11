/**
 * modules/suggestions/handler.ts
 *
 * The interactive flow: /suggest submit → embed + 👍/👎 buttons (+ ✅/❌ for
 * the configured viewer role) posted to suggestions_channel → votes and
 * decisions edit that same message in place, nothing new gets posted.
 *
 * Wired into events/interactionCreate.ts via isSuggestionVoteButton() /
 * isSuggestionDecisionButton() — see the two `if` lines added there.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction,
  EmbedBuilder, TextChannel, GuildMember, MessageFlags, Guild,
} from 'discord.js';
import { error, success } from '../../utils/embeds';
import * as Repo from './repository';

const VOTE_UP_PREFIX        = 'suggestion_vote_up_';
const VOTE_DOWN_PREFIX      = 'suggestion_vote_down_';
const DECIDE_APPROVE_PREFIX = 'suggestion_decide_approve_';
const DECIDE_DENY_PREFIX    = 'suggestion_decide_deny_';

export function isSuggestionVoteButton(customId: string): boolean {
  return customId.startsWith(VOTE_UP_PREFIX) || customId.startsWith(VOTE_DOWN_PREFIX);
}
export function isSuggestionDecisionButton(customId: string): boolean {
  return customId.startsWith(DECIDE_APPROVE_PREFIX) || customId.startsWith(DECIDE_DENY_PREFIX);
}

const STATUS_COLOR: Record<Repo.SuggestionStatus, `#${string}`> = {
  pending:  '#fee75c', // yellow
  approved: '#57f287', // green
  denied:   '#ed4245', // red
};

const STATUS_LABEL: Record<Repo.SuggestionStatus, string> = {
  pending:  '⏳ Ausstehend',
  approved: '✅ Angenommen',
  denied:   '❌ Abgelehnt',
};

/**
 * Builds the suggestion embed. `anonymous` is read from the guild's CURRENT
 * config at render time — it's not stored per-suggestion — matching the
 * spec's "suggestions_anonymous=1 → Anonym" wording literally. That means
 * flipping the setting later changes how an already-posted suggestion
 * displays the next time its message gets edited (e.g. on a vote). Simple,
 * and good enough here; a per-suggestion snapshot would need its own column.
 */
export function buildSuggestionEmbed(suggestion: Repo.Suggestion, anonymous: boolean): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('💡 Vorschlag')
    .setColor(STATUS_COLOR[suggestion.status])
    .addFields(
      { name: 'Autor',     value: anonymous ? '*Anonym*' : `<@${suggestion.author_id}>`,     inline: true },
      { name: 'Status',    value: STATUS_LABEL[suggestion.status],                            inline: true },
      { name: 'Stimmen',   value: `👍 ${suggestion.upvotes}  ·  👎 ${suggestion.downvotes}`,   inline: true },
      { name: 'Vorschlag', value: suggestion.content.slice(0, 1024) },
    )
    .setFooter({ text: `Vorschlag #${suggestion.id}` })
    .setTimestamp(suggestion.created_at * 1000);

  if (suggestion.status !== 'pending') {
    embed.addFields(
      { name: 'Entschieden von', value: suggestion.decided_by ? `<@${suggestion.decided_by}>` : 'Unbekannt', inline: true },
      { name: 'Begründung',      value: suggestion.decision_reason || '*Keine Begründung angegeben*',        inline: true },
    );
  }

  return embed;
}

/** No components once a decision has been made — replaced by the Status field above instead. */
function buildComponents(suggestion: Repo.Suggestion, hasViewerRole: boolean): ActionRowBuilder<ButtonBuilder>[] {
  if (suggestion.status !== 'pending') return [];

  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${VOTE_UP_PREFIX}${suggestion.id}`).setEmoji('👍').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${VOTE_DOWN_PREFIX}${suggestion.id}`).setEmoji('👎').setStyle(ButtonStyle.Danger),
    ),
  ];

  if (hasViewerRole) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${DECIDE_APPROVE_PREFIX}${suggestion.id}`).setLabel('Annehmen').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${DECIDE_DENY_PREFIX}${suggestion.id}`).setLabel('Ablehnen').setEmoji('❌').setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return rows;
}

/** /suggest submit → posts the embed + buttons to suggestions_channel, saves it. Nothing is lost even if the channel send fails — the row is written first. */
export async function handleSuggestionSubmit(
  guild: Guild,
  authorId: string,
  content: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = Repo.getConfig(guild.id);
  if (!cfg.enabled) {
    return { ok: false, reason: 'Vorschläge sind auf diesem Server nicht aktiviert.' };
  }
  if (!cfg.channel) {
    return { ok: false, reason: 'Es ist kein Vorschlags-Channel eingerichtet. Ein Admin muss `/suggest config` ausführen.' };
  }
  const channel = guild.channels.cache.get(cfg.channel) as TextChannel | undefined;
  if (!channel || !channel.isTextBased()) {
    return { ok: false, reason: 'Der konfigurierte Vorschlags-Channel existiert nicht mehr. Ein Admin muss `/suggest config` erneut ausführen.' };
  }

  const id = Repo.createSuggestion(guild.id, authorId, content);
  const suggestion = Repo.getSuggestion(id)!;

  const sent = await channel.send({
    embeds: [buildSuggestionEmbed(suggestion, cfg.anonymous)],
    components: buildComponents(suggestion, !!cfg.viewerRole),
  }).catch(() => null);

  if (!sent) {
    return {
      ok: false,
      reason: 'Der Vorschlag wurde gespeichert, konnte aber nicht in den Channel gepostet werden (fehlende Bot-Berechtigungen?). Bitte einen Admin informieren.',
    };
  }

  Repo.setSuggestionMessageId(id, sent.id);
  return { ok: true };
}

/** 👍/👎 clicked → register the vote, update the embed's counters in place, ephemeral confirmation to the voter. */
export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const isUp = interaction.customId.startsWith(VOTE_UP_PREFIX);
  const id = Number(interaction.customId.slice(isUp ? VOTE_UP_PREFIX.length : VOTE_DOWN_PREFIX.length));
  const voteType: Repo.VoteType = isUp ? 'up' : 'down';

  const result = Repo.setVote(id, interaction.user.id, voteType);
  if (!result.ok) {
    const msg = result.reason === 'decided'
      ? 'Über diesen Vorschlag wurde bereits entschieden — die Abstimmung ist geschlossen.'
      : 'Dieser Vorschlag existiert nicht (mehr).';
    await interaction.reply({ embeds: [error('Abstimmung nicht möglich', msg)], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const suggestion = Repo.getSuggestion(id)!;
  const cfg = Repo.getConfig(interaction.guildId!);

  // .update() edits the existing message in place — no new post, per spec.
  await interaction.update({
    embeds: [buildSuggestionEmbed(suggestion, cfg.anonymous)],
    components: buildComponents(suggestion, !!cfg.viewerRole),
  }).catch(() => {});

  await interaction.followUp({
    embeds: [success('Stimme gezählt', `Aktueller Stand: 👍 ${suggestion.upvotes}  ·  👎 ${suggestion.downvotes}`)],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

/** ✅/❌ clicked (viewer-role only) → decide the suggestion, freeze the message (buttons gone, status text instead). */
export async function handleDecisionButton(interaction: ButtonInteraction): Promise<void> {
  const isApprove = interaction.customId.startsWith(DECIDE_APPROVE_PREFIX);
  const id = Number(interaction.customId.slice(isApprove ? DECIDE_APPROVE_PREFIX.length : DECIDE_DENY_PREFIX.length));

  const cfg = Repo.getConfig(interaction.guildId!);

  // Server-side permission check — NOT just "the button is only shown to the
  // right role". Any member who can see the message can technically fire a
  // button-click interaction for it regardless of who else can see which
  // buttons, so the real gate has to live here.
  if (!cfg.viewerRole) {
    await interaction.reply({ embeds: [error('Nicht konfiguriert', 'Für diesen Server ist keine Entscheidungs-Rolle eingerichtet.')], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const member = interaction.member as GuildMember | null;
  if (!member?.roles.cache.has(cfg.viewerRole)) {
    await interaction.reply({ embeds: [error('Keine Berechtigung', 'Nur die konfigurierte Rolle darf über Vorschläge entscheiden.')], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const suggestion = Repo.getSuggestion(id);
  if (!suggestion) {
    await interaction.reply({ embeds: [error('Nicht gefunden', 'Dieser Vorschlag existiert nicht (mehr).')], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (suggestion.status !== 'pending') {
    await interaction.reply({ embeds: [error('Bereits entschieden', 'Über diesen Vorschlag wurde bereits entschieden.')], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  Repo.decideSuggestion(id, interaction.user.id, isApprove ? 'approved' : 'denied', null);
  const updated = Repo.getSuggestion(id)!;

  await interaction.update({
    embeds: [buildSuggestionEmbed(updated, cfg.anonymous)],
    components: buildComponents(updated, !!cfg.viewerRole), // status is no longer 'pending' → [] → buttons gone
  }).catch(() => {});
}
