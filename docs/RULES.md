# RULES.md — FWPD Scheduling Business Rules, CBA Reference & Engineering Guardrails

**Sources Analyzed:**
- Runtime Codebase: `index.html` (12,893 lines, active branch `macc-dev`)
- Patrolmen CBA: `PBA_Contract_2026.md` (840 lines — full-time commissioned officers below rank of Sergeant)
- Supervisors CBA: `FOPLC_Contract_2026.md` (466 lines — Sergeants and Lieutenants)

This document strictly distinguishes between:
1. **Implemented Rules** enforced today in `index.html`,
2. **Contractual Rules & Gap Analysis** comparing `PBA_Contract_2026.md` and `FOPLC_Contract_2026.md` against current software behavior, and
3. **Engineering Guardrails** required for safe development on `macc-dev`.

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
| **Overtime, FLSA & Non-FLSA** | 7-day work period starting Sun A-Shift: `>42.5 hrs` (`4/2 8.5hr`) or `>40 hrs` (`4/3 10hr`, `5/2 8hr`) at `1.5x` (`PBA` Art. 39 §1 L491-494). 400-hr Non-FLSA carryover cap (`PBA` Art. 48 L608); 160-hr transfer cap (`PBA` Art. 49 L611). `1 hr` FLSA/Non-FLSA spot usage above min (`PBA` Art. 39 §2 L497). | `1.5x` FLSA OT (`FOPLC` Art. 28 §1 L357); 400-hr Non-FLSA paydown Jan 31 (`§2` L359); 160-hr transfer cap (`FOPLC` Art. 20 §1 L250); Call-out `+2hr`/`+1hr` (`FOPLC` Art. 23 §2 L300); Court `2.0x` min 1 hr (`FOPLC` Art. 21 §1 L257). | **Not Implemented:** `DAY_OFF_FLSA` gates on `count > min`; no hour bank balances or payroll calculations exist. |

---

## 3. Codebase & Workflow Engineering Guardrails

### 3.1 Git & Branch Hygiene
- **Never develop directly on `main`:** All code edits, fixes, and feature commits MUST be made on **`macc-dev`**. `main` serves the live GitHub Pages deployment and receives changes only via reviewed merges from `macc-dev`.
- **Keep contract source files immutable:** Never alter `PBA_Contract_2026.md`, `PBA_Contract_2026.docx`, `FOPLC_Contract_2026.md`, or `2026 FOPLC Final Contract.pdf` unless updating to a newly ratified CBA.

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
