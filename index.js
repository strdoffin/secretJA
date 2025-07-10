require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    Routes,
    EmbedBuilder,
} = require("discord.js");
const { REST } = require("@discordjs/rest");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
    TABLE_NAME
)}`;

const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Slash command setup
const commands = [
    new SlashCommandBuilder()
        .setName("verify")
        .setDescription("Verify student and assign game roles")
        .addStringOption((option) =>
            option
                .setName("รหัสนักศึกษา")
                .setDescription("กรอกรหัสนักศึกษา")
                .setRequired(true)
        )
        .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        console.log("Registering slash commands...");
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
            body: commands,
        });
        console.log("Slash commands registered.");
    } catch (err) {
        console.error(err);
    }
})();

// Fetch records from Airtable
async function fetchAirtableRecords() {
    try {
        const res = await fetch(AIRTABLE_URL, {
            headers: {
                Authorization: `Bearer ${AIRTABLE_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(
                `Airtable fetch error: ${res.status} ${res.statusText} - ${errorText}`
            );
        }

        const data = await res.json();
        return data.records;
    } catch (err) {
        console.error("Error fetching Airtable records:", err);
        return [];
    }
}

client.on("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "verify") return;

    // Defer reply (ephemeral using flags)
    await interaction.deferReply({ flags: 1 << 6 });

    const inputStudentid = interaction.options
        .getString("รหัสนักศึกษา")
        .toLowerCase()
        .trim();

    const records = await fetchAirtableRecords();

    const matchedRecord = records.find((record) => {
        const studentId = (record.fields.studentId || "").toLowerCase().trim();
        return studentId === inputStudentid;
    });

    if (!matchedRecord) {
        return interaction.editReply(
            "❌ ไม่พบข้อมูลของคุณในฐานข้อมูล โปรดติดต่อAdmin."
        );
    }

    // Game and TeamName fields
    let games = matchedRecord.fields.Game || [];
    if (typeof games === "string") games = [games];
    const teamName = matchedRecord.fields.TeamName;

    const guild = interaction.guild;
    const member = await guild.members.fetch(interaction.user.id);
    const rolesToAdd = [];

    // Add game roles
    for (const gameName of games) {
        const role = guild.roles.cache.find(
            (r) => r.name.toLowerCase() === gameName.toLowerCase()
        );
        if (role) rolesToAdd.push(role);
    }

    // Add team role
    if (teamName) {
        const teamRole = guild.roles.cache.find(
            (r) => r.name.toLowerCase() === teamName.toLowerCase()
        );
        if (teamRole && !rolesToAdd.some((r) => r.id === teamRole.id)) {
            rolesToAdd.push(teamRole);
        }
    }

    if (rolesToAdd.length === 0) {
        return interaction.editReply(
            "⚠️ No matching roles found in the server for your games or team."
        );
    }

    try {
        await member.roles.add(rolesToAdd);

        await interaction.editReply(`✅ ยืนยันตัวตนสำเร็จ`);

        // Custom field label mapping
        const customFieldNames = {
            Name: "ชื่อจริง",
            Lastname: "นามสกุล",
            TeamName: "ชื่อทีม",
            Game: "เกมที่แข่ง",
            IGN: "ชื่อในเกม",
        };

        const embed = new EmbedBuilder()
            .setTitle(`✅ ยืนยันตัวตนสำเร็จ: ${interaction.user.username}`)
            .setColor(0x00ff00)
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp();

        // Add filtered fields
        for (const [key, value] of Object.entries(matchedRecord.fields)) {
            if (
                ["studentid", "instagram", "discord"].includes(
                    key.toLowerCase()
                )
            )
                continue;

            const displayName = customFieldNames[key] || key;
            embed.addFields({
                name: displayName,
                value: String(value),
                inline: true,
            });
        }

        // Send public embed to channel
        await interaction.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Error assigning roles:", error);
        await interaction.editReply(
            "❌ Failed to assign roles. Please check my permissions."
        );
    }
});

client.login(TOKEN);
