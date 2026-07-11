import { REST, Routes, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import { readdirSync } from 'fs';
import path from 'path';
import { Command } from '../utils/types';
import {
  COMMAND_DESC_LOCALIZATIONS,
  COMMAND_NAME_LOCALIZATIONS,
} from '../i18n/commandDescriptions';

/**
 * Discord's bulk-overwrite PUT is atomic: if ONE command in the array fails
 * Discord's *server-side* validation (which is stricter than what discord.js
 * checks client-side — e.g. locale-specific length limits, permission
 * bitfield edge cases), the ENTIRE PUT is rejected and every command that
 * guild already had stays exactly as it was, including long-removed ones.
 * That's silent and looks like "nothing new deployed, old junk still there".
 *
 * This pulls the real reason out of a DiscordAPIError instead of the
 * generic "Invalid Form Body" that `err.message` gives you.
 */
function describeDiscordError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as any;
    const parts: string[] = [];
    if (anyErr.status) parts.push(`HTTP ${anyErr.status}`);
    if (anyErr.code) parts.push(`code ${anyErr.code}`);
    if (anyErr.rawError?.errors) {
      parts.push(JSON.stringify(anyErr.rawError.errors));
    } else if (anyErr.rawError?.message) {
      parts.push(anyErr.rawError.message);
    } else if (anyErr.message) {
      parts.push(anyErr.message);
    }
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(err);
}

/**
 * Applies Discord locale-aware description (and optionally name) localizations
 * to a SlashCommandBuilder before it is serialized and uploaded.
 *
 * This is what makes command descriptions appear in the user's own language
 * inside the Discord client — completely independent of the server language.
 */
function applyLocalizations(
  builder: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder,
): void {
  const name = builder.name;

  const descLocs = COMMAND_DESC_LOCALIZATIONS[name];
  if (descLocs && Object.keys(descLocs).length > 0) {
    (builder as SlashCommandBuilder).setDescriptionLocalizations(descLocs);
  }

  const nameLocs = COMMAND_NAME_LOCALIZATIONS[name];
  if (nameLocs && Object.keys(nameLocs).length > 0) {
    (builder as SlashCommandBuilder).setNameLocalizations(nameLocs);
  }
}

export interface DeploySummary {
  totalCommands: number;
  brokenFiles: string[];        // "folder/file: reason" — never even made it into the array
  guildsOk: number;
  guildsDegraded: number;       // bulk PUT failed, recovered via one-by-one
  guildsTotal: number;
  rejectedCommands: string[];   // "/name in guild <id>: reason" — from degraded guilds
}

/**
 * Local pre-flight replica of Discord's server-side rule that discord.js
 * does NOT validate: within one options level, every required option must
 * come before all non-required ones (APPLICATION_COMMAND_OPTIONS_REQUIRED_INVALID).
 * One violation anywhere aborts the ENTIRE bulk PUT for a guild — which is
 * exactly the "no new commands, old junk still visible" failure this bot
 * has now hit twice (/backup, both times). Returns human-readable paths
 * like "/backup > auto-enable > delivery" instead of Discord's numeric
 * index maze ({"54":{"options":{"7":...}}}).
 */
function findRequiredOrderViolations(json: any): string[] {
  const violations: string[] = [];
  const walk = (opts: any[] | undefined, ctx: string): void => {
    if (!opts) return;
    let seenOptional = false;
    for (const o of opts) {
      if (o.type === 1 /* SUB_COMMAND */ || o.type === 2 /* SUB_COMMAND_GROUP */) {
        walk(o.options, `${ctx} > ${o.name}`);
      } else {
        if (o.required && seenOptional) violations.push(`${ctx} > ${o.name} (required after optional)`);
        if (!o.required) seenOptional = true;
      }
    }
  };
  walk(json.options, `/${json.name}`);
  return violations;
}

export async function deployCommands(token: string, clientId: string): Promise<DeploySummary> {
  const cmdsByName = new Map<string, unknown>();
  const cmdDir = path.join(__dirname, '../commands');

  let localized = 0;
  let duplicatesSkipped = 0;

  let skippedBroken = 0;
  const brokenFiles: string[] = [];
  const rejectedCommands: string[] = [];

  for (const folder of readdirSync(cmdDir)) {
    const files = readdirSync(path.join(cmdDir, folder)).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'));
    for (const file of files) {
      // One broken command file (throw during require, or during
      // applyLocalizations/toJSON) must never take the other 87 down with
      // it — skip just that file and keep going, loudly.
      try {
        const cmd = require(path.join(cmdDir, folder, file)) as { default: Command };
        if (cmd.default?.data) {
          const builder = cmd.default.data as SlashCommandBuilder;
          applyLocalizations(builder);
          if (COMMAND_DESC_LOCALIZATIONS[builder.name]) localized++;

          // Defensive dedupe: two command files must never produce the same
          // top-level name. Bulk-registering duplicate names causes Discord
          // to reject the whole PUT (or silently show the command twice in
          // the client). Last one found wins; the collision is logged loudly
          // so it gets fixed at the source instead of hidden.
          if (cmdsByName.has(builder.name)) {
            duplicatesSkipped++;
            console.warn(`[Deploy] WARNING: duplicate command name "${builder.name}" in ${file} — overwriting previous definition.`);
          }

          const json = builder.toJSON();

          // Pre-flight: exclude any command that would fail Discord's
          // required-option ordering rule, so ONE bad command can't abort
          // the whole bulk PUT and hide all the others (again).
          const orderViolations = findRequiredOrderViolations(json);
          if (orderViolations.length > 0) {
            skippedBroken++;
            const reason = `required-option ordering: ${orderViolations.join('; ')}`;
            brokenFiles.push(`${folder}/${file}: ${reason}`);
            console.error(`[Deploy] EXCLUDING /${builder.name} (${folder}/${file}) — ${reason}`);
            continue;
          }

          cmdsByName.set(builder.name, json);
        }
      } catch (err) {
        skippedBroken++;
        const reason = describeDiscordError(err);
        brokenFiles.push(`${folder}/${file}: ${reason}`);
        console.error(`[Deploy] SKIPPING ${folder}/${file} — failed to build: ${reason}`);
      }
    }
  }

  if (skippedBroken > 0) {
    console.error(`[Deploy] ${skippedBroken} command file(s) skipped due to build errors — see above. Every other command still deploys normally.`);
  }

  const cmds = Array.from(cmdsByName.values());

  console.log(`[Deploy] Applied localizations to ${localized} commands (de/fr/ru)`);
  if (duplicatesSkipped > 0) {
    console.warn(`[Deploy] ${duplicatesSkipped} duplicate command name(s) detected and collapsed — check the warnings above.`);
  }

  const rest = new REST().setToken(token);

  // Multi-server: register the exact same command set on EVERY guild the
  // bot is currently a member of — instead of only the single GUILD_ID
  // server. Guild-scoped commands still propagate instantly (vs ~1h for
  // global), so this keeps that speed while covering all servers, including
  // ones the bot joins later (this runs automatically on every boot, plus
  // manually via /deploy).
  let guilds: { id: string }[] = [];
  try {
    guilds = await rest.get(Routes.userGuilds()) as { id: string }[];
  } catch (err) {
    console.error('[Deploy] Could not fetch guild list — falling back to global deploy:', err instanceof Error ? err.message : err);
    await rest.put(Routes.applicationCommands(clientId), { body: cmds });
    console.log(`[Deploy] Registered ${cmds.length} slash commands globally (may take ~1h)`);
    return { totalCommands: cmds.length, brokenFiles, guildsOk: 1, guildsDegraded: 0, guildsTotal: 1, rejectedCommands };
  }

  let ok = 0;
  let okDegraded = 0;
  for (const g of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, g.id), { body: cmds });
      ok++;
    } catch (err) {
      // Bulk overwrite got rejected — Discord doesn't say which command did
      // it, only that the array as a whole is invalid. Falling back to
      // registering one-by-one means the 86 good commands still go live
      // instead of the whole guild silently keeping its old command set;
      // whichever single command fails gets named explicitly below.
      console.error(`[Deploy] Bulk register failed in guild ${g.id}: ${describeDiscordError(err)}`);
      console.warn(`[Deploy] Falling back to one-by-one registration for guild ${g.id} to isolate the bad command...`);

      let individualOk = 0;
      for (const cmdJson of cmds) {
        try {
          await rest.post(Routes.applicationGuildCommands(clientId, g.id), { body: cmdJson });
          individualOk++;
        } catch (innerErr) {
          const name = (cmdJson as any)?.name ?? '(unknown)';
          const reason = describeDiscordError(innerErr);
          rejectedCommands.push(`/${name} in guild ${g.id}: ${reason}`);
          console.error(`[Deploy] REJECTED by Discord: "/${name}" in guild ${g.id} — ${reason}`);
        }
      }
      console.warn(`[Deploy] Guild ${g.id}: ${individualOk}/${cmds.length} commands registered individually.`);
      if (individualOk > 0) okDegraded++;
    }
  }
  console.log(`[Deploy] Registered ${cmds.length} slash commands to ${ok}/${guilds.length} guild(s) (instant)${okDegraded > 0 ? `, ${okDegraded} guild(s) recovered via fallback` : ''}`);

  // Clear any stray GLOBAL commands from an earlier global-deploy era.
  // Without this, old global registrations keep living forever alongside
  // the per-guild ones — every command appears twice in Discord, and
  // clicking the orphaned copy times out ("app did not respond") because
  // it no longer matches anything in client.commands.
  try {
    const existingGlobal = await rest.get(Routes.applicationCommands(clientId)) as unknown[];
    if (existingGlobal.length > 0) {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log(`[Deploy] Cleared ${existingGlobal.length} stray global command(s) to prevent duplicates.`);
    }
  } catch (err) {
    console.warn('[Deploy] Could not check/clear global commands (non-fatal):', err instanceof Error ? err.message : err);
  }

  return {
    totalCommands: cmds.length,
    brokenFiles,
    guildsOk: ok,
    guildsDegraded: okDegraded,
    guildsTotal: guilds.length,
    rejectedCommands,
  };
}
