/**
 * FWPD "The Books" — Zero-Touch Hire-Back & Overtime Bidding Engine
 * Implements:
 *   - PBA 2026 Contract Article 35 (Patrol & Detective Bureau Hire-Backs, >=24h Seniority w/ Uniform Priority,
 *     <24h First-Come First-Served Dept-Wide incl. DB/Exempt, Partial 4h Blocks, C-Shift Training Last-4h Rule,
 *     Self-Mark-Off Exclusion)
 *   - FOPLC 2026 Contract Articles 24, 25 & 26 (Supervisor Minimums: 4 Quadrant Sergeants + 1 LT/COD,
 *     Auto-Elevation of Senior Sergeant to Acting COD when 5+ Sgts & 0 LTs, Supervisor Hire-Backs,
 *     Seniority Standby List for Unawarded Bidders, Partial LT Hire-Backs, Duty Chief Gate Once Shift Starts,
 *     Sick/Light Duty Exclusion)
 */
(function () {
  'use strict';

  // ===========================================================================
  // 1. CANDIDATE POOLS (PATROL, DETECTIVE, EXEMPT, SUPERVISORS)
  // ===========================================================================
  const EXTENDED_CANDIDATE_POOL = [
    // Uniform Division Off-Duty Patrol Officers (Other Shifts / Days Off)
    { name: 'PATINO, R', pe: 1742, role: 'OFFICER', bureau: 'OPS', div: 'NE', shift: 'B', badgeLabel: 'Uniform (B-Shift)' },
    { name: 'STEWART, L', pe: 1812, role: 'OFFICER', bureau: 'OPS', div: 'NW', shift: 'C', badgeLabel: 'Uniform (C-Shift)' },
    { name: 'SANDERS, G', pe: 1860, role: 'OFFICER', bureau: 'OPS', div: 'SW', shift: 'B', badgeLabel: 'Uniform (B-Shift)' },
    { name: 'McGILL, M', pe: 1977, role: 'OFFICER', bureau: 'OPS', div: 'SE', shift: 'C', badgeLabel: 'Uniform (C-Shift)' },
    { name: 'LAMBIASE, B', pe: 2013, role: 'OFFICER', bureau: 'OPS', div: 'NW', shift: 'B', badgeLabel: 'Uniform (B-Shift)' },
    // Detective Bureau & Exempt Officers (Eligible on OPS <24h FCFS or OPS >=24h Secondary Tier, and DB shifts)
    { name: 'DET. VANCE, K', pe: 1688, role: 'DETECTIVE', bureau: 'DB', div: 'NW', shift: 'DB', badgeLabel: 'Detective Bureau' },
    { name: 'DET. GARZA, M', pe: 1735, role: 'DETECTIVE', bureau: 'DB', div: 'SE', shift: 'DB', badgeLabel: 'Detective Bureau' },
    { name: 'OFF. REYES, D (VICE/NARC)', pe: 1710, role: 'EXEMPT', bureau: 'EXEMPT', div: 'NE', shift: 'FLEX', badgeLabel: 'Exempt / Narcotics' },
    // Off-Duty Supervisors (FOPLC Lieutenants & Sergeants)
    { name: 'LT. KRAMER, D', pe: 1518, role: 'LT', bureau: 'OPS', div: 'NE', shift: 'B', badgeLabel: 'Lieutenant (FOPLC)' },
    { name: 'SGT. HENDERSON, P', pe: 1612, role: 'SGT', bureau: 'OPS', div: 'NW', shift: 'B', badgeLabel: 'Sergeant (NW Primary)' },
    { name: 'SGT. VARGAS, R', pe: 1679, role: 'SGT', bureau: 'OPS', div: 'SW', shift: 'C', badgeLabel: 'Sergeant (SW Primary)' },
    { name: 'SGT. NOLAN, T', pe: 1749, role: 'SGT', bureau: 'OPS', div: 'SE', shift: 'B', badgeLabel: 'Sergeant (SE Primary)' },
    { name: 'SGT. DET. CHEN, W', pe: 1645, role: 'SGT', bureau: 'DB', div: 'NE', shift: 'DB', badgeLabel: 'Det. Sergeant (DB)' }
  ];

  // Live Zero-Touch Countdown Durations (12s for >=24h Seniority Bid Collection; 4s for <24h Instant FCFS)
  const BID_WINDOW_SECONDS = 12;
  const FCFS_AUTO_FILL_SECONDS = 4;

  // ===========================================================================
  // 2. ENGINE STATE (Attached to global `app.hbEngine` for persistence)
  // ===========================================================================
  function ensureEngineState() {
    if (typeof app === 'undefined' || !app) return null;
    window.app = app; // Expose lexical `let app` onto window for easy debugging
    if (!app.hbEngine) {
      app.hbEngine = {
        // Notice mode: 'ADVANCE_24PLUS' (>=24h), 'SHORT_UNDER24' (<24h), 'SHIFT_STARTED' (In-Shift)
        noticeMode: 'ADVANCE_24PLUS',
        dutyChiefAuthorized: false,
        autoSimulateBids: true,
        timerPaused: false,
        nextBidId: 101,
        openPostings: [],          // Active hire-back postings collecting bids or awaiting FCFS
        closedNotifications: [],   // Sent award/standby notifications to all bidders
        supervisorStandbyList: [], // FOPLC Art. 24 §4B Seniority Standby list for current shift
        commandOffRoster: [],      // Marked-off Lieutenants & Sergeants on current shift
        actingCodInfo: null        // { name, pe, unit, div } when Senior Sgt is elevated per FOPLC Art. 24 §2A & Art. 25
      };
    }
    if (!Array.isArray(app.hbEngine.openPostings)) app.hbEngine.openPostings = [];
    if (!Array.isArray(app.hbEngine.closedNotifications)) app.hbEngine.closedNotifications = [];
    if (!Array.isArray(app.hbEngine.supervisorStandbyList)) app.hbEngine.supervisorStandbyList = [];
    if (!Array.isArray(app.hbEngine.commandOffRoster)) app.hbEngine.commandOffRoster = [];
    return app.hbEngine;
  }

  let tickIntervalId = null;

  // ===========================================================================
  // 3. TIME-OF-HIREBACK & NOTICE WINDOW HELPERS
  // ===========================================================================
  function getShiftStartHour(shiftCode, bureauCode) {
    if (bureauCode === 'DB' && shiftCode !== 'C') return '08:00';
    if (shiftCode === 'A') return '06:00';
    if (shiftCode === 'B') return '14:00';
    return '22:00';
  }

  function getNoticeModeDetails() {
    const eng = ensureEngineState();
    const mode = eng ? eng.noticeMode : 'ADVANCE_24PLUS';
    const shiftStart = getShiftStartHour(app.selectedShift, app.selectedBureau);

    if (mode === 'ADVANCE_24PLUS') {
      return {
        mode,
        shortLabel: '≥ 24h Notice (Seniority Bid)',
        simClockNote: `36h prior to ${app.selectedDate} ${shiftStart}`,
        contractCite: app.selectedBureau === 'DB' ? 'PBA Art. 35 §4 (DB Seniority)' : 'PBA Art. 35 §4 & FOPLC Art. 24 §4B',
        ruleSummary: app.selectedBureau === 'DB'
          ? 'Outside 24h: Collects Detective Bureau bids → Auto-awards to lowest PE# when timer hits 0s & notifies all bidders.'
          : 'Outside 24h: Collects bids → Auto-awards by Seniority (Uniform Division priority, lowest PE#) when timer hits 0s & notifies all bidders.'
      };
    }
    if (mode === 'SHORT_UNDER24') {
      return {
        mode,
        shortLabel: '< 24h Short Notice (Instant FCFS)',
        simClockNote: `5h prior to ${app.selectedDate} ${shiftStart}`,
        contractCite: 'PBA Art. 35 §4 & FOPLC Art. 24 §4C',
        ruleSummary: app.selectedBureau === 'DB'
          ? 'Inside 24h: Urgent DB notification → Auto-populates First-Come, First-Served (FCFS) within Detective Bureau.'
          : 'Inside 24h: Radio + MDC + App Broadcast → Auto-populates First-Come, First-Served (FCFS) Dept-Wide (includes Detectives & Exempt/Gang/Narcotics).'
      };
    }
    return {
      mode: 'SHIFT_STARTED',
      shortLabel: 'Shift Started (Duty Chief Gate)',
      simClockNote: `In-Shift (${app.selectedDate} ${shiftStart} active)`,
      contractCite: 'FOPLC Art. 24 §4D',
      ruleSummary: eng && eng.dutyChiefAuthorized
        ? 'Duty Chief Override ACTIVE → Short-notice FCFS Hire-Backs authorized during active shift.'
        : 'Per FOPLC Art. 24 §4D, hire-back procedure does not go into effect once shift has started unless authorized by the Duty Chief.'
    };
  }

  // ===========================================================================
  // 4. ELIGIBILITY & CONTRACT SORTING (PBA ART. 35 & FOPLC ART. 24 / 26)
  // ===========================================================================
  function didMemberMarkOffCurrentShift(pe) {
    if (!pe || pe === 'COD') return false;
    for (const div of DIV_KEYS) {
      if ((app.dayOffRoster[div] || []).some(o => o.pe === pe)) {
        return true;
      }
    }
    const eng = ensureEngineState();
    if (eng && (eng.commandOffRoster || []).some(c => c.pe === pe)) {
      return true;
    }
    return false;
  }

  function isMemberAlreadyWorkingCurrentShift(pe) {
    if (!pe || pe === 'COD') return false;
    for (const div of DIV_KEYS) {
      if ((app.officers[div] || []).some(r => r.name && r.pe === pe)) return true;
      if ((app.command[div] || []).some(c => c.name && c.pe === pe)) return true;
    }
    return false;
  }

  function isMemberOnSickOrLightDuty(pe) {
    for (const div of DIV_KEYS) {
      const off = (app.dayOffRoster[div] || []).find(o => o.pe === pe);
      if (off && /SICK|LIGHT/i.test(off.status || '')) return true;
    }
    const eng = ensureEngineState();
    if (eng) {
      const cmdOff = (eng.commandOffRoster || []).find(c => c.pe === pe);
      if (cmdOff && /SICK|LIGHT/i.test(cmdOff.status || '')) return true;
    }
    return false;
  }

  function evaluateBidderEligibility(candidate, posting) {
    if (!candidate || !candidate.pe) {
      return { eligible: false, reason: 'Invalid officer PE#' };
    }
    // Rule 1: PBA Art. 35 §4 — "No Employee shall be hired back to a shift from which he/she marked off."
    if (didMemberMarkOffCurrentShift(candidate.pe)) {
      return {
        eligible: false,
        reason: 'Blocked (PBA Art. 35 §4): Marked off this shift'
      };
    }
    // Rule 2: FOPLC Art. 26 — Sick leave / light duty restriction
    if (isMemberOnSickOrLightDuty(candidate.pe)) {
      return {
        eligible: false,
        reason: 'Blocked (FOPLC Art. 26): Currently on Sick / Light Duty'
      };
    }
    // Rule 3: Already on duty on this shift
    if (isMemberAlreadyWorkingCurrentShift(candidate.pe)) {
      return {
        eligible: false,
        reason: 'Already on duty on this shift'
      };
    }
    // Rule 4: Supervisor vs Officer role match
    if (posting.category === 'SUPERVISOR') {
      if (candidate.role !== 'LT' && candidate.role !== 'SGT') {
        return {
          eligible: false,
          reason: 'FOPLC Art. 24: Supervisor (LT/SGT) required'
        };
      }
      if (posting.requiredRank === 'LT' && candidate.role !== 'LT') {
        return {
          eligible: false,
          reason: 'FOPLC Art. 24 §3: Partial-shift Command Hire-Back restricted to Lieutenant'
        };
      }
    } else {
      if (candidate.role === 'LT' || candidate.role === 'SGT') {
        return {
          eligible: false,
          reason: 'PBA Art. 35: Bargaining unit Officer / Detective slot'
        };
      }
      // Detective Bureau restriction (PBA Art. 35 §4: DB hire-backs are restricted to Detective Bureau)
      if (posting.bureau === 'DB' && candidate.bureau !== 'DB') {
        return {
          eligible: false,
          reason: 'PBA Art. 35 §4: Detective Bureau Hire-Back restricted to DB members'
        };
      }
    }

    return { eligible: true, reason: 'Eligible' };
  }

  function sortBidsForPosting(bids, posting) {
    const isFcfs = posting.awardRule === 'FCFS';
    return [...bids].sort((a, b) => {
      if (isFcfs) {
        return a.seq - b.seq;
      }
      // Seniority Award (>= 24 Hours Notice)
      if (posting.category === 'SUPERVISOR') {
        const aUniform = a.bureau === 'OPS' ? 0 : 1;
        const bUniform = b.bureau === 'OPS' ? 0 : 1;
        if (aUniform !== bUniform) return aUniform - bUniform;

        if (posting.targetDiv) {
          const aSameDiv = a.div === posting.targetDiv ? 0 : 1;
          const bSameDiv = b.div === posting.targetDiv ? 0 : 1;
          if (aSameDiv !== bSameDiv) return aSameDiv - bSameDiv;
        }
        return a.pe - b.pe;
      }

      // PBA Art. 35 §4 (Uniform Division): Priority to Officers bid/assigned to a Uniform Division or Shift
      if (posting.bureau === 'OPS') {
        const aUniformPriority = a.bureau === 'OPS' ? 0 : 1;
        const bUniformPriority = b.bureau === 'OPS' ? 0 : 1;
        if (aUniformPriority !== bUniformPriority) {
          return aUniformPriority - bUniformPriority;
        }
      }
      return a.pe - b.pe;
    });
  }

  // ===========================================================================
  // 5. FOPLC ARTICLES 24 & 25 SUPERVISOR & ACTING COD AUDIT ENGINE
  // ===========================================================================
  function auditSupervisorMinimums() {
    const eng = ensureEngineState();
    if (!eng || !app.command || !app.command.NW) {
      return {
        ltCount: 1,
        sgtCount: 4,
        quadrantSgts: { NW: 1, NE: 1, SW: 1, SE: 1 },
        missingQuadrants: [],
        actingCod: null,
        needsSupervisorHireBack: false,
        reason: ''
      };
    }

    for (const div of DIV_KEYS) {
      for (const cell of app.command[div] || []) {
        if (cell.isAutoActingCod) {
          cell.isAutoActingCod = false;
          if (cell.assign === 'ACTING COD') {
            cell.assign = cell.origAssignBeforeCod || '';
          }
          cell.highlight = Boolean(cell.origHighlightBeforeCod);
        }
      }
    }

    const workingLts = [];
    const workingSgts = [];
    const quadrantSgts = { NW: 0, NE: 0, SW: 0, SE: 0 };

    for (const div of DIV_KEYS) {
      for (let i = 0; i < (app.command[div] || []).length; i++) {
        const cell = app.command[div][i];
        if (!cell || !cell.name || cell.pe === null) continue;
        const upper = cell.name.toUpperCase();
        const isPartialAbsent = /\b(88|87)\b/.test(cell.assign || '');
        if (upper.startsWith('LT') || (cell.unit && cell.unit.startsWith('72'))) {
          workingLts.push({ div, idx: i, cell, isPartialAbsent });
        } else if (upper.startsWith('SGT') || /^(110|120|130|210|220|230|310|320|330|410|420|430)$/.test(cell.unit || '')) {
          workingSgts.push({ div, idx: i, cell, isPartialAbsent });
          quadrantSgts[div] = (quadrantSgts[div] || 0) + 1;
        }
      }
    }

    const missingQuadrants = DIV_KEYS.filter(d => quadrantSgts[d] < 1);
    let actingCod = null;
    let needsSupervisorHireBack = false;
    let deficitType = null;
    let deficitDiv = missingQuadrants[0] || 'NW';
    let deficitReason = '';

    if (app.selectedBureau === 'OPS') {
      if (workingLts.length === 0 && workingSgts.length > 0) {
        const sortedSgts = [...workingSgts].sort((a, b) => a.cell.pe - b.cell.pe);
        const seniorSgt = sortedSgts[0];
        seniorSgt.cell.origAssignBeforeCod = seniorSgt.cell.assign || '';
        seniorSgt.cell.origHighlightBeforeCod = Boolean(seniorSgt.cell.highlight);
        seniorSgt.cell.isAutoActingCod = true;
        seniorSgt.cell.assign = 'ACTING COD';
        seniorSgt.cell.highlight = true;

        actingCod = {
          name: seniorSgt.cell.name,
          pe: seniorSgt.cell.pe,
          unit: seniorSgt.cell.unit,
          div: seniorSgt.div
        };

        if (workingSgts.length < 5) {
          needsSupervisorHireBack = true;
          deficitType = 'COD_AND_QUADRANT_SGT';
          deficitDiv = seniorSgt.div;
          deficitReason = `0 Lieutenants & only ${workingSgts.length} Sergeants working (${seniorSgt.cell.name} #${seniorSgt.cell.pe} elevated to Acting COD per Art. 25 → 5th Supervisor needed for 4-Quadrant Minimum per FOPLC Art. 24 §2A)`;
        }
      }

      if (missingQuadrants.length > 0) {
        needsSupervisorHireBack = true;
        deficitType = 'QUADRANT_SGT';
        deficitDiv = missingQuadrants[0];
        deficitReason = `${missingQuadrants.join(', ')} Division has 0 working Sergeants (FOPLC Art. 24 §2B requires minimum 1 Uniform Sgt per quadrant)`;
      }

      const partialLt = workingLts.find(l => l.isPartialAbsent);
      if (partialLt && workingSgts.length < 5 && !needsSupervisorHireBack) {
        needsSupervisorHireBack = true;
        deficitType = 'PARTIAL_LT';
        deficitDiv = partialLt.div;
        deficitReason = `${partialLt.cell.name} (#${partialLt.cell.pe}) marked partial-shift (${partialLt.cell.assign}) with <5 Sergeants (FOPLC Art. 24 §3 Partial-Shift LT Hire-Back)`;
      }
    }

    eng.actingCodInfo = actingCod;

    return {
      ltCount: workingLts.length,
      sgtCount: workingSgts.length,
      quadrantSgts,
      missingQuadrants,
      actingCod,
      needsSupervisorHireBack,
      deficitType,
      deficitDiv,
      reason: deficitReason
    };
  }

  // ===========================================================================
  // 6. AUTO-TRIGGER & MANAGE HIRE-BACK POSTINGS
  // ===========================================================================
  function findOpenOfficerSlot(preferredDiv) {
    const searchOrder = preferredDiv
      ? [preferredDiv, ...DIV_KEYS.filter(d => d !== preferredDiv)]
      : DIV_KEYS;

    for (const div of searchOrder) {
      const floatedOrigin = (app.officers[div] || []).find(r => !r.name && r.floatedTo);
      if (floatedOrigin) return { div, unit: floatedOrigin.unit, row: floatedOrigin };
    }
    for (const div of searchOrder) {
      const markedOffUnits = (app.dayOffRoster[div] || []).map(o => o.homeUnit);
      const vacatedRow = (app.officers[div] || []).find(r => r.unit && !r.name && markedOffUnits.includes(r.unit));
      if (vacatedRow) return { div, unit: vacatedRow.unit, row: vacatedRow };
    }
    for (const div of searchOrder) {
      const openRow = (app.officers[div] || []).find(r => r.unit && !r.name && !r.bidCar);
      if (openRow) return { div, unit: openRow.unit, row: openRow };
    }
    for (const div of searchOrder) {
      const anyRow = (app.officers[div] || []).find(r => r.unit && !r.name);
      if (anyRow) return { div, unit: anyRow.unit, row: anyRow };
    }
    return null;
  }

  function findOpenCommandSlot(preferredDiv, rankPref) {
    const searchOrder = preferredDiv
      ? [preferredDiv, ...DIV_KEYS.filter(d => d !== preferredDiv)]
      : DIV_KEYS;

    for (const div of searchOrder) {
      const rows = app.command[div] || [];
      for (let i = 0; i < rows.length; i++) {
        const c = rows[i];
        if (!c.name && c.unit) {
          if (rankPref === 'LT' && c.unit.startsWith('72')) return { div, idx: i, unit: c.unit, cell: c };
          if (rankPref !== 'LT' && !c.unit.startsWith('72')) return { div, idx: i, unit: c.unit, cell: c };
        }
      }
    }
    for (const div of searchOrder) {
      const rows = app.command[div] || [];
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i].name && rows[i].unit) {
          return { div, idx: i, unit: rows[i].unit, cell: rows[i] };
        }
      }
    }
    return null;
  }

  function createHireBackPosting(options) {
    const eng = ensureEngineState();
    if (!eng) return null;

    const noticeMode = eng.noticeMode;
    const isShiftStartedBlocked = noticeMode === 'SHIFT_STARTED' && !eng.dutyChiefAuthorized;
    const isUnder24 = noticeMode === 'SHORT_UNDER24' || (noticeMode === 'SHIFT_STARTED' && eng.dutyChiefAuthorized);

    let blockType = options.blockType || 'FULL_SHIFT';
    if (options.isCShiftTraining) {
      blockType = 'LAST_4H';
    }

    const awardRule = (isUnder24 || blockType !== 'FULL_SHIFT') ? 'FCFS' : 'SENIORITY';
    const durationHrs = blockType === 'FULL_SHIFT'
      ? (app.selectedBureau === 'DB' ? '8.0 hrs' : '8.5 hrs')
      : '4.0 hrs';

    const bidId = `HB-${eng.nextBidId++}`;
    const secondsTotal = isShiftStartedBlocked
      ? 0
      : (awardRule === 'FCFS' ? FCFS_AUTO_FILL_SECONDS : BID_WINDOW_SECONDS);

    const posting = {
      id: bidId,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      category: options.category || 'OFFICER',
      requiredRank: options.requiredRank || null,
      bureau: app.selectedBureau,
      shift: app.selectedShift,
      date: app.selectedDate,
      targetDiv: options.targetDiv || 'NW',
      targetUnit: options.targetUnit || 'OPEN',
      triggeredByName: options.triggeredByName || 'Shift Shortage',
      triggeredByPe: options.triggeredByPe || null,
      triggerReason: options.triggerReason || 'Shift Count Below Minimum',
      noticeMode,
      awardRule,
      blockType,
      durationHrs,
      isCShiftTraining: Boolean(options.isCShiftTraining),
      status: isShiftStartedBlocked ? 'HELD_DUTY_CHIEF' : 'OPEN',
      secondsRemaining: secondsTotal,
      secondsTotal: Math.max(1, secondsTotal),
      bids: [],
      bidSeqCounter: 1
    };

    eng.openPostings.unshift(posting);

    const ruleTag = posting.category === 'SUPERVISOR'
      ? 'FOPLC Art. 24'
      : (posting.isCShiftTraining ? 'PBA Art. 35 §2 (C-Train)' : 'PBA Art. 35 §4');

    const broadcastChannel = awardRule === 'FCFS'
      ? 'Radio + In-Car MDC + MyShift App (First-Come, First-Served)'
      : 'Department Bid Board + MyShift App (Seniority Bid Window)';

    app.auditEntries.unshift({
      time: posting.createdAt,
      tag: ruleTag,
      msg: isShiftStartedBlocked
        ? `[${posting.id}] Hire-Back for ${posting.targetUnit} (${posting.targetDiv}) HELD — Shift already started; awaiting Duty Chief authorization (FOPLC Art. 24 §4D).`
        : `[${posting.id}] Auto-Posted ${posting.blockType.replace('_', ' ')} (${posting.durationHrs}) Hire-Back for ${posting.targetUnit} (${posting.targetDiv}) via ${broadcastChannel}.`
    });

    if (posting.category === 'SUPERVISOR' && !isShiftStartedBlocked && eng.supervisorStandbyList.length > 0) {
      const standbyWinner = eng.supervisorStandbyList.shift();
      posting.bids.push({
        ...standbyWinner,
        seq: 1,
        bidTime: posting.createdAt,
        source: 'FOPLC Art. 24 §4B Standby List'
      });
      finalizeHireBackAward(posting.id, 'STANDBY_AUTO');
      return posting;
    }

    if (eng.autoSimulateBids && !isShiftStartedBlocked) {
      scheduleSimulatedBidsForPosting(posting);
    }

    ensureTimerRunning();
    return posting;
  }

  function syncAppHireBackBidsIntoPosting(posting) {
    if (!posting || posting.category !== 'OFFICER' || !Array.isArray(app.hireBackBids)) return;
    for (const lb of app.hireBackBids) {
      if (!lb || !lb.pe) continue;
      if (!posting.bids.some(b => b.pe === lb.pe)) {
        posting.bids.push({
          name: lb.name,
          pe: lb.pe,
          role: 'OFFICER',
          bureau: lb.shift === 'DB' ? 'DB' : 'OPS',
          div: lb.div || 'NE',
          shift: lb.shift || 'B',
          badgeLabel: lb.shift ? `Uniform (${lb.shift}-Shift)` : 'Uniform',
          seq: lb.bidOrder || posting.bidSeqCounter++,
          bidTime: lb.bidTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          source: 'Opt-In Bid Queue'
        });
      }
    }
  }

  function scheduleSimulatedBidsForPosting(posting) {
    if (posting.category === 'OFFICER') {
      syncAppHireBackBidsIntoPosting(posting);
    }

    const eligiblePool = EXTENDED_CANDIDATE_POOL.filter(c => evaluateBidderEligibility(c, posting).eligible);
    if (eligiblePool.length === 0) return;

    const picked = [];
    if (posting.category === 'SUPERVISOR') {
      picked.push(...eligiblePool.slice(0, 3));
    } else if (posting.bureau === 'DB') {
      picked.push(...eligiblePool.filter(c => c.bureau === 'DB'));
    } else {
      const juniorUniform = eligiblePool.find(c => c.pe === 1977) || eligiblePool[eligiblePool.length - 1];
      const detectiveCand = eligiblePool.find(c => c.bureau === 'DB');
      const midUniform = eligiblePool.find(c => c.pe === 1812);
      const seniorUniform = eligiblePool.find(c => c.pe === 1742) || eligiblePool[0];

      if (juniorUniform) picked.push(juniorUniform);
      if (detectiveCand) picked.push(detectiveCand);
      if (midUniform && !picked.includes(midUniform)) picked.push(midUniform);
      if (seniorUniform && !picked.includes(seniorUniform)) picked.push(seniorUniform);
    }

    if (picked[0] && posting.bids.length === 0) {
      submitBidToPosting(posting.id, picked[0], 'MyShift Mobile App');
    }
    if (picked[1] && posting.awardRule === 'SENIORITY') {
      setTimeout(() => {
        const eng = ensureEngineState();
        if (eng && eng.openPostings.some(p => p.id === posting.id && p.status === 'OPEN')) {
          submitBidToPosting(posting.id, picked[1], 'MyShift Mobile App');
          if (typeof window.renderAll === 'function') window.renderAll();
        }
      }, 2500);
    }
    if (picked[2] && posting.awardRule === 'SENIORITY') {
      setTimeout(() => {
        const eng = ensureEngineState();
        if (eng && eng.openPostings.some(p => p.id === posting.id && p.status === 'OPEN')) {
          submitBidToPosting(posting.id, picked[2], 'MyShift Mobile App');
          if (typeof window.renderAll === 'function') window.renderAll();
        }
      }, 5000);
    }
  }

  function submitBidToPosting(postingId, candidate, sourceLabel) {
    const eng = ensureEngineState();
    if (!eng) return false;
    const posting = eng.openPostings.find(p => p.id === postingId);
    if (!posting || posting.status !== 'OPEN') return false;

    if (posting.bids.some(b => b.pe === candidate.pe)) {
      return false;
    }

    const check = evaluateBidderEligibility(candidate, posting);
    if (!check.eligible) {
      app.toastData = {
        status: 'blocked',
        title: `Hire-Back Bid Blocked (${candidate.name} #${candidate.pe})`,
        step1: check.reason,
        step2: `Per contract rules, ${candidate.name} (#${candidate.pe}) cannot be awarded ${posting.id}.`,
        pendingAction: null
      };
      if (typeof window.renderAll === 'function') window.renderAll();
      return false;
    }

    const bidTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const seqNum = posting.bidSeqCounter++;
    const bidEntry = {
      name: candidate.name,
      pe: candidate.pe,
      role: candidate.role || 'OFFICER',
      bureau: candidate.bureau || 'OPS',
      div: candidate.div || 'NE',
      shift: candidate.shift || 'B',
      badgeLabel: candidate.badgeLabel || 'Uniform',
      seq: seqNum,
      bidTime: bidTimeStr,
      source: sourceLabel || 'Officer Bid'
    };

    posting.bids.push(bidEntry);

    if (posting.category === 'OFFICER' && Array.isArray(app.hireBackBids)) {
      if (!app.hireBackBids.some(b => b.pe === candidate.pe)) {
        app.hireBackBids.push({
          pe: candidate.pe,
          name: candidate.name,
          shift: candidate.shift || 'B',
          div: candidate.div || 'NE',
          bidOrder: app.hireBackBidCounter ? app.hireBackBidCounter++ : seqNum,
          bidTime: bidTimeStr
        });
      }
    }

    if (posting.awardRule === 'FCFS' && sourceLabel === 'Instant Manual Claim') {
      finalizeHireBackAward(posting.id, 'FCFS_INSTANT');
      return true;
    }

    return true;
  }

  // ===========================================================================
  // 7. AUTO-AWARD, SCHEDULE AUTO-POPULATION & ALL-BIDDER NOTIFICATION
  // ===========================================================================
  function finalizeHireBackAward(postingId, triggerSource) {
    const eng = ensureEngineState();
    if (!eng) return;
    const idx = eng.openPostings.findIndex(p => p.id === postingId);
    if (idx === -1) return;

    const posting = eng.openPostings[idx];

    if (posting.bids.length === 0) {
      if (posting.blockType === 'FULL_SHIFT' && posting.category === 'OFFICER') {
        eng.openPostings.splice(idx, 1);
        splitUnfilledPostingIntoPartialBlocks(posting);
        return;
      }
      posting.secondsRemaining = BID_WINDOW_SECONDS;
      return;
    }

    const sortedBids = sortBidsForPosting(posting.bids, posting);
    const winner = sortedBids[0];
    const standbyBidders = sortedBids.slice(1);

    eng.openPostings.splice(idx, 1);

    let placedUnit = posting.targetUnit;
    let placedDiv = posting.targetDiv;
    const assignBadge = posting.blockType === 'FIRST_4H'
      ? 'HB 1ST 4H'
      : posting.blockType === 'LAST_4H'
        ? 'HB LAST 4H'
        : 'HIREBACK';

    if (posting.category === 'SUPERVISOR') {
      const slot = findOpenCommandSlot(posting.targetDiv, winner.role);
      if (slot) {
        slot.cell.name = winner.name;
        slot.cell.pe = winner.pe;
        slot.cell.assign = assignBadge;
        slot.cell.isHireBack = true;
        slot.cell.highlight = true;
        placedUnit = slot.unit;
        placedDiv = slot.div;
      }
      for (const sb of standbyBidders) {
        if (!eng.supervisorStandbyList.some(x => x.pe === sb.pe)) {
          eng.supervisorStandbyList.push(sb);
        }
      }
    } else {
      let targetRow = null;
      if (posting.targetUnit && app.officers[posting.targetDiv]) {
        const exact = app.officers[posting.targetDiv].find(r => r.unit === posting.targetUnit && !r.name);
        if (exact) {
          targetRow = exact;
          placedDiv = posting.targetDiv;
        }
      }
      if (!targetRow) {
        const openSlot = findOpenOfficerSlot(posting.targetDiv);
        if (openSlot) {
          targetRow = openSlot.row;
          placedDiv = openSlot.div;
          placedUnit = openSlot.unit;
        }
      }

      if (targetRow) {
        targetRow.name = winner.name;
        targetRow.pe = winner.pe;
        targetRow.partner = '';
        targetRow.isHireBack = true;
        targetRow.isReturnedOffTime = false;
        targetRow.hireBackShift = winner.shift || 'B';
        targetRow.assign = assignBadge;
        targetRow.floatedTo = null;
      }
      if (Array.isArray(app.hireBackBids)) {
        app.hireBackBids = app.hireBackBids.filter(b => b.pe !== winner.pe);
        if (getShiftCount() >= app.shiftMin) {
          app.hireBackBids = [];
        }
      }
      app.hireBackLastWinnerNotification = {
        pe: winner.pe,
        name: winner.name,
        shift: winner.shift || 'B',
        assignedUnit: placedUnit,
        assignedDiv: placedDiv,
        ruleLabel: `${posting.awardRule === 'FCFS' ? '<24h First-Come, First-Served' : '≥24h Seniority Bid'} • Auto-Awarded (${posting.durationHrs})`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    }

    const closedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const whyWon = posting.awardRule === 'FCFS'
      ? `First-Come, First-Served (<24h / Partial Rule — Claim #1 at ${winner.bidTime})`
      : (posting.category === 'SUPERVISOR'
        ? `Highest Supervisor Seniority (PE #${winner.pe}, FOPLC Art. 24 §4A)`
        : `Highest Eligible Seniority (PE #${winner.pe}, ${winner.bureau === 'OPS' ? 'Uniform Division Priority' : 'Detective Bureau'} — PBA Art. 35 §4)`);

    const bidderReceipts = sortedBids.map((b, rankIdx) => ({
      name: b.name,
      pe: b.pe,
      badgeLabel: b.badgeLabel,
      bidTime: b.bidTime,
      outcome: rankIdx === 0 ? 'AWARDED' : `NOTIFIED • STANDBY #${rankIdx}`,
      detail: rankIdx === 0
        ? `✅ You were AWARDED ${posting.id} (${assignBadge} • 1.5x OT) in Unit ${placedUnit} (${placedDiv}). Schedule auto-populated.`
        : `📢 ${posting.id} for Unit ${placedUnit} (${placedDiv}) was awarded to ${winner.name} (#${winner.pe}) via ${posting.awardRule === 'FCFS' ? 'First-Come, First-Served' : 'Seniority (PE #' + winner.pe + ')'}. You are #${rankIdx} on Standby.`
    }));

    const notificationRecord = {
      id: posting.id,
      closedAt: closedTime,
      category: posting.category,
      awardRule: posting.awardRule,
      blockType: posting.blockType,
      durationHrs: posting.durationHrs,
      unit: placedUnit,
      div: placedDiv,
      winnerName: winner.name,
      winnerPe: winner.pe,
      winnerBadge: winner.badgeLabel,
      whyWon,
      totalBids: sortedBids.length,
      bidderReceipts
    };

    eng.closedNotifications.unshift(notificationRecord);
    if (eng.closedNotifications.length > 12) {
      eng.closedNotifications.pop();
    }

    auditSupervisorMinimums();

    const otherNames = standbyBidders.length > 0
      ? standbyBidders.map(b => `${b.name} (#${b.pe})`).join(', ')
      : 'None (Sole Bidder)';

    app.toastData = {
      status: 'approved',
      title: `🤖 Zero-Touch Hire-Back Auto-Awarded (${posting.id}): ${winner.name} (#${winner.pe}) → Unit ${placedUnit} (${placedDiv})`,
      step1: `Step 1 (Rule Engine): ${whyWon}. Rate: 1.5x Overtime (${posting.durationHrs}).`,
      step2: `Step 2 (Schedule Auto-Populated): ${winner.name} (#${winner.pe}) automatically placed into Unit ${placedUnit} (${placedDiv}) with badge "${assignBadge}".`,
      step3: `Step 3 (All ${sortedBids.length} Bidders Notified): Award alert sent to ${winner.name} (#${winner.pe}); award + standby notice sent to: ${otherNames}.`
    };

    app.auditEntries.unshift({
      time: closedTime,
      tag: posting.category === 'SUPERVISOR' ? 'FOPLC Art. 24 Award' : 'PBA Art. 35 §4–5',
      msg: `[${posting.id}] Auto-Awarded ${assignBadge} (${posting.durationHrs}) in ${placedUnit} (${placedDiv}) to ${winner.name} (#${winner.pe}) [${whyWon}]. Notified all ${sortedBids.length} bidder(s).`
    });

    checkAndCreatePostingsForCurrentShortages();

    if (typeof window.renderAll === 'function') {
      window.renderAll();
    }
  }

  function splitUnfilledPostingIntoPartialBlocks(unfilledPosting) {
    const first4 = createHireBackPosting({
      category: unfilledPosting.category,
      targetDiv: unfilledPosting.targetDiv,
      targetUnit: unfilledPosting.targetUnit,
      triggeredByName: unfilledPosting.triggeredByName,
      triggeredByPe: unfilledPosting.triggeredByPe,
      triggerReason: `Unfilled Full-Shift ${unfilledPosting.id} → Split to First 4 Hours (PBA Art. 35 §2)`,
      blockType: 'FIRST_4H'
    });
    const last4 = createHireBackPosting({
      category: unfilledPosting.category,
      targetDiv: unfilledPosting.targetDiv,
      targetUnit: unfilledPosting.targetUnit,
      triggeredByName: unfilledPosting.triggeredByName,
      triggeredByPe: unfilledPosting.triggeredByPe,
      triggerReason: `Unfilled Full-Shift ${unfilledPosting.id} → Split to Last 4 Hours (PBA Art. 35 §2)`,
      blockType: 'LAST_4H'
    });

    app.toastData = {
      status: 'approved',
      title: `⏱️ Full-Shift Bid Expired Unfilled → Split into 4-Hour Partial Blocks (PBA Art. 35 §2)`,
      step1: `Step 1 (Full-Shift First): ${unfilledPosting.id} offered full shift (8.5h) first per PBA Art. 35 §2.`,
      step2: `Step 2 (Partial-Shift Split): Automatically posted ${first4 ? first4.id : 'First 4h'} (First 4 Hours) and ${last4 ? last4.id : 'Last 4h'} (Last 4 Hours) on a First-Come, First-Served basis.`,
      step3: `Step 3 (Broadcast): Officers may now claim either 4-hour block or both.`
    };

    if (typeof window.renderAll === 'function') {
      window.renderAll();
    }
  }

  // ===========================================================================
  // 8. AUTOMATIC SHORTAGE DETECTION (PATROL & SUPERVISORS)
  // ===========================================================================
  function checkAndCreatePostingsForCurrentShortages(triggerContext) {
    const eng = ensureEngineState();
    if (!eng) return;

    const count = getShiftCount();
    const min = app.shiftMin;
    const neededOfficers = Math.max(0, min - count);

    const activeOfficerPostings = eng.openPostings.filter(p => p.category === 'OFFICER');
    const postedOfficerSlots = activeOfficerPostings.reduce((acc, p) => {
      return acc + (p.blockType === 'FULL_SHIFT' || p.isCShiftTraining ? 1 : 0.5);
    }, 0);

    const missingPostings = Math.ceil(neededOfficers - postedOfficerSlots);
    for (let i = 0; i < missingPostings; i++) {
      const slot = findOpenOfficerSlot(triggerContext && triggerContext.div);
      createHireBackPosting({
        category: 'OFFICER',
        targetDiv: slot ? slot.div : (triggerContext && triggerContext.div) || 'NW',
        targetUnit: slot ? slot.unit : (triggerContext && triggerContext.unit) || 'OPEN',
        triggeredByName: (triggerContext && triggerContext.name) || 'Shift Minimum Deficit',
        triggeredByPe: (triggerContext && triggerContext.pe) || null,
        triggerReason: (triggerContext && triggerContext.reason) || `Shift Count (${count}) is below Minimum (${min})`,
        isCShiftTraining: Boolean(triggerContext && triggerContext.isCShiftTraining)
      });
    }

    if (neededOfficers === 0 && activeOfficerPostings.length > 0) {
      eng.openPostings = eng.openPostings.filter(p => p.category !== 'OFFICER');
    }

    const supAudit = auditSupervisorMinimums();
    const activeSupPostings = eng.openPostings.filter(p => p.category === 'SUPERVISOR');

    if (supAudit.needsSupervisorHireBack && activeSupPostings.length === 0) {
      const reqRank = supAudit.deficitType === 'PARTIAL_LT' ? 'LT' : null;
      const slot = findOpenCommandSlot(supAudit.deficitDiv, reqRank);
      createHireBackPosting({
        category: 'SUPERVISOR',
        requiredRank: reqRank,
        targetDiv: slot ? slot.div : supAudit.deficitDiv,
        targetUnit: slot ? slot.unit : 'CMD',
        triggeredByName: (triggerContext && triggerContext.name) || 'Command Minimum Deficit',
        triggeredByPe: (triggerContext && triggerContext.pe) || null,
        triggerReason: supAudit.reason,
        blockType: supAudit.deficitType === 'PARTIAL_LT' ? 'FIRST_4H' : 'FULL_SHIFT'
      });
    } else if (!supAudit.needsSupervisorHireBack && activeSupPostings.length > 0) {
      eng.openPostings = eng.openPostings.filter(p => p.category !== 'SUPERVISOR');
    }
  }

  // ===========================================================================
  // 9. LIVE COUNTDOWN TIMER LOOP
  // ===========================================================================
  function ensureTimerRunning() {
    if (tickIntervalId) return;
    tickIntervalId = setInterval(() => {
      const eng = ensureEngineState();
      if (!eng || eng.timerPaused) return;
      const openList = eng.openPostings.filter(p => p.status === 'OPEN');
      if (openList.length === 0) return;

      let expiredIds = [];
      for (const p of openList) {
        p.secondsRemaining = Math.max(0, p.secondsRemaining - 1);
        if (p.secondsRemaining <= 0) {
          expiredIds.push(p.id);
        }
      }

      if (expiredIds.length > 0) {
        for (const id of expiredIds) {
          finalizeHireBackAward(id, 'TIMER_EXPIRED');
        }
      } else {
        updateLiveTimerElements();
      }
    }, 1000);
  }

  function updateLiveTimerElements() {
    const eng = ensureEngineState();
    if (!eng) return;
    for (const p of eng.openPostings) {
      const pct = Math.max(0, Math.min(100, Math.round((p.secondsRemaining / p.secondsTotal) * 100)));
      const ids = [
        `hbTopTimerText-${p.id}`,
        `hbTimerText-${p.id}`,
        `hbMobTimerText-${p.id}`
      ];
      for (const elId of ids) {
        const el = document.getElementById(elId);
        if (el) el.textContent = `${p.secondsRemaining}s`;
      }
      const barIds = [
        `hbTopTimerBar-${p.id}`,
        `hbTimerBar-${p.id}`
      ];
      for (const bId of barIds) {
        const barEl = document.getElementById(bId);
        if (barEl) barEl.style.width = `${pct}%`;
      }
    }
  }

  // ===========================================================================
  // 10. SUPERVISOR (LT / SGT) MARK-OFF & RESTORE ACTIONS (FOPLC ART. 24–26)
  // ===========================================================================
  window.openCommandActionPopover = function (event, div, rowIdx) {
    event.stopPropagation();
    const menu = document.getElementById('floatingActionMenu');
    const content = document.getElementById('floatingMenuContent');
    const cell = (app.command[div] || [])[rowIdx];
    if (!menu || !content || !cell || !cell.name) return;

    const isLt = cell.name.toUpperCase().startsWith('LT') || (cell.unit && cell.unit.startsWith('72'));

    content.innerHTML = `
      <div class="px-2.5 py-2 border-b border-[var(--border-grid)]">
        <div class="flex items-center justify-between">
          <span class="font-bold text-[var(--text-main)]">${cell.name}</span>
          <span class="font-mono text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 font-bold">PE #${cell.pe}</span>
        </div>
        <div class="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">Command Unit ${cell.unit || 'CMD'} (${div} Division • FOPLC)</div>
      </div>

      <div class="pt-1 space-y-0.5">
        <div class="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          FOPLC Supervisor Mark-Off (Art. 24–26)
        </div>
        <button onclick="triggerCommandLeaveAction('${div}', ${rowIdx}, 'SICK')" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 flex items-center justify-between cursor-pointer font-semibold text-red-600 dark:text-red-400">
          <span>🤒 Call In Sick Leave</span>
          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-red-500/15">FOPLC Art. 26</span>
        </button>
        <button onclick="triggerCommandLeaveAction('${div}', ${rowIdx}, 'VACATION')" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-500/10 flex items-center justify-between cursor-pointer">
          <span>🏖️ Supervisor Vacation / Day Off</span>
          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-500">Art. 24 Check</span>
        </button>
        ${isLt ? `
        <button onclick="triggerCommandLeaveAction('${div}', ${rowIdx}, 'PARTIAL_LT_88')" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-amber-500/10 flex items-center justify-between cursor-pointer text-amber-600 dark:text-amber-300 font-semibold">
          <span>⏱️ Partial Shift Absence (88 Early)</span>
          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15">Art. 24 §3</span>
        </button>
        ` : ''}
      </div>
    `;

    menu.classList.remove('hidden');
    const rect = event.currentTarget.getBoundingClientRect();
    let left = rect.right - 256;
    let top = rect.bottom + 6;
    if (left < 12) left = 12;
    if (top + 220 > window.innerHeight - 12) top = Math.max(12, rect.top - 220);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };

  window.triggerCommandLeaveAction = function (div, rowIdx, actionType) {
    closeActionPopover();
    const eng = ensureEngineState();
    const cell = (app.command[div] || [])[rowIdx];
    if (!eng || !cell || !cell.name) return;

    const supName = cell.name;
    const supPe = cell.pe;
    const supUnit = cell.unit || 'CMD';

    if (actionType === 'PARTIAL_LT_88') {
      cell.assign = '88 1000';
      cell.highlight = true;
      const audit = auditSupervisorMinimums();
      app.auditEntries.unshift({
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tag: 'FOPLC Art. 24 §3',
        msg: `${supName} (#${supPe}) marked partial shift (${cell.assign}). ${audit.actingCod ? `${audit.actingCod.name} (#${audit.actingCod.pe}) covers COD.` : ''}`
      });
      checkAndCreatePostingsForCurrentShortages({
        div,
        unit: supUnit,
        name: supName,
        pe: supPe,
        reason: `${supName} (#${supPe}) partial absence`
      });
      renderAll();
      return;
    }

    eng.commandOffRoster.push({
      div,
      rowIdx,
      unit: supUnit,
      name: supName,
      pe: supPe,
      status: actionType === 'SICK' ? 'SICK LEAVE (FOPLC)' : 'SUPV DAY OFF',
      origAssign: cell.origAssignBeforeCod !== undefined ? cell.origAssignBeforeCod : (cell.assign || ''),
      origBold: Boolean(cell.bold),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    cell.name = '';
    cell.pe = null;
    cell.assign = '';
    cell.highlight = false;
    cell.isAutoActingCod = false;

    const supAudit = auditSupervisorMinimums();

    app.toastData = {
      status: 'approved',
      title: `Supervisor Marked Off: ${supName} (#${supPe}) [${supUnit} ${div}]`,
      step1: supAudit.actingCod
        ? `Step 1 (FOPLC Art. 24 §2A & Art. 25): 0 Lieutenants working with ${supAudit.sgtCount} Sergeants → Senior Sergeant ${supAudit.actingCod.name} (#${supAudit.actingCod.pe}) automatically elevated to ACTING COD!`
        : `Step 1 (Command Check): Lieutenants working: ${supAudit.ltCount} • Sergeants working: ${supAudit.sgtCount} (Min 4 across NW/NE/SW/SE).`,
      step2: supAudit.needsSupervisorHireBack
        ? `Step 2 (FOPLC Art. 24 Trigger): ${supAudit.reason} → Initiating automatic Supervisor Hire-Back!`
        : `Step 2 (No Hire-Back Required): All 4 quadrants have ≥1 Sergeant and ${supAudit.sgtCount} Sergeants cover command minimums without overtime cost!`,
      step3: `Step 3 (Zero-Touch Audit): Logged under FOPLC Articles 24, 25 & 26.`
    };

    app.auditEntries.unshift({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tag: 'FOPLC Art. 24 & 25',
      msg: `${supName} (#${supPe}) [${supUnit} ${div}] marked ${actionType}. ${supAudit.actingCod ? `Senior Sgt ${supAudit.actingCod.name} (#${supAudit.actingCod.pe}) auto-assigned ACTING COD.` : ''} ${supAudit.needsSupervisorHireBack ? 'Supervisor Hire-Back posted.' : 'Command minimums satisfied.'}`
    });

    checkAndCreatePostingsForCurrentShortages({
      div,
      unit: supUnit,
      name: supName,
      pe: supPe,
      reason: supAudit.reason
    });

    renderAll();
  };

  window.restoreSupervisorToDuty = function (pe) {
    const eng = ensureEngineState();
    if (!eng) return;
    const idx = eng.commandOffRoster.findIndex(c => c.pe === pe);
    if (idx === -1) return;
    const rec = eng.commandOffRoster[idx];
    eng.commandOffRoster.splice(idx, 1);

    const row = (app.command[rec.div] || [])[rec.rowIdx];
    if (row) {
      row.name = rec.name;
      row.pe = rec.pe;
      row.assign = rec.origAssign || '';
      row.bold = rec.origBold;
      row.highlight = false;
    }

    auditSupervisorMinimums();
    checkAndCreatePostingsForCurrentShortages();

    app.auditEntries.unshift({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tag: 'FOPLC Restored',
      msg: `Supervisor ${rec.name} (#${rec.pe}) returned to duty in Unit ${rec.unit} (${rec.div}).`
    });

    renderAll();
  };

  // ===========================================================================
  // 11. C-SHIFT MORNING IN-SERVICE TRAINING ACTION (PBA ART. 34 §7 & ART. 35 §2)
  // ===========================================================================
  window.triggerCShiftTrainingLeave = function (div, unit) {
    closeActionPopover();
    const row = (app.officers[div] || []).find(r => r.unit === unit);
    if (!row || !row.name) return;

    const offName = row.name;
    const offPe = row.pe;
    const homeSlotUnit = row.floatedFrom ? row.floatedFrom.unit : unit;
    const homeSlotDiv = row.floatedFrom ? row.floatedFrom.div : div;

    app.dayOffRoster[homeSlotDiv].push({
      homeUnit: homeSlotUnit,
      name: offName,
      pe: offPe,
      status: 'IN-SVC TRAIN (LAST 4H)',
      fullLabel: 'Morning In-Service Training — Last 4 Hrs Off (Art. 34 §7)',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    recalculateFloats();

    checkAndCreatePostingsForCurrentShortages({
      div: homeSlotDiv,
      unit: homeSlotUnit,
      name: offName,
      pe: offPe,
      isCShiftTraining: true,
      reason: `${offName} (#${offPe}) granted Last 4 Hours Admin Time for Morning In-Service Training (Art. 34 §7 & Art. 35 §2)`
    });

    app.toastData = {
      status: 'approved',
      title: `🎓 Morning In-Service Training Applied: ${offName} (#${offPe}) — Last 4 Hours Off (Art. 34 §7)`,
      step1: `Step 1 (Art. 34 §7 Admin Time): ${offName} (#${offPe}) credited Last 4 Hours off on C-Shift for attending same-day morning training.`,
      step2: `Step 2 (Art. 35 §2 C-Shift Exception): Per PBA Contract Art. 35 §2, the ONLY hire-back offered is for the LAST 4 HOURS of C-Shift (First-Come, First-Served).`,
      step3: `Step 3 (Zero-Touch Broadcast): Last-4-Hours Hire-Back automatically posted to MyShift App.`
    };

    renderAll();
  };

  // ===========================================================================
  // 12. PUBLIC CONTROLS CALLED FROM UI BUTTONS
  // ===========================================================================
  window.setHbNoticeMode = function (newMode) {
    const eng = ensureEngineState();
    if (!eng) return;
    eng.noticeMode = newMode;
    app.hireBackNoticeMode = (newMode === 'SHORT_UNDER24' || newMode === 'SHIFT_STARTED')
      ? 'FCFS_UNDER_24HR'
      : 'SENIORITY_24HR';

    for (const p of eng.openPostings) {
      p.noticeMode = newMode;
      if (newMode === 'SHIFT_STARTED' && !eng.dutyChiefAuthorized) {
        p.status = 'HELD_DUTY_CHIEF';
      } else {
        p.status = 'OPEN';
        p.awardRule = (newMode === 'SHORT_UNDER24' || newMode === 'SHIFT_STARTED' || p.blockType !== 'FULL_SHIFT')
          ? 'FCFS'
          : 'SENIORITY';
        p.secondsTotal = p.awardRule === 'FCFS' ? FCFS_AUTO_FILL_SECONDS : BID_WINDOW_SECONDS;
        p.secondsRemaining = Math.min(p.secondsRemaining || p.secondsTotal, p.secondsTotal);
      }
    }

    renderAll();
  };

  window.toggleDutyChiefAuth = function () {
    const eng = ensureEngineState();
    if (!eng) return;
    eng.dutyChiefAuthorized = !eng.dutyChiefAuthorized;

    for (const p of eng.openPostings) {
      if (eng.noticeMode === 'SHIFT_STARTED') {
        p.status = eng.dutyChiefAuthorized ? 'OPEN' : 'HELD_DUTY_CHIEF';
        if (eng.dutyChiefAuthorized) {
          p.awardRule = 'FCFS';
          p.secondsTotal = FCFS_AUTO_FILL_SECONDS;
          p.secondsRemaining = FCFS_AUTO_FILL_SECONDS;
          if (p.bids.length === 0 && eng.autoSimulateBids) {
            scheduleSimulatedBidsForPosting(p);
          }
        }
      }
    }

    app.auditEntries.unshift({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tag: 'FOPLC Art. 24 §4D',
      msg: eng.dutyChiefAuthorized
        ? 'Duty Chief AUTHORIZED in-shift hire-backs after shift start.'
        : 'Duty Chief authorization revoked; in-shift hire-backs held.'
    });

    renderAll();
  };

  window.toggleHbTimerPause = function () {
    const eng = ensureEngineState();
    if (!eng) return;
    eng.timerPaused = !eng.timerPaused;
    renderAll();
  };

  window.expirePostingNow = function (postingId) {
    finalizeHireBackAward(postingId, 'MANUAL_FAST_FORWARD');
  };

  window.splitPostingToPartialsNow = function (postingId) {
    const eng = ensureEngineState();
    if (!eng) return;
    const idx = eng.openPostings.findIndex(p => p.id === postingId);
    if (idx === -1) return;
    const posting = eng.openPostings.splice(idx, 1)[0];
    splitUnfilledPostingIntoPartialBlocks(posting);
  };

  window.userBidOrClaimPosting = function (postingId, candidateIdxOrLoggedIn) {
    const eng = ensureEngineState();
    if (!eng) return;
    const posting = eng.openPostings.find(p => p.id === postingId);
    if (!posting) return;

    let cand = null;
    if (candidateIdxOrLoggedIn === 'LOGGED_IN') {
      if (app.loggedInPe === 'COD') {
        cand = EXTENDED_CANDIDATE_POOL.find(c => evaluateBidderEligibility(c, posting).eligible) || EXTENDED_CANDIDATE_POOL[0];
      } else {
        const dirMatch = (typeof MASTER_OPERATIONS_DIRECTORY !== 'undefined')
          ? MASTER_OPERATIONS_DIRECTORY.find(o => o.pe === app.loggedInPe)
          : null;
        cand = {
          name: dirMatch ? dirMatch.name : `OFFICER #${app.loggedInPe}`,
          pe: app.loggedInPe,
          role: 'OFFICER',
          bureau: app.selectedBureau,
          div: dirMatch && dirMatch.div ? dirMatch.div : 'NW',
          badgeLabel: 'Logged-In Officer (MyShift)'
        };
      }
    } else {
      cand = EXTENDED_CANDIDATE_POOL[candidateIdxOrLoggedIn];
    }

    if (!cand) return;
    const source = posting.awardRule === 'FCFS' ? 'Instant Manual Claim' : 'Officer Bid';
    submitBidToPosting(postingId, cand, source);
    renderAll();
  };

  // ===========================================================================
  // 13. UI RENDERERS (TOP CONTROL STRIP + LIVE COUNTDOWN BANNER, WORKSHEET, APP)
  // ===========================================================================
  function ensureControlStripExists() {
    if (document.getElementById('hbZeroTouchControlBar')) return;
    const toastEl = document.getElementById('transactionToast');
    if (!toastEl || !toastEl.parentElement) return;

    const strip = document.createElement('div');
    strip.id = 'hbZeroTouchControlBar';
    strip.className = 'hb-control-strip';
    toastEl.parentElement.insertBefore(strip, toastEl);
  }

  function renderControlStrip() {
    ensureControlStripExists();
    const strip = document.getElementById('hbZeroTouchControlBar');
    if (!strip) return;

    const eng = ensureEngineState();
    const details = getNoticeModeDetails();
    const supAudit = auditSupervisorMinimums();
    const openPostings = eng.openPostings;
    const openCount = openPostings.length;
    const standbyCount = eng.supervisorStandbyList.length;

    const qBadges = DIV_KEYS.map(d => {
      const c = supAudit.quadrantSgts[d] || 0;
      const ok = c >= 1;
      return `<span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${ok ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/25 text-red-300 border border-red-500/40 animate-pulse'}">${d}: ${c} Sgt</span>`;
    }).join('');

    const codBadge = supAudit.actingCod
      ? `<span class="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-extrabold text-[10.5px]">⚡ ACTING COD: ${supAudit.actingCod.name} (#${supAudit.actingCod.pe}) [FOPLC Art. 25]</span>`
      : `<span class="px-2 py-0.5 rounded bg-blue-500/20 text-blue-200 border border-blue-500/30 font-semibold text-[10.5px]">COD: ${supAudit.ltCount} LT / ${supAudit.sgtCount} SGT On Duty</span>`;

    let topLiveCountdownsHtml = '';
    if (openPostings.length > 0) {
      topLiveCountdownsHtml = `
        <div class="mt-2.5 pt-2.5 border-t border-blue-500/40 space-y-2">
          ${openPostings.map(p => {
            if (p.category === 'OFFICER') syncAppHireBackBidsIntoPosting(p);
            const sortedBids = sortBidsForPosting(p.bids, p);
            const leader = sortedBids[0];
            const pct = Math.max(0, Math.min(100, Math.round((p.secondsRemaining / p.secondsTotal) * 100)));
            return `
              <div class="p-3 rounded-xl bg-slate-950/95 border-2 ${p.awardRule === 'FCFS' ? 'border-amber-400' : 'border-emerald-400'} space-y-2 shadow-xl">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-md font-mono font-black text-xs ${p.awardRule === 'FCFS' ? 'bg-amber-400 text-slate-950' : 'bg-emerald-400 text-slate-950'}">
                      ⏱️ AUTO-AWARD IN <span id="hbTopTimerText-${p.id}">${p.secondsRemaining}s</span>
                    </span>
                    <span class="font-extrabold text-xs md:text-sm text-white">
                      ${p.id}: Auto-Bidding Open for Unit ${p.targetUnit} (${p.targetDiv}) • ${p.blockType.replace('_', ' ')} (${p.durationHrs})
                    </span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    ${p.blockType === 'FULL_SHIFT' && p.category === 'OFFICER' ? `
                      <button type="button" onclick="splitPostingToPartialsNow('${p.id}')" class="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold cursor-pointer">
                        ✂️ Split to 4h Blocks
                      </button>
                    ` : ''}
                    <button type="button" onclick="toggleHbTimerPause()" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold cursor-pointer">
                      ${eng.timerPaused ? '▶ Resume Timer' : '⏸ Pause Timer'}
                    </button>
                    <button type="button" onclick="expirePostingNow('${p.id}')" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold cursor-pointer shadow">
                      ⏩ Expire &amp; Auto-Populate Now
                    </button>
                  </div>
                </div>

                <div class="hb-timer-bar-bg">
                  <div id="hbTopTimerBar-${p.id}" class="hb-timer-bar-fill" style="width: ${pct}%;"></div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-slate-400 font-semibold text-[11px]">Live Incoming Bids (${sortedBids.length}):</span>
                    ${sortedBids.map((b, idx) => `
                      <span class="px-2 py-0.5 rounded font-mono text-[11px] ${idx === 0 ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 font-extrabold' : 'bg-slate-800 text-slate-300 border border-slate-700'}">
                        ${idx === 0 ? '🏆 LEADER: ' : `#${idx + 1}: `}${b.name} (PE #${b.pe})
                      </span>
                    `).join('')}
                  </div>
                  <span class="text-[11px] text-emerald-300 font-semibold">
                    🤖 No click needed — schedule auto-populates ${leader ? `${leader.name} (#${leader.pe})` : 'winner'} when timer hits 0s!
                  </span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    strip.innerHTML = `
      <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1.5 pr-1">
            <span class="w-2.5 h-2.5 rounded-full ${openCount > 0 ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}"></span>
            <span class="text-xs font-extrabold tracking-tight text-white uppercase">Zero-Touch Hire-Back Engine:</span>
          </div>

          <button type="button" onclick="setHbNoticeMode('ADVANCE_24PLUS')" class="hb-mode-pill ${details.mode === 'ADVANCE_24PLUS' ? 'active-24plus' : 'inactive'}" title="Outside 24 Hours before shift start: Collects bids and auto-awards to highest seniority (lowest PE# with Uniform priority) when window expires">
            <span>🕒 ≥ 24h Notice</span>
            <span class="opacity-80 font-normal">(12s Auto-Bid Pool → Seniority)</span>
          </button>

          <button type="button" onclick="setHbNoticeMode('SHORT_UNDER24')" class="hb-mode-pill ${details.mode === 'SHORT_UNDER24' ? 'active-under24' : 'inactive'}" title="Inside 24 Hours before shift start: Broadcasts via Radio/MDC/App and auto-populates First-Come, First-Served (includes DB & Exempt)">
            <span>⚡ &lt; 24h Short Notice</span>
            <span class="opacity-80 font-normal">(4s Instant FCFS)</span>
          </button>

          <button type="button" onclick="setHbNoticeMode('SHIFT_STARTED')" class="hb-mode-pill ${details.mode === 'SHIFT_STARTED' ? 'active-started' : 'inactive'}" title="Shift already started: FOPLC Art. 24 §4D freezes hire-backs unless Duty Chief authorizes">
            <span>🔒 Shift Started</span>
            <span class="opacity-80 font-normal">(Duty Chief Gate)</span>
          </button>

          ${details.mode === 'SHIFT_STARTED' ? `
            <button type="button" onclick="toggleDutyChiefAuth()" class="px-2.5 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer transition ${eng.dutyChiefAuthorized ? 'bg-emerald-600 text-white' : 'bg-red-600/80 hover:bg-red-500 text-white'}">
              ${eng.dutyChiefAuthorized ? '✓ Duty Chief Authorized' : '🛡️ Authorize via Duty Chief'}
            </button>
          ` : ''}
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs">
          ${codBadge}
          <div class="flex items-center gap-1" title="FOPLC Art. 24 §2B: Minimum 1 Uniform Sergeant per Quadrant (4 total)">
            ${qBadges}
          </div>
          ${standbyCount > 0 ? `
            <span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-400/30 font-mono text-[10px]" title="FOPLC Art. 24 §4B Seniority Standby List">
              📋 Supv Standby: ${standbyCount}
            </span>
          ` : ''}
        </div>
      </div>

      <div class="mt-1.5 pt-1.5 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
        <div>
          <strong class="text-blue-300">${details.contractCite}:</strong>
          <span>${details.ruleSummary}</span>
        </div>
        <div class="flex items-center gap-3 text-[10.5px] text-slate-400 font-mono">
          <span>Sim Clock: <strong class="text-slate-200">${details.simClockNote}</strong></span>
        </div>
      </div>

      ${topLiveCountdownsHtml}
    `;
  }

  function renderEnhancedCommandRows() {
    const tbody = document.getElementById('paperCommandBody');
    if (!tbody || !app.command || !app.command.NW) return;

    const eng = ensureEngineState();
    const cmdLen = app.selectedBureau === 'DB' ? (app.selectedShift === 'C' ? 2 : 12) : 8;
    let html = '';

    for (let i = 0; i < cmdLen; i++) {
      html += '<tr>';
      DIV_KEYS.forEach((div, dIdx) => {
        const cell = app.command[div][i] || { unit: '', name: '', pe: null, assign: '' };
        const sepCls = dIdx < 3 ? 'div-sep-right' : '';
        const markedOffSup = eng.commandOffRoster.find(c => c.div === div && c.rowIdx === i);

        if (cell.name && cell.pe !== null) {
          const isActingCod = Boolean(cell.isAutoActingCod);
          const isHb = Boolean(cell.isHireBack);
          const rowCls = isActingCod
            ? 'row-acting-cod'
            : isHb
              ? 'row-hireback-awarded'
              : (cell.highlight ? 'bg-amber-300/80 text-slate-950 font-bold' : '');

          const caretBtn = `<button type="button" onclick="openCommandActionPopover(event, '${div}', ${i})" class="caret-btn" title="FOPLC Supervisor Actions for ${cell.name} (#${cell.pe})">▾</button>`;

          const nameHtml = `
            <div class="flex items-center justify-between gap-1">
              <div class="truncate">
                <span class="${cell.bold || isActingCod || isHb ? 'font-bold' : 'font-medium'}">${cell.name}</span>
                <span class="font-mono text-[10px] text-[var(--text-muted)]">(${cell.pe})</span>
              </div>
              ${caretBtn}
            </div>
          `;

          const assignBadgeCls = isActingCod
            ? 'bg-amber-400 text-slate-950 border border-amber-600'
            : isHb
              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
              : cell.highlight
                ? 'bg-amber-400 text-slate-950 border border-amber-600'
                : 'bg-blue-500/15 text-blue-600 dark:text-blue-300';

          const assignHtml = cell.assign
            ? `<span class="px-1.5 py-0.2 rounded ${assignBadgeCls} font-mono font-bold text-[10px]">${cell.assign}</span>`
            : '';

          html += `
            <td class="unit-cell ${rowCls}">${cell.unit || ''}</td>
            <td class="${rowCls}">${nameHtml}</td>
            <td class="text-center ${rowCls} ${sepCls}">${assignHtml}</td>
          `;
        } else if (markedOffSup) {
          html += `
            <td class="unit-cell font-bold text-red-600 dark:text-red-400">${markedOffSup.unit}</td>
            <td class="row-cmd-off">
              <div class="flex items-center justify-between gap-1">
                <span class="truncate text-[10.5px] font-bold">OFF: ${markedOffSup.name} (${markedOffSup.pe})</span>
                <button type="button" onclick="restoreSupervisorToDuty(${markedOffSup.pe})" class="px-1.5 py-0.2 rounded bg-emerald-600 text-white text-[9.5px] font-bold cursor-pointer" title="Return Supervisor to Duty">↩ Restore</button>
              </div>
            </td>
            <td class="text-center row-cmd-off ${sepCls}">
              <span class="px-1 py-0.2 rounded bg-red-500/20 text-red-600 dark:text-red-300 font-mono font-bold text-[9.5px]">SICK/OFF</span>
            </td>
          `;
        } else {
          html += `
            <td class="unit-cell">${cell.unit || ''}</td>
            <td></td>
            <td class="text-center ${sepCls}"></td>
          `;
        }
      });
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function renderEnhancedHireBackCard() {
    const hbBadge = document.getElementById('hireBackCountBadge');
    const hbBox = document.getElementById('hireBackActionBox');
    if (!hbBadge || !hbBox) return;

    const eng = ensureEngineState();
    const count = getShiftCount();
    const min = app.shiftMin;
    const supAudit = auditSupervisorMinimums();
    const openPostings = eng.openPostings;
    const recentClosed = eng.closedNotifications.slice(0, 2);
    const optInCount = Array.isArray(app.hireBackOptInPes) ? app.hireBackOptInPes.length : 12;

    if (openPostings.length > 0) {
      hbBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-300 animate-pulse';
      hbBadge.textContent = `⏱️ ${openPostings.length} Auto-Bidding`;
    } else if (count < min || supAudit.needsSupervisorHireBack) {
      hbBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-600 dark:text-red-300';
      hbBadge.textContent = `Shortage Detected`;
    } else {
      hbBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300';
      hbBadge.textContent = `Count OK (${count}/${min})`;
    }

    let html = '<div class="space-y-2 mt-1">';

    for (const p of openPostings) {
      if (p.category === 'OFFICER') syncAppHireBackBidsIntoPosting(p);
      const sortedBids = sortBidsForPosting(p.bids, p);
      const pct = Math.max(0, Math.min(100, Math.round((p.secondsRemaining / p.secondsTotal) * 100)));

      html += `
        <div class="p-2.5 rounded-xl bg-slate-900 text-slate-100 border ${p.awardRule === 'FCFS' ? 'border-amber-500/60' : 'border-blue-500/60'} space-y-2 shadow-md">
          <div class="flex items-center justify-between gap-1">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold ${p.awardRule === 'FCFS' ? 'bg-amber-400 text-slate-950' : 'bg-blue-600 text-white'}">
              ${p.id} • ${p.awardRule === 'FCFS' ? '⚡ <24h FCFS' : '🕒 ≥24h SENIORITY'}
            </span>
            <span class="font-mono text-[11px] font-extrabold text-emerald-300">
              Auto-Award in <span id="hbTimerText-${p.id}">${p.secondsRemaining}s</span>
            </span>
          </div>

          <div class="hb-timer-bar-bg">
            <div id="hbTimerBar-${p.id}" class="hb-timer-bar-fill" style="width: ${pct}%;"></div>
          </div>

          <div class="p-2 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1">
            <div class="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
              <span>Live Incoming Officer Bids (${sortedBids.length}):</span>
              <span>Auto-populates at 0s</span>
            </div>
            ${sortedBids.map((b, idx) => `
              <div class="flex items-center justify-between text-[10.5px] font-mono px-1.5 py-0.5 rounded ${idx === 0 ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'text-slate-400'}">
                <span>${idx === 0 ? '🏆 LEADER: ' : `#${idx + 1} Standby: `}${b.name} (PE #${b.pe})</span>
                <span class="text-[9.5px]">${b.badgeLabel}</span>
              </div>
            `).join('')}
          </div>

          <div class="flex items-center gap-1.5 pt-0.5">
            <button type="button" onclick="expirePostingNow('${p.id}')" class="flex-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold cursor-pointer shadow">
              ⏩ Expire &amp; Auto-Award Winner Now
            </button>
            <button type="button" onclick="toggleHbTimerPause()" class="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10.5px] font-bold cursor-pointer">
              ${eng.timerPaused ? '▶' : '⏸'}
            </button>
          </div>
        </div>
      `;
    }

    if (recentClosed.length > 0) {
      for (const n of recentClosed) {
        html += `
          <div class="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-[11px] space-y-1">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-emerald-600 dark:text-emerald-300">
                ✅ ${n.id} Auto-Populated → ${n.winnerName} (#${n.winnerPe}) in ${n.unit} (${n.div})
              </span>
              <span class="font-mono text-[10px] text-[var(--text-muted)]">${n.closedAt}</span>
            </div>
            <div class="text-[10px] text-[var(--text-muted)]">${n.whyWon}</div>
            <div class="pt-1 border-t border-emerald-500/20 space-y-0.5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                📢 Automated Notifications Sent to All ${n.totalBids} Bidder(s):
              </div>
              ${n.bidderReceipts.map(r => `
                <div class="flex items-center justify-between text-[10px] font-mono">
                  <span class="${r.outcome === 'AWARDED' ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'text-[var(--text-muted)]'}">
                    • ${r.name} (#${r.pe})
                  </span>
                  <span class="px-1.5 py-0.2 rounded ${r.outcome === 'AWARDED' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold' : 'bg-slate-500/15 text-[var(--text-muted)]'}">
                    ${r.outcome}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    // Always include Luke's PR #3 Searchable Cross-Shift Opt-In & Bidding Database button!
    html += `
      <button type="button" onclick="openHireBackPopover(event)" class="w-full px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition cursor-pointer flex items-center justify-between">
        <span>🔍 View All Bids &amp; Opt-In Database (${optInCount} Opted-In)</span>
        <span>▾</span>
      </button>
    `;

    html += '</div>';
    hbBox.innerHTML = html;
  }

  function appendMobileAppHireBackCenter() {
    const container = document.getElementById('mobileAppBody');
    if (!container) return;
    const existing = document.getElementById('mobileHbLiveCenter');
    if (existing) existing.remove();

    const eng = ensureEngineState();
    const details = getNoticeModeDetails();
    const openPostings = eng.openPostings;
    const recentClosed = eng.closedNotifications.slice(0, 2);
    const activePe = app.loggedInPe === 'COD' ? 1883 : app.loggedInPe;
    const markedOffSelf = didMemberMarkOffCurrentShift(activePe);

    const section = document.createElement('div');
    section.id = 'mobileHbLiveCenter';
    section.className = 'pt-2 border-t border-slate-800 space-y-2.5';

    let html = `
      <div class="flex items-center justify-between px-1">
        <span class="text-[10px] font-bold uppercase tracking-wider text-amber-300">
          🔔 Zero-Touch Hire-Back Alerts (${details.mode === 'ADVANCE_24PLUS' ? '≥24h Seniority' : '<24h FCFS'})
        </span>
        <span class="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9.5px]">
          Auto-Award
        </span>
      </div>
    `;

    for (const p of openPostings) {
      if (p.category === 'OFFICER') syncAppHireBackBidsIntoPosting(p);
      const sortedBids = sortBidsForPosting(p.bids, p);
      const leader = sortedBids[0];

      html += `
        <div class="p-3 rounded-2xl bg-amber-500/15 border-2 border-amber-400 space-y-2">
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-extrabold text-[10px]">
              🚨 ${p.id}: ${p.targetUnit} (${p.targetDiv}) • ${p.durationHrs}
            </span>
            <span class="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-mono text-[11px] font-black">
              ⏱️ <span id="hbMobTimerText-${p.id}">${p.secondsRemaining}s</span>
            </span>
          </div>
          <div class="text-[10.5px] text-slate-200">
            <strong>Auto-Award Rule:</strong> ${p.awardRule === 'FCFS' ? 'Instant First-Come, First-Served (<24h)' : 'Seniority Bid Pool (≥24h — Lowest PE# Wins at 0s)'}
          </div>
          ${leader ? `
            <div class="text-[10px] font-mono text-emerald-300 bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
              🏆 Current Leader: ${leader.name} (#${leader.pe}) • ${sortedBids.length} Bid(s)
            </div>
          ` : ''}

          ${markedOffSelf ? `
            <div class="w-full p-2 rounded-xl bg-red-950/80 border border-red-500/40 text-red-300 text-[10px] font-bold text-center">
              🚫 You Marked Off This Shift — Blocked per PBA Art. 35 §4
            </div>
          ` : ''}
        </div>
      `;
    }

    for (const n of recentClosed) {
      html += `
        <div class="p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-extrabold text-emerald-300">📢 AUTO-AWARD NOTIFICATION SENT</span>
            <span class="font-mono text-[9.5px] text-slate-400">${n.id}</span>
          </div>
          <div class="text-[11px] font-bold text-white">
            Awarded: ${n.winnerName} (#${n.winnerPe}) → Unit ${n.unit} (${n.div})
          </div>
          <div class="text-[10px] text-emerald-200">${n.whyWon}</div>
        </div>
      `;
    }

    html += `
      <button onclick="triggerCShiftTrainingLeave('${findOfficerByPe(activePe)?.div || 'NW'}', '${findOfficerByPe(activePe)?.unit || 'A152'}')" class="w-full p-2.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900/70 border border-indigo-500/40 flex items-center justify-between text-left transition cursor-pointer">
        <div>
          <div class="font-bold text-indigo-200 text-[11px]">🎓 Morning In-Service Training (Art. 34 §7)</div>
          <div class="text-[9.5px] text-slate-400">Takes Last 4h off &amp; triggers Last-4h-Only Hire-Back (Art. 35 §2)</div>
        </div>
        <span class="text-xs text-indigo-300 font-bold">→</span>
      </button>
    `;

    section.innerHTML = html;
    if (openPostings.length > 0 || recentClosed.length > 0) {
      container.insertBefore(section, container.firstChild);
    } else {
      container.appendChild(section);
    }
  }

  // ===========================================================================
  // 14. HOOK INTO CORE APPLICATION FUNCTIONS
  // ===========================================================================
  function hookHireBackEngine() {
    if (!ensureEngineState()) return;

    const origExecuteLeave = window.executeApprovedLeaveMove;
    if (typeof origExecuteLeave === 'function') {
      window.executeApprovedLeaveMove = function (div, unit, leaveConfig) {
        const row = (app.officers[div] || []).find(r => r.unit === unit);
        const offName = row ? row.name : 'Officer';
        const offPe = row ? row.pe : null;
        const homeUnit = row && row.floatedFrom ? row.floatedFrom.unit : unit;
        const homeDiv = row && row.floatedFrom ? row.floatedFrom.div : div;

        origExecuteLeave.apply(this, arguments);

        checkAndCreatePostingsForCurrentShortages({
          div: homeDiv,
          unit: homeUnit,
          name: offName,
          pe: offPe,
          reason: `${offName} (#${offPe}) marked ${leaveConfig ? leaveConfig.shortCode : 'OFF'} in ${homeUnit} (${homeDiv})`
        });

        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origRestoreOfficer = window.restoreOfficerFromDayOff;
    if (typeof origRestoreOfficer === 'function') {
      window.restoreOfficerFromDayOff = function (div, homeUnit) {
        origRestoreOfficer.apply(this, arguments);
        checkAndCreatePostingsForCurrentShortages();
        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origReturnStatic = window.returnStaticOfficerToWork;
    if (typeof origReturnStatic === 'function') {
      window.returnStaticOfficerToWork = function (categoryKey, div, idx, pe) {
        origReturnStatic.apply(this, arguments);
        checkAndCreatePostingsForCurrentShortages();
        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origRemoveHb = window.removeHireBackOfficer;
    if (typeof origRemoveHb === 'function') {
      window.removeHireBackOfficer = function (div, unit) {
        origRemoveHb.apply(this, arguments);
        checkAndCreatePostingsForCurrentShortages({
          div,
          unit,
          name: 'Hire-Back Removed',
          reason: `Hire-Back removed from Unit ${unit} (${div})`
        });
        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origSubmitHbBid = window.submitHireBackBid;
    if (typeof origSubmitHbBid === 'function') {
      window.submitHireBackBid = function (pe, keepOpen) {
        origSubmitHbBid.apply(this, arguments);
        const eng = ensureEngineState();
        if (eng) {
          for (const p of eng.openPostings) {
            if (p.category === 'OFFICER') {
              syncAppHireBackBidsIntoPosting(p);
            }
          }
        }
        renderControlStrip();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origSetNoticeMode = window.setHireBackNoticeMode;
    if (typeof origSetNoticeMode === 'function') {
      window.setHireBackNoticeMode = function (mode) {
        origSetNoticeMode.apply(this, arguments);
        const mapped = mode === 'FCFS_UNDER_24HR' ? 'SHORT_UNDER24' : 'ADVANCE_24PLUS';
        window.setHbNoticeMode(mapped);
      };
    }

    const origChangeMin = window.changeMinimum;
    if (typeof origChangeMin === 'function') {
      window.changeMinimum = function (delta) {
        origChangeMin.apply(this, arguments);
        checkAndCreatePostingsForCurrentShortages({
          div: 'NW',
          unit: 'OPEN',
          name: 'Minimum Count Adjusted',
          reason: `Shift Minimum adjusted to ${app.shiftMin} (Current Count: ${getShiftCount()})`
        });
        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    const origOpenPopover = window.openOfficerActionPopover;
    if (typeof origOpenPopover === 'function') {
      window.openOfficerActionPopover = function (event, mode, div, unit) {
        origOpenPopover.apply(this, arguments);
        if (mode === 'ON_DUTY') {
          const content = document.getElementById('floatingMenuContent');
          if (content && !content.innerHTML.includes('triggerCShiftTrainingLeave')) {
            const extraBtn = document.createElement('div');
            extraBtn.className = 'pt-1 border-t border-[var(--border-grid)]';
            extraBtn.innerHTML = `
              <button onclick="triggerCShiftTrainingLeave('${div}', '${unit}')" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-indigo-500/15 flex items-center justify-between cursor-pointer font-semibold text-indigo-600 dark:text-indigo-300">
                <span>🎓 In-Service Training (Last 4h)</span>
                <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/15">Art. 34 §7</span>
              </button>
            `;
            content.appendChild(extraBtn);
          }
        }
      };
    }

    const origLoadShift = window.loadActiveDateAndShift;
    if (typeof origLoadShift === 'function') {
      window.loadActiveDateAndShift = function () {
        const eng = ensureEngineState();
        if (eng) {
          eng.openPostings = [];
          eng.commandOffRoster = [];
          eng.supervisorStandbyList = [];
          eng.actingCodInfo = null;
        }
        origLoadShift.apply(this, arguments);
      };
    }

    const origRenderAll = window.renderAll;
    if (typeof origRenderAll === 'function') {
      window.renderAll = function () {
        auditSupervisorMinimums();
        origRenderAll.apply(this, arguments);
        renderControlStrip();
        renderEnhancedCommandRows();
        renderEnhancedHireBackCard();
        appendMobileAppHireBackCenter();
      };
    }

    // Also run after persistence-print-export finishes restoring any saved state!
    setTimeout(() => {
      checkAndCreatePostingsForCurrentShortages();
      renderControlStrip();
      renderEnhancedCommandRows();
      renderEnhancedHireBackCard();
      appendMobileAppHireBackCenter();
      ensureTimerRunning();
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookHireBackEngine);
  } else {
    hookHireBackEngine();
  }
})();
