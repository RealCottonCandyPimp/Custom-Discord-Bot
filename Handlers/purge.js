const { PermissionFlagsBits } = require("discord.js");

/**
 * Handles /purge command and deletes active temporary invites.
 * Expected option: confirm (boolean)
 */
async function handlePurgeCommand(interaction) {
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
            content: "Purge cancelled. Re-run with confirm set to true.",
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const invites = await interaction.guild.invites.fetch();
    const now = Date.now();

    // "Time-limited" invites are treated as invites with an expiration timestamp in the future.
    const expiringInvites = invites.filter((invite) => {
        if (!invite.expiresTimestamp) {
            return false;
        }
        return invite.expiresTimestamp > now;
    });

    if (expiringInvites.size === 0) {
        await interaction.editReply("No active time-limited invites were found.");
        return;
    }

    let deleted = 0;
    for (const invite of expiringInvites.values()) {
        try {
            await invite.delete(`Purged by ${interaction.user.tag}`);
            deleted += 1;
        } catch (_) {
            // Ignore individual invite deletion failures and continue purging.
        }
    }

    await interaction.editReply(
        `Purge complete. Removed ${deleted}/${expiringInvites.size} active time-limited invite(s).`
    );
}

module.exports = {
    handlePurgeCommand
};
