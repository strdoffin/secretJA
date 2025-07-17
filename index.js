require("dotenv").config();
const {
	Client,
	GatewayIntentBits,
	SlashCommandBuilder,
	Routes,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	InteractionType,
} = require("discord.js");
const { REST } = require("@discordjs/rest");
const axios = require("axios");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const GATE_TABLE = process.env.AIRTABLE_GATE_TABLE || "Gate";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Slash command registration
const commands = [
	new SlashCommandBuilder()
		.setName("gate")
		.setDescription("Verify with your student ID")
		.toJSON(),
	new SlashCommandBuilder()
		.setName("esport")
		.setDescription("Verify as Esport player")
		.toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
	try {
		console.log("🔁 Registering slash commands...");
		await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
			body: commands,
		});
		console.log("✅ Slash commands registered.");
	} catch (err) {
		console.error("❌ Slash command error:", err);
	}
})();

// Airtable fetchers
async function fetchAirtableRecords() {
	let records = [];
	let offset = null;
	const urlBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

	try {
		do {
			const url = `${urlBase}${offset ? `?offset=${offset}` : ""}`;
			const response = await axios.get(url, {
				headers: {
					Authorization: `Bearer ${AIRTABLE_TOKEN}`,
					"Content-Type": "application/json",
				},
			});
			records = records.concat(response.data.records);
			offset = response.data.offset;
		} while (offset);
	} catch (err) {
		console.error("Error fetching esport records:", err.message);
	}
	return records;
}

async function fetchGateTableRecords() {
	let records = [];
	let offset = null;
	const urlBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(GATE_TABLE)}`;

	try {
		do {
			const url = `${urlBase}${offset ? `?offset=${offset}` : ""}`;
			const response = await axios.get(url, {
				headers: {
					Authorization: `Bearer ${AIRTABLE_TOKEN}`,
					"Content-Type": "application/json",
				},
			});
			records = records.concat(response.data.records);
			offset = response.data.offset;
		} while (offset);
	} catch (err) {
		console.error("Error fetching Gate table:", err.message);
	}
	return records;
}

let gateCache = [];

client.once("ready", async () => {
	console.log(`🤖 Logged in as ${client.user.tag}`);
	gateCache = await fetchGateTableRecords();
	console.log(`🧠 Cached ${gateCache.length} Gate records`);
});

client.on("interactionCreate", async (interaction) => {
	// 🟢 /gate
	if (interaction.isChatInputCommand() && interaction.commandName === "gate") {
		const modal = new ModalBuilder()
			.setCustomId("gate-id-modal")
			.setTitle("กรอกรหัสนักศึกษา");

		const input = new TextInputBuilder()
			.setCustomId("student_id_input")
			.setLabel("Student ID")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		modal.addComponents(new ActionRowBuilder().addComponents(input));
		await interaction.showModal(modal);
	}

	// 🟢 /esport
	else if (interaction.isChatInputCommand() && interaction.commandName === "esport") {
		const modal = new ModalBuilder()
			.setCustomId("esport-modal")
			.setTitle("ยืนยันตัวตนนักกีฬา Esport");

		const input = new TextInputBuilder()
			.setCustomId("student_id")
			.setLabel("รหัสนักศึกษา")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		modal.addComponents(new ActionRowBuilder().addComponents(input));
		await interaction.showModal(modal);
	}

	// 🟢 Handle /gate modal
	else if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "gate-id-modal") {
		await interaction.deferReply({ ephemeral: true });

		const studentId = interaction.fields.getTextInputValue("student_id_input").toLowerCase().trim();
		const matched = gateCache.find((record) => {
			const idField = (record.fields.ID || "").toLowerCase().trim();
			return idField === studentId;
		});

		if (matched && matched.fields.Gate) {
			const gateValue = matched.fields.Gate.toLowerCase();
			const role = interaction.guild.roles.cache.find(
				(r) => r.name.toLowerCase() === gateValue
			);

			if (!role) return interaction.editReply("⚠️ ไม่พบ role ที่ตรงกับ Gate ใน Discord");

			try {
				const member = await interaction.guild.members.fetch(interaction.user.id);
				await member.roles.add(role);

				await interaction.editReply({ content: "✅ ยืนยันตัวตนสำเร็จ", ephemeral: true });

				const publicEmbed = new EmbedBuilder()
					.setTitle("✅ รับ Role Gate สำเร็จ")
					.setColor(0x804000)
					.setDescription(`${interaction.user} ได้รับ Role: **${role.name}**`)
					.setThumbnail(interaction.user.displayAvatarURL())
					.setTimestamp();

				return interaction.channel.send({ embeds: [publicEmbed] });
			} catch (err) {
				console.error("Role assign error:", err);
				return interaction.editReply("❌ ไม่สามารถเพิ่ม Role ได้ กรุณาตรวจสอบสิทธิ์ของบอท");
			}
		} else {
			const select = new StringSelectMenuBuilder()
				.setCustomId(`gate-select|${studentId}`)
				.setPlaceholder("กรุณาเลือก Gate ของคุณ")
				.addOptions([
					{ label: "NOR", value: "nor" },
					{ label: "NOT", value: "not" },
					{ label: "OR", value: "or" },
					{ label: "AND", value: "and" },
				]);

			const row = new ActionRowBuilder().addComponents(select);

			return interaction.editReply({
				content: "❌ ไม่พบข้อมูลของคุณในระบบ โปรดเลือก Gate ด้านล่าง",
				components: [row],
			});
		}
	}

	// ✅ Handle Gate select menu (updated to show embed publicly)
	else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("gate-select")) {
		await interaction.deferReply({ ephemeral: true });

		const selectedGate = interaction.values[0];
		const role = interaction.guild.roles.cache.find(
			(r) => r.name.toLowerCase() === selectedGate
		);

		if (!role) {
			return interaction.editReply("❌ ไม่พบ Role ที่ตรงกับ Gate ที่เลือก");
		}

		try {
			const member = await interaction.guild.members.fetch(interaction.user.id);
			await member.roles.add(role);

			await interaction.editReply({ content: "✅ ยืนยันตัวตนด้วย Gate สำเร็จ", ephemeral: true });

			const embed = new EmbedBuilder()
				.setTitle("✅ รับ Role Gate สำเร็จ")
				.setColor(0x00b140)
				.setDescription(`${interaction.user} ได้รับ Role: **${role.name.toUpperCase()}**`)
				.setThumbnail(interaction.user.displayAvatarURL())
				.setTimestamp();

			await interaction.channel.send({ embeds: [embed] });
		} catch (err) {
			console.error("Error assigning fallback role:", err);
			await interaction.editReply("❌ ไม่สามารถเพิ่ม Role ได้ กรุณาตรวจสอบสิทธิ์ของบอท");
		}
	}

	// 🟢 Handle /esport modal
	else if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "esport-modal") {
		await interaction.deferReply({ ephemeral: false });

		const studentId = interaction.fields.getTextInputValue("student_id").toLowerCase().trim();
		const records = await fetchAirtableRecords();

		const matched = records.filter(
			(record) => (record.fields.studentId || "").toLowerCase().trim() === studentId
		);

		if (matched.length === 0) {
			return interaction.editReply("❌ ไม่พบข้อมูลของคุณในฐานข้อมูล โปรดติดต่อ Admin.");
		}

		const allGames = new Set();
		const allTeams = new Set();
		const mergedFields = {};

		for (const record of matched) {
			let games = record.fields.Game || [];
			if (typeof games === "string") games = [games];
			games.forEach((g) => allGames.add(g));

			if (record.fields.TeamName) allTeams.add(record.fields.TeamName);

			for (const [key, value] of Object.entries(record.fields)) {
				if (["studentid", "instagram", "discord"].includes(key.toLowerCase())) continue;
				mergedFields[key] = value;
			}
		}

		const member = await interaction.guild.members.fetch(interaction.user.id);
		const rolesToAdd = [];

		for (const g of allGames) {
			const role = interaction.guild.roles.cache.find(
				(r) => r.name.toLowerCase() === g.toLowerCase()
			);
			if (role) rolesToAdd.push(role);
		}

		for (const t of allTeams) {
			const role = interaction.guild.roles.cache.find(
				(r) => r.name.toLowerCase() === t.toLowerCase()
			);
			if (role && !rolesToAdd.some((r) => r.id === role.id)) {
				rolesToAdd.push(role);
			}
		}

		if (rolesToAdd.length === 0) {
			return interaction.editReply("⚠️ ไม่พบ role ที่ตรงกับข้อมูลของคุณใน Discord");
		}

		try {
			await member.roles.add(rolesToAdd);
			await interaction.editReply("✅ ยืนยันตัวตนสำเร็จ");

			const embed = new EmbedBuilder()
				.setTitle(`✅ ยืนยันตัวตนสำเร็จ: ${interaction.user.username}`)
				.setColor(0x00ff00)
				.setThumbnail(interaction.user.displayAvatarURL())
				.setTimestamp();

			const labels = {
				Name: "ชื่อจริง",
				Lastname: "นามสกุล",
				TeamName: "ชื่อทีม",
				Game: "เกมที่แข่ง",
				IGN: "ชื่อในเกม",
			};

			for (const [key, value] of Object.entries(mergedFields)) {
				if (["Game", "TeamName"].includes(key)) continue;
				embed.addFields({
					name: labels[key] || key,
					value: String(value),
					inline: true,
				});
			}

			embed.addFields({
				name: "เกมที่แข่ง",
				value: [...allGames].join(", ") || "-",
				inline: true,
			});
			embed.addFields({
				name: "ชื่อทีม",
				value: [...allTeams].join(", ") || "-",
				inline: true,
			});

			await interaction.channel.send({ embeds: [embed] });
		} catch (err) {
			console.error("Role assign error:", err);
			await interaction.editReply("❌ Failed to assign roles. Please check bot permissions.");
		}
	}
});

client.login(TOKEN);
