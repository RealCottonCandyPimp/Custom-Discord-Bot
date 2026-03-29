const mysql = require("mysql2/promise");

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0]?.c) > 0;
}

async function ensureColumn(pool, table, column, definition) {
    if (await columnExists(pool, table, column)) {
        return;
    }
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function createPoolAndMigrate() {
    const host = process.env.MYSQL_HOST || "localhost";
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD ?? "";
    const database = process.env.MYSQL_DATABASE;

    const pool = mysql.createPool({
        host,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        idleTimeout: 60_000,
        enableKeepAlive: true
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            prefix VARCHAR(16) NOT NULL DEFAULT '!',
            command_flags JSON NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    await ensureColumn(
        pool,
        "guild_settings",
        "xp_enabled",
        "TINYINT(1) NOT NULL DEFAULT 0"
    );
    await ensureColumn(
        pool,
        "guild_settings",
        "xp_per_message",
        "INT UNSIGNED NOT NULL DEFAULT 15"
    );
    await ensureColumn(
        pool,
        "guild_settings",
        "xp_per_level",
        "INT UNSIGNED NOT NULL DEFAULT 100"
    );
    await ensureColumn(
        pool,
        "guild_settings",
        "xp_daily_cap",
        "INT UNSIGNED NOT NULL DEFAULT 500"
    );
    await ensureColumn(
        pool,
        "guild_settings",
        "xp_level_roles",
        "JSON NOT NULL DEFAULT ('[]')"
    );

    await pool.query(`
        CREATE TABLE IF NOT EXISTS guild_member_xp (
            guild_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
            xp_day DATE NULL,
            xp_earned_today INT UNSIGNED NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (guild_id, user_id)
        )
    `);

    return pool;
}

module.exports = {
    createPoolAndMigrate
};
