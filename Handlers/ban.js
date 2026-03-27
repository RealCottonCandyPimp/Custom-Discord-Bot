const { PermissionFlagsBits, ChannelType } = require("discord.js");

/**
 * Handles /ban command.
 * Expected options: user (required), reason (optional), log_channel (optional text channel)
 */
async function handleBanCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const canBanMembers = interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
    if (!canBanMembers) {
        await interaction.reply({
            content: "You need the Ban Members permission to use this command.",
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided.";
    const logChannel = interaction.options.getChannel("log_channel");

    if (logChannel && logChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
            content: "The log channel must be a text channel.",
            ephemeral: true
        });
        return;
    }

    const targetMember = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);

    if (!targetMember) {
        await interaction.reply({
            content: "That user is not in this server or could not be resolved.",
            ephemeral: true
        });
        return;
    }

    if (targetMember.id === interaction.user.id) {
        await interaction.reply({
            content: "You cannot ban yourself.",
            ephemeral: true
        });
        return;
    }

    if (targetMember.id === interaction.guild.ownerId) {
        await interaction.reply({
            content: "You cannot ban the server owner.",
            ephemeral: true
        });
        return;
    }

    if (!targetMember.bannable) {
        await interaction.reply({
            content: "I cannot ban this user. Check role hierarchy and permissions.",
            ephemeral: true
        });
        return;
    }

    try {
        await interaction.guild.members.ban(targetMember.id, { reason });

        await interaction.reply({
            content: `Banned ${targetUser.tag}. Reason: ${reason}`,
            ephemeral: true
        });

        if (logChannel) {
            try {
                await logChannel.send(
                    `User banned: ${targetUser.tag} (${targetUser.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`
                );
            } catch (_) {
                await interaction.followUp({
                    content: "Ban succeeded, but the log message could not be sent to that channel.",
                    ephemeral: true
                });
            }
        }
    } catch (_) {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: "Failed to ban that user. Please try again.",
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: "Failed to ban that user. Please try again.",
                ephemeral: true
            });
        }
    }
}

module.exports = {
    handleBanCommand
};
