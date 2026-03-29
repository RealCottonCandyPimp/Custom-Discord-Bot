const { PermissionFlagsBits } = require("discord.js");

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
/** Safety cap: 100 messages per iteration, max iterations limits total work per invocation. */
const MAX_ITERATIONS = 500;

/**
 * Handles /message-purge: deletes all messages in the channel where the command was used.
 * Expected option: confirm (boolean)
 */
async function handleMessagePurgeCommand(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
        await interaction.reply({
            content: "This command can only be used in a text channel or thread.",
            ephemeral: true
        });
        return;
    }

    const canManageMessages = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
    if (!canManageMessages) {
        await interaction.reply({
            content: "You need the Manage Messages permission to use this command.",
            ephemeral: true
        });
        return;
    }

    const confirmed = interaction.options.getBoolean("confirm", true);
    if (!confirmed) {
        await interaction.reply({
            content: "Message purge cancelled. Re-run with confirm set to true.",
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    let removed = 0;
    let iterations = 0;

    try {
        while (iterations < MAX_ITERATIONS) {
            iterations += 1;
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size === 0) {
                break;
            }

            const cutoff = Date.now() - TWO_WEEKS_MS;
            const recent = messages.filter((m) => m.createdTimestamp > cutoff);
            const old = messages.filter((m) => m.createdTimestamp <= cutoff);

            if (recent.size > 0) {
                const deleted = await channel.bulkDelete(recent, true);
                removed += deleted.size;
            }

            for (const msg of old.values()) {
                try {
                    await msg.delete();
                    removed += 1;
                } catch (_) {
                    // Continue with remaining messages.
                }
            }
        }
    } catch (error) {
        console.error("Message purge error:", error);
        await interaction.editReply(
            `Something went wrong while purging (${error.message}). Removed ${removed} message(s) before stopping.`
        );
        return;
    }

    let suffix = "";
    if (iterations >= MAX_ITERATIONS) {
        const remaining = await channel.messages.fetch({ limit: 1 });
        if (remaining.size > 0) {
            suffix =
                " Channel may still contain messages (safety limit reached); run the command again to continue.";
        }
    }

    await interaction.editReply(`Message purge complete. Removed ${removed} message(s).${suffix}`);
}

module.exports = {
    handleMessagePurgeCommand
};
