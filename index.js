const fs = require("node:fs");
const path = require("node:path");
const { Client, GatewayIntentBits, Events, PermissionFlagsBits } = require("discord.js");
const { requireEnvVars } = require("./env");
const { createPoolAndMigrate } = require("./lib/mysql");
const guildSettings = require("./lib/guildSettings");
const { createDashboardApp } = require("./dashboard/app");

const config = require("./MainBot.json");
const { handlePurgeCommand } = require("./Handlers/purge");
const { handleMessagePurgeCommand } = require("./Handlers/messagePurge");
const { handleBanCommand } = require("./Handlers/ban");
const { handleKickCommand } = require("./Handlers/kick");
const { handleTemplateCommand, handleRestoreCommand } = require("./Handlers/templateRestore");
const { handleRankCommand } = require("./Handlers/rank");
const { awardMessageXp, getRoleIdsForLevelsCrossed } = require("./lib/xpService");

const { DISCORD_TOKEN: botToken } = requireEnvVars(
    [
        "DISCORD_TOKEN",
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "DASHBOARD_CALLBACK_URL",
        "SESSION_SECRET",
        "MYSQL_USER",
        "MYSQL_DATABASE"
    ],
    "bot and dashboard startup"
);

const commandPermissionRequirements = {
    ban: {
        permission: PermissionFlagsBits.BanMembers,
        message: "You need the Ban Members permission to use this command."
    },
    kick: {
        permission: PermissionFlagsBits.KickMembers,
        message: "You need the Kick Members permission to use this command."
    },
    purge: {
        permission: PermissionFlagsBits.ManageGuild,
        message: "You need the Manage Server permission to use this command."
    },
    "message-purge": {
        permission: PermissionFlagsBits.ManageMessages,
        message: "You need the Manage Messages permission to use this command."
    },
    template: {
        permission: PermissionFlagsBits.ManageGuild,
        message: "You need the Manage Server permission to use this command."
    },
    restore: {
        permission: PermissionFlagsBits.ManageGuild,
        message: "You need the Manage Server permission to use this command."
    }
};

function mapIntents(intentNames) {
    const mapped = [];
    for (const name of intentNames) {
        if (GatewayIntentBits[name] !== undefined) {
            mapped.push(GatewayIntentBits[name]);
        }
    }
    return mapped;
}

const client = new Client({
    intents: mapIntents(config.intents || ["GUILDS"])
});

let pool;

async function grantXpLevelRoles(message, settings, oldLevel, newLevel) {
    const roleIds = getRoleIdsForLevelsCrossed(oldLevel, newLevel, settings.xp.levelRoles);
    if (roleIds.length === 0) {
        return;
    }
    const guild = message.guild;
    const me = guild.members.me;
    if (!me) {
        return;
    }
    const botHigh = me.roles.highest;
    const member =
        message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
    if (!member) {
        return;
    }
    for (const rid of roleIds) {
        if (member.roles.cache.has(rid)) {
            continue;
        }
        const role =
            guild.roles.cache.get(rid) ?? (await guild.roles.fetch(rid).catch(() => null));
        if (!role || role.managed) {
            continue;
        }
        if (role.position >= botHigh.position) {
            continue;
        }
        try {
            await member.roles.add(role, "XP level reward");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`XP level role ${rid}:`, msg);
        }
    }
}

async function isCommandEnabledForContext(interaction, commandName) {
    const defaults = guildSettings.buildDefaults(config);
    if (!Object.prototype.hasOwnProperty.call(defaults.commands, commandName)) {
        return true;
    }
    if (!interaction.inGuild()) {
        return defaults.commands[commandName] !== false;
    }
    const settings = await guildSettings.getGuildSettings(pool, interaction.guildId, config);
    return settings.commands[commandName] !== false;
}

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
    const port = Number(process.env.DASHBOARD_PORT || 3000);
    const app = createDashboardApp({ client, pool, config });
    app.listen(port, () => {
        console.log(`Dashboard listening on port ${port}`);
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    try {
        const enabled = await isCommandEnabledForContext(interaction, interaction.commandName);
        if (!enabled) {
            await interaction.reply({
                content: "This command is disabled for this server.",
                ephemeral: true
            });
            return;
        }

        const requirement = commandPermissionRequirements[interaction.commandName];
        if (requirement) {
            if (!interaction.inGuild()) {
                await interaction.reply({
                    content: "This command can only be used in a server.",
                    ephemeral: true
                });
                return;
            }

            const hasPermission = interaction.memberPermissions?.has(requirement.permission);
            if (!hasPermission) {
                await interaction.reply({
                    content: requirement.message,
                    ephemeral: true
                });
                return;
            }
        }

        if (interaction.commandName === "ping") {
            await interaction.reply({ content: "pong", ephemeral: true });
            return;
        }

        if (interaction.commandName === "help") {
            const defaults = guildSettings.buildDefaults(config);
            let allowed = new Set(Object.keys(defaults.commands).filter((n) => defaults.commands[n]));
            if (interaction.inGuild()) {
                const settings = await guildSettings.getGuildSettings(pool, interaction.guildId, config);
                allowed = new Set(Object.keys(settings.commands).filter((n) => settings.commands[n]));
            }
            const commandFiles
                = fs.readdirSync(path.join(__dirname, "Commands")).filter((file) => file.endsWith(".json"));
            const lines = [];
            for (const file of commandFiles) {
                const command = require(path.join(__dirname, "Commands", file));
                if (allowed.has(command.name)) {
                    lines.push(`/${command.name} - ${command.description}`);
                }
            }
            await interaction.reply({
                content:
                    lines.length > 0
                        ? `Available commands:\n${lines.join("\n")}`
                        : "No commands are enabled here.",
                ephemeral: true
            });
            return;
        }

        if (interaction.commandName === "purge") {
            await handlePurgeCommand(interaction);
            return;
        }

        if (interaction.commandName === "message-purge") {
            await handleMessagePurgeCommand(interaction);
            return;
        }

        if (interaction.commandName === "ban") {
            await handleBanCommand(interaction);
            return;
        }

        if (interaction.commandName === "kick") {
            await handleKickCommand(interaction);
            return;
        }

        if (interaction.commandName === "template") {
            await handleTemplateCommand(interaction);
            return;
        }

        if (interaction.commandName === "restore") {
            await handleRestoreCommand(interaction);
            return;
        }

        if (interaction.commandName === "rank") {
            await handleRankCommand(interaction, pool, config);
            return;
        }
    } catch (error) {
        console.error("Error handling interaction:", error);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: "Something went wrong while running that command.",
                ephemeral: true
            });
            return;
        }

        await interaction.reply({
            content: "Something went wrong while running that command.",
            ephemeral: true
        });
    }
});

client.on(Events.MessageCreate, async (message) => {
    try {
        if (!message.guild || message.author.bot || message.system || message.webhookId) {
            return;
        }
        const settings = await guildSettings.getGuildSettings(pool, message.guild.id, config);
        if (!settings.xp.enabled) {
            return;
        }
        const result = await awardMessageXp(pool, message.guild.id, message.author.id, settings);
        if (result.leveledUp) {
            await grantXpLevelRoles(message, settings, result.oldLevel, result.level);
        }
    } catch (err) {
        console.error("MessageCreate (XP):", err);
    }
});

async function start() {
    pool = await createPoolAndMigrate();
    await client.login(botToken);
}

start().catch((error) => {
    console.error("Startup failed:", error);
    process.exit(1);
});
