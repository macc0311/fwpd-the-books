/**
 * FWPD "The Books" — Persistence, Roll-Call Print & Backup/Export Add-on Module
 * Designed as a zero-conflict drop-in module for macc0311/fwpd-the-books.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fwpd_the_books_state_v3_0_unified';
  const SCHEMA_VERSION = '3.0.0';
  let isRestoring = false;
  let lastSavedTimeStr = 'Just now';
  const MAX_UNDO_STEPS = 20;
  let undoStack = [];
  let lastCommittedSnapshot = null;
  let lastCommittedFingerprint = null;
  let updatedFlashTimer = null;

  // =========================================================================
  // 1. STATE SNAPSHOT, UNDO HISTORY & SILENT PERSISTENCE ENGINE
  // =========================================================================
  function getFloatScopeValue() {
    const el = document.getElementById('floatScopeSelect');
    return el ? el.value : 'citywide';
  }

  function setFloatScopeValue(val) {
    const el = document.getElementById('floatScopeSelect');
    if (el && (val === 'citywide' || val === 'quadrant')) {
      el.value = val;
    }
  }

  function serializeState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      selectedBureau: app.selectedBureau || 'OPS',
      selectedDate: app.selectedDate || '2026-11-15',
      selectedShift: app.selectedShift || 'A',
      activeScheduleId: app.activeScheduleId || 'A_11_15',
      scheduleDate: app.selectedDate || '2026-11-15',
      shift: `${app.selectedShift || 'A'}-SHIFT`,
      shiftMin: app.shiftMin,
      loggedInPe: app.loggedInPe,
      viewMode: app.viewMode,
      darkMode: Boolean(app.darkMode),
      floatScope: getFloatScopeValue(),
      command: app.command,
      officers: app.officers,
      dayOffRoster: app.dayOffRoster,
      offTimeSheet: app.offTimeSheet || null,
      hireBackOptInPes: Array.isArray(app.hireBackOptInPes) ? app.hireBackOptInPes : null,
      hireBackNoticeMode: app.hireBackNoticeMode || 'SENIORITY_24HR',
      hireBackBids: Array.isArray(app.hireBackBids) ? app.hireBackBids : [],
      hireBackBidCounter: app.hireBackBidCounter || 1,
      hireBackLastWinnerNotification: app.hireBackLastWinnerNotification || null,
      shiftNotices: Array.isArray(app.shiftNotices) ? app.shiftNotices : [],
      floatedMoves: app.floatedMoves,
      auditEntries: app.auditEntries,
      savedHistory: app.savedHistory || {},
      hbEngine: app.hbEngine || null
    };
  }

  function getScheduleFingerprint(payload) {
    return JSON.stringify({
      selectedBureau: payload.selectedBureau,
      selectedDate: payload.selectedDate,
      selectedShift: payload.selectedShift,
      shiftMin: payload.shiftMin,
      floatScope: payload.floatScope,
      command: payload.command,
      officers: payload.officers,
      dayOffRoster: payload.dayOffRoster,
      offTimeSheet: payload.offTimeSheet,
      hireBackOptInPes: payload.hireBackOptInPes,
      hireBackNoticeMode: payload.hireBackNoticeMode,
      hireBackBids: payload.hireBackBids,
      shiftNotices: payload.shiftNotices,
      floatedMoves: payload.floatedMoves,
      auditEntries: payload.auditEntries,
      hbEngine: payload.hbEngine
    });
  }

  function resetUndoBaseline(payload) {
    const snap = payload ? JSON.parse(JSON.stringify(payload)) : JSON.parse(JSON.stringify(serializeState()));
    undoStack = [];
    lastCommittedSnapshot = snap;
    lastCommittedFingerprint = getScheduleFingerprint(snap);
    updateUndoControl('idle');
  }

  function saveStateToStorage(options) {
    if (isRestoring) return;
    const silentUndo = options && typeof options === 'object' && options.skipUndo === true;
    const payload = serializeState();
    const clonedPayload = JSON.parse(JSON.stringify(payload));
    const fp = getScheduleFingerprint(clonedPayload);

    if (!silentUndo) {
      if (lastCommittedSnapshot === null) {
        lastCommittedSnapshot = clonedPayload;
        lastCommittedFingerprint = fp;
      } else if (fp !== lastCommittedFingerprint) {
        undoStack.push(lastCommittedSnapshot);
        if (undoStack.length > MAX_UNDO_STEPS) {
          undoStack.shift();
        }
        lastCommittedSnapshot = clonedPayload;
        lastCommittedFingerprint = fp;
        updateUndoControl('updated');
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      lastSavedTimeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (err) {
      // Silently ignore when running in sandboxed previews or restricted storage contexts
    }
  }

  function applyStatePayload(data) {
    if (!data || typeof data !== 'object' || !data.officers || !data.command) {
      return false;
    }

    isRestoring = true;
    try {
      if (data.selectedBureau === 'OPS' || data.selectedBureau === 'DB') {
        app.selectedBureau = data.selectedBureau;
      }
      if (typeof data.selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.selectedDate)) {
        app.selectedDate = data.selectedDate;
        const dateEl = document.getElementById('scheduleDateInput');
        if (dateEl) dateEl.value = app.selectedDate;
      }
      if (data.selectedShift === 'A' || data.selectedShift === 'B' || data.selectedShift === 'C') {
        app.selectedShift = data.selectedShift;
      }
      if (typeof data.activeScheduleId === 'string') {
        app.activeScheduleId = data.activeScheduleId;
      }
      if (data.savedHistory && typeof data.savedHistory === 'object') {
        app.savedHistory = JSON.parse(JSON.stringify(data.savedHistory));
      }
      if (Array.isArray(data.shiftNotices)) {
        app.shiftNotices = JSON.parse(JSON.stringify(data.shiftNotices));
      }
      if (data.hbEngine && typeof data.hbEngine === 'object') {
        app.hbEngine = JSON.parse(JSON.stringify(data.hbEngine));
      }
      if (typeof data.shiftMin === 'number') {
        app.shiftMin = Math.max(1, data.shiftMin);
      }
      if (data.loggedInPe !== undefined) {
        app.loggedInPe = data.loggedInPe === 'COD' ? 'COD' : parseInt(data.loggedInPe, 10) || 1883;
      }
      if (data.viewMode === 'split' || data.viewMode === 'sheet') {
        app.viewMode = data.viewMode;
      }
      app.darkMode = Boolean(data.darkMode);

      app.command = JSON.parse(JSON.stringify(data.command));
      app.officers = JSON.parse(JSON.stringify(data.officers));
      app.dayOffRoster = data.dayOffRoster
        ? JSON.parse(JSON.stringify(data.dayOffRoster))
        : { NW: [], NE: [], SW: [], SE: [] };
      if (data.offTimeSheet && typeof data.offTimeSheet === 'object') {
        app.offTimeSheet = JSON.parse(JSON.stringify(data.offTimeSheet));
      }
      if (Array.isArray(data.hireBackOptInPes)) {
        app.hireBackOptInPes = [...data.hireBackOptInPes];
      }
      if (typeof data.hireBackNoticeMode === 'string') {
        app.hireBackNoticeMode = data.hireBackNoticeMode;
      }
      if (Array.isArray(data.hireBackBids)) {
        app.hireBackBids = JSON.parse(JSON.stringify(data.hireBackBids));
      }
      if (typeof data.hireBackBidCounter === 'number') {
        app.hireBackBidCounter = data.hireBackBidCounter;
      }
      if (data.hireBackLastWinnerNotification !== undefined) {
        app.hireBackLastWinnerNotification = data.hireBackLastWinnerNotification
          ? JSON.parse(JSON.stringify(data.hireBackLastWinnerNotification))
          : null;
      }
      app.floatedMoves = Array.isArray(data.floatedMoves)
        ? JSON.parse(JSON.stringify(data.floatedMoves))
        : [];
      app.auditEntries = Array.isArray(data.auditEntries)
        ? JSON.parse(JSON.stringify(data.auditEntries))
        : [];

      // Sync DOM controls
      setFloatScopeValue(data.floatScope || 'citywide');

      if (typeof window.populateUserSelect === 'function') {
        window.populateUserSelect();
      }
      const userSel = document.getElementById('loggedInUserSelect');
      if (userSel) {
        userSel.value = String(app.loggedInPe);
      }

      document.body.classList.toggle('dark-mode', app.darkMode);
      const themeBtn = document.getElementById('themeToggleBtn');
      if (themeBtn) {
        themeBtn.textContent = app.darkMode ? '☀️' : '🌙';
        themeBtn.title = app.darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      }

      if (typeof window.setViewMode === 'function') {
        window.setViewMode(app.viewMode);
      }

      if (typeof window.renderAll === 'function') {
        window.renderAll();
      }
    } finally {
      isRestoring = false;
    }
    return true;
  }

  function restoreStateFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const ok = applyStatePayload(parsed);
      if (ok) {
        const savedTime = parsed.savedAt
          ? new Date(parsed.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : 'earlier session';
        lastSavedTimeStr = savedTime;
        resetUndoBaseline();
      }
      return ok;
    } catch (err) {
      return false;
    }
  }

  function updateUndoControl(mode) {
    const btn = document.getElementById('undoLastActionBtn');
    if (!btn) return;

    if (updatedFlashTimer) {
      clearTimeout(updatedFlashTimer);
      updatedFlashTimer = null;
    }

    const count = undoStack.length;
    if (count === 0) {
      if (mode === 'undone') {
        btn.className = 'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 transition select-none cursor-default';
        btn.disabled = true;
        btn.textContent = '↺ Undone';
        btn.title = 'Reverted to initial state';
        updatedFlashTimer = setTimeout(() => {
          btn.classList.add('hidden');
        }, 1600);
      } else {
        btn.classList.add('hidden');
        btn.disabled = true;
      }
      return;
    }

    btn.disabled = false;
    const stepLabel = count === 1 ? '1 step' : `${count} steps`;

    if (mode === 'updated') {
      btn.className = 'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 transition cursor-pointer inline-flex items-center gap-1.5';
      btn.innerHTML = '<span>✓ Updated</span><span class="opacity-40">·</span><span class="underline underline-offset-2">↺ Undo</span>';
      btn.title = `Schedule updated — click to undo last action (${stepLabel} available • Ctrl+Z)`;
      updatedFlashTimer = setTimeout(() => {
        updateUndoControl('idle');
      }, 4500);
    } else if (mode === 'undone') {
      btn.className = 'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 border border-blue-400/40 transition cursor-pointer inline-flex items-center gap-1.5';
      btn.innerHTML = '<span>↺ Undone</span><span class="opacity-40">·</span><span class="underline underline-offset-2">Undo Again</span>';
      btn.title = `Reverted last action (${stepLabel} remaining • Ctrl+Z)`;
      updatedFlashTimer = setTimeout(() => {
        updateUndoControl('idle');
      }, 2200);
    } else {
      btn.className = 'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer inline-flex items-center gap-1';
      btn.textContent = '↺ Undo';
      btn.title = `Undo last action (${stepLabel} available • Ctrl+Z)`;
    }
  }

  function undoLastAction() {
    if (undoStack.length === 0) return;
    const prevSnapshot = undoStack.pop();
    if (!prevSnapshot) return;

    const ok = applyStatePayload(prevSnapshot);
    if (ok) {
      lastCommittedSnapshot = JSON.parse(JSON.stringify(prevSnapshot));
      lastCommittedFingerprint = getScheduleFingerprint(lastCommittedSnapshot);
      saveStateToStorage({ skipUndo: true });
      updateUndoControl('undone');
    }
  }
  window.undoLastAction = undoLastAction;

  // =========================================================================
  // 2. ROLL-CALL PRINT SHEET ENGINE (Single-Page US Letter Landscape)
  // =========================================================================
  function ensurePrintFooterExists() {
    let footer = document.getElementById('printRollCallFooter');
    if (footer) return footer;

    const sheetCard = document.querySelector('.books-sheet-card');
    if (!sheetCard) return null;

    footer = document.createElement('div');
    footer.id = 'printRollCallFooter';
    footer.className = 'print-only-footer';
    sheetCard.appendChild(footer);
    return footer;
  }

  function ensurePrintPreviewToolbarExists() {
    let toolbar = document.getElementById('rollCallPrintPreviewToolbar');
    if (toolbar) return toolbar;

    toolbar = document.createElement('div');
    toolbar.id = 'rollCallPrintPreviewToolbar';
    toolbar.className = 'print-preview-toolbar';
    toolbar.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider">
          🖨️ Roll-Call Print Preview
        </span>
        <div class="text-xs text-slate-300">
          <strong class="text-white">Single-Page US Letter Landscape</strong> • Command + Patrol Roster + Day-Off + District/Float Summary
          <span id="printIframeNotice" class="ml-2 text-amber-300 text-[11px]"></span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" id="previewSystemPrintBtn" class="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer shadow">
          🖨️ System Print Dialog (Ctrl+P)
        </button>
        <button type="button" id="previewDownloadPrintableBtn" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer shadow" title="Downloads a standalone 1-page printable Roll-Call HTML file that auto-opens your browser print dialog">
          ⬇️ Download Printable Roll-Call Sheet (.html)
        </button>
        <button type="button" id="previewExitBtn" class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold text-xs cursor-pointer">
          ✕ Exit Preview (Esc)
        </button>
      </div>
    `;
    document.body.insertBefore(toolbar, document.body.firstChild);

    document.getElementById('previewSystemPrintBtn').addEventListener('click', invokeBrowserPrintWithFallback);
    document.getElementById('previewDownloadPrintableBtn').addEventListener('click', downloadPrintableRollCallHtml);
    document.getElementById('previewExitBtn').addEventListener('click', exitRollCallPrintPreview);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('rollcall-print-preview')) {
        exitRollCallPrintPreview();
      }
    });

    return toolbar;
  }

  function updatePrintFooter() {
    const footer = ensurePrintFooterExists();
    if (!footer) return;

    const distCounts = typeof window.getDistrictCounts === 'function' ? window.getDistrictCounts() : {};
    const count = typeof window.getShiftCount === 'function' ? window.getShiftCount() : 32;
    const min = app.shiftMin;
    const allDists = ['A', 'B', 'C', 'E', 'F', 'G', 'I', 'J', 'K', 'L', 'D', 'M', 'N', 'O'];

    const distSummaryHtml = allDists
      .map(d => {
        const c = distCounts[d] || 0;
        const flag = c === 0 ? ' [0!]' : c === 1 ? ' [1]' : '';
        return `<span style="padding:1px 4px;border:1px solid #94a3b8;border-radius:3px;font-family:monospace;background:${c === 0 ? '#fee2e2' : c === 1 ? '#fef3c7' : '#f1f5f9'};"><strong>${d}:</strong> ${c}${flag}</span>`;
      })
      .join(' ');

    const floats = Array.isArray(app.floatedMoves) ? app.floatedMoves : [];
    const floatSummaryText = floats.length > 0
      ? floats.map(m => `${m.name} (#${m.pe}): ${m.fromUnit} [${m.fromDiv}] → ${m.toUnit} [${m.toDiv}] (Dist ${m.district})`).join('  •  ')
      : 'None — All On-Duty Patrol Officers Assigned to Home Cars';

    const scopeLabel = getFloatScopeValue() === 'quadrant'
      ? 'Same Quadrant First (PE#)'
      : 'Citywide Inverse PE# (Art. 37 §5)';

    const printedAt = new Date().toLocaleString([], {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    footer.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <strong style="text-transform:uppercase;letter-spacing:0.04em;">District Coverage (A–O):</strong>
          ${distSummaryHtml}
        </div>
        <div style="font-family:monospace;font-weight:700;">
          Count: ${count} / Min: ${min} (${count < min ? `BELOW MIN — ${min - count} HIRE-BACK NEEDED` : count === min ? 'AT MINIMUM' : `+${count - min} ABOVE MIN`})
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px dashed #cbd5e1;padding-top:2px;">
        <div>
          <strong style="text-transform:uppercase;letter-spacing:0.04em;">Active Float Reassignments (${scopeLabel}):</strong>
          <span style="font-family:monospace;">${floatSummaryText}</span>
        </div>
        <div style="white-space:nowrap;font-family:monospace;">
          <strong>Legend:</strong> <u><strong>Bold/Underlined Unit</strong></u> = Union Bid Car (Locked) • <strong>88</strong> = Off-Duty • <strong>87</strong> = On-Duty • Printed: ${printedAt} • COD/Supv: ______________________
        </div>
      </div>
    `;
  }

  function invokeBrowserPrintWithFallback() {
    const t0 = Date.now();
    let printThrew = false;
    try {
      window.print();
    } catch (err) {
      printThrew = true;
    }
    const elapsed = Date.now() - t0;
    const inIframe = (function () {
      try { return window.self !== window.top; } catch (e) { return true; }
    })();

    // In sandboxed preview iframes, Chromium silently ignores window.print() in < 15ms.
    if (printThrew || (inIframe && elapsed < 50)) {
      const noticeEl = document.getElementById('printIframeNotice');
      if (noticeEl) {
        noticeEl.textContent = '(Embedded preview sandbox blocks native print dialogs — click "⬇️ Download Printable Roll-Call Sheet" or open on GitHub Pages to print)';
      }
    }
  }

  function triggerRollCallPrint() {
    closeBackupDropdown();
    if (typeof window.closeActionPopover === 'function') {
      window.closeActionPopover();
    }
    ensurePrintPreviewToolbarExists();
    updatePrintFooter();
    document.body.classList.add('rollcall-print-preview');
    window.scrollTo(0, 0);

    // Give the browser a frame to paint the 1-page Roll-Call Print Preview, then invoke window.print()
    setTimeout(function () {
      invokeBrowserPrintWithFallback();
    }, 80);
  }

  function exitRollCallPrintPreview() {
    document.body.classList.remove('rollcall-print-preview');
    const noticeEl = document.getElementById('printIframeNotice');
    if (noticeEl) noticeEl.textContent = '';
  }

  function downloadPrintableRollCallHtml() {
    updatePrintFooter();
    const sheetCard = document.querySelector('.books-sheet-card');
    if (!sheetCard) return;

    const styles = Array.from(document.querySelectorAll('style'))
      .map(s => s.outerHTML)
      .join('\n');

    let printCss = '';
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href && sheet.href.includes('print-rollcall.css')) {
          printCss = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        }
      }
    } catch (e) {}

    const cloneCard = sheetCard.cloneNode(true);
    cloneCard.querySelectorAll('.caret-btn').forEach(b => b.remove());
    const minBanner = cloneCard.querySelector('#sheetMinBanner');
    if (minBanner && minBanner.nextElementSibling) {
      minBanner.nextElementSibling.remove();
    }

    const shiftTag = `${app.selectedBureau === 'DB' ? 'DB-' : ''}${app.selectedShift || 'A'}-Shift`;
    const fileShiftSlug = shiftTag.toLowerCase();
    const dateLabel = app.selectedDate || new Date().toISOString().slice(0, 10);

    const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FWPD ${shiftTag} Roll-Call Worksheet — ${dateLabel}</title>
  ${styles}
  <style>
    ${printCss}
    body { padding: 16px !important; background: #ffffff !important; color: #0f172a !important; }
    .print-only-footer { display: flex !important; flex-direction: column; gap: 4px; padding: 6px 8px; border-top: 1.5px solid #0f172a; background: #f8fafc; font-size: 9px; }
    .books-sheet-card > div:nth-child(3) { display: none !important; }
    .row-logged-in { background: transparent !important; box-shadow: none !important; }
  </style>
</head>
<body class="rollcall-print-preview" style="padding:12px !important;background:#fff !important;">
  ${cloneCard.outerHTML}
  <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 200); });<\/script>
</body>
</html>`;

    downloadFile(`fwpd-rollcall-sheet-${fileShiftSlug}-${dateLabel}.html`, htmlDoc, 'text/html;charset=utf-8');
  }

  // =========================================================================
  // 3. JSON & CSV EXPORT / IMPORT TOOLS
  // =========================================================================
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportScheduleJson() {
    closeBackupDropdown();
    const payload = serializeState();
    const jsonStr = JSON.stringify(payload, null, 2);
    const fileShiftSlug = `${app.selectedBureau === 'DB' ? 'db-' : ''}${(app.selectedShift || 'A').toLowerCase()}-shift`;
    const dateLabel = app.selectedDate || new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-the-books-${fileShiftSlug}-${dateLabel}.json`, jsonStr, 'application/json;charset=utf-8');

    app.toastData = {
      status: 'approved',
      title: 'Exported Complete Schedule Backup (.json)',
      step1: 'Saved full schedule snapshot including Command rows, Patrol Officers, Day-Off Roster, Active Floats, and Audit Trail.',
      step2: 'Use "📂 Import Schedule Backup (.json)" under Backup / Export at any time to restore this exact state.',
      step3: ''
    };
    if (typeof window.renderAll === 'function') window.renderAll();
  }

  function triggerImportJsonPicker() {
    closeBackupDropdown();
    const fileInput = document.getElementById('scheduleJsonFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function handleImportJsonFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const parsed = JSON.parse(String(e.target.result || ''));
        if (!parsed || !parsed.officers || !parsed.command) {
          throw new Error('Missing command or officers schedule tables in JSON file.');
        }

        const timeStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        if (Array.isArray(parsed.auditEntries)) {
          parsed.auditEntries.unshift({
            time: timeStr,
            msg: `Imported schedule backup from "${file.name}".`,
            tag: 'Backup Restore'
          });
        }

        applyStatePayload(parsed);
        saveStateToStorage('✓ Imported');

        app.toastData = {
          status: 'approved',
          title: `Imported Schedule Backup: ${file.name}`,
          step1: `Restored Shift Count ${getShiftCount()} / Shift Minimum ${app.shiftMin}.`,
          step2: `Restored Day-Off Roster and ${app.floatedMoves.length} active seniority float(s).`,
          step3: 'State has been saved automatically to browser localStorage.'
        };
        if (typeof window.renderAll === 'function') window.renderAll();
      } catch (err) {
        alert(`Could not import schedule JSON file:\n${err.message || err}`);
      }
    };
    reader.readAsText(file);
  }

  function csvEscape(val) {
    const s = val === null || val === undefined ? '' : String(val);
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function exportRosterCsv() {
    closeBackupDropdown();
    const rows = [
      ['Section', 'Division', 'District', 'Unit', 'BidCar', 'OfficerName', 'PE_Number', 'Partner', 'Status_Or_Assign', 'Float_Origin_Or_Dest']
    ];

    for (const div of DIV_KEYS) {
      // Command rows
      for (const cmd of app.command[div] || []) {
        if (cmd.unit || cmd.name) {
          rows.push([
            'COMMAND',
            div,
            '',
            cmd.unit || '',
            'NO',
            cmd.name || '',
            cmd.pe !== null && cmd.pe !== undefined ? cmd.pe : '',
            '',
            cmd.assign || 'ON_DUTY',
            ''
          ]);
        }
      }

      // Patrol officer rows
      for (const off of app.officers[div] || []) {
        if (!off.unit && !off.name) continue;
        let floatInfo = '';
        if (off.floatedFrom) {
          floatInfo = `FM ${off.floatedFrom.unit} (${off.floatedFrom.div})`;
        } else if (off.floatedTo) {
          floatInfo = `TO ${off.floatedTo.unit} (${off.floatedTo.div})`;
        }
        rows.push([
          'PATROL',
          div,
          off.district || (off.unit ? off.unit.charAt(0) : ''),
          off.unit || '',
          off.bidCar ? 'YES' : 'NO',
          off.name || '',
          off.pe !== null && off.pe !== undefined ? off.pe : '',
          off.partner || '',
          off.assign || (off.name ? 'ON_DUTY' : off.floatedTo ? 'FLOATED_OUT' : 'OPEN'),
          floatInfo
        ]);
      }

      // Day off roster rows
      for (const off of app.dayOffRoster[div] || []) {
        rows.push([
          'DAY_OFF',
          div,
          off.homeUnit ? off.homeUnit.charAt(0) : '',
          off.homeUnit || '',
          '',
          off.name || '',
          off.pe !== null && off.pe !== undefined ? off.pe : '',
          '',
          off.status || 'DAY_OFF',
          `Marked off at ${off.time || ''}`
        ]);
      }
    }

    const csvContent = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const fileShiftSlug = `${app.selectedBureau === 'DB' ? 'db-' : ''}${(app.selectedShift || 'A').toLowerCase()}-shift`;
    const dateLabel = app.selectedDate || new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-roster-${fileShiftSlug}-${dateLabel}.csv`, csvContent, 'text/csv;charset=utf-8');
  }

  function exportAuditCsv() {
    closeBackupDropdown();
    const rows = [['Time', 'Contract_Article_Tag', 'Audit_Event_Description']];
    for (const entry of app.auditEntries || []) {
      rows.push([entry.time || '', entry.tag || '', entry.msg || '']);
    }
    const csvContent = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-contract-audit-log-${stamp}.csv`, csvContent, 'text/csv;charset=utf-8');
  }

  // =========================================================================
  // 4. ADMINISTRATOR CONTROLS (COMMAND-ONLY SHIFT MINIMUM) & NAVBAR HOOKS
  // =========================================================================
  function isCommandMode() {
    return typeof app !== 'undefined' && app.loggedInPe === 'COD';
  }

  function syncAdminMenuState() {
    const btn = document.getElementById('menuAdminShiftMinBtn');
    const tag = document.getElementById('menuAdminShiftMinTag');
    if (!btn || !tag) return;
    const isCmd = isCommandMode();
    const minVal = typeof app !== 'undefined' && typeof app.shiftMin === 'number' ? app.shiftMin : 32;
    if (isCmd) {
      btn.disabled = false;
      btn.classList.remove('opacity-45', 'cursor-not-allowed');
      btn.title = 'Command authorization: explicitly change the shift minimum count';
      tag.textContent = `Min ${minVal}`;
      tag.className = 'backup-menu-tag !bg-amber-500/20 !text-amber-300';
    } else {
      btn.disabled = true;
      btn.classList.add('opacity-45', 'cursor-not-allowed');
      btn.title = 'Command Only — switch User to Supervisor / COD Mode to adjust Shift Minimum';
      tag.textContent = '🔒 Command';
      tag.className = 'backup-menu-tag';
    }
  }

  function closeAdminShiftMinModal() {
    const modal = document.getElementById('adminShiftMinModal');
    if (modal) modal.remove();
  }

  function openAdminShiftMinModal() {
    closeBackupDropdown();
    if (!isCommandMode()) return;

    closeAdminShiftMinModal();

    const currentCount = typeof window.getShiftCount === 'function' ? window.getShiftCount() : 0;
    const currentMin = app.shiftMin;
    let draftMin = currentMin;

    const modal = document.createElement('div');
    modal.id = 'adminShiftMinModal';
    modal.className = 'fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4';
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeAdminShiftMinModal();
    });

    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 text-slate-100 shadow-2xl space-y-4">
        <div class="flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <div class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 mb-1">
              <span>🛡️ Command Administration</span>
            </div>
            <h3 class="text-base font-extrabold text-white">Adjust Shift Minimum Count</h3>
            <p class="text-[11px] text-slate-400 mt-0.5">Explicit Command override for ${app.selectedShift || 'A'}-Shift (${app.selectedDate || ''})</p>
          </div>
          <button type="button" id="adminMinCloseBtn" class="text-slate-400 hover:text-white text-lg font-bold px-1.5 cursor-pointer" title="Close">✕</button>
        </div>

        <div class="grid grid-cols-2 gap-2.5 text-center">
          <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-2.5">
            <div class="text-[10px] uppercase tracking-wider text-slate-400">Current Count</div>
            <div class="text-xl font-mono font-extrabold text-white mt-0.5">${currentCount}</div>
          </div>
          <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-2.5">
            <div class="text-[10px] uppercase tracking-wider text-slate-400">Current Minimum</div>
            <div class="text-xl font-mono font-extrabold text-amber-300 mt-0.5">${currentMin}</div>
          </div>
        </div>

        <div class="space-y-1.5">
          <label for="adminMinInput" class="block text-xs font-semibold text-slate-300">New Shift Minimum</label>
          <div class="flex items-center gap-2">
            <button type="button" id="adminMinDecBtn" class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-lg cursor-pointer">−</button>
            <input
              id="adminMinInput"
              type="number"
              min="1"
              max="99"
              value="${currentMin}"
              class="flex-1 h-10 rounded-xl bg-slate-950 border border-slate-700 text-center font-mono font-extrabold text-lg text-white focus:outline-none focus:border-amber-400"
            />
            <button type="button" id="adminMinIncBtn" class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-lg cursor-pointer">+</button>
          </div>
          <div id="adminMinImpactNote" class="text-[11px] font-medium pt-1"></div>
        </div>

        <div class="space-y-1">
          <label for="adminMinReasonInput" class="block text-xs font-semibold text-slate-300">Command Reason (optional)</label>
          <input
            id="adminMinReasonInput"
            type="text"
            placeholder="e.g., Special event staffing directive"
            class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
          />
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button type="button" id="adminMinCancelBtn" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer">
            Cancel
          </button>
          <button type="button" id="adminMinApplyBtn" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer transition">
            Confirm Shift Minimum
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const inputEl = document.getElementById('adminMinInput');
    const impactEl = document.getElementById('adminMinImpactNote');
    const applyBtn = document.getElementById('adminMinApplyBtn');
    const reasonEl = document.getElementById('adminMinReasonInput');

    function updatePreview() {
      const parsed = parseInt(inputEl.value, 10);
      draftMin = Number.isFinite(parsed) ? Math.max(1, Math.min(99, parsed)) : currentMin;
      const diff = currentCount - draftMin;
      if (draftMin === currentMin) {
        impactEl.className = 'text-[11px] font-medium pt-1 text-slate-400';
        impactEl.textContent = 'No change from current shift minimum.';
        applyBtn.disabled = true;
        applyBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        applyBtn.disabled = false;
        applyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        if (diff > 0) {
          impactEl.className = 'text-[11px] font-semibold pt-1 text-emerald-300';
          impactEl.textContent = `Impact: ${currentCount}/${draftMin} — ${diff} above minimum (${diff} open leave ${diff === 1 ? 'slot' : 'slots'}).`;
        } else if (diff === 0) {
          impactEl.className = 'text-[11px] font-semibold pt-1 text-amber-300';
          impactEl.textContent = `Impact: ${currentCount}/${draftMin} — At exact minimum count.`;
        } else {
          impactEl.className = 'text-[11px] font-semibold pt-1 text-red-300';
          impactEl.textContent = `Impact: ${currentCount}/${draftMin} — ${Math.abs(diff)} below minimum (triggers automated Hire-Back).`;
        }
      }
    }

    document.getElementById('adminMinDecBtn').addEventListener('click', function () {
      inputEl.value = String(Math.max(1, (parseInt(inputEl.value, 10) || currentMin) - 1));
      updatePreview();
    });
    document.getElementById('adminMinIncBtn').addEventListener('click', function () {
      inputEl.value = String(Math.min(99, (parseInt(inputEl.value, 10) || currentMin) + 1));
      updatePreview();
    });
    inputEl.addEventListener('input', updatePreview);
    document.getElementById('adminMinCloseBtn').addEventListener('click', closeAdminShiftMinModal);
    document.getElementById('adminMinCancelBtn').addEventListener('click', closeAdminShiftMinModal);

    applyBtn.addEventListener('click', function () {
      if (draftMin === currentMin) return;
      const reason = (reasonEl.value || '').trim();
      const prevMin = app.shiftMin;
      app.shiftMin = draftMin;
      if (Array.isArray(app.auditEntries)) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        app.auditEntries.unshift({
          time: timeStr,
          tag: 'COMMAND ADMIN',
          msg: `Command updated ${app.selectedShift || 'A'}-Shift minimum from ${prevMin} to ${draftMin}${reason ? ` (${reason})` : ''}.`
        });
      }
      closeAdminShiftMinModal();
      if (typeof window.recalculateFloats === 'function') {
        window.recalculateFloats();
      } else if (typeof window.renderAll === 'function') {
        window.renderAll();
      }
    });

    updatePreview();
  }

  function toggleBackupDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('backupExportMenu');
    if (!menu) return;
    syncAdminMenuState();
    menu.classList.toggle('hidden');
  }

  function closeBackupDropdown() {
    const menu = document.getElementById('backupExportMenu');
    if (menu) menu.classList.add('hidden');
  }

  function injectNavbarControls() {
    const resetBtn = document.querySelector('button[onclick="resetSchedule()"]');
    if (!resetBtn || document.getElementById('backupExportDropdownWrap')) return;

    const parentBar = resetBtn.parentElement;
    const cornerUtils = document.getElementById('headerCornerUtils') || resetBtn.closest('header') || parentBar;

    // 1. Contextual "✓ Updated · ↺ Undo" / "↺ Undo" Control (Hidden at rest until a change occurs)
    const undoBtn = document.createElement('button');
    undoBtn.id = 'undoLastActionBtn';
    undoBtn.type = 'button';
    undoBtn.className = 'hidden px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer';
    undoBtn.title = 'Undo last schedule change (Ctrl+Z)';
    undoBtn.textContent = '↺ Undo';
    undoBtn.addEventListener('click', undoLastAction);

    // 2. Compact Settings Cog Dropdown (Print, Backup, Export & Command Admin) inside lower-right utility cluster
    const dropdownWrap = document.createElement('div');
    dropdownWrap.id = 'backupExportDropdownWrap';
    dropdownWrap.className = 'backup-dropdown-wrap';
    dropdownWrap.innerHTML = `
      <button
        id="backupExportBtn"
        type="button"
        aria-label="Settings, Print &amp; Export Menu"
        title="Settings, Print &amp; Administration"
        class="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/80 flex items-center justify-center transition cursor-pointer"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <div id="backupExportMenu" class="backup-dropdown-menu hidden" onclick="event.stopPropagation()">
        <div class="px-2.5 py-1.5 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-amber-400">
          Administrators (Command)
        </div>
        <button type="button" id="menuAdminShiftMinBtn" class="backup-menu-item mt-1">
          <span>🛡️ Adjust Shift Minimum</span>
          <span id="menuAdminShiftMinTag" class="backup-menu-tag">Min 32</span>
        </button>
        <div class="my-1 border-t border-slate-800"></div>
        <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Print &amp; Schedule Backups
        </div>
        <button type="button" id="menuPrintSheetBtn" class="backup-menu-item mt-1">
          <span>🖨️ Print Roll-Call Sheet</span>
          <span class="backup-menu-tag">1-Page</span>
        </button>
        <button type="button" id="menuExportJsonBtn" class="backup-menu-item">
          <span>⬇️ Export Schedule Backup</span>
          <span class="backup-menu-tag">.JSON</span>
        </button>
        <button type="button" id="menuImportJsonBtn" class="backup-menu-item">
          <span>📂 Import Schedule Backup</span>
          <span class="backup-menu-tag">.JSON</span>
        </button>
        <div class="my-1 border-t border-slate-800"></div>
        <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Spreadsheet &amp; Audit Exports
        </div>
        <button type="button" id="menuExportRosterCsvBtn" class="backup-menu-item">
          <span>📊 Export Roster &amp; Day-Off</span>
          <span class="backup-menu-tag">.CSV</span>
        </button>
        <button type="button" id="menuExportAuditCsvBtn" class="backup-menu-item">
          <span>📜 Export Contract Audit Log</span>
          <span class="backup-menu-tag">.CSV</span>
        </button>
      </div>
      <input type="file" id="scheduleJsonFileInput" accept=".json,application/json" class="hidden" />
    `;

    parentBar.insertBefore(undoBtn, resetBtn);
    cornerUtils.appendChild(dropdownWrap);

    document.getElementById('backupExportBtn').addEventListener('click', toggleBackupDropdown);
    document.getElementById('menuAdminShiftMinBtn').addEventListener('click', openAdminShiftMinModal);
    document.getElementById('menuPrintSheetBtn').addEventListener('click', triggerRollCallPrint);
    document.getElementById('menuExportJsonBtn').addEventListener('click', exportScheduleJson);
    document.getElementById('menuImportJsonBtn').addEventListener('click', triggerImportJsonPicker);
    document.getElementById('menuExportRosterCsvBtn').addEventListener('click', exportRosterCsv);
    document.getElementById('menuExportAuditCsvBtn').addEventListener('click', exportAuditCsv);
    document.getElementById('scheduleJsonFileInput').addEventListener('change', handleImportJsonFile);

    document.addEventListener('click', function () {
      closeBackupDropdown();
    });

    // Keyboard shortcut: Ctrl+Z / Cmd+Z to undo last schedule action (when not typing in a field)
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'z') {
        const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (document.activeElement && document.activeElement.isContentEditable)) {
          return;
        }
        if (undoStack.length > 0) {
          e.preventDefault();
          undoLastAction();
        }
      }
    });
  }

  function hookGlobalFunctions() {
    // Wrap renderAll so every state change updates the print footer, admin menu state, and records undo/persistence
    const origRenderAll = window.renderAll;
    if (typeof origRenderAll === 'function') {
      window.renderAll = function () {
        origRenderAll.apply(this, arguments);
        updatePrintFooter();
        syncAdminMenuState();
        saveStateToStorage();
      };
    }

    // Wrap toggleTheme so Dark/Light mode preference persists across reloads
    const origToggleTheme = window.toggleTheme;
    if (typeof origToggleTheme === 'function') {
      window.toggleTheme = function () {
        origToggleTheme.apply(this, arguments);
        saveStateToStorage({ skipUndo: true });
      };
    }

    // Wrap setViewMode so Split vs. Full-Width Worksheet preference persists
    const origSetViewMode = window.setViewMode;
    if (typeof origSetViewMode === 'function') {
      window.setViewMode = function () {
        origSetViewMode.apply(this, arguments);
        saveStateToStorage({ skipUndo: true });
      };
    }

    // Wrap restoreOfficerFromDayOff so step2 dynamically reports the actual floated officer unless a Hire-Back cancellation toast is active
    const origRestore = window.restoreOfficerFromDayOff;
    if (typeof origRestore === 'function') {
      window.restoreOfficerFromDayOff = function (div, homeUnit) {
        const priorMove = Array.isArray(app.floatedMoves)
          ? app.floatedMoves.find(m => m.toUnit === homeUnit && m.toDiv === div)
          : null;
        origRestore.apply(this, arguments);
        if (app.toastData && app.toastData.status === 'approved' && !String(app.toastData.title || '').includes('Canceled')) {
          app.toastData.step2 = priorMove
            ? `Step 2: Floated coverage officer (${priorMove.name} #${priorMove.pe}) automatically returned to home car ${priorMove.fromUnit} (${priorMove.fromDiv}).`
            : 'Step 2: All district assignments verified and restored.';
        }
        if (typeof window.renderAll === 'function') {
          window.renderAll();
        }
      };
    }

    // Wrap resetSchedule so clicking "↺ Reset" clears localStorage and undo stack back to factory defaults
    const origResetSchedule = window.resetSchedule;
    if (typeof origResetSchedule === 'function') {
      window.resetSchedule = function () {
        closeBackupDropdown();
        setFloatScopeValue('citywide');
        if (app.hbEngine) {
          app.hbEngine.openPostings = [];
          app.hbEngine.closedNotifications = [];
          app.hbEngine.supervisorStandbyList = [];
          app.hbEngine.commandOffRoster = [];
          app.hbEngine.actingCodInfo = null;
          app.hbEngine.dutyChiefAuthorized = false;
        }
        origResetSchedule.apply(this, arguments);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
        resetUndoBaseline();
      };
    }
  }

  function initPersistencePrintExportModule() {
    injectNavbarControls();
    ensurePrintFooterExists();
    ensurePrintPreviewToolbarExists();
    hookGlobalFunctions();
    const restored = restoreStateFromStorage();
    if (!restored) {
      updatePrintFooter();
      resetUndoBaseline();
      saveStateToStorage({ skipUndo: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPersistencePrintExportModule);
  } else {
    initPersistencePrintExportModule();
  }
})();
