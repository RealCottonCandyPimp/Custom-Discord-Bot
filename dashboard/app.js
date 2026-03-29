const path = require("node:path");
const express = require("express");
const session = require("express-session");
const {
    buildAuthorizeUrl,
    exchangeCode,
    fetchDiscordUser,
    fetchUserGuilds,
    canConfigureGuild,
    randomState
} = require("./discordOAuth");
const guildSettings = require("../lib/guildSettings");

const GUILDS_CACHE_MS = 60_000;

function parseGuildId(param) {
    const id = String(param || "").trim();
    if (!/^\d{17,20}$/.test(id)) {
        return null;
    }
    return id;
}

function createDashboardApp({ client, pool, config }) {
    const app = express();
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const callbackUrl = process.env.DASHBOARD_CALLBACK_URL;
    const sessionSecret = process.env.SESSION_SECRET;

    if (!clientId || !clientSecret || !callbackUrl || !sessionSecret) {
        throw new Error(
            "Dashboard requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_CALLBACK_URL, and SESSION_SECRET"
        );
    }

    app.set("trust proxy", 1);
    app.use(
        session({
            name: "dashboard.sid",
            secret: sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                httpOnly: true,
                sameSite: "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000,
                secure: process.env.DASHBOARD_COOKIE_SECURE === "true"
            }
        })
    );
    app.use(express.json());

    const publicDir = path.join(__dirname, "public");
    app.use(express.static(publicDir));

    function requireSession(req, res, next) {
        if (!req.session || !req.session.discordAccessToken || !req.session.discordUser) {
            res.status(401).json({ error: "Not logged in" });
            return;
        }
        next();
    }

    async function getCachedGuilds(req) {
        const now = Date.now();
        const cache = req.session.guildsCache;
        if (cache && now - cache.at < GUILDS_CACHE_MS) {
            return cache.list;
        }
        const list = await fetchUserGuilds(req.session.discordAccessToken);
        req.session.guildsCache = { at: now, list };
        return list;
    }

    async function assertGuildDashboardAccess(req, guildId) {
        const id = parseGuildId(guildId);
        if (!id) {
            return { ok: false, status: 400, error: "Invalid guild id" };
        }
        if (!client.guilds.cache.has(id)) {
            return { ok: false, status: 404, error: "Bot is not in this server" };
        }
        const guilds = await getCachedGuilds(req);
        const membership = guilds.find((g) => g.id === id);
        if (!membership) {
            return { ok: false, status: 403, error: "You are not a member of this server" };
        }
        if (!canConfigureGuild(membership)) {
            return {
                ok: false,
                status: 403,
                error: "You need Manage Server or Administrator to change bot settings"
            };
        }
        return { ok: true, guildId: id };
    }

    app.get("/auth/discord", (req, res) => {
        const state = randomState();
        req.session.oauthState = state;
        const url = buildAuthorizeUrl({ clientId, redirectUri: callbackUrl, state });
        res.redirect(url);
    });

    app.get("/auth/discord/callback", async (req, res) => {
        const { code, state, error } = req.query;
        if (error) {
            res.status(400).send(`Discord OAuth error: ${error}`);
            return;
        }
        if (!code || typeof code !== "string" || state !== req.session.oauthState) {
            res.status(400).send("Invalid OAuth state or missing code");
            return;
        }
        delete req.session.oauthState;

        try {
            const tokenJson = await exchangeCode({
                clientId,
                clientSecret,
                code,
                redirectUri: callbackUrl
            });
            const accessToken = tokenJson.access_token;
            if (!accessToken) {
                res.status(400).send("No access token returned");
                return;
            }
            const user = await fetchDiscordUser(accessToken);
            req.session.regenerate((regenErr) => {
                if (regenErr) {
                    console.error("Session regenerate after OAuth:", regenErr);
                    res.status(500).send("Login failed. Could not create session.");
                    return;
                }
                req.session.discordAccessToken = accessToken;
                req.session.discordUser = {
                    id: user.id,
                    username: user.username,
                    global_name: user.global_name,
                    avatar: user.avatar,
                    discriminator: user.discriminator
                };
                res.redirect("/");
            });
        } catch (err) {
            console.error("OAuth callback error:", err);
            res.status(500).send("Login failed. Check server logs.");
        }
    });

    app.post("/api/logout", (req, res) => {
        req.session.destroy(() => {
            res.json({ ok: true });
        });
    });

    app.get("/api/me", requireSession, (req, res) => {
        res.json({ user: req.session.discordUser });
    });

    app.get("/api/guilds", requireSession, async (req, res) => {
        try {
            const guilds = await getCachedGuilds(req);
            const mutual = guilds
                .filter((g) => client.guilds.cache.has(g.id))
                .filter((g) => canConfigureGuild(g))
                .map((g) => {
                    const discordGuild = client.guilds.cache.get(g.id);
                    return {
                        id: g.id,
                        name: discordGuild?.name ?? g.name,
                        icon: g.icon
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name));

            res.json({ guilds: mutual });
        } catch (err) {
            console.error("GET /api/guilds:", err);
            res.status(500).json({ error: "Failed to load servers" });
        }
    });

    app.get("/api/guilds/:guildId/settings", requireSession, async (req, res) => {
        const check = await assertGuildDashboardAccess(req, req.params.guildId);
        if (!check.ok) {
            res.status(check.status).json({ error: check.error });
            return;
        }
        try {
            const settings = await guildSettings.getGuildSettings(pool, check.guildId, config);
            const descriptions = {};
            for (const [name, meta] of Object.entries(config.commands || {})) {
                descriptions[name] = meta?.description ?? "";
            }
            res.json({ settings, descriptions });
        } catch (err) {
            console.error("GET settings:", err);
            res.status(500).json({ error: "Failed to load settings" });
        }
    });

    app.put("/api/guilds/:guildId/settings", requireSession, async (req, res) => {
        const check = await assertGuildDashboardAccess(req, req.params.guildId);
        if (!check.ok) {
            res.status(check.status).json({ error: check.error });
            return;
        }
        try {
            await guildSettings.upsertGuildSettings(pool, check.guildId, req.body || {}, config);
            const settings = await guildSettings.getGuildSettings(pool, check.guildId, config);
            res.json({ settings });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Update failed";
            const status = message.includes("Unknown command") || message.includes("prefix") ? 400 : 500;
            res.status(status).json({ error: message });
        }
    });

    app.get("*", (req, res) => {
        res.sendFile(path.join(publicDir, "index.html"));
    });

    return app;
}

module.exports = {
    createDashboardApp
};
