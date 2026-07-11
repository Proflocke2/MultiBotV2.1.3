/**
 * /config-audit — view the config change audit trail (see modules/audit/configAudit.ts).
 * Not exhaustive across every single settings write in the bot — scoped to
 * security-sensitive and structural changes: security/anti-nuke settings,
 * per-channel exceptions, command disable/enable, welcome toggles, and
 * reaction-role panel structure.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { requireAdmin } from '../../utils/guards';
import { getRecentConfigChanges } from '../../modules/audit/configAudit';
import { info } from '../../utils/embeds';

const ACTION_LABELS: Record<string, string> = {
  command_disabled: '🔴 Command deaktiviert',
  command_enabled: '🟢 Command aktiviert',
  security_toggled: '🛡️ Security an/aus',
  security_features_changed: '🛡️ Security-Features geändert',
  security_severity_changed: '🛡️ Security-Severity geändert',
  security_log_channel_changed: '🛡️ Security-Log-Channel geändert',
  security_thresholds_changed: '🛡️ Security-Schwellwerte geändert',
  channel_exceptions_changed: '📍 Kanal-Ausnahme geändert',
  antinuke_toggled: '💣 Anti-Nuke an/aus',
  antinuke_action_changed: '💣 Anti-Nuke-Aktion geändert',
  antinuke_log_channel_changed: '💣 Anti-Nuke-Log-Channel geändert',
  antinuke_limits_changed: '💣 Anti-Nuke-Limits geändert',
  antinuke_whitelist_added: '💣 Anti-Nuke-Whitelist: hinzugefügt',
  antinuke_whitelist_removed: '💣 Anti-Nuke-Whitelist: entfernt',
  welcome_join_toggled: '👋 Beitritts-Nachricht an/aus',
  welcome_leave_toggled: '🚪 Austritts-Nachricht an/aus',
  reactionrole_panel_created: '🎭 Reaction-Role-Panel erstellt',
  reactionrole_panel_deleted: '🎭 Reaction-Role-Panel gelöscht',
};

export default {
  data: new SlashCommandBuilder()
    .setName('config-audit')
    .setDescription('Show who changed which security/config setting, and when')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addIntegerOption(o => o.setName('limit').setDescription('How many entries to show (default 20, max 50)').setMinValue(1).setMaxValue(50)),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;
    const gid = ix.guildId!;
    const limit = ix.options.getInteger('limit') ?? 20;

    const rows = getRecentConfigChanges(gid, limit);
    if (rows.length === 0) {
      await ix.reply({ embeds: [info('📜 Config-Audit-Log', 'Noch keine protokollierten Änderungen.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = rows.map(r => {
      const label = ACTION_LABELS[r.action] ?? r.action;
      const detail = r.detail ? ` — ${r.detail}` : '';
      return `<t:${r.created_at}:R> **${label}**${detail} *(<@${r.user_id}>)*`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📜 Config-Audit-Log')
      .setColor('#5865f2')
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: 'Deckt Security/Anti-Nuke/Kanal-Ausnahmen/Command-Toggles/Welcome/Reaction-Roles ab — nicht jede einzelne Einstellung im Bot.' });

    await ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
