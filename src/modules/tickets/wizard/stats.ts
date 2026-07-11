/**
 * modules/tickets/wizard/stats.ts
 *
 * Read-only reporting — folded in from the old /ticketstats command so it
 * doesn't have to survive as a stray top-level command. No editing here,
 * just three view buttons.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as Repo from '../repository';
import { info } from '../../../utils/embeds';
import { buildCustomId } from './session';
import { navRow, renderTo, WizardComponentInteraction, WizardView } from './helpers';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function bar(count: number, total: number): string {
  const filled = Math.round(total > 0 ? (count / total) * 10 : 0);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` (${count})`;
}

export function renderStatsMenu(sessionId: string): WizardView {
  const embed = new EmbedBuilder().setTitle('📊 Statistik').setColor('#5865f2').setDescription('Welche Ansicht?');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'stats', 'overview')).setLabel('Übersicht').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'stats', 'staff')).setLabel('Staff-Performance').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(buildCustomId(sessionId, 'stats', 'survey')).setLabel('Umfrage-Ergebnisse').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, navRow(sessionId, 'menu')] };
}

export async function handleStatsSection(interaction: WizardComponentInteraction, sessionId: string, action: string, guildId: string): Promise<void> {
  if (action === 'menu') return renderTo(interaction, renderStatsMenu(sessionId));

  if (action === 'overview') {
    const s = Repo.getGuildStats(guildId);
    const avgClose = s.avg_close_time !== null ? formatDuration(s.avg_close_time) : 'N/A';
    const openPct  = s.total > 0 ? ((s.open / s.total) * 100).toFixed(1) : '0';
    const closePct = s.total > 0 ? ((s.closed / s.total) * 100).toFixed(1) : '0';
    const embed = new EmbedBuilder().setTitle('📊 Ticket-Statistik — Übersicht').setColor('#5865f2').addFields(
      { name: '🎫 Gesamt',    value: String(s.total), inline: true },
      { name: '🟢 Offen',     value: `${s.open} (${openPct}%)`, inline: true },
      { name: '🔒 Geschlossen', value: `${s.closed} (${closePct}%)`, inline: true },
      { name: '📅 Heute',     value: String(s.today), inline: true },
      { name: '📅 Diese Woche', value: String(s.this_week), inline: true },
      { name: '📅 Dieser Monat', value: String(s.this_month), inline: true },
      { name: '⏱️ Ø Schließzeit', value: avgClose, inline: true },
    );
    return renderTo(interaction, { embeds: [embed], components: [navRow(sessionId, 'stats:menu')] });
  }

  if (action === 'staff') {
    const staff = Repo.getStaffStats(guildId, 10);
    if (staff.length === 0) return renderTo(interaction, { embeds: [info('👥 Staff-Statistik', 'Noch keine Aktivität erfasst.')], components: [navRow(sessionId, 'stats:menu')] });
    const rows = staff.map((s, i) => `**${i + 1}.** <@${s.user_id}> — ✋ ${s.claimed} beansprucht • 🔒 ${s.closed} geschlossen • **${s.claimed + s.closed} gesamt**`);
    const embed = new EmbedBuilder().setTitle('👥 Staff-Performance').setColor('#5865f2').setDescription(rows.join('\n'));
    return renderTo(interaction, { embeds: [embed], components: [navRow(sessionId, 'stats:menu')] });
  }

  if (action === 'survey') {
    const s = Repo.getSurveyStats(guildId);
    if (s.total === 0) return renderTo(interaction, { embeds: [info('⭐ Umfrage-Statistik', 'Noch keine Antworten. Aktivieren über Einstellungen → Ein/Aus-Optionen → Umfrage.')], components: [navRow(sessionId, 'stats:menu')] });
    const avgStr = s.avg_rating !== null ? s.avg_rating.toFixed(2) : 'N/A';
    const embed = new EmbedBuilder().setTitle('⭐ Umfrage-Statistik').setColor('#fee75c').addFields(
      { name: 'Antworten gesamt', value: String(s.total), inline: true },
      { name: 'Ø Bewertung', value: `${avgStr} / 5.00 ⭐`, inline: true },
      { name: '⭐ 1 Stern', value: bar(s.rating_1, s.total) },
      { name: '⭐⭐ 2 Sterne', value: bar(s.rating_2, s.total) },
      { name: '⭐⭐⭐ 3 Sterne', value: bar(s.rating_3, s.total) },
      { name: '⭐⭐⭐⭐ 4 Sterne', value: bar(s.rating_4, s.total) },
      { name: '⭐⭐⭐⭐⭐ 5 Sterne', value: bar(s.rating_5, s.total) },
    );
    return renderTo(interaction, { embeds: [embed], components: [navRow(sessionId, 'stats:menu')] });
  }
}
