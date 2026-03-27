const { PermissionFlagsBits, ChannelType } = require("discord.js");

/**
 * Handles /kick command.
 * Expected options: user (required), reason (optional), log_channel (optional text channel)
 */
async function handleKickCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const canKickMembers = interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers);
    if (!canKickMembers) {
        await interaction.reply({
            content: "You need the Kick Members permission to use this command.",
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

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
        await interaction.reply({
            content: "That user is not in this server or could not be resolved.",
            ephemeral: true
        });
        return;
    }

    if (targetMember.id === interaction.user.id) {
        await interaction.reply({
            content: "You cannot kick yourself.",
            ephemeral: true
        });
        return;
    }

    if (targetMember.id === interaction.guild.ownerId) {
        await interaction.reply({
            content: "You cannot kick the server owner.",
            ephemeral: true
        });
        return;
    }

    if (!targetMember.kickable) {
        await interaction.reply({
            content: "I cannot kick this user. Check role hierarchy and permissions.",
            ephemeral: true
        });
        return;
    }

    const dmMessage = [
        `You were kicked from **${interaction.guild.name}**.`,
        `Moderator: ${interaction.user.tag}`,
        `Reason: ${reason}`
    ].join("\n");

    try {
        await targetUser.send(dmMessage).catch(() => null);
        await targetMember.kick(`${reason} | Kicked by ${interaction.user.tag}`);

        await interaction.reply({
            content: `Kicked ${targetUser.tag}. Reason: ${reason}`,
            ephemeral: true
        });

        if (logChannel) {
            await logChannel.send(
                `User kicked: ${targetUser.tag} (${targetUser.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`
            );
        }
    } catch (_) {
        await interaction.reply({
            content: "Failed to kick that user. Please try again.",
            ephemeral: true
        });
    }
}

module.exports = {
    handleKickCommand
};
