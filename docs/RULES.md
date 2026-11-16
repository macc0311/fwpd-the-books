# RULES.md — FWPD Scheduling Business Rules, CBA Reference & Engineering Guardrails

**Sources Consolidated:**
- Runtime Codebase: `index.html` (12,893 lines, active branch `macc-dev` / `main`)
- Patrolmen CBA (below Sergeant): `PBA_Contract_2026.md` (archived in git `e91d318`)
- Supervisors CBA (Sergeants & Lieutenants): `FOPLC_Contract_2026.md` (archived in git `e91d318`)
- Prior Rule Summary: `CONTRACT_RULES.md` (consolidated here; archived in git `10bdf32`)

This document strictly distinguishes between:
1. **Implemented Rules** enforced today in `index.html`,
2. **Consolidated CBA Reference & Gap Analysis** combining `PBA_Contract_2026.md`, `FOPLC_Contract_2026.md`, and `CONTRACT_RULES.md` against current software behavior, and
3. **Engineering Guardrails** required for safe, token-efficient development on `macc-dev`.

---

## 1. Implemented Business & Scheduling Rules (Enforced Today in `index.html`)

### R1. Shift Count, Minimum Count & Status Classification
- **Active Shift Count (`getShiftCount()`, `L10626-10634`):** Counts every slot across `DIV_KEYS` (`NW`, `NE`, `SW`, `SE`) where `r.name && r.pe !== null`.
- **Template Defaults (`resolveScheduleTemplate()`, `L10325-10343`):**
  - Operations `A`-Shift: Minimum `32` (`A_11_15` starts at 32; `A_11_17` starts at 36)
  - Operations `B`-Shift: Minimum `40` (`B_11_16` starts at 42)
  - Operations `C`-Shift: Minimum `34` (`C_11_15` starts at 36)
  - Detective Bureau Flex/Day: Minimum `30` (`DB_FLEX` starts at 48)
  - Detective Bureau C-Shift: Minimum `2` (`DB_C` starts at 5)
- **Status Banner States (`renderAll()`, `L11855-11867`):**
  - `count === min`: **MINIMUM COUNT** (amber banner; spot leave blocked).
  - `count < min`: **BELOW MINIMUM (`count`/`min`) • + HIRE BACK ▾** (red pulsing banner; auto-triggers Hire-Back broadcast and pauses floating).
  - `count > min`: **ABOVE MINIMUM (+`count - min` OPEN)** (emerald banner; spot leave allowed).

### R2. Below-Minimum Float Pause Guard (Commit `6123c40`)
- **Rule (`recalculateFloats()`, `L10679`):** Floating executes **only when `currentCount >= app.shiftMin`**.
- **Operational Effect:** When a shift falls below minimum (`count < min`), all remaining on-duty officers stay in their normal home car assignments, and the vacated car stays marked `OPEN HB` (`vacatedDayOffEntry`) so the awarded Hire-Back officer fills that vacated role directly without displacing coworkers.
- **UI Synchronization:** `#floatQueueMiniList` (`L12675-12679`) and `#mobileAppBody` (`L12625-12626`) explicitly display that floating is paused while `count < min`.

### R3. Inverse PE# Seniority Floating & Protection Rules (`recalculateFloats()`, `L10680-10744`)
When `count >= min`, for each division (`NW`, `NE`, `SW`, `SE`) and each district in `DIV_DISTRICTS[div]` (`A–C`, `E–G`, `I–L`, `D/M–O`) where `distCounts[dist] === 0`:
1. **Target Slot Preference (`L10686-10689`):** Vacated day-off unit in that district → open non-bid car in that district → any open car in that district.
2. **Protected Cars Never Float (`L10695-10699`, `L12650-12652`):**
   - **Standing Union Bid Car (`r.bidCar === true`):** Locked against floating (marked bold/underlined with emerald bar via `.unit-bid-car`).
   - **Sole District Car (`distCounts[r.district] <= 1`):** Last remaining car covering a district cannot be floated away.
3. **Donor Selection Order (`L10704-10711`):**
   - **`citywide` scope (default):** Highest `pe` first (`b.row.pe - a.row.pe` — lowest seniority floats first).
   - **`quadrant` scope:** Same-division eligible officers (`a.div === div`) prioritized before out-of-division officers, then highest `pe` first.
4. **Deterministic Replay (`L10656-10674`):** `recalculateFloats()` resets all prior dynamic floats and recomputes from baseline on every roster change, leaving `isHireBack` and `isReturnedOffTime` placements intact.

### R4. Leave Request Gate & Minimum-Count Bypass Rules (`LEAVE_CONFIG_MAP`, `L11349-11398`)
- **Minimum-Gated Leave (`requiresAboveMin: true`):**
  - `DAY_OFF_VAC` (Vacation — Art. 43 §4)
  - `DAY_OFF_PERS` (Personal Day — Art. 44 §1)
  - `DAY_OFF_FLSA` (FLSA / Comp Time — Art. 39 §2)
  - Held/blocked by `handleOfficerStatusSelect()` (`L11649-11659`) when `currentCount <= minCount` (demo override button calls `forceApprovePendingDayOff()` at `L11664-11671`, decrementing `app.shiftMin`).
- **Minimum-Bypass Leave (`requiresAboveMin: false`):**
  - `SICK` (Sick Leave Call-In — Art. 50 & Art. 35 §3)
  - `BEREAVEMENT` (Bereavement Leave — Art. 45)
  - `UTB` (Union Time Bank — Art. 16 §1)
  - Approved even at or below minimum count; if `countAfter < shiftMin`, auto-triggers Hire-Back broadcast (`L11716-11723`).
- **Partial Duty Codes (`L11618-11644`):** `CODE_88` (`88 Off-Duty`) and `CODE_87` (`87 On-Duty`) prompt for a 4-digit time and stamp `row.assign` inline without removing the officer from `getShiftCount()`.

### R5. Unified Scheduled Off-Time & Return-to-Work Rules
- **Unified 4-Column Off-Time Sheet (`renderPaperScheduledOffTimeRows()`, `L12236-12297`):**
  - Columns: `dayOff` (`DAY OFF (ROTATION)`), `vacation` (`PREF. VACATION / VACATION / PERSONAL / NFLSA`), `sickAndLeave` (`SICK / BEREAVEMENT / LIGHT DUTY / MILITARY`), `trainingAndSpecial` (`TRAINING / ADMIN / EXCH / UNION / SPECIAL`).
  - Dynamic marked-off officers (`app.dayOffRoster`) prepend above static `app.offTimeSheet` rows inside their inferred category column (`inferOffTimeCategory()`, `L12174-12181`).
- **Return-to-Work & Reassignment:**
  - Dynamic off-time officers can be restored directly to their `homeUnit` via `restoreOfficerFromDayOff()` (`L11752-11783`), clearing any temporary `isHireBack` / `isReturnedOffTime` occupant on that `homeUnit`.
  - Static off-time officers can cancel off-time via `returnStaticOfficerToWork()` (`L11449-11489`, either regular `RTW` or `1.5x OT` Hire-Back) or move between columns via `moveStaticOffTimeOfficer()` (`L11491-11502`).
  - Temporary duty (`RTW` or `HIREBACK`) rows can be reverted via `cancelTemporaryDutyRow()` (`L11504-11536`).
- **Open Slot Placement Priority (`findTargetOpenSlotForReturnOrHireBack()`, `L11400-11446`):**
  1. Explicit `(preferredDiv, preferredUnit)` if empty;
  2. Officer's known home unit on active shift in `MASTER_OPERATIONS_DIRECTORY` if empty;
  3. Vacated day-off unit in an uncovered district (`distCounts[r.district] === 0`);
  4. Any vacated day-off unit;
  5. Any open non-header car in an uncovered district (`distCounts[r.district] === 0`);
  6. Slot whose occupant was floated out (`r.floatedTo`);
  7. First open non-bid car;
  8. First open car.

### R6. Automated Hire-Back Broadcast, Opt-In, Search & Bidding Rules (`L10952-11605`)
- **Opt-In Registry (`L10244`, `L10958-10984`):** Controlled by `app.hireBackOptInPes` (seeded with 11 `DEFAULT_HIREBACK_OPT_IN_PES`). Opting out removes any pending bid for that PE.
- **Auto-Broadcast (`ensureAutomatedHireBackBroadcast()`, `L10994-11025`):** Activates whenever `count < min`; purges bids from officers already `ON_DUTY` on the current shift; seeds 3 cross-shift demo bids (`#1997`, `#2013`, `#1689`) if empty.
- **Dual Award Rule (`getSortedHireBackBids()`, `L11027-11041`):**
  - `SENIORITY_24HR` (`≥ 24hr Notice`): Sorted by **lowest PE# ascending** (`a.pe - b.pe` — most senior bidder wins).
  - `FCFS_UNDER_24HR` (`< 24hr Notice`): Sorted by **`bidOrder` ascending** (`a.bidOrder - b.bidOrder` — first-come, first-served; supports instant claim from Mobile App `L11068-11078`).
- **Award & Placement (`awardCrossShiftHireBack()`, `L11538-11605`):** Places winner into target slot (`isHireBack = true`, `assign = "HB (<shift>)"`), recalculates floats, clears bid pool once `countAfter >= shiftMin`, sends push banner (`app.hireBackLastWinnerNotification`), and switches preview user to winner (`app.loggedInPe = pe`).
- **Searchable Officer Database UI (`L11105-11334`, commits `66f685c` & `4dcbd71`):**
  - Filter tabs strictly ordered **`A` | `B` | `C` | `All`** (`L11131-11134`).
  - Excludes `role === 'COMMAND'` and active on-duty PEs (`L11260-11261`), deduplicates by PE#, sorts ascending by PE#.
  - No Quick Award section (explicitly replaced by the searchable database).

---

## 2. PBA & FOPLC CBA Rules Reference & Gap Analysis

### 2.1 Side-by-Side Comparison Matrix (Patrolmen PBA vs. Supervisors FOPLC vs. `index.html`)

| Domain | PBA Contract (Below Sergeant) | FOPLC Contract (Sgts & Lts) | Current `index.html` Status |
| :--- | :--- | :--- | :--- |
| **Bargaining Unit & Command** | Full-time commissioned officers below Sergeant (`PBA` Art. 1 L15, Art. 4 L37-39). Patrolmen never displace/command (`PBA` Art. 8). | Sergeants & Lieutenants (`FOPLC` Art. 2–3 L16-22). Chain of Command (`FOPLC` Art. 25 L337-343): Patrolman never placed in command; senior Sgt on shift becomes COD in absence of Capt/Lt and cannot defer (`+2hr` pay or `+1hr` if `≤4hr`). | **Partial:** Command rows separated (`paperCommandBody`); COD toggle exists in user dropdown (`COD`), but supervisor minimum/COD assignment rules are not enforced. |
| **Seniority Definition** | Continuous appointment date with FWPD; tiebreak alphabetical by last name at appointment (`PBA` Art. 21 §1 L224). | Appointment date by Merit Commission to rank of Sgt/Lt; tiebreak position on Merit Promotion List (`FOPLC` Art. 9 §1 L81). | **Proxy Only:** Uses numeric `PE#` ascending as seniority proxy; no tiebreak metadata or rank-date vs hire-date distinction. |
| **Probationary Officers** | 12 mo total (6 mo supervised + 6 mo unsupervised; eligible to bid in final month of supervised probation) (`PBA` Art. 21 §2 L226-227). Bid positions open upon completion (`PBA` Art. 22 §1I L265). | N/A (3 months in-rank required for exempt/temp assignments except IA/Academy/Crime Scene/Spillman, `FOPLC` Art. 9 §4A L93, Art. 10 §4 L110). | **Partial:** Partners/probationary officers rendered inline (`r.partner`); probation bid restrictions not enforced. |
| **Work Schedule & Shifts** | Uniform: `4 on / 2 off`, `8.5 hr` (`A: 0600–1430`, `B: 1400–2230`, `C: 2200–0630`) (`PBA` Art. 34 §1 L400).<br>DB `A`: `5 on / 2 off` Mon–Fri `8.0 hr` (`0800–1600` or `0700–1500`); DB `B`: `4/2` `8.5 hr` `1500–2330`; DB `C`: `4/2` `8.5 hr` `2300–0730` (`PBA` Art. 34 §2 L402).<br>Also `4/3 10 hr` in FLSA (`PBA` Art. 39 §1 L493). | Uniform: `4 on / 2 off`, `8.5 hr` repeating 6-day rotation (`FOPLC` Art. 10 §1 L101).<br>Investigative/Admin: `5 on / 2 off`, `8.0 hr` repeating 7-day rotation (`FOPLC` Art. 10 §3 L108). | **Partial / Gap:** Shift hours displayed statically per template (`DB_FLEX` shows `0800–1630 hrs (Flex)`). Date navigation uses 4 OPS snapshots + odd/even `A`-shift fallback (`L10331-10342`), not true 6-day (`4/2`) or 7-day (`5/2`) rotation math. |
| **C-Shift → A-Shift Training Rule** | Scheduled C-shift prior to A-shift in-service training → marked off-duty last `4 hrs`; may bank-off first `4.5 hrs` Ops / `4 hrs` DB (`PBA` Art. 34 §7 L416). | Identical rule (`FOPLC` Art. 10 §5 L115). | **Not Implemented.** |
| **Districts & Standing Bid Cars** | 13 Districts (`A,B,C` NW; `E,F,G` NE; `I,J,K,L` SW; `M,N,O` SE); ≥1 standing secondary union bid car per district; attrition 2→1 in `E,F,G,J,M,N` (`PBA` Art. 22 §1A–D L247-258). | Supervisors bid by Division, Section, Shift, Rank (Operations) or Division, Shift, Rank (DB); Lts by Div, Shift, Rank (`FOPLC` Art. 9 §3 L85). | **Diverges:** App adds `D` (Downtown) under `SE` (14 districts total) and marks 13–14 OPS cars `bidCar: true`. Bid-posting/10-day rescission workflows not implemented. |
| **Minimum Staffing & Floating** | Min staffing posted May 1 & Oct 1; Day after Thanksgiving = `1/2` normal min for `5/2` & `4/3` (`PBA` Art. 37 §3 L472).<br>Floating (`PBA` Art. 37 §5 L477): Union bid cars NEVER float; **non-bid-to-shift / unbid officers float BEFORE bid-to-shift regardless of seniority** (`PBA` Art. 28 L366, Art. 37 §5 L477); inverse seniority otherwise. | Uniform min = **4 Sergeants (1 per quadrant) + 1 Lieutenant (or 5th Sgt as COD)** (`FOPLC` Art. 24 §2A–B L327-328). | **Diverges / Partial:** `bidCar`, sole-district car, inverse PE#, and below-min float pause implemented. **Missing:** unbid-to-shift floats before bid-to-shift rule; supervisor 4-Sgt + 1-Lt min enforcement; Thanksgiving ½ rule. |
| **Specialty Units & Min Count Exclusions** | **K-9 (`PBA` Art. 23 §4,6,8 L288-294):** Min 1 North + 1 South/shift; **excluded from daily & holiday shift min counts**; never force-filled.<br>**SRO (`PBA` Art. 24 §6,8 L309-313):** Excluded from daily/holiday min counts; summer patrol redeployment.<br>**Juvenile Aid (`PBA` Art. 22 §1G L263):** Counts toward DB `A`-shift min on weekends/holidays only.<br>**Hit-Skip (`PBA` Art. 25 L320-329):** ≥3 officers, `5/2` Mon–Fri 8hr.<br>**Crime Scene (`PBA` Art. 26 L330-343):** `5/2` (`A: 0800–1600`, `B: 1600–2400`, `Mid: 1800–0200`), 2-wk call-out rotation. | Training new Sgt (15 working days) does not affect division min count (`FOPLC` Art. 21 §2 L262). | **Bug / Gap:** `parseDistrict()` excludes `K9*` from districts, **but** `C_11_15` includes 3 occupied `K9` rows in `getShiftCount()` (contrary to Art. 23 §8) and exposes them as float candidates (`undefined <= 1` is `false`). |
| **Temporary Assignments** | Max **8** active dept-wide; max **90** cal days/yr (exceptions: 160 days Academy instructor, 2 officers × 160 days SRO) (`PBA` Art. 28 L363-367). Unbid moved first; inverse seniority for desk/supply/guard duty. | Max **4** supervisors at once, max **1** per Shift/Div; 90 cal days per 12-mo period (exceptions: 160 days Academy, 180 days SRO); ≥3 mo in rank (`FOPLC` Art. 10 §4 L110-113). | **Not Implemented:** No cap or day-counter tracking. |
| **Hire-Backs** | Mandatory when `< min` (`PBA` Art. 35 §§1–5 L418-436):<br>• Full shift first; then **4-hr partial shift (FCFS)** except C-shift AM training (last 4 hrs only).<br>• **No officer hired back to shift marked off from.**<br>• `≥24hr`: Posted bid; **Uniform Div/Shift priority**, then dept-wide FCFS inside 24hr.<br>• `<24hr`: Radio/in-car FCFS.<br>• Paid `1.5x`. | Mandatory for Sgts/Lts when `< min` (`FOPLC` Art. 24 §§1–5 L321-336):<br>• Partial-shift HB **only** when Lt absent `<` full shift.<br>• `≥24hr`: Seniority bid w/ Uniform Div/primary quadrant preference.<br>• `<24hr`: Radio/in-car/phone paging FCFS.<br>• Sequential callback list for extra HBs.<br>• **Stops once shift starts unless Duty Chief authorizes.**<br>• **No inverse seniority except holidays.** | **Partial:** Automated broadcast + `≥24hr` seniority vs `<24hr` FCFS implemented for Patrol. **Missing:** Uniform-shift priority tiering, mark-off self-exclusion guard, 4-hr partial-shift HB, Supervisor (`COMMAND`) Hire-Backs, shift-started Duty Chief lock, callback list order. |
| **Holidays** | 12 Holidays (`PBA` Art. 36 L437-466); MLK & Memorial on national observance; window `0600` holiday–`0630` next day; bid 45–15 days prior, HB 10 days prior, lock 5 days prior; `2.0x` + holiday back; whole day only (`§6`). | 12 Holidays (`FOPLC` Art. 13 L187-199); **all observed on actual date**; window `0500`–`0600` next day (`FOPLC` Art. 23 §1B L298); 1 Lt + 4 Sgts min; senior Sgt = COD if no Lt; `2.0x` (`2.5x` outside shift) + holiday back. | **Not Implemented:** Only static `[HOLIDAY]` string entries exist in `DB_FLEX.offTimeSheet`. |
| **Special Events & Guard Duty** | Min count may not increase by `>2` (`PBA` Art. 27 L347); 45-day bid / 15-day post; inverse dept-wide if needed (undercover & 1-time bid vac exempt); ≤50% bike-certified (`PBA` Art. 27 L359); `2.0x`; 2-hr `<24hr` cancel pay. Guard duty is periodic duty, not a Special Event (`PBA` Art. 27 L345). | Ratio **1 Sgt per ≤6 officers**; **1 Lt per 4 Sgts**; supervisors perform supervisory duties only; Vice/Narcotics & Crime Scene exempt from inverse (`FOPLC` Art. 22 L270-293). | **Display Only:** `guardDutyNote` and `specialAlert` render static yellow banners (`L378`, `L393`). |
| **Vacations** | 0–34 days/yr (`PBA` Art. 43 §1 L538-562). Jan Preferential Bid: 2 requests (`4–15` days on `5/2`, `2–16` on `4/2`), primary then secondary by seniority. Post-Jan 45–15 days seniority; `<15` days FCFS. Spot leave `1 hr` min above min count. Sell back ≤5 days by Apr 15. | 18–34 days/yr (`FOPLC` Art. 12 §1 L160-178). Jan: 2 requests `4–16` days; **June: 1 extra request `4–16` days** (`§3`). Post-Jan 45–15 days seniority. Spot leave `1 hr` min above min count (`§4`). | **Partial:** `DAY_OFF_VAC` enforces `requiresAboveMin`; static `[PREF. VACATION]` & `[VACATION]` shown. **Missing:** Jan/June bid windows, 1-hr spot increments, accrual/quota deduction. |
| **Personal Days** | **10 days/yr**, `1 hr` increments, subject to min count (`PBA` Art. 44 §1 L573). | **12 days/yr**, `1 hr` increments, subject to min count (`FOPLC` Art. 18 L238). | **Partial:** `DAY_OFF_PERS` enforces `requiresAboveMin`; no quota/hourly balance tracking. |
| **Bereavement / Death in Family** | 8 / 5 / 3 days excl. days off + up to 5 extended days (vac/pers) exempt from min + up to 4 days/rotation completion exempt from min (`PBA` Art. 45 L575-583). | 8 / 5 / 3 days excl. days off + up to 5 extended days from any bank exempt from min (`FOPLC` Art. 17 L227-235). | **Implemented (Gate):** `BEREAVEMENT` bypasses min count (`requiresAboveMin: false`); no relationship tier or day-limit counter. |
| **Union Time Bank (UTB)** | **2,000 hrs/yr** (+500 carryover, **2,500** max). Pres/VP/Treas/Sec bypass min anytime; Board members bypass min with `≥15 days` notice (else subject to min); Pres 50/50 flex (`PBA` Art. 16 L175-190). | **800 hrs/yr** city + ≤300 member-donated (**2,000** max); **all usage subject to maintaining minimum manpower** (`FOPLC` Art. 7 §2 L45-46). | **Diverges:** `UTB` sets `requiresAboveMin: false` globally for all officers without checking rank/union role, 15-day notice, or UTB balance. |
| **Sick, Parental, Military, FMLA** | Sick: ≥270 days, 1-yr exhaustion (`PBA` Art. 50 L615-618). Parental: 15 days (`PBA` Art. 46 §2 L588). Military: 15 days/120 hrs; **`>15` consecutive days do NOT count against shift count** (`PBA` Art. 47 §5 L600, Art. 37 §4 L474). | Sick: 270-day disability trigger, 1-yr exhaustion; **sick/light-duty supervisors void holiday/HB/SE bids unless released 15 days prior** (`FOPLC` Art. 26 L346-348). Military: 15 days/120 hrs (`FOPLC` Art. 16 L216). | **Partial:** `SICK` bypasses min; static `[SICK LEAVE]`, `[LIGHT DUTY - HOD]`, `[MILITARY]` entries render in `sickAndLeave`. No 270-day, 15-day release, or military exclusion tracking. |
| **Exchange of Work Time** | Max 160 hrs (`5/2`) / 170 hrs (`4/2`) = 20 days/yr; dates within **30 days**; submit ≥24hr to COD (2 emergency `<24hr` exceptions/yr) (`PBA` Art. 38 L479-489). | Identical limits & 30-day rule (`FOPLC` Art. 19 L240-247; Non-FLSA exchange carryover `FOPLC` Art. 20 §2 L252). | **Static Text Only:** `[WORKING EXCH]` appears in `trainingAndSpecial`; no exchange workflow. |
| **Overtime, FLSA & Non-FLSA** | 7-day work period starting Sun A-Shift: `>42.5 hrs` (`4/2 8.5hr`) or `>40 hrs` (`4/3 10hr`, `5/2 8hr`) at `1.5x` (`PBA` Art. 39 §1 L491-494). 400-hr Non-FLSA carryover cap paid down by **Feb 28** (`PBA` Art. 48 L608); 160-hr transfer cap (`PBA` Art. 49 L611). `1 hr` FLSA/Non-FLSA spot usage above min (`PBA` Art. 39 §2 L497). | `1.5x` FLSA OT (`FOPLC` Art. 28 §1 L357); 400-hr Non-FLSA paydown submitted Jan 15 / paid **Jan 31** (`§2` L359); 160-hr transfer cap (`FOPLC` Art. 20 §1 L250); Call-out `+2hr`/`+1hr` (`FOPLC` Art. 23 §2 L300); Court `2.0x` min 1 hr (`FOPLC` Art. 21 §1 L257). | **Not Implemented:** `DAY_OFF_FLSA` gates on `count > min`; no hour bank balances or payroll calculations exist. |

---

### 2.2 Consolidated CBA Detailed Reference *(Absorbed from `PBA_Contract_2026.md`, `FOPLC_Contract_2026.md` & `CONTRACT_RULES.md`)*

#### 2.2.1 Shift Schedules, Flexing, Command (COD) & Exchanges
- **PBA Schedules & Units:**
  - **Uniform Operations (`4/2`, `8.5 hr`):** A `0600–1430`, B `1400–2230`, C `2200–0630` (`Art. 34 §1`).
  - **Investigative / DB (`Art. 34 §§2–3`, `Art. 22 §1G`):** A (`5/2` Mon–Fri `8.0 hr`, `0800–1600` or `0700–1500`; Sat/Sun duty grants 1 day off week prior + 1 day off week following at employee discretion subject to min count; Juvenile Aid counts toward DB A-shift min on weekends/holidays only), B (`4/2` `8.5 hr` `1500–2330`), C (`4/2` `8.5 hr` `2300–0730`).
  - **Specialty Schedules:** **SRO** (`Art. 24 §§4,7–10`): A-shift `5/2` Mon–Fri `0700–1500`; redeployed to Ops Uniform Patrol district car within 7 days after school ends (except ≤2 for FWCS summer needs), returning earlier of Transition Day or 7 days pre-school. **Hit-Skip** (`Art. 25 §§2–3`): ≥3 officers, `5/2` Mon–Fri `8.0 hr`. **Crime Scene** (`Art. 26 §§3,6`): `5/2` (`A 0800–1600`, `B 1600–2400`, `Mid 1800–0200`); 2-wk call-out rotation (`2` techs + trainees + `1` supervisor). **K-9** (`Art. 23 §§4–6`): Ops A/B/C or Vice/Narcotics exempt; `+4 hr` regular pay per 7-day cycle for K-9 maintenance/care.
  - **Exempt & Flexing (`Art. 29`, `Art. 34 §§4–6`):** Max `74` exempt PBA roles (none in IA). Employee-initiated shift flex max `±2 hrs` (>2 hrs voluntary w/ approval), requires Supervisor/Cmdr/DC/Chief plan approval; no make-work, school/childcare/sports/fitness-only flexing, or min-count impact.
  - **C-Shift → A-Shift Training (`Art. 34 §7` & `FOPLC Art. 10 §5`):** Marked off last `4 hrs` of prior C-shift; may mark off first half (`4.5 hr` Ops / `4.0 hr` DB) from banked time.
  - **Vehicle Repair (`PBA Art. 39 §3`, `FOPLC Art. 21 §3`):** C-shift/directed off-duty vehicle maintenance when shop closed compensated under OT articles.
- **FOPLC Schedules, COD & Training Pay:**
  - **Rotations (`Art. 10 §§1–3`):** Uniform repeating `6-day` (`4/2`, `8.5 hr`); Investigative/Admin repeating `7-day` (`5/2`, `8.0 hr`). Emergency hour changes only when unforeseen manpower above min cannot be otherwise met.
  - **Det. Sgt Weekend On-Call (`Art. 21 §4`):** `+2 hr` base pay per weekend on-call day when no Det. Sgt is on duty.
  - **Commander of the Day (`Art. 25`):** When Capt/Lt absent, **senior Sgt** becomes COD and **cannot defer**; paid `+2 hr/day` (`+1 hr` if `≤4 hrs`, or `1 hr` each if two Sgts share COD).
  - **Supervisory Training Pay (`Art. 21 §2`):** `+2.5 hr OT/day` when training a new Sgt (`≥15` working days; trainee doesn't affect div min) or Lt (`≥8` working days).
- **Exchange of Work Time (`PBA Art. 38 §§1–4`, `Art. 16 §6`, `Art. 47 §3`; `FOPLC Art. 19 §§1–3`, `Art. 20 §2`, `Art. 16 §3`):**
  - Like-for-like only (Uniform↔Uniform, DB↔DB), max **`160 hrs`** (`5/2`) or **`170 hrs`** (`4/2`) = 20 days/yr (holidays excluded).
  - Dates must be within **`30 days`**; submit ≥`24 hrs` prior to COD (`PBA`: `2` emergency `<24hr` exceptions/yr). Military drill days may be exchanged against RDOs in the prior/following rotation.
  - **FOPLC >400-hr Non-FLSA Exchange Cap (`Art. 20 §2`):** Non-FLSA hours earned at the 400-hr cap via exchange are logged as "exchanged time" and forfeited if unused before the final paycheck of the year received (or next year if donated after final check).

#### 2.2.2 Seniority, Bidding, Probation & Temporary Assignments
- **PBA Seniority & Attrition (`Art. 21 §§1–3`, `Art. 9 §§1–3`):** Continuous FWPD appointment date; tiebreak alphabetical by last name at appointment. Broken only by quit (>6 mo), 12-mo layoff, or discharge. Layoffs inverse seniority w/ ≥4 wks union notice; recalls direct seniority.
- **PBA Probation & Job Bidding (`Art. 21 §2`, `Art. 22 §§1–3`):** 12 mo (`6 mo` supervised + `6 mo` unsupervised; bid-eligible in month 6). Two-phase award: **Primary** (Div/Shift/Bureau) + **Secondary** (section or standing district bid car `A–C, E–G, I–L, M–O` + new annexed districts). Specialized units (K-9, SRO, CS, Hit-Skip) bid unit-first. Crime Suppression & Crimes Against Persons exempt (excl. Dec 31, 2004 grandfathered; open Crime Suppression spots offered to Property Crimes detectives first, else bid to A-shift DB). Intranet posting `7 cal days`; max `3` simultaneous bids / **`3 awarded bids/yr`**; suspended `>30 days` barred. Trial rescission **`10 cal days`** (`15 cal days` post-training + `15-day` extension). Displaced officers bump junior in div/section (else B-shift Uniform) with 6-mo re-establishment return rights; K-9 & SRO never inverse force-filled.
- **FOPLC Seniority & Bidding (`Art. 9 §§1,3,4`):** Most recent Merit Commission Sgt/Lt appointment date; tiebreak Merit Promotion List rank. Post vacancies within `15 cal days` (Ops Sgt: Div/Sec/Shift/Rank; DB: Div/Shift/Rank after optional same-div lateral by seniority; Lt: Div/Shift/Rank); start ≤`21 days`; **`10 cal days`** rescission (delayed to first return workday if on FMLA); displaced/demoted/disciplined Sgts temp-assigned by Asst Chief to Uniform A/B/C until bid (cannot inverse disciplined Sgt back to same job). **Exempt supervisors:** max `25% + 1`, `≥3 mo` in rank (excl. IA/Academy/CS/Spillman), 5-day notice, `7-day` rescission. On-call extra-duty ties resolved by seniority (excl. PIO).
- **Temporary & Intra-Shift Assignments:**
  - **PBA (`Art. 28`):** Max **`8`** dept-wide, **`90 cal days/yr`** (`160 days` for 1 Academy instructor & up to 2 SROs). Intra-shift motor/guard/desk/supply/bike/foot assignments use **inverse seniority**, moving **unbid officers first**.
  - **FOPLC (`Art. 10 §4`):** Max **`4`** supervisors dept-wide, max **`1`** per Shift/Div, **`90 cal days / 12 mo`** (`160` Academy / `180` SRO), `≥3 mo` in rank (excl. IA/Academy/CS/Spillman).

#### 2.2.3 Minimum Staffing, Exclusions, Floating, Hire-Backs & Special Events
- **Minimum Counts & Exclusions:**
  - **PBA (`Art. 37`, `Art. 23 §8`, `Art. 24 §6`, `Art. 16 §§1,4`, `Art. 45`, `Art. 47 §5`):** Posted **May 1** & **Oct 1**; Day after Thanksgiving = **`1/2`** min for `5/2` & `4/3`; Special Events max `+2` min increase. Excluded from daily/holiday min counts: **K-9**, **SRO** (*unless* working a holiday exchange for an inversed officer, when they count toward min & patrol a district), and **Military Leave `>15` consecutive days**. **UTB** (`2,000 hr/yr` + `500` carryover = `2,500` max): Pres works `50/50` flex; Pres/VP/Treas/Sec bypass min anytime; Board members bypass w/ `≥15 days` notice; all others subject to min. **Extended Bereavement**: up to `5` vac/pers days + up to `4` completion days exempt from min.
  - **FOPLC (`Art. 24 §2`, `Art. 21 §2`, `Art. 17D`, `Art. 7 §2`):** **4 Uniform Sgts (1/quadrant) + 1 Lt (`5` total)**. If `0` Lt works: initiate Lt HB; if unfilled and `≥5` Sgts work, senior Sgt becomes COD; if only `4` Sgts work, initiate Sgt HB for COD while senior working Sgt acts as COD. Newly promoted Sgt `15-day` training doesn't affect min. Bereavement extended `5` days exempt from min; all FOPLC UTB (`800 hr` city + `≤300` member-donated = `2,000` max) is subject to min.
- **District Floating Priority (`PBA Art. 37 §5`):** 1) Officers **not bid to the shift** float first (regardless of seniority) → 2) Officers **bid to the shift** by inverse seniority → 3) Standing **Union bid cars NEVER float**.
- **Hire-Backs (`1.5x`):**
  - **PBA (`Art. 35`):** Self-mark-off excluded (cannot HB to shift marked off). **Uniform:** `≥24hr` seniority w/ Uniform Div/Shift priority → `<24hr` radio/in-car FCFS dept-wide (incl. Detectives & Gang/Narcotics). **DB:** `≥24hr` DB seniority → `<24hr` DB FCFS. **Partial (`4 hr` min FCFS):** first 4, last 4, or both if full-shift unfilled; C-shift AM-training skips full-shift and offers last 4 hrs only.
  - **FOPLC (`Art. 24`, `Art. 26`):** `≥24hr` seniority w/ Uniform Div & primary quadrant pref → `<24hr` radio/in-car/phone FCFS; subsequent HBs call denied supervisors sequentially (1 call to FLSA phone before re-posting). Partial HB **only** when Lt absent `< full shift`. **Stops once shift starts unless Duty Chief authorizes.** No inverse seniority for regular HB. Sick/light-duty bid void unless released by award date (`15 days` prior).
- **Special Events (`2.0x`):**
  - Formula `(base + shift diff + longevity + specialty) / 2080`; `<24hr` cancel = **`2 hr`** pay; post-report cancel = COD reassigns or pay balance; holiday SE `≥4 hrs` adds holiday back (unless exchanged for PBA).
  - **PBA (`Art. 27`):** Notice Mar 1 (or 15d post-reschedule), bid `45d`, post `15d`; `<50%` bike-certified; EST/PSRT first for VIP visits; inverse exempts undercover, full-shift workers, 1-time Preferential Bid vac, and same-day inversed holiday officers.
  - **FOPLC (`Art. 22`):** Ratios **`1 Sgt : ≤6 officers`** & **`1 Lt : 4 Sgts`**; supervisory duties only; Vice/Narcotics & Crime Scene exempt from SE inverse; cross-union exchange w/ inversed PBA allowed.

#### 2.2.4 Call-Out, On-Call Banks, IA & Court Pay
- **Call-Out (`≤48hr` notice, `PBA Art. 40 §§1–2`, `FOPLC Art. 23 §§1–3`):** `+2 hr` bonus if begins AND ends outside regular shift; `+1 hr` if either begins OR ends outside shift (`PBA`: `≥1 hr` separation between call-outs, else `1 hr` min). Holiday call-out `2.0x` + holiday back (`PBA ≥4 hrs`; `FOPLC >4 hrs`, `0500–0600` window then `1.5x` past `0600` outside shift).
- **On-Call Teams (`PBA Art. 40 §§3–4`, `FOPLC Art. 23 §4`):** Weekly bonuses: Homicide/ASU (`PBA 8/8.5 hr` split `4/4` or `4.25/4.25`; `FOPLC` Homicide/CS/Fatal Crash Supervisors `1 day/primary wk`, ASU `0.5/primary + 0.5/backup`, Fatal Crash member `0.5/primary`), CS (`PBA 4+4 hr` over 2 wks), Fatal Crash (`PBA 4/4.25 hr`). Annual banks (`8/8.5 hr` day): `EST 4d`, `CRT 4d`, `EOD 2d`, `PIO 2d`, `PSRT 1d/callout >4h` (`FOPLC` adds `ASU 4d`, `EOD K9 2d`, `Shooting/UOF 2d`). Requires `≥60%` annual call-out attendance; forfeited if unused before next year Non-FLSA paydown.
- **Off-Duty IA / OPS & Court:** IA interviews (`PBA Art. 7 §6`, `FOPLC Art. 11 §5D`) add **`+1 hr` travel time** (`FOPLC` `1.5x`). Court (`PBA Art. 41`, `FOPLC Art. 21 §1A`): **`2.0x`**, **`1-hr min`** per appearance (not subpoena) rounded to ¼ hr; `PBA` outside Allen County adds **`1.5x`** travel time.

#### 2.2.5 Vacation Schedules, Personal, FLSA / Non-FLSA & Holidays
- **Annual Vacation Entitlements (1 day = full shift):**
  - **PBA (`Art. 43 §§1–2`, `Art. 21 §6`):** `0–6 mo`: `0` (laterals `7` at hire + `5` at 6 mo); `6mo–1yr`: `7`; `1–3 yr`: `12`; `4–5 yr`: `18`; `6..15 yr`: `19..28` (+1/yr); `16..20+ yr`: `29, 30, 31, 32, 34`.
  - **FOPLC (`Art. 12 §§1–2`):** `3–5 yr`: `18`; `6..15 yr`: `19..28` (+1/yr); `16 yr`: `29`; `17 yr`: `31`; `18 yr`: `32`; `19 yr`: `33`; `20+ yr`: `34`.
- **Vacation Bid Windows:** Jan Preferential Bids (`PBA`: `2` bids `4–15d` `5/2` or `2–16d` `4/2`, primary then secondary by seniority, **14-day fallback bid if both denied**; `FOPLC`: Jan `2` bids `4–16d` + **June `1` bid `4–16d`**). Rolling seniority `45–15 days`; `PBA <15 days` FCFS (2+ day blocks granted whole); `1-hr` spot increments above min; `PBA` sell back `≤5 days` by Apr 15.
- **Personal & Bereavement:** `10` (`PBA`) / `12` (`FOPLC`) personal days/yr in `1-hr` increments above min. Bereavement `8 / 5 / 3` days excl. RDOs + extended days exempt from min.
- **FLSA / Non-FLSA:** PBA 7-day Sun A-shift work periods: `1.5x` after `42.5 hrs` (`4/2`) or `40 hrs` (`4/3` & `5/2`); base includes worked, FLSA/Non-FLSA used, PBA leave (excl. seminars), holidays (excludes vac/sick/bereavement/personal). **400-hr Non-FLSA paydown:** PBA paid by **Feb 28** (`Art. 48`); FOP submitted **Jan 15** / paid **Jan 31** (`Art. 28 §2`). Transfer/donation cap **`160 hrs/yr`**.
- **Holidays (12):** New Year's Day, MLK, Easter, Memorial Day, Juneteenth, Independence Day, Labor Day, Veterans Day, Thanksgiving, Christmas Eve, Christmas Day, New Year's Eve. `2.0x` + holiday back (`FOPLC 2.5x` per `0.5 hr` outside regular shift). **PBA (`Art. 36`)**: MLK & Memorial on national observance; window `0600–0630` next day; `45–15d` shift seniority, `15–10d` patrol HB, `10–5d` inverse + exchange, lock `5d` prior. **FOPLC (`Art. 13`, `Art. 24 §2C`)**: ALL observed on actual date; `0500–0600` call-out window; `45–15d` cascade (`on-shift Uniform → any-shift Uniform → inverse Sgt → senior Sgt COD`), post `≥15d`; post-award absence exhausts denied on-shift Sgts/Lts first.

---

## 3. Codebase & Workflow Engineering Guardrails

### 3.1 Git, Branch & Token-Efficiency Hygiene
- **Never develop directly on `main`:** All code edits, fixes, and feature commits MUST be made on **`macc-dev`** (or a dedicated feature branch). `main` serves the live GitHub Pages deployment and receives changes only via clean merges from verified branches.
- **Token-Lean Documentation Policy:** Keep `docs/ARCHITECTURE.md` and `docs/RULES.md` concise and authoritative so agents can onboard with minimal tokens. Raw CBA files (`PBA_Contract_2026.*`, `FOPLC_Contract_2026.*`) and `CONTRACT_RULES.md` are consolidated here and remain archived in git history (`e91d318` / `10bdf32`) — do not re-duplicate them into the active working tree unless revising for a newly ratified CBA.

### 3.2 Single-File Architecture & Verification Invariants
- **No Unplanned File Splitting:** Unless an explicit modularization/build-pipeline plan is approved, keep `index.html` as a self-contained single file so GitHub Pages and preview iframes work with zero build tooling.
- **Mandatory JS Syntax Check Before Commit:** Extract `<script>` from `index.html` and run `node --check` (ensuring zero syntax errors across the 12k-line file) before staging or committing.
- **Preserve Standalone Export Coupling:** Any changes to `<head>` `<style>`, `#publishHelperBtn`, `#publishHelperModal`, `#transactionToast`, or `#floatingActionMenu` must stay compatible with `buildStandaloneReleaseHtml()` (`L12764-12779`) — specifically keeping `--bg-app` inside the primary `<style>` block so preview styles are distinguished accurately.

### 3.3 Safe Logic & UI Mutation Rules
1. **Always Call `recalculateFloats()` + `renderAll()` (or `renderAll()` via `recalculateFloats()`):** Never mutate `app.officers` or `app.dayOffRoster` for duty/leave changes without running `recalculateFloats()` so `floatedFrom`, `floatedTo`, `floatedMoves`, and `savedHistory` remain consistent.
2. **Preserve Below-Minimum Float Pause (`L10679`):** Never allow `recalculateFloats()` to float on-duty officers when `getShiftCount() < app.shiftMin`.
3. **Preserve Dual-Mode Hire-Back & Filter Tab Order:** Keep `SENIORITY_24HR` (lowest PE# wins) vs `FCFS_UNDER_24HR` (`bidOrder` wins) semantics, exclude `COMMAND` and active on-duty officers from the Hire-Back search list, and preserve the exact tab order **`A` | `B` | `C` | `All`** (`L11131-11134`) without re-adding a Quick Award block.
4. **Keep Worksheet & Mobile App Synchronized:** Both `#paperOfficersBody` / `#paperScheduledOffTimeBody` and `#mobileAppBody` read from `app` and mutate through shared handlers (`handleOfficerStatusSelect`, `returnStaticOfficerToWork`, `restoreOfficerFromDayOff`, `submitOfficerHireBackBid`, `autoAwardWinningHireBackBid`, `cancelTemporaryDutyRow`). Note: fix `switchUserRole(...)` → `handleUserSwitch(...)` (`L12331-12337`) when touching mobile quick-switchers.
5. **Prevent K-9 / Specialty Minimum-Count Distortion:** When implementing future CBA compliance fixes, exclude `K9*` (PBA Art. 23 §8) and `SRO` (PBA Art. 24 §6) rows from `getShiftCount()` and float eligibility checks (`recalculateFloats()` and `renderBottomPanels()`).
