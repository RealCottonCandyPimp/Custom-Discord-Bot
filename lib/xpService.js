/**
 * Level uses flat thresholds: level = 1 + floor(totalXp / xpPerLevel).
 */

function levelFromTotalXp(totalXp, xpPerLevel) {
    const xp = Number(totalXp) || 0;
    const per = Math.max(1, Number(xpPerLevel) || 1);
    return 1 + Math.floor(xp / per);
}

function xpProgress(totalXp, xpPerLevel) {
    const per = Math.max(1, Number(xpPerLevel) || 1);
    const xp = Number(totalXp) || 0;
    const level = levelFromTotalXp(xp, per);
    const intoLevel = xp - (level - 1) * per;
    const toNext = level * per - xp;
    return { level, intoLevel, toNext, xpPerLevel: per };
}

function utcDateString(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

/**
 * Role IDs to grant when crossing from oldLevel to newLevel (exclusive lower, inclusive upper).
 * @param {number} oldLevel
 * @param {number} newLevel
 * @param {{ level: number, roleId: string }[]} levelRoles
 * @returns {string[]}
 */
function getRoleIdsForLevelsCrossed(oldLevel, newLevel, levelRoles) {
    const oldL = Number(oldLevel);
    const newL = Number(newLevel);
    if (!Number.isFinite(oldL) || !Number.isFinite(newL) || newL <= oldL) {
        return [];
    }
    if (!Array.isArray(levelRoles) || levelRoles.length === 0) {
        return [];
    }
    const seen = new Set();
    const ordered = [...levelRoles].sort((a, b) => Number(a.level) - Number(b.level));
    const out = [];
    for (const rule of ordered) {
        if (!rule || typeof rule !== "object") {
            continue;
        }
        const L = Number(rule.level);
        const rid = String(rule.roleId ?? "").trim();
        if (!Number.isFinite(L)) {
            continue;
        }
        if (L <= oldL || L > newL) {
            continue;
        }
        if (!/^\d{17,20}$/.test(rid) || seen.has(rid)) {
            continue;
        }
        seen.add(rid);
        out.push(rid);
    }
    return out;
}

function normalizeDay(value) {
    if (!value) {
        return null;
    }
    if (value instanceof Date) {
        return utcDateString(value);
    }
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
    }
    if (typeof value === "string" && value.length >= 10) {
        return s.slice(0, 10);
    }
    return s;
}

/**
 * @param {import("mysql2/promise").Pool} pool
 * @param {string} guildId
 * @param {string} userId
 * @param {{ xp: { enabled: boolean, perMessage: number, perLevel: number, dailyCap: number } }}} settings
 */
async function awardMessageXp(pool, guildId, userId, settings) {
    const { perMessage, perLevel, dailyCap } = settings.xp;
    const grantCap = Math.max(1, Math.min(1000, Number(perMessage) || 1));
    const perLvl = Math.max(1, Number(perLevel) || 1);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            "SELECT xp, xp_day, xp_earned_today FROM guild_member_xp WHERE guild_id = ? AND user_id = ? FOR UPDATE",
            [guildId, userId]
        );

        const today = utcDateString();
        let totalXp = 0;
        let earnedToday = 0;

        if (rows.length > 0) {
            totalXp = Number(rows[0].xp) || 0;
            const storedDay = normalizeDay(rows[0].xp_day);
            earnedToday =
                storedDay === today ? Math.max(0, Number(rows[0].xp_earned_today) || 0) : 0;
        }

        const cap = Number(dailyCap);
        let grant = grantCap;
        if (Number.isFinite(cap) && cap > 0) {
            grant = Math.min(grant, Math.max(0, cap - earnedToday));
        }

        if (grant <= 0) {
            await conn.commit();
            const lvl = levelFromTotalXp(totalXp, perLvl);
            return {
                granted: 0,
                totalXp,
                level: lvl,
                oldLevel: lvl,
                leveledUp: false
            };
        }

        const newTotal = totalXp + grant;
        const newEarned = earnedToday + grant;

        await conn.query(
            `INSERT INTO guild_member_xp (guild_id, user_id, xp, xp_day, xp_earned_today)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               xp = VALUES(xp),
               xp_day = VALUES(xp_day),
               xp_earned_today = VALUES(xp_earned_today)`,
            [guildId, userId, newTotal, today, newEarned]
        );

        await conn.commit();

        const oldLevel = levelFromTotalXp(totalXp, perLvl);
        const newLevel = levelFromTotalXp(newTotal, perLvl);

        return {
            granted: grant,
            totalXp: newTotal,
            level: newLevel,
            oldLevel,
            leveledUp: newLevel > oldLevel
        };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * @param {import("mysql2/promise").Pool} pool
 * @param {string} guildId
 * @param {string} userId
 */
async function getMemberXpRow(pool, guildId, userId) {
    const [rows] = await pool.query(
        "SELECT xp, xp_day, xp_earned_today FROM guild_member_xp WHERE guild_id = ? AND user_id = ?",
        [guildId, userId]
    );
    if (rows.length === 0) {
        return { xp: 0, xp_day: null, xp_earned_today: 0 };
    }
    return {
        xp: Number(rows[0].xp) || 0,
        xp_day: rows[0].xp_day,
        xp_earned_today: Number(rows[0].xp_earned_today) || 0
    };
}

module.exports = {
    levelFromTotalXp,
    xpProgress,
    utcDateString,
    awardMessageXp,
    getMemberXpRow,
    getRoleIdsForLevelsCrossed
};
