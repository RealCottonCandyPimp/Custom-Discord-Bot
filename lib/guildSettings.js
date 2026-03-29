const DEFAULT_TTL_MS = 30_000;
const cache = new Map();

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MAX_LEVEL_ROLES = 50;

function normalizeLevelRoles(list, fallback) {
    if (!Array.isArray(list)) {
        return fallback.map((r) => ({ ...r }));
    }
    const byLevel = new Map();
    for (const item of list) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const level = Number(item.level);
        const roleId = String(item.roleId ?? item.role_id ?? "").trim();
        if (!Number.isFinite(level) || level < 2 || level > 1_000_000) {
            continue;
        }
        if (!SNOWFLAKE_RE.test(roleId)) {
            continue;
        }
        byLevel.set(Math.floor(level), roleId);
    }
    const out = [...byLevel.entries()].map(([level, roleId]) => ({ level, roleId }));
    out.sort((a, b) => a.level - b.level);
    return out;
}

function parseLevelRolesColumn(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback.map((r) => ({ ...r }));
    }
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return fallback.map((r) => ({ ...r }));
        }
    }
    return normalizeLevelRoles(parsed, fallback);
}

function validateLevelRolesInput(input) {
    if (!Array.isArray(input)) {
        throw new Error("xp.levelRoles must be an array");
    }
    if (input.length > MAX_LEVEL_ROLES) {
        throw new Error(`xp.levelRoles must have at most ${MAX_LEVEL_ROLES} entries`);
    }
    const seen = new Set();
    for (const item of input) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error("Each xp.levelRoles entry must be an object");
        }
        const level = Number(item.level);
        const roleId = String(item.roleId ?? item.role_id ?? "").trim();
        if (!Number.isFinite(level) || level < 2 || level > 1_000_000) {
            throw new Error(
                "Each xp.levelRoles entry needs level between 2 and 1000000 (level 1 is the starting level)"
            );
        }
        if (!SNOWFLAKE_RE.test(roleId)) {
            throw new Error("Each xp.levelRoles entry needs a valid Discord role ID");
        }
        const L = Math.floor(level);
        if (seen.has(L)) {
            throw new Error(`Duplicate level in xp.levelRoles: ${L}`);
        }
        seen.add(L);
    }
    return normalizeLevelRoles(input, []);
}

function buildXpDefaults(config) {
    const raw = config.xp && typeof config.xp === "object" ? config.xp : {};
    const perMessage = Number(raw.perMessage);
    const perLevel = Number(raw.perLevel);
    const dailyCap = Number(raw.dailyCap);
    const levelRoles = normalizeLevelRoles(raw.levelRoles, []);
    return {
        enabled: Boolean(raw.enabled),
        perMessage: Number.isFinite(perMessage) && perMessage > 0 ? Math.min(1000, Math.floor(perMessage)) : 15,
        perLevel: Number.isFinite(perLevel) && perLevel > 0 ? Math.min(1_000_000, Math.floor(perLevel)) : 100,
        dailyCap:
            raw.dailyCap === undefined || raw.dailyCap === null
                ? 500
                : Number.isFinite(dailyCap) && dailyCap >= 0
                  ? Math.min(100_000_000, Math.floor(dailyCap))
                  : 500,
        levelRoles
    };
}

function buildDefaults(config) {
    const prefix = typeof config.prefix === "string" && config.prefix.length > 0 ? config.prefix : "!";
    const commands = {};
    for (const [name, meta] of Object.entries(config.commands || {})) {
        commands[name] = meta && meta.enabled !== false;
    }
    const xp = buildXpDefaults(config);
    return { prefix, commands, xp };
}

function getMergedFromRow(defaults, row) {
    const merged = {
        prefix: row.prefix,
        commands: { ...defaults.commands },
        xp: { ...defaults.xp }
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

    if (row.xp_enabled !== undefined && row.xp_enabled !== null) {
        merged.xp.enabled = row.xp_enabled === true || row.xp_enabled === 1;
    }
    if (row.xp_per_message != null && row.xp_per_message !== "") {
        const n = Number(row.xp_per_message);
        if (Number.isFinite(n)) {
            merged.xp.perMessage = Math.min(1000, Math.max(1, Math.floor(n)));
        }
    }
    if (row.xp_per_level != null && row.xp_per_level !== "") {
        const n = Number(row.xp_per_level);
        if (Number.isFinite(n)) {
            merged.xp.perLevel = Math.min(1_000_000, Math.max(1, Math.floor(n)));
        }
    }
    if (row.xp_daily_cap != null && row.xp_daily_cap !== "") {
        const n = Number(row.xp_daily_cap);
        if (Number.isFinite(n) && n >= 0) {
            merged.xp.dailyCap = Math.min(100_000_000, Math.floor(n));
        }
    }
    if (row.xp_level_roles !== undefined && row.xp_level_roles !== null) {
        merged.xp.levelRoles = parseLevelRolesColumn(row.xp_level_roles, merged.xp.levelRoles);
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
        "SELECT prefix, command_flags, xp_enabled, xp_per_message, xp_per_level, xp_daily_cap, xp_level_roles FROM guild_settings WHERE guild_id = ?",
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
        "SELECT prefix, command_flags, xp_enabled, xp_per_message, xp_per_level, xp_daily_cap, xp_level_roles FROM guild_settings WHERE guild_id = ?",
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

    const xp = { ...current.xp };
    if (body.xp !== undefined) {
        if (!body.xp || typeof body.xp !== "object" || Array.isArray(body.xp)) {
            throw new Error("xp must be an object");
        }
        if (body.xp.enabled !== undefined) {
            xp.enabled = Boolean(body.xp.enabled);
        }
        if (body.xp.perMessage !== undefined) {
            const n = Number(body.xp.perMessage);
            if (!Number.isFinite(n) || n < 1 || n > 1000) {
                throw new Error("xp.perMessage must be a number from 1 to 1000");
            }
            xp.perMessage = Math.floor(n);
        }
        if (body.xp.perLevel !== undefined) {
            const n = Number(body.xp.perLevel);
            if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
                throw new Error("xp.perLevel must be a number from 1 to 1000000");
            }
            xp.perLevel = Math.floor(n);
        }
        if (body.xp.dailyCap !== undefined) {
            const n = Number(body.xp.dailyCap);
            if (!Number.isFinite(n) || n < 0 || n > 100_000_000) {
                throw new Error("xp.dailyCap must be a number from 0 to 100000000 (0 = no daily limit)");
            }
            xp.dailyCap = Math.floor(n);
        }
        if (body.xp.levelRoles !== undefined) {
            xp.levelRoles = validateLevelRolesInput(body.xp.levelRoles);
        }
    }

    await pool.query(
        `INSERT INTO guild_settings (guild_id, prefix, command_flags, xp_enabled, xp_per_message, xp_per_level, xp_daily_cap, xp_level_roles)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           prefix = VALUES(prefix), 
           command_flags = VALUES(command_flags),
           xp_enabled = VALUES(xp_enabled),
           xp_per_message = VALUES(xp_per_message),
           xp_per_level = VALUES(xp_per_level),
           xp_daily_cap = VALUES(xp_daily_cap),
           xp_level_roles = VALUES(xp_level_roles)`,
        [
            guildId,
            prefix,
            JSON.stringify(commands),
            xp.enabled ? 1 : 0,
            xp.perMessage,
            xp.perLevel,
            xp.dailyCap,
            JSON.stringify(xp.levelRoles)
        ]
    );
    invalidateGuildCache(guildId);
}

module.exports = {
    buildDefaults,
    getGuildSettings,
    upsertGuildSettings,
    invalidateGuildCache
};
