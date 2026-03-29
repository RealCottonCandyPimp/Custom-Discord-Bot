const guildSettings = require("../lib/guildSettings");
const { xpProgress, getMemberXpRow } = require("../lib/xpService");

async function handleRankCommand(interaction, pool, config) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            ephemeral: true
        });
        return;
    }

    const settings = await guildSettings.getGuildSettings(pool, interaction.guildId, config);
    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = member?.displayName ?? targetUser.username;

    const row = await getMemberXpRow(pool, interaction.guildId, targetUser.id);
    const { level, toNext, xpPerLevel } = xpProgress(row.xp, settings.xp.perLevel);
    const capNote =
        settings.xp.dailyCap > 0
            ? `Daily cap: **${settings.xp.dailyCap}** XP (resets at UTC midnight).`
            : "No daily XP cap.";

    const systemNote = settings.xp.enabled
        ? `Messages earn **${settings.xp.perMessage}** XP (until the daily cap).`
        : "The XP system is **disabled** for this server (no new XP from messages).";

    await interaction.reply({
        content: [
            `**${displayName}** — Level **${level}**`,
            `Total XP: **${row.xp}** · **${toNext}** XP to the next level (needs **${xpPerLevel}** XP per level).`,
            systemNote,
            capNote
        ].join("\n"),
        ephemeral: true
    });
}

module.exports = {
    handleRankCommand
};
