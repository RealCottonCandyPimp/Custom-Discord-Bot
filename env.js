require("dotenv").config();

function isDiscordSnowflake(value) {
    return /^\d{17,20}$/.test(value);
}

function isLikelyDiscordToken(value) {
    // Basic sanity check: most bot tokens are long strings with dot-separated segments.
    return typeof value === "string" && value.length >= 50 && value.includes(".");
}

function requireEnvVars(requiredKeys, contextLabel) {
    const missing = requiredKeys.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        const formatted = missing.map((key) => `- ${key}`).join("\n");
        console.error(
            `Missing required environment variables for ${contextLabel}:\n${formatted}\n\n` +
            "Create/update .env from .env.example and try again."
        );
        process.exit(1);
    }

    const values = requiredKeys.reduce((acc, key) => {
        acc[key] = process.env[key];
        return acc;
    }, {});

    const formatErrors = [];

    if (values.DISCORD_CLIENT_ID && !isDiscordSnowflake(values.DISCORD_CLIENT_ID)) {
        formatErrors.push("- DISCORD_CLIENT_ID must be a numeric Discord snowflake.");
    }

    if (values.DISCORD_GUILD_ID && !isDiscordSnowflake(values.DISCORD_GUILD_ID)) {
        formatErrors.push("- DISCORD_GUILD_ID must be a numeric Discord snowflake.");
    }

    if (values.DISCORD_TOKEN && !isLikelyDiscordToken(values.DISCORD_TOKEN)) {
        formatErrors.push("- DISCORD_TOKEN format looks invalid (check for copy/paste errors).");
    }

    if (formatErrors.length > 0) {
        console.error(
            `Invalid environment variable format for ${contextLabel}:\n${formatErrors.join("\n")}\n\n` +
            "Update .env and try again."
        );
        process.exit(1);
    }

    return values;
}

module.exports = {
    requireEnvVars
};
