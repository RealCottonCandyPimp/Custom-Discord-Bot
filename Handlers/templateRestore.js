const fs = require("node:fs");
const path = require("node:path");
const {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
    OverwriteType
} = require("discord.js");

const TEMPLATE_VERSION = 1;
const dataDir = path.join(__dirname, "..", "data");
const globalTemplatesPath = path.join(dataDir, "global-templates.json");

function templatePath(guildId) {
    return path.join(dataDir, `template-${guildId}.json`);
}

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function normalizeTemplateKey(raw) {
    if (raw == null || typeof raw !== "string") {
        return null;
    }
    const k = raw
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "");
    if (!k || k.length > 40) {
        return null;
    }
    return k;
}

function readGlobalStore() {
    ensureDataDir();
    if (!fs.existsSync(globalTemplatesPath)) {
        return { version: 1, entries: {} };
    }
    try {
        const data = JSON.parse(fs.readFileSync(globalTemplatesPath, "utf8"));
        if (!data || typeof data.entries !== "object" || data.entries === null) {
            return { version: 1, entries: {} };
        }
        return data;
    } catch (_) {
        return { version: 1, entries: {} };
    }
}

function writeGlobalStore(store) {
    ensureDataDir();
    fs.writeFileSync(globalTemplatesPath, JSON.stringify(store, null, 2), "utf8");
}

function validateSnapshot(data) {
    return (
        data &&
        data.version === TEMPLATE_VERSION &&
        Array.isArray(data.roles) &&
        Array.isArray(data.categories) &&
        Array.isArray(data.channels)
    );
}

function serializeOverwrites(channel, guild) {
    const list = [];
    for (const ow of channel.permissionOverwrites.cache.values()) {
        const allow = ow.allow.bitfield.toString();
        const deny = ow.deny.bitfield.toString();
        if (ow.type === OverwriteType.Role) {
            const role = guild.roles.cache.get(ow.id);
            list.push({
                targetType: "role",
                targetName: role ? role.name : null,
                allow,
                deny
            });
        } else {
            list.push({
                targetType: "member",
                targetId: ow.id,
                allow,
                deny
            });
        }
    }
    return list;
}

function buildTemplatePayload(guild) {
    const everyone = guild.roles.everyone;
    const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => a.position - b.position);

    const roleData = roles.map((r) => ({
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions.bitfield.toString(),
        position: r.position,
        unicodeEmoji: r.unicodeEmoji ?? null
    }));

    const categories = [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    const categoryIndexById = new Map(categories.map((c, i) => [c.id, i]));

    const categoryEntries = categories.map((c) => ({
        name: c.name,
        position: c.position,
        permissionOverwrites: serializeOverwrites(c, guild)
    }));

    const otherChannels = [...guild.channels.cache.values()].filter(
        (c) => c.type !== ChannelType.GuildCategory && !c.isThread()
    );

    const channelData = otherChannels
        .sort((a, b) => {
            if (a.rawPosition !== b.rawPosition) {
                return a.rawPosition - b.rawPosition;
            }
            return a.id.localeCompare(b.id);
        })
        .map((c) => {
            const parent = c.parent;
            const parentIndex =
                parent && parent.type === ChannelType.GuildCategory
                    ? categoryIndexById.get(parent.id) ?? null
                    : null;

            return {
                type: c.type,
                name: c.name,
                position: c.position,
                parentIndex,
                permissionOverwrites: serializeOverwrites(c, guild),
                ...serializeChannelExtra(c)
            };
        });

    return {
        version: TEMPLATE_VERSION,
        savedAt: new Date().toISOString(),
        guildId: guild.id,
        guildName: guild.name,
        everyoneRole: {
            permissions: everyone.permissions.bitfield.toString()
        },
        roles: roleData,
        categories: categoryEntries,
        channels: channelData
    };
}

function buildRoleNameToIdMap(guild) {
    const map = new Map();
    map.set("@everyone", guild.id);
    for (const r of guild.roles.cache.values()) {
        if (!map.has(r.name)) {
            map.set(r.name, r.id);
        }
    }
    return map;
}

function parseOverwrites(overwrites, roleNameToId) {
    const result = [];
    for (const o of overwrites || []) {
        try {
            const allow = new PermissionsBitField(BigInt(o.allow || "0"));
            const deny = new PermissionsBitField(BigInt(o.deny || "0"));
            if (o.targetType === "role") {
                if (!o.targetName) {
                    continue;
                }
                const id = roleNameToId.get(o.targetName);
                if (!id) {
                    continue;
                }
                result.push({
                    id,
                    type: OverwriteType.Role,
                    allow,
                    deny
                });
            } else if (o.targetId) {
                result.push({
                    id: o.targetId,
                    type: OverwriteType.Member,
                    allow,
                    deny
                });
            }
        } catch (_) {
            // Skip invalid overwrite entries.
        }
    }
    return result;
}

function serializeChannelExtra(c) {
    const extra = {};
    switch (c.type) {
        case ChannelType.GuildText:
        case ChannelType.GuildAnnouncement:
            extra.topic = c.topic;
            extra.nsfw = c.nsfw;
            extra.rateLimitPerUser = c.rateLimitPerUser;
            extra.defaultAutoArchiveDuration = c.defaultAutoArchiveDuration;
            break;
        case ChannelType.GuildVoice:
            extra.bitrate = c.bitrate;
            extra.userLimit = c.userLimit;
            break;
        case ChannelType.GuildStageVoice:
            extra.topic = c.topic;
            extra.bitrate = c.bitrate;
            extra.userLimit = c.userLimit;
            break;
        case ChannelType.GuildForum:
        case ChannelType.GuildMedia:
            extra.topic = c.topic;
            extra.nsfw = c.nsfw;
            extra.rateLimitPerUser = c.rateLimitPerUser;
            break;
        default:
            break;
    }
    return extra;
}

function clampBitrate(guild, bitrate) {
    const limits = [64000, 96000, 128000, 256000, 384000];
    const tier = guild.premiumTier;
    const max = limits[Math.min(tier, limits.length - 1)] ?? 96000;
    const b = bitrate || 64000;
    return Math.min(Math.max(b, 8000), max);
}

async function createChannelFromTemplate(guild, data, parentId, roleNameToId) {
    const overwrites = parseOverwrites(data.permissionOverwrites, roleNameToId);
    const base = {
        name: data.name,
        parent: parentId || undefined,
        permissionOverwrites: overwrites,
        reason: "Template restore"
    };

    switch (data.type) {
        case ChannelType.GuildText:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildText,
                topic: data.topic ?? undefined,
                nsfw: data.nsfw ?? false,
                rateLimitPerUser: data.rateLimitPerUser ?? undefined,
                defaultAutoArchiveDuration: data.defaultAutoArchiveDuration ?? undefined
            });
        case ChannelType.GuildAnnouncement:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildAnnouncement,
                topic: data.topic ?? undefined,
                nsfw: data.nsfw ?? false,
                rateLimitPerUser: data.rateLimitPerUser ?? undefined,
                defaultAutoArchiveDuration: data.defaultAutoArchiveDuration ?? undefined
            });
        case ChannelType.GuildVoice:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildVoice,
                bitrate: clampBitrate(guild, data.bitrate),
                userLimit: data.userLimit ?? 0
            });
        case ChannelType.GuildStageVoice:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildStageVoice,
                topic: data.topic ?? undefined,
                bitrate: clampBitrate(guild, data.bitrate),
                userLimit: data.userLimit ?? 0
            });
        case ChannelType.GuildForum:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildForum,
                topic: data.topic ?? undefined,
                nsfw: data.nsfw ?? false,
                rateLimitPerUser: data.rateLimitPerUser ?? undefined
            });
        case ChannelType.GuildMedia:
            return guild.channels.create({
                ...base,
                type: ChannelType.GuildMedia,
                topic: data.topic ?? undefined,
                nsfw: data.nsfw ?? false,
                rateLimitPerUser: data.rateLimitPerUser ?? undefined
            });
        default:
            return null;
    }
}

async function restoreGuildFromSnapshot(guild, me, data) {
    await guild.roles.fetch().catch(() => {});
    await guild.channels.fetch().catch(() => {});

    const nonCategories = [...guild.channels.cache.values()].filter(
        (c) => c.type !== ChannelType.GuildCategory && !c.isThread()
    );
    nonCategories.sort((a, b) => b.rawPosition - a.rawPosition);
    for (const ch of nonCategories) {
        await ch.delete("Template restore").catch(() => {});
    }

    const categoryChans = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildCategory
    );
    categoryChans.sort((a, b) => b.position - a.position);
    for (const ch of categoryChans) {
        await ch.delete("Template restore").catch(() => {});
    }

    const rolesToDelete = [...guild.roles.cache.values()]
        .filter(
            (r) =>
                r.id !== guild.id &&
                !r.managed &&
                r.editable &&
                me &&
                me.roles.highest.comparePositionTo(r) > 0
        )
        .sort((a, b) => b.position - a.position);

    for (const r of rolesToDelete) {
        await r.delete("Template restore").catch(() => {});
    }

    await guild.roles.fetch().catch(() => {});

    if (data.everyoneRole?.permissions) {
        await guild.roles.everyone.setPermissions(
            new PermissionsBitField(BigInt(data.everyoneRole.permissions)),
            "Template restore"
        );
    }

    const sortedRoles = [...data.roles].sort((a, b) => a.position - b.position);
    const rolePositionUpdates = [];
    let recreatedRoles = 0;
    for (const rd of sortedRoles) {
        const role = await guild.roles
            .create({
                name: rd.name,
                color: rd.color ?? undefined,
                hoist: rd.hoist ?? false,
                mentionable: rd.mentionable ?? false,
                permissions: new PermissionsBitField(BigInt(rd.permissions || "0")),
                unicodeEmoji: rd.unicodeEmoji ?? undefined,
                reason: "Template restore"
            })
            .catch(() => null);
        if (role) {
            recreatedRoles += 1;
            if (typeof rd.position === "number") {
                rolePositionUpdates.push({ role: role.id, position: rd.position });
            }
        }
    }

    if (rolePositionUpdates.length > 0) {
        await guild.roles.setPositions(rolePositionUpdates).catch(() => {});
    }

    await guild.roles.fetch().catch(() => {});
    const roleNameToId = buildRoleNameToIdMap(guild);

    const newCategoryIds = [];
    const sortedCats = [...data.categories].sort((a, b) => a.position - b.position);
    for (const cat of sortedCats) {
        const overwrites = parseOverwrites(cat.permissionOverwrites, roleNameToId);
        const created = await guild.channels
            .create({
                name: cat.name,
                type: ChannelType.GuildCategory,
                permissionOverwrites: overwrites,
                reason: "Template restore"
            })
            .catch(() => null);
        newCategoryIds.push(created ? created.id : null);
    }

    const sortedChannels = [...data.channels].sort((a, b) => {
        if (a.parentIndex !== b.parentIndex) {
            return (a.parentIndex ?? -1) - (b.parentIndex ?? -1);
        }
        return a.position - b.position;
    });

    let createdChannels = 0;
    for (const ch of sortedChannels) {
        let parentId = null;
        if (ch.parentIndex != null && newCategoryIds[ch.parentIndex]) {
            parentId = newCategoryIds[ch.parentIndex];
        }
        const created = await createChannelFromTemplate(guild, ch, parentId, roleNameToId);
        if (created) {
            createdChannels += 1;
            if (typeof ch.position === "number") {
                await created.setPosition(ch.position).catch(() => {});
            }
        }
    }

    return {
        recreatedRoles,
        categoryCount: newCategoryIds.filter(Boolean).length,
        createdChannels
    };
}

async function handleTemplateCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!canManageGuild) {
        await interaction.reply({
            content: "You need the Manage Server permission to use this command.",
            ephemeral: true
        });
        return;
    }

    const guild = interaction.guild;
    await guild.roles.fetch().catch(() => {});
    await guild.channels.fetch().catch(() => {});

    const payload = buildTemplatePayload(guild);
    const rolesCount = payload.roles.length;
    const categoriesCount = payload.categories.length;
    const channelsCount = payload.channels.length;

    ensureDataDir();
    fs.writeFileSync(templatePath(guild.id), JSON.stringify(payload, null, 2), "utf8");

    const shareRaw = interaction.options.getString("share_key");
    const shareKey = normalizeTemplateKey(shareRaw || "");
    let sharedNote = "";
    if (shareRaw && shareRaw.trim()) {
        if (!shareKey) {
            await interaction.reply({
                content:
                    "Local template saved, but `share_key` is invalid. Use 1–40 characters: letters, numbers, dashes, underscores (spaces become dashes).",
                ephemeral: true
            });
            return;
        }
        const store = readGlobalStore();
        store.entries[shareKey] = {
            savedAt: payload.savedAt,
            sourceGuildId: guild.id,
            sourceGuildName: guild.name,
            savedByUserId: interaction.user.id,
            savedByUserTag: interaction.user.tag,
            snapshot: payload
        };
        writeGlobalStore(store);
        sharedNote = ` Shared copy published as **${shareKey}** — restore elsewhere with \`/restore\` and **from_key**: \`${shareKey}\`.`;
    }

    await interaction.reply({
        content: `Template saved for this server (${rolesCount} custom role(s), ${categoriesCount} categor(ies), ${channelsCount} channel(s)).${sharedNote} (@everyone permissions and managed/integration roles are handled separately.)`,
        ephemeral: true
    });
}

async function handleRestoreCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!canManageGuild) {
        await interaction.reply({
            content: "You need the Manage Server permission to use this command.",
            ephemeral: true
        });
        return;
    }

    const confirmed = interaction.options.getBoolean("confirm", true);
    if (!confirmed) {
        await interaction.reply({
            content: "Restore cancelled. Run again with confirm set to true.",
            ephemeral: true
        });
        return;
    }

    const fromKeyRaw = interaction.options.getString("from_key");
    const fromKey = normalizeTemplateKey(fromKeyRaw || "");

    let data;
    let sourceLabel = "this server's local save";

    if (fromKeyRaw && fromKeyRaw.trim()) {
        if (!fromKey) {
            await interaction.reply({
                content:
                    "Invalid **from_key**. Use the same format as **share_key**: 1–40 characters (letters, numbers, dashes, underscores).",
                ephemeral: true
            });
            return;
        }
        const store = readGlobalStore();
        const entry = store.entries[fromKey];
        if (!entry || !entry.snapshot) {
            await interaction.reply({
                content: `No shared template named **${fromKey}**. Check the key or run \`/template\` with **share_key** on the source server.`,
                ephemeral: true
            });
            return;
        }
        data = entry.snapshot;
        sourceLabel = `shared key **${fromKey}** (from **${entry.sourceGuildName || "unknown server"}**)`;
    } else {
        const file = templatePath(interaction.guild.id);
        if (!fs.existsSync(file)) {
            await interaction.reply({
                content:
                    "No saved template for this server. Run `/template` first, or use **from_key** with a shared template.",
                ephemeral: true
            });
            return;
        }
        try {
            data = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (_) {
            await interaction.reply({
                content: "Saved template file is invalid. Save again with `/template`.",
                ephemeral: true
            });
            return;
        }
    }

    if (!validateSnapshot(data)) {
        await interaction.reply({
            content: "Template data is not supported. Save again with `/template`.",
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const me = guild.members.me;

    try {
        const { recreatedRoles, categoryCount, createdChannels } = await restoreGuildFromSnapshot(
            guild,
            me,
            data
        );
        await interaction.editReply(
            `Restore finished from ${sourceLabel}. Recreated ${recreatedRoles} role(s), ${categoryCount} categor(ies), and ${createdChannels} channel(s).`
        );
    } catch (err) {
        console.error("Template restore error:", err);
        await interaction.editReply(
            "Restore failed partway through. Check the bot's role position, permissions (Manage Server, Manage Channels, Manage Roles), and the console log."
        );
    }
}

module.exports = {
    handleTemplateCommand,
    handleRestoreCommand
};
