import { isRateLimited } from '../utils/rateLimiter';
import db, { isCommandDisabled } from '../database/db';
import { logError } from '../modules/errorTracking/service';
import { Interaction, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { BotClient } from '../utils/types';
import { error } from '../utils/embeds';
import { handleGiveawayButton } from '../commands/utility/giveaway';
import {
  handleApplyButton, handleAppActionButton,
  handleApplicationCreateModal, handleAppReasonModal,
} from '../commands/application/applyHandler';
import {
  handleVerifyButton, handleVerifySubmitButton, handleVerifyModal,
} from '../handlers/verifyHandler';
import {
  handleInviteAccept, handleInviteDecline,
  isGameMove, handleGameMove,
} from '../handlers/gameHandler';
import { isEmbedModal, handleEmbedModal, popPendingImage } from '../commands/utility/embed';
import { isWebhookButton, isWebhookModal, isWebhookSelect, handleWebhookButton, handleWebhookModal, handleWebhookSelect } from '../handlers/webhookHandler';
import { isEconomyButton, handleEconomyButton } from '../economy/handlers/economyHandler';
import { isDisclaimerButton, handleDisclaimerButton } from '../economy/handlers/disclaimerHandler';

// ── Old panel system (backwards compat) ──────────────────────────────────────
import {
  isPanelButton, isPanelSelect, isPanelModal, handlePanelButton,
  handlePanelSelect, handlePanelModal, isTicketControl, handleTicketControl,
} from '../handlers/panelHandler';

// ── New ticket system v2 ─────────────────────────────────────────────────────
import {
  isTicketCustomId,
  routeButton  as routeTicketButton,
  routeSelect  as routeTicketSelect,
  routeModal   as routeTicketModal,
} from '../modules/tickets/handler';

// ── Report-Staff (select menu + modal flow) ──────────────────────────────────
import {
  isReportStaffSelect, isReportStaffModal,
  handleReportStaffSelect, handleReportStaffModal,
} from '../modules/reportStaff/handler';

// ── Suggestions (/suggest — vote + decision buttons) ─────────────────────────
import {
  isSuggestionVoteButton, isSuggestionDecisionButton,
  handleVoteButton as handleSuggestionVoteButton,
  handleDecisionButton as handleSuggestionDecisionButton,
} from '../modules/suggestions/handler';

// ── Ticket setup wizard (/ticket-setup) ───────────────────────────────────────
import { isWizardComponent, handleWizardComponent } from '../modules/tickets/wizard';
import { isWelcomeWizardComponent, handleWelcomeWizardComponent } from '../modules/welcome/wizard';
import { isAntiNukeWizardComponent, handleAntiNukeWizardComponent } from '../modules/moderation/antiNukeWizard';
import { isReactionRolesWizardComponent, handleReactionRolesWizardComponent } from '../modules/moderation/reactionRolesWizard';

export default {
  async execute(interaction: Interaction, client: BotClient) {

    // ── Autocomplete ─────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName) as any;
      if (cmd?.autocomplete) await cmd.autocomplete(interaction).catch(() => {});
      return;
    }

    try {
    // ── Slash Commands ───────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;

      // Per-guild disabled commands (via /disable) — checked before anything
      // else runs, so a disabled command never even reaches rate-limiting
      // or execute(). "disable"/"enable" themselves can never be disabled
      // (enforced in those commands), so there's no lockout path.
      if (interaction.guildId && isCommandDisabled(interaction.guildId, interaction.commandName)) {
        await interaction.reply({
          embeds: [error('Command disabled', `\`/${interaction.commandName}\` has been disabled on this server.`)],
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      // Global rate-limiting (max. 10 commands / 10s per user)
      if (isRateLimited(interaction.user.id, interaction.guildId ?? 'dm')) {
        await interaction.reply({
          content: '⏱️ Du sendest zu viele Befehle. Bitte warte kurz.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      try {
        await cmd.execute(interaction, client);
      } catch (e) {
        // No stack-trace to user — only internal log
        console.error(`[Error] /${interaction.commandName}:`, e);
        logError(`command:${interaction.commandName}`, e, {
          guildId: interaction.guildId ?? undefined,
          userId: interaction.user.id,
        });
        const payload = {
          embeds: [error('Internal Error', 'Something went wrong. Please try again later.')],
          ephemeral: true,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // ── String Select Menus ──────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      if (isTicketCustomId(interaction.customId)) return await routeTicketSelect(interaction);
      if (isPanelSelect(interaction.customId))    return await handlePanelSelect(interaction);
      if (isReportStaffSelect(interaction.customId)) return await handleReportStaffSelect(interaction);
      if (isWebhookSelect(interaction.customId))  return await handleWebhookSelect(interaction);
      if (isAntiNukeWizardComponent(interaction.customId)) return await handleAntiNukeWizardComponent(interaction);
      if (isReactionRolesWizardComponent(interaction.customId)) return await handleReactionRolesWizardComponent(interaction);
    }

    // ── Channel / Role Select Menus ──────────────────────────────────────────
    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      if (isWizardComponent(interaction.customId)) return await handleWizardComponent(interaction);
      if (isWelcomeWizardComponent(interaction.customId)) return await handleWelcomeWizardComponent(interaction);
      if (isAntiNukeWizardComponent(interaction.customId)) return await handleAntiNukeWizardComponent(interaction);
      if (isReactionRolesWizardComponent(interaction.customId)) return await handleReactionRolesWizardComponent(interaction);
    }

    // ── User Select Menus (currently only the Anti-Nuke whitelist picker) ────
    if (interaction.isUserSelectMenu()) {
      if (isAntiNukeWizardComponent(interaction.customId)) return await handleAntiNukeWizardComponent(interaction);
    }

    // ── Buttons ──────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const btn = interaction as ButtonInteraction;
      const id  = btn.customId;

      // Warn buttons (list / remove last)
      if (id.startsWith('warn:')) {
        const parts   = id.split(':');
        const wAction = parts[1];
        const tId     = parts[2];
        const wGid    = btn.guildId!;

        if (wAction === 'list') {
          const warns = db.prepare(
            'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10',
          ).all(wGid, tId) as Array<{ id: number; reason: string; moderator_id: string; created_at: number }>;

          const { EmbedBuilder } = await import('discord.js');
          const embed = new EmbedBuilder()
            .setTitle(`📋 Warnings for <@${tId}>`)
            .setColor('#fee75c')
            .setDescription(
              warns.length === 0
                ? 'Keine Verwarnungen.'
                : warns.map((w, i) => `**${i + 1}.** \`[${w.id}]\` <@${w.moderator_id}>: ${w.reason}`).join('\n'),
            );
          await btn.reply({ embeds: [embed], flags: 64 });
          return;
        }

        if (wAction === 'remove_last') {
          if (!btn.memberPermissions?.has('ManageGuild')) {
            await btn.reply({ content: '❌ Keine Berechtigung.', flags: 64 });
            return;
          }
          const last = db.prepare(
            'SELECT id FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
          ).get(wGid, tId) as { id: number } | undefined;
          if (last) {
            db.prepare('DELETE FROM warnings WHERE id = ?').run(last.id);
            await btn.reply({ content: `✅ Letzte Verwarnung von <@${tId}> entfernt.`, flags: 64 });
          } else {
            await btn.reply({ content: 'Keine Verwarnungen vorhanden.', flags: 64 });
          }
          return;
        }
      }

      // Reaction Roles
      if (id.startsWith('rr:toggle:')) {
        const roleId = id.replace('rr:toggle:', '');
        const member = btn.member as import('discord.js').GuildMember;
        try {
          if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
            await btn.reply({ content: `✅ Rolle <@&${roleId}> entfernt.`, flags: 64 });
          } else {
            await member.roles.add(roleId);
            await btn.reply({ content: `✅ Role <@&${roleId}> added.`, flags: 64 });
          }
        } catch {
          await btn.reply({ content: '❌ Role could not be changed. Check bot permissions.', flags: 64 });
        }
        return;
      }

      // Ticket system v2 (priority)
      if (isTicketCustomId(id)) return await routeTicketButton(btn);

      // Old panel system (backwards compat)
      if (isPanelButton(id))      return await handlePanelButton(btn);
      if (isTicketControl(id))    return await handleTicketControl(btn);

      // Other systems
      if (isWebhookButton(id))                 return await handleWebhookButton(btn);
      if (isDisclaimerButton(id))              return await handleDisclaimerButton(btn);
      if (isEconomyButton(id))                 return await handleEconomyButton(btn);
      if (id.startsWith('invite_accept_'))     return await handleInviteAccept(btn, client);
      if (id.startsWith('invite_decline_'))    return await handleInviteDecline(btn, client);
      if (isGameMove(id))                      return await handleGameMove(btn, client);
      if (id === 'verify_button')              return await handleVerifyButton(btn, client);
      if (id === 'verify_submit')              return await handleVerifySubmitButton(btn);
      if (id.startsWith('giveaway_'))          return await handleGiveawayButton(btn);
      if (id.startsWith('apply_'))             return await handleApplyButton(btn);
      if (id.startsWith('appaction_'))         return await handleAppActionButton(btn);
      if (id === 'data_delete_confirm' || id === 'data_delete_cancel') {
        const { handleDataDeleteButton } = await import('../handlers/dataDeleteHandler');
        return await handleDataDeleteButton(btn);
      }
      if (isSuggestionVoteButton(id))     return await handleSuggestionVoteButton(btn);
      if (isSuggestionDecisionButton(id)) return await handleSuggestionDecisionButton(btn);
      if (isWizardComponent(id))          return await handleWizardComponent(btn);
      if (isWelcomeWizardComponent(id))   return await handleWelcomeWizardComponent(btn);
      if (isAntiNukeWizardComponent(id))  return await handleAntiNukeWizardComponent(btn);
      if (isReactionRolesWizardComponent(id)) return await handleReactionRolesWizardComponent(btn);
    }

    // ── Modals ───────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const modal = interaction as ModalSubmitInteraction;

      // Ticket system v2 modals (priority)
      if (isTicketCustomId(modal.customId)) return await routeTicketModal(modal);

      // Old panel system modals
      if (isPanelModal(modal.customId)) return await handlePanelModal(modal);

      if (modal.customId === 'verify_modal')         return await handleVerifyModal(modal);
      if (modal.customId === 'app_create_modal')     return await handleApplicationCreateModal(modal);
      if (modal.customId.startsWith('appreason_'))   return await handleAppReasonModal(modal);
      if (isEmbedModal(modal.customId)) {
        const imageUrl = popPendingImage(modal.customId);
        if (imageUrl) (modal as any).__imageUrl = imageUrl;
        return await handleEmbedModal(modal);
      }
      if (isWebhookModal(modal.customId)) return await handleWebhookModal(modal);
      if (isReportStaffModal(modal.customId)) return await handleReportStaffModal(modal);
    }
    } catch (e) {
      // Global safety net for buttons, select menus and modals.
      const ix = interaction as any;
      const label = ix.customId ?? ix.commandName ?? 'unknown';
      console.error(`[Error] interaction (${label}):`, e);
      logError(`interaction:${label}`, e, {
        guildId: interaction.guildId ?? undefined,
        userId: interaction.user.id,
      });
      try {
        if (interaction.isRepliable()) {
          const payload = {
            embeds: [error('Internal Error', 'Something went wrong. Please try again.')],
            flags: 64,
          };
          if (ix.replied || ix.deferred) {
            await ix.followUp(payload).catch(() => {});
          } else {
            await ix.reply(payload).catch(() => {});
          }
        }
      } catch { /* swallow — nothing more we can do */ }
    }
  },
};
