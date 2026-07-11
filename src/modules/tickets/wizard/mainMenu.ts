/**
 * modules/tickets/wizard/mainMenu.ts
 *
 * The top-level menu every "🔙 Zurück" eventually leads back to.
 */

import { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';
import { buildCustomId } from './session';
import { WizardView } from './helpers';

export function renderMainMenu(sessionId: string): WizardView {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket-System — Setup')
    .setColor('#5865f2')
    .setDescription('Ein zentraler Ort für die komplette Ticket-Verwaltung. Bereich wählen:');

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(sessionId, 'nav', 'goto'))
    .setPlaceholder('Bereich wählen')
    .addOptions(
      { label: 'Panels & Kategorien', value: 'panel:list', emoji: '🎫', description: 'Panels erstellen, bearbeiten, Kategorien verwalten, senden' },
      { label: 'Multi-Panels',        value: 'multi:list', emoji: '🧩', description: 'Mehrere Panels in einer Nachricht kombinieren' },
      { label: 'Einstellungen',       value: 'set:overview', emoji: '⚙️', description: 'Log/Archiv-Channel, Cooldown, Autoclose, Support-Zeiten, ...' },
      { label: 'Ticket-Vorlagen',     value: 'type:list', emoji: '🏷️', description: 'Wiederverwendbare Kategorie-Vorlagen' },
      { label: 'Tags (Quick Replies)', value: 'tag:list', emoji: '💬', description: 'Gespeicherte Antworten verwalten' },
      { label: 'Statistik',           value: 'stats:menu', emoji: '📊', description: 'Übersicht, Staff-Performance, Umfragen' },
    );

  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}
