import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import { coachCommandDescription, coachVoiceFooter, coachVoiceTitle } from "../../shared/madden_coach_voice.js";
import { getLeagueBuddyLogoEmoji } from "../../shared/application_emojis.js";

const ROLE_MAP_PATH = path.join(process.cwd(), "data", "madden", "madden_role_ids.json");

const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription(coachCommandDescription("help"));

function isStaff(member) {
  try {
    const map = JSON.parse(fs.readFileSync(ROLE_MAP_PATH, "utf8"));
    const commishIds = Object.entries(map || {})
      .filter(([key]) => key.toLowerCase().includes("commish"))
      .map(([, id]) => id);
    if (commishIds.length && member?.roles?.cache) {
      return member.roles.cache.some(r => commishIds.includes(r.id));
    }
  } catch {
    // ignore and fall back to name check
  }
  const fallbackNames = ["LB Commish", "LB Co-Commish"];
  return member?.roles?.cache?.some(r => fallbackNames.includes(r.name)) ?? false;
}

const coachSections = [
  ["League", [
    ["/help", "Show this command list."],
    ["/schedule", "View the league schedule."],
    ["/roster", "Open a team roster card."],
    ["/playersearch", "Find a player from the synced roster."],
    ["/streamlink", "Post your game stream."],
    ["/tradeblock", "Post or update your trade block."],
  ]],
  ["Draft", [
    ["/draftclass", "View loaded class status."],
    ["/scout", "Scout draft prospects privately."],
    ["/myscouts", "Review your scouted prospects."],
    ["/bigboard", "Browse the current draft board."],
    ["/draftprimer", "Get team-aware draft prep."],
    ["/mockdraft", "View the live mock draft."],
    ["/recruiting", "Browse the current recruiting class."],
  ]],
  ["Prep", [
    ["/franchisehub", "Open your franchise overview."],
    ["/gamestrategy", "Get matchup prep from league data."],
  ]],
];

const staffSections = [
  ["Staff Setup", [
    ["/setup", "Open setup and reconnect league data."],
    ["/sync", "Refresh league data."],
    ["/resetleague", "Reset league connection state."],
    ["/disconnectleague", "Disconnect this server from its league."],
    ["/setup-reset", "Clean setup-created roles/channels."],
  ]],
  ["Staff Members", [
    ["/member onboard", "Assign a coach and send the DM."],
    ["/member assign", "Assign a coach without the DM."],
    ["/member remove", "Remove coach assignment and access."],
    ["/promo", "Post the promo and open-team list."],
  ]],
  ["Staff Ops", [
    ["/activitycheck", "Post an activity check."],
    ["/create-threads", "Create game threads."],
    ["/delete-threads", "Delete generated game threads."],
    ["/weeklyupdate", "Post the weekly league update."],
  ]],
  ["Staff Access", [
    ["/setplan", "Set server access level."],
    ["/viewplan", "View current server access."],
    ["/activateplan", "Mark server access active."],
    ["/deactivateplan", "Mark server access inactive."],
  ]],
];

function commandLines(commands) {
  return commands.map(([name, description]) => `**${name}** - ${description}`).join("\n");
}

function addSections(embed, sections) {
  for (const [name, commands] of sections) {
    embed.addFields({ name, value: commandLines(commands) });
  }
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const staffView = isStaff(interaction.member);
  const logo = getLeagueBuddyLogoEmoji();

  const embed = new EmbedBuilder()
    .setColor(staffView ? 0xffd700 : 0x1e90ff)
    .setTitle(`${logo ? `${logo} ` : ""}${coachVoiceTitle(staffView ? "staffCommands" : "coachCommands", staffView ? "Staff Commands" : "Coach Commands")}`)
    .setDescription(staffView ? "Commands staff can use to run the league." : "Commands coaches can use during the season.")
    .setFooter({ text: coachVoiceFooter(staffView ? "staffOnly" : "coachOnly", staffView ? "Staff command list" : "Coach command list") });

  addSections(embed, coachSections);
  if (staffView) addSections(embed, staffSections);

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute };
