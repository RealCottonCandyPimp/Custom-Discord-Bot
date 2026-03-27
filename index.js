const fs = require("node:fs");
const path = require("node:path");
const { Client, GatewayIntentBits, Events, PermissionFlagsBits } = require("discord.js");
const { requireEnvVars } = require("./env");

const config = require("./MainBot.json");
const { handlePurgeCommand } = require("./Handlers/purge");
const { handleBanCommand } = require("./Handlers/ban");
const { handleKickCommand } = require("./Handlers/kick");
const { DISCORD_TOKEN: botToken } = requireEnvVars(["DISCORD_TOKEN"], "bot startup");
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

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    try {
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
            const commandFiles = fs
                .readdirSync(path.join(__dirname, "Commands"))
                .filter((file) => file.endsWith(".json"));
            const commands = commandFiles.map((file) => {
                const command = require(path.join(__dirname, "Commands", file));
                return `/${command.name} - ${command.description}`;
            });
            await interaction.reply({
                content: `Available commands:\n${commands.join("\n")}`,
                ephemeral: true
            });
            return;
        }

        if (interaction.commandName === "purge") {
            await handlePurgeCommand(interaction);
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

client.login(botToken);
