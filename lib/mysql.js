const mysql = require("mysql2/promise");

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

    return pool;
}

module.exports = {
    createPoolAndMigrate
};
