const crypto = require("node:crypto");

const DISCORD_API = "https://discord.com/api/v10";

function buildAuthorizeUrl({ clientId, redirectUri, state, scope = "identify guilds" }) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope,
        state
    });
    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
    });

    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }

    return res.json();
}

async function fetchDiscordUser(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`users/@me failed: ${res.status} ${text}`);
    }
    return res.json();
}

async function fetchUserGuilds(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`users/@me/guilds failed: ${res.status} ${text}`);
    }
    return res.json();
}

function canConfigureGuild({ owner, permissions }) {
    if (owner) {
        return true;
    }
    try {
        const p = BigInt(permissions);
        const administrator = 1n << 3n;
        const manageGuild = 1n << 5n;
        return (p & administrator) !== 0n || (p & manageGuild) !== 0n;
    } catch {
        return false;
    }
}

function randomState() {
    return crypto.randomBytes(24).toString("hex");
}

module.exports = {
    buildAuthorizeUrl,
    exchangeCode,
    fetchDiscordUser,
    fetchUserGuilds,
    canConfigureGuild,
    randomState,
    DISCORD_API
};
