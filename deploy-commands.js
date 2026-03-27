const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes } = require("discord.js");
const { requireEnvVars } = require("./env");

const {
    DISCORD_TOKEN: botToken,
    DISCORD_CLIENT_ID: clientId,
    DISCORD_GUILD_ID: guildId
} = requireEnvVars(
    ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"],
    "command deployment"
);

const commandsDir = path.join(__dirname, "Commands");
const commandFiles = fs.readdirSync(commandsDir).filter((file) => file.endsWith(".json"));
const commands = commandFiles.map((file) =>
    JSON.parse(fs.readFileSync(path.join(commandsDir, file), "utf8"))
);

const rest = new REST({ version: "10" }).setToken(botToken);

async function deployCommands() {
    await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
    );

    console.log(`Deployed ${commands.length} command(s) to guild ${guildId}`);
}

deployCommands().catch((error) => {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
});
