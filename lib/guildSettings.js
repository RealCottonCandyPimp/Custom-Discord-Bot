const DEFAULT_TTL_MS = 30_000;
const cache = new Map();

function buildDefaults(config) {
    const prefix = typeof config.prefix === "string" && config.prefix.length > 0 ? config.prefix : "!";
    const commands = {};
    for (const [name, meta] of Object.entries(config.commands || {})) {
        commands[name] = meta && meta.enabled !== false;
    }
    return { prefix, commands };
}

function getMergedFromRow(defaults, row) {
    const merged = {
        prefix: row.prefix,
        commands: { ...defaults.commands }
    };
    let flags = row.command_flags;
    if (typeof flags === "string") {
        try {
            flags = JSON.parse(flags);
        } catch {
            flags = {};
        }
    }
    if (flags && typeof flags === "object") {
        for (const name of Object.keys(defaults.commands)) {
            if (Object.prototype.hasOwnProperty.call(flags, name)) {
                merged.commands[name] = Boolean(flags[name]);
            }
        }
    }
    return merged;
}

async function getGuildSettings(pool, guildId, config) {
    const key = String(guildId);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) {
        return hit.value;
    }

    const defaults = buildDefaults(config);
    const [rows] = await pool.query(
        "SELECT prefix, command_flags FROM guild_settings WHERE guild_id = ?",
        [guildId]
    );

    const merged = rows.length > 0 ? getMergedFromRow(defaults, rows[0]) : defaults;
    cache.set(key, { value: merged, expires: now + DEFAULT_TTL_MS });
    return merged;
}

function invalidateGuildCache(guildId) {
    cache.delete(String(guildId));
}

async function upsertGuildSettings(pool, guildId, body, config) {
    const defaults = buildDefaults(config);
    const [rows] = await pool.query(
        "SELECT prefix, command_flags FROM guild_settings WHERE guild_id = ?",
        [guildId]
    );
    let current = defaults;
    if (rows.length > 0) {
        current = getMergedFromRow(defaults, rows[0]);
    }

    let prefix = current.prefix;
    if (body.prefix !== undefined) {
        if (typeof body.prefix !== "string") {
            throw new Error("prefix must be a string");
        }
        const p = body.prefix.trim();
        if (p.length < 1 || p.length > 16) {
            throw new Error("prefix must be between 1 and 16 characters");
        }
        prefix = p;
    }

    const commands = { ...current.commands };
    if (body.commands !== undefined) {
        if (!body.commands || typeof body.commands !== "object" || Array.isArray(body.commands)) {
            throw new Error("commands must be an object");
        }
        for (const k of Object.keys(body.commands)) {
            if (!Object.prototype.hasOwnProperty.call(defaults.commands, k)) {
                throw new Error(`Unknown command: ${k}`);
            }
            commands[k] = Boolean(body.commands[k]);
        }
    }

    await pool.query(
        `INSERT INTO guild_settings (guild_id, prefix, command_flags)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE prefix = VALUES(prefix), command_flags = VALUES(command_flags)`,
        [guildId, prefix, JSON.stringify(commands)]
    );
    invalidateGuildCache(guildId);
}

module.exports = {
    buildDefaults,
    getGuildSettings,
    upsertGuildSettings,
    invalidateGuildCache
};
