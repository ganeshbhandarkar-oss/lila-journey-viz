# Three insights for Level Design

All numbers come from the full dataset (Feb 10–14, all maps) unless a map is named. You can reproduce each one in the tool using the view listed under it.

---

## 1. Combat is almost entirely PvE: bots decide who dies

**What I saw.** Very few human-vs-human fights happen. Nearly every human death is caused by a bot, and humans win most bot fights.

**Evidence**
- 403 of 445 human deaths (**90.6 %**) are `BotKilled`. 39 (8.8 %) are storm deaths, and only **3** are PvP (`Killed`).
- Across 796 matches there are only **3 `Kill`** events in total.
- 743 of 796 matches (**93%**) contain exactly one human and no recorded bot journey. Those humans still log `BotKill` events, so bot combat is real even when the bot's path was not written out.
- Humans log **2,232 bot kills against 403 deaths to bots**, a 5.5 : 1 kill ratio.
- In the tool: *Ambrose Valley → All matches → Death zones heatmap*.

**What a Level Designer should do**
- Treat **bot spawn placement and density as the main difficulty and pacing lever**. Encounter design is bot design.
- The death heatmap shows deaths clustered at the map centre. Spread some bot groups toward the edges and extraction routes so danger isn't concentrated at the centre.
- If PvP is meant to be part of the fantasy, add contested chokepoints or shared high-value loot between likely spawn areas, so the few multi-human matches actually produce encounters.

**Metrics affected:** human death rate (currently 57 % of journeys end in death), time-to-first-death (median 4:43 on Ambrose), PvP encounter rate, bot kill : death ratio.

---

## 2. Grand Rift's Mine Pit is a loot magnet and a death trap

**What I saw.** On the Grand Rift traffic and death heatmaps, the Mine Pit (the red central zone) is the hottest area by a wide margin.

**Evidence** (Mine Pit bounding box, about **8 % of the playable land**)
- **18 %** of all human movement samples.
- **25 %** of all loot pickups (217 / 880).
- **57 %** of all human deaths on the map (17 / 30).
- 37 human journeys entered the pit, and **17 of them (46 %) died there**.
- In the tool: *Grand Rift → Traffic heatmap*, then *Death zones*.

**What a Level Designer should do**
- Move part of the Mine Pit's loot to under-used named areas, such as Gas Station and Maintenance Bay (both cool on the traffic heatmap), so that routes spread out.
- Add cover or a second entry/exit to the pit. A 46 % death rate for visitors suggests players get pinned with no way out.
- Re-check the heatmaps after the change: success means the loot share falls toward about 15 % and deaths spread across 3 or more zones.

**Metrics affected:** loot pickups per zone, share of map visited per journey, death concentration (top-zone share of deaths), survival/extraction rate on Grand Rift.

---

## 3. The storm catches late players on Lockdown and Grand Rift far more than on Ambrose Valley

**What I saw.** Storm deaths only happen late, and players who are still alive at the 10-minute mark are about 3× more likely to die to the storm on Lockdown and Grand Rift than on Ambrose Valley.

**Evidence**
- Every one of the 39 storm deaths occurs after **10:55** of match time (range 10:55–14:47).
- Share of human journeys lasting ≥ 10 min that end in a storm death:
  **Lockdown 17 / 44 = 39 %**, **Grand Rift 5 / 14 = 36 %**, **Ambrose Valley 17 / 129 = 13 %**.
- Lockdown has as many storm deaths as Ambrose (17 each) with less than a third of the journeys (170 vs 554). On Lockdown the storm accounts for **18 %** of human deaths, compared with 5 % on Ambrose.
- In the tool: *Lockdown → All matches → Storm deaths heatmap*, then drag the timeline from 10:00 to the end.

**What a Level Designer should do**
- Check how far it is from Lockdown's late-game loot areas to the nearest extraction. Storm deaths cluster in the east-centre and north. Add or move an extraction closer to those areas, or open a faster route (Lockdown's rock walls and water lanes force detours).
- Make the storm direction and extraction locations easier to see on Lockdown and Grand Rift, for example with stronger signage and audio cues at the 10-minute mark.
- Alternatively, slow the late storm on the smaller maps so the timing matches Ambrose's.

**Metrics affected:** storm death rate, extraction success rate, late-game (> 10 min) survival, loot carried out per match.
