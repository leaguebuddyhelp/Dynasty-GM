import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import { coachCommandDescription, coachPanelIntro, coachVoiceFooter, coachVoiceTitle } from "../../shared/madden_coach_voice.js";
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
    ["/help", "Open this role-based command board."],
    ["/schedule", "Scan the weekly slate and league schedule."],
    ["/roster", "Open a roster card with contract and dev context."],
    ["/playersearch", "Pull any synced player card fast."],
    ["/streamlink", "Post your stream with a matchup hook."],
    ["/tradeblock", "Keep your trade market visible."],
  ]],
  ["Draft", [
    ["/draftclass", "Check the active class lock."],
    ["/scout", "Spend scout points on current-class prospects."],
    ["/myscouts", "Review and reorder your private board."],
    ["/bigboard", "Browse the live class board."],
    ["/draftprimer", "Get team-aware draft lanes and pressure points."],
    ["/mockdraft", "Open the live mock built from order and needs."],
    ["/recruiting", "Scan the current recruiting board."],
  ]],
  ["Prep", [
    ["/franchisehub", "Open your private franchise desk."],
    ["/gamestrategy", "Get the weekly matchup report."],
  ]],
];

const staffSections = [
  ["Staff Setup", [
    ["/setup", "Open setup or reconnect the league feed."],
    ["/sync", "Pull the latest Madden export."],
    ["/resetleague", "Reset league connection state."],
    ["/disconnectleague", "Disconnect this server from its league."],
    ["/setup-reset", "Clean setup-created roles/channels."],
  ]],
  ["Staff Members", [
    ["/member onboard", "Assign a coach and send the quick-start DM."],
    ["/member assign", "Attach a coach to a team."],
    ["/member remove", "Clear team access when coaches move on."],
    ["/promo", "Post the league promo and open-team list."],
    ["/availableteams", "List open teams with records."],
  ]],
  ["Staff Ops", [
    ["/activitycheck", "Run a league activity check."],
    ["/points", "Award Activity, Impact, or Legacy points."],
    ["/create-threads", "Build game threads for the slate."],
    ["/delete-threads", "Clean up generated game threads."],
    ["/weeklyupdate", "Post the weekly league reset."],
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
    .setDescription(coachPanelIntro(staffView ? "staffCommands" : "coachCommands", { userId: interaction.user.id, guildId: interaction.guildId }))
    .setFooter({ text: coachVoiceFooter(staffView ? "staffOnly" : "coachOnly", staffView ? "Staff command list" : "Coach command list") });

  addSections(embed, coachSections);
  if (staffView) addSections(embed, staffSections);

  await interaction.editReply({ embeds: [embed] });
}

export default { data, execute };
