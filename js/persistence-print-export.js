/**
 * FWPD "The Books" — Persistence, Roll-Call Print & Backup/Export Add-on Module
 * Designed as a zero-conflict drop-in module for macc0311/fwpd-the-books.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fwpd_the_books_state_v2_6';
  const SCHEMA_VERSION = '2.6.0';
  let isRestoring = false;
  let lastSavedTimeStr = 'Just now';

  // =========================================================================
  // 1. LOCALSTORAGE AUTO-SAVE & RESTORE ENGINE
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
      floatedMoves: app.floatedMoves,
      auditEntries: app.auditEntries,
      savedHistory: app.savedHistory || {},
      hbEngine: app.hbEngine || null
    };
  }

  function saveStateToStorage(customLabel) {
    if (isRestoring) return;
    try {
      const payload = serializeState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      lastSavedTimeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      updateSavedBadge(customLabel || '✓ Saved', `Auto-saved to browser storage at ${lastSavedTimeStr}`);
    } catch (err) {
      console.warn('[FWPD Books] Could not save state to localStorage:', err);
      updateSavedBadge('⚠ Storage Full', 'Browser localStorage is unavailable or full');
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
        themeBtn.textContent = app.darkMode ? '☀️ Light Mode' : '🌙 Dark Mode';
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
        updateSavedBadge('✓ Saved', `Restored schedule from ${savedTime}`);
      }
      return ok;
    } catch (err) {
      console.warn('[FWPD Books] Failed to restore state from localStorage:', err);
      return false;
    }
  }

  function updateSavedBadge(text, tooltip) {
    const badge = document.getElementById('persistenceStatusBadge');
    if (!badge) return;
    badge.textContent = text;
    if (tooltip) badge.title = tooltip;
    badge.classList.remove('save-badge-flash');
    void badge.offsetWidth; // Reflow for animation restart
    badge.classList.add('save-badge-flash');
  }

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

    const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FWPD A-Shift Roll-Call Worksheet — Sunday, Nov 15, 2026</title>
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

    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-rollcall-sheet-A-shift-${stamp}.html`, htmlDoc, 'text/html;charset=utf-8');
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
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-the-books-A-shift-${stamp}.json`, jsonStr, 'application/json;charset=utf-8');

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
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`fwpd-roster-A-shift-${stamp}.csv`, csvContent, 'text/csv;charset=utf-8');
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
  // 4. UI INJECTION INTO TOP NAVBAR & HOOKS
  // =========================================================================
  function toggleBackupDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('backupExportMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  }

  function closeBackupDropdown() {
    const menu = document.getElementById('backupExportMenu');
    if (menu) menu.classList.add('hidden');
  }

  function injectNavbarControls() {
    const resetBtn = document.querySelector('button[onclick="resetSchedule()"]');
    if (!resetBtn || document.getElementById('printRollCallBtn')) return;

    const parentBar = resetBtn.parentElement;

    // 1. Subtle "✓ Saved" Auto-Persistence Indicator Badge
    const savedBadge = document.createElement('span');
    savedBadge.id = 'persistenceStatusBadge';
    savedBadge.className = 'px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 select-none';
    savedBadge.title = 'Changes auto-save to browser localStorage';
    savedBadge.textContent = '✓ Saved';

    // 2. "🖨️ Print" Button
    const printBtn = document.createElement('button');
    printBtn.id = 'printRollCallBtn';
    printBtn.type = 'button';
    printBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer';
    printBtn.title = 'Open 1-page US Letter Landscape Roll-Call Print Preview';
    printBtn.innerHTML = '🖨️ Print';
    printBtn.addEventListener('click', triggerRollCallPrint);

    // 3. "💾 Backup / Export ▾" Dropdown Button + Menu
    const dropdownWrap = document.createElement('div');
    dropdownWrap.id = 'backupExportDropdownWrap';
    dropdownWrap.className = 'backup-dropdown-wrap';
    dropdownWrap.innerHTML = `
      <button id="backupExportBtn" type="button" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white border border-blue-400/30 shadow-xs transition cursor-pointer">
        💾 Backup / Export ▾
      </button>
      <div id="backupExportMenu" class="backup-dropdown-menu hidden" onclick="event.stopPropagation()">
        <div class="px-2.5 py-1.5 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Roll-Call &amp; Schedule Data
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

    parentBar.insertBefore(savedBadge, resetBtn);
    parentBar.insertBefore(printBtn, resetBtn);
    parentBar.insertBefore(dropdownWrap, resetBtn);

    document.getElementById('backupExportBtn').addEventListener('click', toggleBackupDropdown);
    document.getElementById('menuPrintSheetBtn').addEventListener('click', triggerRollCallPrint);
    document.getElementById('menuExportJsonBtn').addEventListener('click', exportScheduleJson);
    document.getElementById('menuImportJsonBtn').addEventListener('click', triggerImportJsonPicker);
    document.getElementById('menuExportRosterCsvBtn').addEventListener('click', exportRosterCsv);
    document.getElementById('menuExportAuditCsvBtn').addEventListener('click', exportAuditCsv);
    document.getElementById('scheduleJsonFileInput').addEventListener('change', handleImportJsonFile);

    document.addEventListener('click', function () {
      closeBackupDropdown();
    });
  }

  function hookGlobalFunctions() {
    // Wrap renderAll so every state change updates the print footer and auto-saves to localStorage
    const origRenderAll = window.renderAll;
    if (typeof origRenderAll === 'function') {
      window.renderAll = function () {
        origRenderAll.apply(this, arguments);
        updatePrintFooter();
        saveStateToStorage();
      };
    }

    // Wrap toggleTheme so Dark/Light mode preference persists across reloads
    const origToggleTheme = window.toggleTheme;
    if (typeof origToggleTheme === 'function') {
      window.toggleTheme = function () {
        origToggleTheme.apply(this, arguments);
        saveStateToStorage();
      };
    }

    // Wrap setViewMode so Split vs. Full-Width Worksheet preference persists
    const origSetViewMode = window.setViewMode;
    if (typeof origSetViewMode === 'function') {
      window.setViewMode = function () {
        origSetViewMode.apply(this, arguments);
        saveStateToStorage();
      };
    }

    // Wrap restoreOfficerFromDayOff so step2 dynamically reports the actual floated officer instead of hardcoded Sikorski
    const origRestore = window.restoreOfficerFromDayOff;
    if (typeof origRestore === 'function') {
      window.restoreOfficerFromDayOff = function (div, homeUnit) {
        const priorMove = Array.isArray(app.floatedMoves)
          ? app.floatedMoves.find(m => m.toUnit === homeUnit && m.toDiv === div)
          : null;
        origRestore.apply(this, arguments);
        if (app.toastData && app.toastData.status === 'approved') {
          app.toastData.step2 = priorMove
            ? `Step 2: Floated coverage officer (${priorMove.name} #${priorMove.pe}) automatically returned to home car ${priorMove.fromUnit} (${priorMove.fromDiv}).`
            : 'Step 2: All district assignments verified and restored.';
          if (typeof origRenderAll === 'function') {
            origRenderAll.apply(this, []);
            updatePrintFooter();
            saveStateToStorage();
          }
        }
      };
    }

    // Wrap resetSchedule so clicking "↺ Reset" clears localStorage back to factory defaults
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
        updateSavedBadge('↺ Reset to Default', 'Cleared saved browser state and restored factory schedule');
      };
    }

    // Ensure standalone HTML export closes our dropdown cleanly if used
    const origBuildStandalone = window.buildStandaloneReleaseHtml;
    if (typeof origBuildStandalone === 'function') {
      window.buildStandaloneReleaseHtml = function () {
        closeBackupDropdown();
        exitRollCallPrintPreview();
        return origBuildStandalone.apply(this, arguments);
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
      saveStateToStorage('✓ Saved');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPersistencePrintExportModule);
  } else {
    initPersistencePrintExportModule();
  }
})();
