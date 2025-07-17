require("dotenv").config();
const axios = require("axios");
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

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commands = [
	new SlashCommandBuilder()
		.setName("esport")
		.setDescription("Verify Esport Player")
		.addStringOption((option) =>
			option
				.setName("รหัสนักศึกษา")
				.setDescription("กรอกรหัสนักศึกษา")
				.setRequired(true)
		)
		.toJSON(),
	new SlashCommandBuilder()
		.setName("gate")
		.setDescription("Verify and add Gate role by student ID")
		.addStringOption((option) =>
			option.setName("id").setDescription("Your Student ID").setRequired(true)
		)
		.toJSON()
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

// ✅ Airtable pagination support with axios
async function fetchAirtableRecords() {
	let records = [];
	let offset = null;

	try {
		do {
			const url = `${AIRTABLE_URL}${offset ? `?offset=${offset}` : ""}`;
			const response = await axios.get(url, {
				headers: {
					Authorization: `Bearer ${AIRTABLE_TOKEN}`,
					"Content-Type": "application/json",
				},
				timeout: 10000,
			});

			records = records.concat(response.data.records);
			offset = response.data.offset;
		} while (offset);
	} catch (err) {
		if (err.response) {
			console.error(
				`Airtable fetch error: ${err.response.status} ${err.response.statusText} -`,
				err.response.data
			);
		} else {
			console.error("Error fetching Airtable records:", err.message);
		}
	}

	return records;
}
async function fetchGateTableRecords() {
	let records = [];
	let offset = null;
	const tableName = process.env.AIRTABLE_GATE_TABLE || "Gate";
	const urlBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`;

	try {
		do {
			const url = `${urlBase}${offset ? `?offset=${offset}` : ""}`;
			const response = await axios.get(url, {
				headers: {
					Authorization: `Bearer ${AIRTABLE_TOKEN}`,
					"Content-Type": "application/json",
				},
				timeout: 10000,
			});

			records = records.concat(response.data.records);
			offset = response.data.offset;
		} while (offset);
	} catch (err) {
		console.error(`Error fetching Gate table:`, err.message);
	}

	return records;
}

let gateCache = [];

client.on("ready", async () => {
	console.log(`✅ Logged in as ${client.user.tag}`);

	gateCache = await fetchGateTableRecords();
	console.log(`🧠 Gate table cached: ${gateCache.length} records`);
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	// /gate command
	if (interaction.commandName === "gate") {
		await interaction.deferReply({ ephemeral: false });

		const inputId = interaction.options.getString("id").toLowerCase().trim();

		const matched = gateCache.find((record) => {
			const idField = (record.fields.ID || "").toLowerCase().trim();
			return idField === inputId;
		});

		if (!matched) {
			return interaction.editReply("❌ ไม่พบข้อมูลในระบบ Gate");
		}

		const gateValue = (matched.fields.Gate || "").toLowerCase();

		if (!gateValue) {
			return interaction.editReply("⚠️ ไม่พบค่าของ Gate สำหรับ ID นี้");
		}

		const role = interaction.guild.roles.cache.find(
			(r) => r.name.toLowerCase() === gateValue
		);

		if (!role) {
			return interaction.editReply("⚠️ ไม่พบ role ที่ตรงกับค่า Gate ใน Discord");
		}

		try {
			const member = await interaction.guild.members.fetch(interaction.user.id);
			await member.roles.add(role);

			const embed = new EmbedBuilder()
				.setTitle("✅ รับRole Gateสำเร็จ")
				.setColor(0x804000)
				.setDescription(`คุณได้รับ Role: **${role.name}**`)
				.setThumbnail(interaction.user.displayAvatarURL())
				.setTimestamp();

			return interaction.editReply({ embeds: [embed], ephemeral: false });
		} catch (err) {
			console.error("Role add error:", err);
			return interaction.editReply({
				content: "❌ เพิ่ม role ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์ของบอท",
				ephemeral: false,
			});
		}
	}

	// /esport command
	else if (interaction.commandName === "esport") {
		await interaction.deferReply({ flags: 1 << 6 });

		const inputStudentid = interaction.options
			.getString("รหัสนักศึกษา")
			.toLowerCase()
			.trim();

		const records = await fetchAirtableRecords();

		const matchedRecords = records.filter((record) => {
			const studentId = (record.fields.studentId || "").toLowerCase().trim();
			return studentId === inputStudentid;
		});

		if (matchedRecords.length === 0) {
			return interaction.editReply(
				"❌ ไม่พบข้อมูลของคุณในฐานข้อมูล โปรดติดต่อ Admin."
			);
		}

		const allGames = new Set();
		const allTeams = new Set();
		const mergedFields = {};

		for (const record of matchedRecords) {
			let games = record.fields.Game || [];
			if (typeof games === "string") games = [games];
			for (const g of games) allGames.add(g);

			if (record.fields.TeamName) allTeams.add(record.fields.TeamName);

			for (const [key, value] of Object.entries(record.fields)) {
				if (["studentid", "instagram", "discord"].includes(key.toLowerCase())) continue;
				mergedFields[key] = value;
			}
		}

		const guild = interaction.guild;
		const member = await guild.members.fetch(interaction.user.id);
		const rolesToAdd = [];

		for (const gameName of allGames) {
			const role = guild.roles.cache.find(
				(r) => r.name.toLowerCase() === gameName.toLowerCase()
			);
			if (role) rolesToAdd.push(role);
		}

		for (const teamName of allTeams) {
			const role = guild.roles.cache.find(
				(r) => r.name.toLowerCase() === teamName.toLowerCase()
			);
			if (role && !rolesToAdd.some((r) => r.id === role.id)) {
				rolesToAdd.push(role);
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

			for (const [key, value] of Object.entries(mergedFields)) {
				if (["Game", "TeamName"].includes(key)) continue;
				const displayName = customFieldNames[key] || key;
				embed.addFields({
					name: displayName,
					value: String(value),
					inline: true,
				});
			}

			embed.addFields({
				name: "เกมที่แข่ง",
				value: Array.from(allGames).join(", ") || "-",
				inline: true,
			});
			embed.addFields({
				name: "ชื่อทีม",
				value: Array.from(allTeams).join(", ") || "-",
				inline: true,
			});

			await interaction.channel.send({ embeds: [embed] });
		} catch (error) {
			console.error("Error assigning roles:", error);
			await interaction.editReply(
				"❌ Failed to assign roles. Please check my permissions."
			);
		}
	}
});


client.login(TOKEN);
