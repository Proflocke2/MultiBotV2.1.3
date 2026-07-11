/**
 * events/guildCreate.ts
 *
 * Fires once when the bot joins a new server. Sends the server owner a
 * short DM pointing at the main setup entry points, so they don't have to
 * discover /setup, /ticket setup, etc. by trial and error. Never blocks
 * anything if it fails (DMs closed, owner left, whatever) — this is a
 * nice-to-have, not a requirement for the bot to function in the guild.
 */

import { Guild, EmbedBuilder } from 'discord.js';

export default {
  async execute(guild: Guild) {
    try {
      const owner = await guild.fetchOwner().catch(() => null);
      if (!owner) return;

      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle(`👋 Danke, dass du mich zu ${guild.name} hinzugefügt hast!`)
        .setDescription(
          'Ein paar gute Startpunkte, alle interaktiv per Klick — keine Optionen zum Auswendiglernen:\n\n' +
          '**`/setup`** — Security & AutoMod in wenigen Klicks einrichten (Quick-Setup für die empfohlenen Basics)\n' +
          '**`/ticket setup`** — Ticket-System: Panels, Kategorien, Einstellungen\n' +
          '**`/welcome`** — Begrüßungsnachricht für neue Mitglieder\n' +
          '**`/security config`** — Feintuning für Anti-Raid, Anti-Nuke, Kanal-Ausnahmen\n' +
          '**`/help`** — Vollständige Befehlsübersicht in einfachem Englisch\n\n' +
          'Alles läuft über geführte Menüs (Buttons/Dropdowns) — nichts muss manuell eingetippt werden. ' +
          'Bei Fragen einfach `/help` in einem Kanal auf dem Server ausführen.',
        )
        .setFooter({ text: 'Diese Nachricht wird nur einmal beim Beitritt gesendet.' })
        .setTimestamp();

      await owner.send({ embeds: [embed] }).catch(() => {
        // DMs closed — not a big deal, /help and /setup are discoverable via
        // Discord's own "/" command list regardless.
      });
    } catch (err) {
      console.error('[GuildCreate] Failed to send owner welcome DM (non-fatal):', err);
    }
  },
};
