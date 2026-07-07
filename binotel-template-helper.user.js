// ==UserScript==
// @name         Binotel helper → шаблони номерів
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Перетягуване меню для pbxNumbersEnhanced: універсальний шаблон, Tele2, Kyivstar Trunk, FMC Lifecell, масове додавання номерів
// @author       Binotel
// @match        https://panel.binotel.com/*
// @updateURL    https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-template-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-template-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    targetModules: ['pbxNumbersEnhanced', 'pbxNumbers'],
    tele2Template: 'tele2-trunk-main-gfv20',
    panelId: 'binotel-template-helper-panel',
    bulkModalId: 'binotel-template-helper-bulk-modal',
    kyivstarModalId: 'binotel-template-helper-kyivstar-modal',
    kyivstarOperatorModalSelector: '#operatorKyivstarTrunk',
    fmcModalId: 'binotel-template-helper-fmc-modal',
    fmcLifeOperatorModalSelector: '#operatorLifeBinotel',
    stopButtonId: 'binotel-template-helper-emergency-stop',
    positionStorageKey: 'binotel_template_helper_position_v1',
    bulkStateStorageKey: 'binotel_template_helper_bulk_state_v1',
    bulkActiveStorageKey: 'binotel_template_helper_bulk_active_v1',
    kyivstarStateStorageKey: 'binotel_template_helper_kyivstar_state_v1',
    kyivstarActiveStorageKey: 'binotel_template_helper_kyivstar_active_v1',
    fmcStateStorageKey: 'binotel_template_helper_fmc_state_v1',
    fmcActiveStorageKey: 'binotel_template_helper_fmc_active_v1',
    delayAfterInsertMs: 900,
    delayAfterSaveMs: 1600,
  };

  const EXAMPLE_TEXT = `00039833
defaultuser = 00039833
fromuser = 00039833
secret = testSecret123
host = 213.170.92.166
fromdomain = 213.170.92.166

---
00039834
defaultuser = 00039834
fromuser = 00039834
secret = testSecret456
host = 213.170.92.166
fromdomain = 213.170.92.166

---
00039835
defaultuser = 00039835
fromuser = 00039835
host = 213.170.92.166
fromdomain = 213.170.92.166`;

  const KYIVSTAR_EXAMPLE_TEXT = `0674002203
0674002204
0674002205`;

  const FMC_EXAMPLE_TEXT = `0930000000
0730000000 | 901`;

  let bulkStopRequested = false;

  function isTargetPage() {
    const params = new URLSearchParams(window.location.search);
    return CONFIG.targetModules.includes(params.get('module'));
  }

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setStatus(message, type = 'info') {
    const status = $(`#${CONFIG.panelId} .bth-status`);
    if (!status) return;

    status.textContent = message;
    status.className = `bth-status ${type}`;
  }

  function setBulkLog(message, type = 'info') {
    const log = $(`#${CONFIG.bulkModalId} .bth-bulk-log`);
    if (!log) return;

    const row = document.createElement('div');
    row.className = `bth-bulk-log-row ${type}`;
    row.textContent = message;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function clearBulkLog() {
    const log = $(`#${CONFIG.bulkModalId} .bth-bulk-log`);
    if (log) log.innerHTML = '';
  }

  function setKyivstarLog(message, type = 'info') {
    const log = $(`#${CONFIG.kyivstarModalId} .bth-kyivstar-log`);
    if (!log) return;

    const row = document.createElement('div');
    row.className = `bth-bulk-log-row ${type}`;
    row.textContent = message;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function clearKyivstarLog() {
    const log = $(`#${CONFIG.kyivstarModalId} .bth-kyivstar-log`);
    if (log) log.innerHTML = '';
  }

  function setFmcLog(message, type = 'info') {
    const log = $(`#${CONFIG.fmcModalId} .bth-fmc-log`);
    if (!log) return;

    const row = document.createElement('div');
    row.className = `bth-bulk-log-row ${type}`;
    row.textContent = message;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function clearFmcLog() {
    const log = $(`#${CONFIG.fmcModalId} .bth-fmc-log`);
    if (log) log.innerHTML = '';
  }

  function dispatchFieldEvents(element) {
    if (!element) return;

    ['input', 'change', 'keyup', 'blur'].forEach(eventName => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });

    if (window.jQuery) {
      try {
        window.jQuery(element)
          .trigger('input')
          .trigger('change')
          .trigger('keyup')
          .trigger('blur');
      } catch (err) {
        console.warn('[Binotel helper] jQuery trigger error:', err);
      }
    }
  }

  function setFieldValue(element, value) {
    if (!element) return false;

    element.value = value || '';
    element.setAttribute('value', value || '');
    dispatchFieldEvents(element);
    return true;
  }

  function waitForElement(selector, timeoutMs = 5000, root = document) {
    return new Promise(resolve => {
      const existing = $(selector, root);
      if (existing) {
        resolve(existing);
        return;
      }

      const startedAt = Date.now();

      const timer = setInterval(() => {
        const element = $(selector, root);

        if (element) {
          clearInterval(timer);
          resolve(element);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 150);
    });
  }

  function getUnlockPasswordFromPage() {
    const scriptsText = $all('script')
      .map(script => script.textContent || '')
      .join('\n');

    const patterns = [
      /prompt\(['"]Пароль\?['"]\)\s*!==\s*['"]([^'"]+)['"]/,
      /prompt\([^)]*Пароль[^)]*\)\s*!==\s*['"]([^'"]+)['"]/,
    ];

    for (const pattern of patterns) {
      const match = scriptsText.match(pattern);
      if (match && match[1]) return match[1];
    }

    return '';
  }

  function findVisibleAddButton() {
    const candidates = $all('button, a, input[type="button"], input[type="submit"]');

    return candidates.find(element => {
      const text = (element.textContent || element.value || '').trim();
      const rect = element.getBoundingClientRect();

      return (
        text === 'Добавить' &&
        rect.width > 0 &&
        rect.height > 0 &&
        !text.includes('Временный')
      );
    });
  }

  async function waitForAddButtonReady(timeoutMs = 15000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const addButton = findVisibleAddButton();

      if (addButton) {
        return true;
      }

      await sleep(250);
    }

    return false;
  }

  async function openAddFormIfNeeded(state) {
    if ($('#operatorUniversalTemplate')) return true;

    const readyForAdd = await waitForAddButtonReady(15000);

    if (!readyForAdd) {
      return false;
    }

    const addButton = findVisibleAddButton();

    if (!addButton) {
      return false;
    }

    saveBulkState({
      ...state,
      phase: 'opening',
    });

    addButton.click();

    const modal = await waitForElement('#operatorUniversalTemplate', 10000);
    return Boolean(modal);
  }

  async function ensureUniversalModalExists() {
    if ($('#operatorUniversalTemplate')) return true;

    const addButton = findVisibleAddButton();

    if (addButton) {
      addButton.click();
      await sleep(500);
    }

    return Boolean($('#operatorUniversalTemplate'));
  }

  async function showUniversalModal() {
    const exists = await ensureUniversalModalExists();

    if (!exists) {
      setStatus('Не знайдено універсальний шаблон', 'error');
      return false;
    }

    const modal = $('#operatorUniversalTemplate');

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
      return true;
    }

    const opener = $('a[href="#operatorUniversalTemplate"][data-toggle="modal"]');

    if (opener) {
      opener.click();
      return true;
    }

    modal.classList.add('in');
    modal.removeAttribute('aria-hidden');
    modal.style.display = 'block';

    return true;
  }

  function unlockUniversalTemplate() {
    const modal = $('#operatorUniversalTemplate');

    if (!modal) {
      setStatus('Не знайдено #operatorUniversalTemplate', 'error');
      return false;
    }

    const accessDenied = $('#operatorUniversalTemplate .access-denied-message');
    const settingsBlock = $('#operatorUniversalTemplate .settings-block');
    const saveButton = $('#operatorUniversalTemplate button.saveNumber');

    const alreadyUnlocked =
      settingsBlock &&
      settingsBlock.style.display !== 'none' &&
      (!accessDenied || accessDenied.style.display === 'none');

    if (alreadyUnlocked) {
      setStatus('Шаблон уже відкритий', 'success');
      return true;
    }

    const password = getUnlockPasswordFromPage();

    if (!password) {
      setStatus('Пароль не знайдено', 'error');
      return false;
    }

    const unlockButton = $('#unlock-button');

    if (unlockButton) {
      const originalPrompt = window.prompt;

      try {
        window.prompt = function () {
          return password;
        };

        unlockButton.click();

        setTimeout(() => {
          window.prompt = originalPrompt;
        }, 0);

        setStatus('Шаблон відкрито', 'success');
        return true;
      } catch (err) {
        window.prompt = originalPrompt;
        console.error('[Binotel helper] unlock click error:', err);
      }
    }

    if (accessDenied) accessDenied.style.display = 'none';
    if (settingsBlock) settingsBlock.style.display = '';
    if (saveButton) saveButton.style.display = '';

    setStatus('Шаблон відкрито напряму', 'success');
    return true;
  }

  async function openUniversalTemplate() {
    const shown = await showUniversalModal();
    if (!shown) return;

    setTimeout(() => {
      unlockUniversalTemplate();
    }, 100);
  }

  function setTele2SipTemplate() {
    const mainForm = $('#main-form');

    if (!mainForm) {
      setStatus('Tele2 можна ставити тільки на сторінці редагування номера', 'error');
      return;
    }

    const sipTemplateInput = $('#main-form input[name="sipTemplate"]');

    if (!sipTemplateInput) {
      setStatus('Не знайдено SIP-шаблон', 'error');
      return;
    }

    sipTemplateInput.value = CONFIG.tele2Template;
    sipTemplateInput.setAttribute('value', CONFIG.tele2Template);

    dispatchFieldEvents(sipTemplateInput);

    const iCheck = $('#iCheck');

    if (iCheck) {
      iCheck.textContent = 'good';
      iCheck.className = 'iCheck';
    }

    setStatus('Tele2 встановлено', 'success');
    console.log('[Binotel helper] SIP template set:', CONFIG.tele2Template);
  }

  function parseKeyValueLines(lines) {
    const data = {};

    lines.forEach(line => {
      const match = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (!match) return;

      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      data[key] = value;
    });

    return data;
  }

  function generateRegister(entry, options) {
    if (options.trunkMode) return '';

    const data = entry.data;
    const login = data.defaultuser || data.fromuser || '';
    const secret = data.secret || '';
    const host = data.host || data.fromdomain || '';
    const proxy = data.outboundproxy || '';
    const port = data.port || '';

    if (!login || !secret || !host) {
      throw new Error('Для авто-register потрібні defaultuser/fromuser, secret і host');
    }

    if (options.useProxy && proxy) {
      return `register => ${login}@${host}:${secret}:${login}@${proxy}/${entry.number}`;
    }

    const hostWithPort = options.usePort && port ? `${host}:${port}` : host;
    return `register => ${login}:${secret}@${hostWithPort}/${entry.number}`;
  }

  function getBulkState() {
    try {
      const raw = localStorage.getItem(CONFIG.bulkStateStorageKey);
      if (!raw) return null;

      const state = JSON.parse(raw);

      if (!state || !Array.isArray(state.entries) || typeof state.index !== 'number') {
        return null;
      }

      return state;
    } catch (err) {
      return null;
    }
  }

  function saveBulkState(state) {
    localStorage.setItem(CONFIG.bulkStateStorageKey, JSON.stringify(state));
  }

  function setBulkActive() {
    sessionStorage.setItem(CONFIG.bulkActiveStorageKey, '1');
  }

  function isBulkActive() {
    return sessionStorage.getItem(CONFIG.bulkActiveStorageKey) === '1';
  }

  function clearBulkState() {
    localStorage.removeItem(CONFIG.bulkStateStorageKey);
    sessionStorage.removeItem(CONFIG.bulkActiveStorageKey);
  }

  function getKyivstarState() {
    try {
      const raw = localStorage.getItem(CONFIG.kyivstarStateStorageKey);
      if (!raw) return null;

      const state = JSON.parse(raw);

      if (!state || !Array.isArray(state.entries) || typeof state.index !== 'number') {
        return null;
      }

      return state;
    } catch (err) {
      return null;
    }
  }

  function saveKyivstarState(state) {
    localStorage.setItem(CONFIG.kyivstarStateStorageKey, JSON.stringify(state));
  }

  function setKyivstarActive() {
    sessionStorage.setItem(CONFIG.kyivstarActiveStorageKey, '1');
  }

  function isKyivstarActive() {
    return sessionStorage.getItem(CONFIG.kyivstarActiveStorageKey) === '1';
  }

  function clearKyivstarState() {
    localStorage.removeItem(CONFIG.kyivstarStateStorageKey);
    sessionStorage.removeItem(CONFIG.kyivstarActiveStorageKey);
  }

  function getFmcState() {
    try {
      const raw = localStorage.getItem(CONFIG.fmcStateStorageKey);
      if (!raw) return null;

      const state = JSON.parse(raw);

      if (!state || !Array.isArray(state.entries) || typeof state.index !== 'number') {
        return null;
      }

      return state;
    } catch (err) {
      return null;
    }
  }

  function saveFmcState(state) {
    localStorage.setItem(CONFIG.fmcStateStorageKey, JSON.stringify(state));
  }

  function setFmcActive() {
    sessionStorage.setItem(CONFIG.fmcActiveStorageKey, '1');
  }

  function isFmcActive() {
    return sessionStorage.getItem(CONFIG.fmcActiveStorageKey) === '1';
  }

  function clearFmcState() {
    localStorage.removeItem(CONFIG.fmcStateStorageKey);
    sessionStorage.removeItem(CONFIG.fmcActiveStorageKey);
  }

  function getPanelParams(state = null) {
    const params = new URLSearchParams(window.location.search);

    return {
      companyID: params.get('companyID') || (state && state.companyID) || '',
      showProjectID: params.get('showProjectID') || (state && state.showProjectID) || '',
      module: params.get('module') || '',
      action: params.get('action') || '',
    };
  }

  function buildPanelUrl(moduleName, state = null, extra = {}) {
    const current = getPanelParams(state);
    const url = new URL('https://panel.binotel.com/');

    url.searchParams.set('module', moduleName);

    if (current.companyID) {
      url.searchParams.set('companyID', current.companyID);
    }

    if (current.showProjectID) {
      url.searchParams.set('showProjectID', current.showProjectID);
    }

    Object.keys(extra).forEach(key => {
      if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') {
        url.searchParams.set(key, extra[key]);
      }
    });

    return url.toString();
  }

  function navigateToPanelModule(moduleName, state = null, extra = {}) {
    window.location.href = buildPanelUrl(moduleName, state, extra);
  }

  function showEmergencyStopButton() {
    if ($(`#${CONFIG.stopButtonId}`)) return;

    const button = document.createElement('button');
    button.id = CONFIG.stopButtonId;
    button.type = 'button';
    button.textContent = '⛔ СТОП';
    button.title = 'Зупинити масове додавання після поточної дії';

    Object.assign(button.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '1000002',
      border: 'none',
      borderRadius: '999px',
      padding: '14px 22px',
      background: '#dc2626',
      color: '#ffffff',
      fontWeight: '800',
      fontSize: '16px',
      cursor: 'pointer',
      boxShadow: '0 10px 30px rgba(220, 38, 38, 0.45)',
    });

    button.addEventListener('click', () => {
      bulkStopRequested = true;
      clearBulkState();
      clearKyivstarState();
      clearFmcState();
      setStatus('Масове додавання зупинено', 'warn');
      setBulkLog('Натиснуто аварійний СТОП. Поточна дія може завершитись, але наступний номер не запуститься.', 'warn');
      setKyivstarLog('Натиснуто аварійний СТОП. Поточна дія може завершитись, але наступний номер не запуститься.', 'warn');
      setFmcLog('Натиснуто аварійний СТОП. Поточна дія може завершитись, але наступний крок FMC не запуститься.', 'warn');
      button.textContent = '⛔ ЗУПИНЕНО';

      setTimeout(hideEmergencyStopButton, 2500);
    });

    document.body.appendChild(button);
  }

  function hideEmergencyStopButton() {
    const button = $(`#${CONFIG.stopButtonId}`);
    if (button) button.remove();
  }

  function findMainSaveButton() {
    const mainForm = $('#main-form') || $('form');
    const roots = mainForm ? [mainForm, document] : [document];

    for (const root of roots) {
      const candidates = $all('button, input[type="submit"], input[type="button"]', root);

      const saveButton = candidates.find(element => {
        const text = (element.textContent || element.value || '').trim();
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        const isDisabled = element.disabled || element.getAttribute('disabled') !== null;

        return (
          isVisible &&
          !isDisabled &&
          /^(Сохранить|Зберегти)$/i.test(text)
        );
      });

      if (saveButton) return saveButton;
    }

    return null;
  }

  async function saveCurrentNumber() {
    const saveButton = findMainSaveButton();

    if (!saveButton) {
      throw new Error('Не знайдено кнопку "Сохранить"');
    }

    saveButton.click();
    await sleep(CONFIG.delayAfterSaveMs);
  }

  function parseBulkText(rawText, options) {
    const blocks = rawText
      .split(/\n\s*---\s*\n/g)
      .map(block => block.trim())
      .filter(Boolean);

    return blocks.map((block, index) => {
      const lines = block
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      const number = lines[0] || '';

      if (!number) {
        throw new Error(`Блок ${index + 1}: не вказано номер`);
      }

      const sipLines = lines
        .slice(1)
        .filter(line => !/^register\s*=>/i.test(line));

    const entry = {
        number,
        sipData: sipLines.join('\n'),
        data: parseKeyValueLines(sipLines),
      };

      entry.register = generateRegister(entry, options);
      return entry;
    });
  }

  async function fillUniversalTemplate(entry) {
    const shown = await showUniversalModal();
    if (!shown) throw new Error('Не відкрився універсальний шаблон');

    await sleep(120);

    if (!unlockUniversalTemplate()) {
      throw new Error('Не вдалося відкрити універсальний шаблон');
    }

    await sleep(120);

    const modal = $('#operatorUniversalTemplate');
    const numberField = $('#operatorUniversalTemplate input[name="number"]');
    const sipDataField = $('#operatorUniversalTemplate textarea[name="sipData"]');
    const registerField = $('#operatorUniversalTemplate input[name="sipRegisterData"]');
    const insertButton = $('#operatorUniversalTemplate button.saveNumber');

    if (!modal || !numberField || !sipDataField || !registerField || !insertButton) {
      throw new Error('Не знайдено одне з полів універсального шаблону');
    }

    setFieldValue(numberField, entry.number);
    setFieldValue(sipDataField, entry.sipData);
    setFieldValue(registerField, entry.register || '');

    insertButton.click();
    await sleep(CONFIG.delayAfterInsertMs);
  }

  async function addOneNumberAndSave(entry) {
    const state = getBulkState();

    const opened = await openAddFormIfNeeded(state || {});

    if (!opened) {
      throw new Error('Починати потрібно зі списку, де видно кнопку "Добавить"');
    }

    await fillUniversalTemplate(entry);
    await saveCurrentNumber();
  }

  function markCurrentBulkEntryDone(state) {
    const completedIndex =
      typeof state.pendingIndex === 'number'
        ? state.pendingIndex
        : state.index;

    const nextState = {
      ...state,
      index: completedIndex + 1,
      phase: 'list',
      lastNumber: state.entries[completedIndex]
        ? state.entries[completedIndex].number
        : state.lastNumber,
    };

    delete nextState.pendingIndex;

    saveBulkState(nextState);
    return nextState;
  }

  async function processBulkState() {
    const state = getBulkState();

    if (!state || !isBulkActive()) {
      if (state && !isBulkActive()) {
        clearBulkState();
      }
      hideEmergencyStopButton();
      return;
    }

    showEmergencyStopButton();

    const total = state.entries.length;

    if (state.index >= total) {
      clearBulkState();
      hideEmergencyStopButton();
      setBulkLog('Готово. Перевір список номерів у панелі.', 'success');
      setStatus('Масове додавання завершено', 'success');
      return;
    }

    if (bulkStopRequested) {
      clearBulkState();
      hideEmergencyStopButton();
      setBulkLog('Зупинено користувачем', 'warn');
      setStatus('Масове додавання зупинено', 'warn');
      return;
    }

    if (state.phase === 'saving') {
      const readyAfterSave = await waitForAddButtonReady(15000);

      if (!readyAfterSave) {
        setBulkLog('Чекаю повернення до списку номерів. Якщо сторінка оновиться — продовжу автоматично.', 'warn');
        setStatus('Чекаю список номерів', 'warn');
        return;
      }

      if (bulkStopRequested || !getBulkState()) {
        hideEmergencyStopButton();
        setBulkLog('Масове додавання зупинено після поточної дії.', 'warn');
        setStatus('Масове додавання зупинено', 'warn');
        return;
      }

      const nextState = markCurrentBulkEntryDone(state);
      const doneEntry = state.entries[state.pendingIndex] || state.entries[state.index];

      if (doneEntry) {
        setBulkLog(`${nextState.index}/${total}: ${doneEntry.number} — збережено`, 'success');
      }

      await sleep(400);
      processBulkState();
      return;
    }

    const entry = state.entries[state.index];

    try {
      setBulkLog(`${state.index + 1}/${total}: додаю ${entry.number}`, 'info');
      setStatus(`Масове додавання: ${state.index + 1}/${total}`, 'info');

      saveBulkState({
        ...state,
        phase: 'saving',
        pendingIndex: state.index,
      });

      await addOneNumberAndSave(entry);

      if (bulkStopRequested || !getBulkState()) {
        hideEmergencyStopButton();
        setBulkLog('Масове додавання зупинено після поточної дії.', 'warn');
        setStatus('Масове додавання зупинено', 'warn');
        return;
      }

      const latestState = getBulkState();
      const readyForNext = await waitForAddButtonReady(15000);

      if (!readyForNext) {
        setBulkLog('Чекаю повернення до списку номерів. Якщо сторінка оновиться — продовжу автоматично.', 'warn');
        setStatus('Чекаю список номерів', 'warn');
        return;
      }

      if (bulkStopRequested || !getBulkState()) {
        hideEmergencyStopButton();
        setBulkLog('Масове додавання зупинено після поточної дії.', 'warn');
        setStatus('Масове додавання зупинено', 'warn');
        return;
      }

      const nextState = markCurrentBulkEntryDone(latestState || state);
      setBulkLog(`${nextState.index}/${total}: ${entry.number} — збережено`, 'success');

      await sleep(400);
      processBulkState();
    } catch (err) {
      clearBulkState();
      hideEmergencyStopButton();
      setBulkLog(`${state.index + 1}/${total}: ${entry.number} — ${err.message}`, 'error');
      setStatus(`Помилка на ${entry.number}`, 'error');
    }
  }

  async function runBulkAdd() {
    const modal = $(`#${CONFIG.bulkModalId}`);
    const textarea = $('.bth-bulk-textarea', modal);
    const options = {
      trunkMode: $('.bth-option-trunk', modal).checked,
      useProxy: $('.bth-option-proxy', modal).checked,
      usePort: $('.bth-option-port', modal).checked,
    };

    clearBulkLog();
    bulkStopRequested = false;
    clearBulkState();

    if (!findVisibleAddButton()) {
      setBulkLog('Стартуй зі сторінки списку розширених номерів, де видно кнопку "Добавить".', 'error');
      setStatus('Потрібна сторінка списку', 'error');
      return;
    }

    let entries = [];

    try {
      entries = parseBulkText(textarea.value, options);
    } catch (err) {
      setBulkLog(`Помилка формату: ${err.message}`, 'error');
      return;
    }

    if (!entries.length) {
      setBulkLog('Немає номерів для додавання', 'warn');
      return;
    }

    saveBulkState({
      startedAt: new Date().toISOString(),
      index: 0,
      phase: 'list',
      entries,
    });

    setBulkActive();
    showEmergencyStopButton();

    setBulkLog(`Знайдено номерів: ${entries.length}`, 'info');
    setBulkLog('Після кожного "Вставить" скрипт натискатиме "Сохранить" і продовжить список.', 'info');

    await processBulkState();
  }

  function parseKyivstarNumbers(rawText) {
    const numbers = rawText
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean);

    const uniqueNumbers = [];
    const seen = new Set();

    numbers.forEach(number => {
      if (seen.has(number)) return;
      seen.add(number);
      uniqueNumbers.push(number);
    });

    uniqueNumbers.forEach(number => {
      if (!/^0\d{9}$/.test(number)) {
        throw new Error(`Номер "${number}" має бути у форматі 0XXXXXXXXX`);
      }
    });

    return uniqueNumbers;
  }

  async function openAddFormIfNeededForKyivstar(state) {
    if ($(CONFIG.kyivstarOperatorModalSelector)) return true;

    const readyForAdd = await waitForAddButtonReady(15000);

    if (!readyForAdd) {
      return false;
    }

    const addButton = findVisibleAddButton();

    if (!addButton) {
      return false;
    }

    saveKyivstarState({
      ...state,
      phase: 'opening',
    });

    addButton.click();

    const modal = await waitForElement(CONFIG.kyivstarOperatorModalSelector, 10000);
    return Boolean(modal);
  }

  async function ensureKyivstarOperatorModalExists() {
    if ($(CONFIG.kyivstarOperatorModalSelector)) return true;

    const addButton = findVisibleAddButton();

    if (addButton) {
      addButton.click();
      await sleep(500);
    }

    return Boolean($(CONFIG.kyivstarOperatorModalSelector));
  }

  async function showKyivstarOperatorModal() {
    const exists = await ensureKyivstarOperatorModalExists();

    if (!exists) {
      setStatus('Не знайдено шаблон Kyivstar Trunk', 'error');
      return false;
    }

    const modal = $(CONFIG.kyivstarOperatorModalSelector);

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
      return true;
    }

    const opener = $('a[href="#operatorKyivstarTrunk"][data-toggle="modal"]') || $('a[href="#operatorKyivstarTrunk"]');

    if (opener) {
      opener.click();
      return true;
    }

    modal.classList.add('in');
    modal.removeAttribute('aria-hidden');
    modal.style.display = 'block';

    return true;
  }

  async function fillKyivstarTrunkTemplate(entry) {
    const shown = await showKyivstarOperatorModal();
    if (!shown) throw new Error('Не відкрився шаблон Kyivstar Trunk');

    await sleep(120);

    const numberField = $('#operatorKyivstarTrunk input[name="number"]');
    const paiField = $('#operatorKyivstarTrunk input[name="pai"]');
    const insertButton = $('#operatorKyivstarTrunk button.saveNumber');

    if (!numberField || !paiField || !insertButton) {
      throw new Error('Не знайдено поля Kyivstar Trunk');
    }

    setFieldValue(numberField, entry.number);
    setFieldValue(paiField, entry.kind === 'sip' ? entry.pai : '');

    insertButton.click();
    await sleep(CONFIG.delayAfterInsertMs);

    const nameField = $all('input[name="name"]').find(field => {
      const rect = field.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        !field.closest(CONFIG.kyivstarOperatorModalSelector)
      );
    });

    if (!nameField) {
      throw new Error('Не знайдено поле "Название"');
    }

    setFieldValue(nameField, entry.name);
  }

  async function addOneKyivstarNumberAndSave(entry) {
    const state = getKyivstarState();
    const opened = await openAddFormIfNeededForKyivstar(state || {});

    if (!opened) {
      throw new Error('Починати потрібно зі списку розширених номерів, де видно кнопку "Добавить"');
    }

    await fillKyivstarTrunkTemplate(entry);
    await saveCurrentNumber();
  }

  function markCurrentKyivstarEntryDone(state) {
    const completedIndex =
      typeof state.pendingIndex === 'number'
        ? state.pendingIndex
        : state.index;

    const nextState = {
      ...state,
      index: completedIndex + 1,
      phase: 'list',
      lastNumber: state.entries[completedIndex]
        ? state.entries[completedIndex].number
        : state.lastNumber,
    };

    delete nextState.pendingIndex;

    saveKyivstarState(nextState);
    return nextState;
  }

  function findPbxNumberEditHref(number) {
    const rows = $all('tr');

    for (const row of rows) {
      const rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rowText.includes(number)) continue;

      const editLink = $all('a[href*="module=pbxNumbers"][href*="action=edit"][href*="pbxNumberID="]', row)
        .find(link => link.href);

      if (editLink) return editLink.href;
    }

    return '';
  }

  function setRdnisYes() {
    const hidden = $('input[name="isRDNIS"]');
    const yesButton = $('#isRDNIS button[data-value="1"]');

    if (!hidden || !yesButton) {
      throw new Error('Не знайдено поле RDNIS');
    }

    if (hidden.value !== '1') {
      yesButton.click();
      hidden.value = '1';
      hidden.setAttribute('value', '1');
      dispatchFieldEvents(hidden);
    }

    return true;
  }

  function markCurrentKyivstarRdnisDone(state) {
    const completedIndex =
      typeof state.pendingRdnisIndex === 'number'
        ? state.pendingRdnisIndex
        : state.rdnisIndex;

    const nextState = {
      ...state,
      rdnisIndex: completedIndex + 1,
      phase: 'rdnis-list',
      lastRdnisNumber: state.sipNumbers[completedIndex] || state.lastRdnisNumber,
    };

    delete nextState.pendingRdnisIndex;

    saveKyivstarState(nextState);
    return nextState;
  }

  async function processKyivstarRdnisState(state) {
    const params = getPanelParams(state);
    const total = state.sipNumbers.length;

    if (state.rdnisIndex >= total) {
      clearKyivstarState();
      hideEmergencyStopButton();
      setKyivstarLog('Готово. SIP-номери додані, RDNIS увімкнено.', 'success');
      setStatus('Kyivstar Trunk завершено', 'success');
      return;
    }

    if (params.module !== 'pbxNumbers') {
      setKyivstarLog('Переходжу в "Телефонные номера" для RDNIS.', 'info');
      navigateToPanelModule('pbxNumbers', state);
      return;
    }

    if (state.phase === 'rdnis-saving') {
      const nextState = markCurrentKyivstarRdnisDone(state);
      const doneNumber = state.sipNumbers[state.pendingRdnisIndex] || state.sipNumbers[state.rdnisIndex];

      if (doneNumber) {
        setKyivstarLog(`RDNIS: ${nextState.rdnisIndex}/${total}: ${doneNumber} — збережено`, 'success');
      }

      navigateToPanelModule('pbxNumbers', nextState);
      return;
    }

    if (state.phase === 'rdnis-edit') {
      const number = state.sipNumbers[state.rdnisIndex];

      try {
        setKyivstarLog(`RDNIS: вмикаю "Да" для ${number}`, 'info');
        setRdnisYes();

        saveKyivstarState({
          ...state,
          phase: 'rdnis-saving',
          pendingRdnisIndex: state.rdnisIndex,
        });

        await saveCurrentNumber();

        const latestState = getKyivstarState();
        const nextState = markCurrentKyivstarRdnisDone(latestState || state);
        setKyivstarLog(`RDNIS: ${nextState.rdnisIndex}/${total}: ${number} — збережено`, 'success');
        navigateToPanelModule('pbxNumbers', nextState);
      } catch (err) {
        clearKyivstarState();
        hideEmergencyStopButton();
        setKyivstarLog(`RDNIS: ${number} — ${err.message}`, 'error');
        setStatus(`Помилка RDNIS на ${number}`, 'error');
      }

      return;
    }

    if (params.action === 'edit') {
      navigateToPanelModule('pbxNumbers', state);
      return;
    }

    const number = state.sipNumbers[state.rdnisIndex];
    const editHref = findPbxNumberEditHref(number);

    if (!editHref) {
      const nextState = {
        ...state,
        rdnisIndex: state.rdnisIndex + 1,
        phase: 'rdnis-list',
      };

      saveKyivstarState(nextState);
      setKyivstarLog(`RDNIS: ${number} — не знайшов у "Телефонные номера", пропускаю.`, 'warn');
      await sleep(300);
      processKyivstarRdnisState(nextState);
      return;
    }

    saveKyivstarState({
      ...state,
      phase: 'rdnis-edit',
    });

    window.location.href = editHref;
  }

  async function processKyivstarState() {
    const state = getKyivstarState();

    if (!state || !isKyivstarActive()) {
      if (state && !isKyivstarActive()) {
        clearKyivstarState();
      }
      hideEmergencyStopButton();
      return;
    }

    showEmergencyStopButton();

    if (bulkStopRequested) {
      clearKyivstarState();
      hideEmergencyStopButton();
      setKyivstarLog('Kyivstar Trunk зупинено користувачем', 'warn');
      setStatus('Kyivstar Trunk зупинено', 'warn');
      return;
    }

    if (state.phase && state.phase.startsWith('rdnis')) {
      await processKyivstarRdnisState(state);
      return;
    }

    const params = getPanelParams(state);

    if (params.module !== 'pbxNumbersEnhanced') {
      setKyivstarLog('Переходжу в "Расш. телефонные номера".', 'info');
      navigateToPanelModule('pbxNumbersEnhanced', state);
      return;
    }

    const total = state.entries.length;

    if (state.index >= total) {
      if (state.options.setRdnis && state.sipNumbers.length) {
        saveKyivstarState({
          ...state,
          phase: 'rdnis-list',
          rdnisIndex: 0,
        });

        setKyivstarLog('Номери додані. Переходжу до RDNIS.', 'info');
        navigateToPanelModule('pbxNumbers', state);
        return;
      }

      clearKyivstarState();
      hideEmergencyStopButton();
      setKyivstarLog('Готово. Перевір список розширених номерів у панелі.', 'success');
      setStatus('Kyivstar Trunk завершено', 'success');
      return;
    }

    if (state.phase === 'saving') {
      const readyAfterSave = await waitForAddButtonReady(15000);

      if (!readyAfterSave) {
        setKyivstarLog('Чекаю повернення до списку розширених номерів.', 'warn');
        setStatus('Чекаю список номерів', 'warn');
        return;
      }

      const nextState = markCurrentKyivstarEntryDone(state);
      const doneEntry = state.entries[state.pendingIndex] || state.entries[state.index];

      if (doneEntry) {
        setKyivstarLog(`${nextState.index}/${total}: ${doneEntry.number} — збережено`, 'success');
      }

      await sleep(400);
      processKyivstarState();
      return;
    }

    const entry = state.entries[state.index];

    try {
      setKyivstarLog(`${state.index + 1}/${total}: додаю ${entry.number} (${entry.kind === 'pai' ? 'PAI' : 'SIP'})`, 'info');
      setStatus(`Kyivstar Trunk: ${state.index + 1}/${total}`, 'info');

      saveKyivstarState({
        ...state,
        phase: 'saving',
        pendingIndex: state.index,
      });

      await addOneKyivstarNumberAndSave(entry);

      const latestState = getKyivstarState();
      const readyForNext = await waitForAddButtonReady(15000);

      if (!readyForNext) {
        setKyivstarLog('Чекаю повернення до списку розширених номерів.', 'warn');
        setStatus('Чекаю список номерів', 'warn');
        return;
      }

      const nextState = markCurrentKyivstarEntryDone(latestState || state);
      setKyivstarLog(`${nextState.index}/${total}: ${entry.number} — збережено`, 'success');

      await sleep(400);
      processKyivstarState();
    } catch (err) {
      clearKyivstarState();
      hideEmergencyStopButton();
      setKyivstarLog(`${state.index + 1}/${total}: ${entry.number} — ${err.message}`, 'error');
      setStatus(`Помилка Kyivstar на ${entry.number}`, 'error');
    }
  }

  async function runKyivstarAdd() {
    const modal = $(`#${CONFIG.kyivstarModalId}`);
    const pai = $('.bth-kyivstar-pai', modal).value.trim();
    const rawNumbers = $('.bth-kyivstar-numbers', modal).value;
    const addPai = $('.bth-kyivstar-add-pai', modal).checked;
    const setRdnis = $('.bth-kyivstar-rdnis', modal).checked;
    const current = getPanelParams();

    clearKyivstarLog();
    bulkStopRequested = false;
    clearKyivstarState();

    if (!current.companyID || !current.showProjectID) {
      setKyivstarLog('Не бачу companyID/showProjectID у URL. Відкрий потрібний проект Panel.', 'error');
      return;
    }

    if (!/^0\d{9}$/.test(pai)) {
      setKyivstarLog('PAI має бути у форматі 0XXXXXXXXX, наприклад 0897202782.', 'error');
      return;
    }

    let sipNumbers = [];

    try {
      sipNumbers = parseKyivstarNumbers(rawNumbers);
    } catch (err) {
      setKyivstarLog(`Помилка формату SIP-номерів: ${err.message}`, 'error');
      return;
    }

    if (!addPai && !sipNumbers.length) {
      setKyivstarLog('Немає що додавати: увімкни PAI або додай SIP-номери.', 'warn');
      return;
    }

    const entries = [];

    if (addPai) {
      entries.push({
        kind: 'pai',
        number: pai,
        pai: '',
        name: 'Tech SIP KS',
      });
    }

    sipNumbers.forEach(number => {
      entries.push({
        kind: 'sip',
        number,
        pai,
        name: 'Mobile SIP KS',
      });
    });

    saveKyivstarState({
      startedAt: new Date().toISOString(),
      companyID: current.companyID,
      showProjectID: current.showProjectID,
      index: 0,
      phase: 'list',
      entries,
      sipNumbers,
      options: {
        addPai,
        setRdnis,
      },
    });

    setKyivstarActive();
    showEmergencyStopButton();

    setKyivstarLog(`PAI: ${pai}`, 'info');
    setKyivstarLog(`SIP-номерів: ${sipNumbers.length}`, 'info');
    setKyivstarLog('Після кожного "Вставить" скрипт натискатиме "Сохранить".', 'info');

    await processKyivstarState();
  }

  function normalizeCompact(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function setSelectByValueOrText(select, variants) {
    if (!select) return false;

    const normalizedVariants = variants
      .filter(Boolean)
      .map(value => String(value).toLowerCase());

    const option = Array.from(select.options).find(item => {
      const value = String(item.value || '').toLowerCase();
      const text = String(item.textContent || '').trim().toLowerCase();

      return normalizedVariants.some(variant => (
        value === variant ||
        text === variant ||
        value.includes(variant) ||
        text.includes(variant)
      ));
    });

    if (!option) return false;

    select.value = option.value;
    option.selected = true;
    dispatchFieldEvents(select);
    return true;
  }

  function parseFmcTree(rawText) {
    const blocks = rawText
      .split(/\n\s*\n/g)
      .map(block => block.trim())
      .filter(Boolean);

    return blocks.map((block, blockIndex) => {
      const lines = block
        .split(/\r?\n/g)
        .map(line => line.trim())
        .filter(Boolean);

      const voip = normalizeCompact(lines[0] || '');

      if (!/^0\d{9}$/.test(voip)) {
        throw new Error(`Блок ${blockIndex + 1}: VoIP має бути у форматі 0XXXXXXXXX`);
      }

      const mobiles = lines.slice(1).map((line, lineIndex) => {
        const parts = line
          .split('|')
          .map(part => part.trim());

        const mobile = normalizeCompact(parts[0] || '');
        const endpoint = normalizeCompact(parts[1] || '');

        if (!/^0\d{9}$/.test(mobile)) {
          throw new Error(`Блок ${blockIndex + 1}, рядок ${lineIndex + 2}: мобайл має бути у форматі 0XXXXXXXXX`);
        }

        if (!/^[1-9]\d{2,}$/.test(endpoint)) {
          throw new Error(`Блок ${blockIndex + 1}, рядок ${lineIndex + 2}: ВЛ має бути 3+ цифри, наприклад 901`);
        }

        return { mobile, endpoint };
      });

      if (!mobiles.length) {
        throw new Error(`Блок ${blockIndex + 1}: під VoIP потрібно додати хоча б один мобайл з ВЛ`);
      }

      return { voip, mobiles };
    });
  }

  function buildFmcEntries(prefix, blocks, options) {
    const entries = [];

    if (options.addPrefix && prefix) {
      entries.push({
        kind: 'prefix',
        number: prefix,
        name: '',
        csip: '',
      });
    }

    blocks.forEach(block => {
      entries.push({
        kind: 'voip',
        number: block.voip,
        voip: block.voip,
        name: `FMCLC_${block.voip}`,
        csip: '',
      });

      block.mobiles.forEach(item => {
        entries.push({
          kind: 'mobileNumber',
          number: item.mobile,
          mobile: item.mobile,
          voip: block.voip,
          endpoint: item.endpoint,
          name: `FMCLC_${block.voip}`,
          csip: block.voip,
        });

        entries.push({
          kind: 'mobileEndpoint',
          number: item.mobile,
          mobile: item.mobile,
          voip: block.voip,
          endpoint: item.endpoint,
          name: `FMCLC_${block.voip}`,
        });
      });
    });

    return entries;
  }

  function findEnhancedNumberRow(number) {
    const expected = String(number || '').trim();
    if (!expected) return null;

    return $all('tr').find(row => {
      const cells = $all('td, th', row).map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim());
      return cells.some(cell => cell === expected || cell.includes(expected));
    }) || null;
  }

  function findEndpointRowByInternalNumber(internalNumber) {
    const expected = String(internalNumber || '').trim();
    if (!expected) return null;

    const regex = new RegExp(`(^|\\D)${escapeRegExp(expected)}(\\D|$)`);

    return $all('tr').find(row => {
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      return regex.test(text);
    }) || null;
  }

  function getVisibleNumberConflictText() {
    const bodyText = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    const match = bodyText.match(/Номер\s+уже\s+используется\s*\(companyID:\s*\d+\)/i);

    if (match) return match[0];

    return /Номер\s+уже\s+используется/i.test(bodyText)
      ? 'Номер уже используется'
      : '';
  }

  async function openAddFormIfNeededForFmc(state) {
    if ($(CONFIG.fmcLifeOperatorModalSelector)) return true;

    const readyForAdd = await waitForAddButtonReady(15000);
    if (!readyForAdd) return false;

    const addButton = findVisibleAddButton();
    if (!addButton) return false;

    saveFmcState({
      ...state,
      phase: 'opening',
    });

    addButton.click();

    const modal = await waitForElement(CONFIG.fmcLifeOperatorModalSelector, 10000);
    return Boolean(modal);
  }

  async function ensureFmcLifeModalExists() {
    if ($(CONFIG.fmcLifeOperatorModalSelector)) return true;

    const addButton = findVisibleAddButton();

    if (addButton) {
      addButton.click();
      await sleep(500);
    }

    return Boolean($(CONFIG.fmcLifeOperatorModalSelector));
  }

  async function showFmcLifeModal() {
    const exists = await ensureFmcLifeModalExists();

    if (!exists) {
      setStatus('Не знайдено шаблон Life Binotel', 'error');
      return false;
    }

    const modal = $(CONFIG.fmcLifeOperatorModalSelector);

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
      return true;
    }

    const opener = $('a[href="#operatorLifeBinotel"][data-toggle="modal"]') || $('a[href="#operatorLifeBinotel"]');

    if (opener) {
      opener.click();
      return true;
    }

    modal.classList.add('in');
    modal.removeAttribute('aria-hidden');
    modal.style.display = 'block';

    return true;
  }

  async function insertFmcLifeTemplate(entry) {
    const shown = await showFmcLifeModal();
    if (!shown) throw new Error('Не відкрився шаблон Life Binotel');

    await sleep(150);

    const modal = $(CONFIG.fmcLifeOperatorModalSelector);
    const lifeServer = $('select[name="lifeBinotelServer"]', modal);
    const sipServer = $('select[name="sipServer"]', modal);
    const numberField = $('input[name="number"]', modal);
    const csipField = $('select[name="csip"]', modal);
    const insertButton = $('button.saveNumber', modal);

    if (!lifeServer || !sipServer || !numberField || !csipField || !insertButton) {
      throw new Error('Не знайдено поля Life Binotel');
    }

    numberField.removeAttribute('data-replace-online');
    numberField.removeAttribute('pattern');

    setSelectByValueOrText(lifeServer, ['life-binotel-1']);

    if (!sipServer.value) {
      setSelectByValueOrText(sipServer, ['sip35']);
    }

    if (entry.csip) {
      const csipSelected = setSelectByValueOrText(csipField, [entry.csip]);
      if (!csipSelected) {
        throw new Error(`VoIP ${entry.csip} ще не доступний у CSIP списку`);
      }
    } else {
      setFieldValue(csipField, '');
    }

    setFieldValue(numberField, entry.number);

    insertButton.click();
    await sleep(CONFIG.delayAfterInsertMs);

    const conflictText = getVisibleNumberConflictText();

    if (conflictText) {
      if (entry.kind === 'prefix') {
        return {
          skipped: true,
          reason: conflictText,
        };
      }

      throw new Error(conflictText);
    }

    if (entry.name) {
      const nameField = $all('input[name="name"]').find(field => {
        const rect = field.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !field.closest(CONFIG.fmcLifeOperatorModalSelector)
        );
      });

      if (!nameField) {
        throw new Error('Не знайдено поле "Название" після вставки');
      }

      setFieldValue(nameField, entry.name);
    }

    return {
      skipped: false,
    };
  }

  async function showMobileEndpointModal() {
    const modal = $('#addMobileEndpoint');

    if (!modal) {
      throw new Error('Не знайдено модалку додавання мобільної ВЛ');
    }

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
      return modal;
    }

    modal.classList.add('in');
    modal.removeAttribute('aria-hidden');
    modal.style.display = 'block';

    return modal;
  }

  async function submitMobileEndpointCreate(entry, state) {
    const modal = await showMobileEndpointModal();

    await sleep(120);

    const fmcType = $('select[name="fmcType"]', modal);
    const mobileInput = $('input[name="mobileEndpointLogin"]', modal);
    const submitButton = $('button[type="submit"]', modal) || $('.btn-inverse', modal);

    if (!fmcType || !mobileInput || !submitButton) {
      throw new Error('Не знайдено поля мобільної ВЛ');
    }

    mobileInput.removeAttribute('data-replace-online');
    mobileInput.removeAttribute('pattern');

    setSelectByValueOrText(fmcType, ['lc', 'lifecell']);
    setFieldValue(mobileInput, entry.mobile);

    saveFmcState({
      ...state,
      phase: 'mobile-edit',
      pendingIndex: state.index,
    });

    submitButton.click();

    setTimeout(processFmcState, 1200);
  }

  async function fillMobileEndpointEditAndSave(state) {
    const entry = state.entries[state.pendingIndex ?? state.index];

    if (!entry) {
      throw new Error('Не знайдено поточний мобайл для редагування ВЛ');
    }

    const internalNumberField = $('input[name="internalNumber"]');
    const nameField = $('input[name="name"]');
    const projectSelect = $('select[name="projectID"]');

    if (!internalNumberField || !nameField) {
      throw new Error('Не знайдено поля внутрішньої лінії після створення мобайла');
    }

    setFieldValue(internalNumberField, entry.endpoint);
    setFieldValue(nameField, entry.name);

    if (projectSelect && state.showProjectID) {
      setSelectByValueOrText(projectSelect, [state.showProjectID]);
    }

    saveFmcState({
      ...state,
      phase: 'mobile-saving',
      pendingIndex: state.pendingIndex ?? state.index,
    });

    await saveCurrentNumber();
  }

  function markCurrentFmcEntryDone(state) {
    const completedIndex =
      typeof state.pendingIndex === 'number'
        ? state.pendingIndex
        : state.index;

    const nextState = {
      ...state,
      index: completedIndex + 1,
      phase: 'list',
      lastNumber: state.entries[completedIndex]
        ? state.entries[completedIndex].number
        : state.lastNumber,
    };

    delete nextState.pendingIndex;

    saveFmcState(nextState);
    return nextState;
  }

  function fmcEntryLabel(entry) {
    if (entry.kind === 'prefix') return `prefix ${entry.number}`;
    if (entry.kind === 'voip') return `VoIP ${entry.number}`;
    if (entry.kind === 'mobileNumber') return `mobile ${entry.mobile} → ${entry.voip}`;
    if (entry.kind === 'mobileEndpoint') return `ВЛ ${entry.endpoint} для ${entry.mobile}`;
    return entry.number || entry.kind;
  }

  async function processFmcState() {
    const state = getFmcState();

    if (!state || !isFmcActive()) {
      if (state && !isFmcActive()) {
        clearFmcState();
      }
      hideEmergencyStopButton();
      return;
    }

    showEmergencyStopButton();

    if (bulkStopRequested) {
      clearFmcState();
      hideEmergencyStopButton();
      setFmcLog('FMC Lifecell зупинено користувачем', 'warn');
      setStatus('FMC Lifecell зупинено', 'warn');
      return;
    }

    const total = state.entries.length;

    if (state.index >= total) {
      clearFmcState();
      hideEmergencyStopButton();
      setFmcLog('Готово. FMC Lifecell оброблено.', 'success');
      setStatus('FMC Lifecell завершено', 'success');
      return;
    }

    if (state.phase === 'saving' || state.phase === 'mobile-saving') {
      const nextState = markCurrentFmcEntryDone(state);
      const doneEntry = state.entries[state.pendingIndex] || state.entries[state.index];

      if (doneEntry) {
        setFmcLog(`${nextState.index}/${total}: ${fmcEntryLabel(doneEntry)} — збережено`, 'success');
      }

      await sleep(500);
      processFmcState();
      return;
    }

    const params = getPanelParams(state);
    const entry = state.entries[state.index];

    if (state.phase === 'mobile-edit') {
      if (params.module !== 'endpoints' || params.action !== 'edit') {
        setFmcLog('Чекаю сторінку редагування мобільної ВЛ...', 'warn');
        setTimeout(processFmcState, 1000);
        return;
      }

      try {
        await fillMobileEndpointEditAndSave(state);
        const latestState = getFmcState();
        const nextState = markCurrentFmcEntryDone(latestState || state);
        setFmcLog(`${nextState.index}/${total}: ${fmcEntryLabel(entry)} — ВЛ збережено`, 'success');
        navigateToPanelModule('endpoints', nextState);
      } catch (err) {
        clearFmcState();
        hideEmergencyStopButton();
        setFmcLog(`${fmcEntryLabel(entry)} — ${err.message}`, 'error');
        setStatus('Помилка FMC Lifecell', 'error');
      }

      return;
    }

    if (entry.kind === 'mobileEndpoint') {
      if (params.module !== 'endpoints') {
        setFmcLog('Переходжу у "Внутренние линии" для мобільної ВЛ.', 'info');
        navigateToPanelModule('endpoints', state);
        return;
      }

      if (params.action === 'edit') {
        navigateToPanelModule('endpoints', state);
        return;
      }

      if (findEndpointRowByInternalNumber(entry.endpoint)) {
        const nextState = markCurrentFmcEntryDone(state);
        setFmcLog(`${nextState.index}/${total}: ВЛ ${entry.endpoint} вже існує — пропускаю`, 'warn');
        await sleep(400);
        processFmcState();
        return;
      }

      try {
        setFmcLog(`${state.index + 1}/${total}: додаю мобільну ВЛ ${entry.endpoint} для ${entry.mobile}`, 'info');
        await submitMobileEndpointCreate(entry, state);
      } catch (err) {
        clearFmcState();
        hideEmergencyStopButton();
        setFmcLog(`${fmcEntryLabel(entry)} — ${err.message}`, 'error');
        setStatus('Помилка FMC Lifecell', 'error');
      }

      return;
    }

    if (params.module !== 'pbxNumbersEnhanced') {
      setFmcLog('Переходжу в "Расш. телефонные номера".', 'info');
      navigateToPanelModule('pbxNumbersEnhanced', state);
      return;
    }

    if (params.action === 'edit') {
      navigateToPanelModule('pbxNumbersEnhanced', state);
      return;
    }

    if (findEnhancedNumberRow(entry.number)) {
      const nextState = markCurrentFmcEntryDone(state);
      setFmcLog(`${nextState.index}/${total}: ${fmcEntryLabel(entry)} вже є в компанії — пропускаю`, 'warn');
      await sleep(400);
      processFmcState();
      return;
    }

    try {
      setFmcLog(`${state.index + 1}/${total}: додаю ${fmcEntryLabel(entry)}`, 'info');
      setStatus(`FMC Lifecell: ${state.index + 1}/${total}`, 'info');

      const opened = await openAddFormIfNeededForFmc(state);

      if (!opened) {
        throw new Error('Починати потрібно зі списку розширених номерів, де видно кнопку "Добавить"');
      }

      saveFmcState({
        ...state,
        phase: 'processing',
        pendingIndex: state.index,
      });

      const result = await insertFmcLifeTemplate(entry);

      if (result.skipped) {
        const latestState = getFmcState() || state;
        const nextState = markCurrentFmcEntryDone(latestState);
        setFmcLog(`${nextState.index}/${total}: ${fmcEntryLabel(entry)} — ${result.reason}, пропускаю`, 'warn');
        navigateToPanelModule('pbxNumbersEnhanced', nextState);
        return;
      }

      saveFmcState({
        ...(getFmcState() || state),
        phase: 'saving',
        pendingIndex: state.index,
      });

      await saveCurrentNumber();

      const latestState = getFmcState();
      const nextState = markCurrentFmcEntryDone(latestState || state);
      setFmcLog(`${nextState.index}/${total}: ${fmcEntryLabel(entry)} — збережено`, 'success');

      navigateToPanelModule('pbxNumbersEnhanced', nextState);
    } catch (err) {
      clearFmcState();
      hideEmergencyStopButton();
      setFmcLog(`${state.index + 1}/${total}: ${fmcEntryLabel(entry)} — ${err.message}`, 'error');
      setStatus('Помилка FMC Lifecell', 'error');
    }
  }

  async function runFmcAdd() {
    const modal = $(`#${CONFIG.fmcModalId}`);
    const prefix = normalizeCompact($('.bth-fmc-prefix', modal).value || '');
    const rawTree = $('.bth-fmc-tree', modal).value;
    const addPrefix = $('.bth-fmc-add-prefix', modal).checked;
    const current = getPanelParams();

    clearFmcLog();
    bulkStopRequested = false;
    clearFmcState();

    if (!current.companyID || !current.showProjectID) {
      setFmcLog('Не бачу companyID/showProjectID у URL. Відкрий потрібний проект Panel.', 'error');
      return;
    }

    if (addPrefix && !prefix) {
      setFmcLog('Вкажи префікс або зніми галку додавання префікса.', 'error');
      return;
    }

    if (addPrefix && !/^[0-9A-Za-z_-]+$/.test(prefix)) {
      setFmcLog('Префікс має містити тільки цифри/літери без пробілів, наприклад 3916B.', 'error');
      return;
    }

    let blocks = [];

    try {
      blocks = parseFmcTree(rawTree);
    } catch (err) {
      setFmcLog(`Помилка формату дерева: ${err.message}`, 'error');
      return;
    }

    const entries = buildFmcEntries(prefix, blocks, { addPrefix });

    if (!entries.length) {
      setFmcLog('Немає що додавати.', 'warn');
      return;
    }

    saveFmcState({
      startedAt: new Date().toISOString(),
      companyID: current.companyID,
      showProjectID: current.showProjectID,
      index: 0,
      phase: 'list',
      prefix,
      blocks,
      entries,
      options: {
        addPrefix,
      },
    });

    setFmcActive();
    showEmergencyStopButton();

    setFmcLog(`Префікс: ${addPrefix ? prefix : 'не додаємо'}`, 'info');
    setFmcLog(`VoIP блоків: ${blocks.length}`, 'info');
    setFmcLog(`Кроків до виконання: ${entries.length}`, 'info');

    await processFmcState();
  }

  function openBulkModal() {
    let modal = $(`#${CONFIG.bulkModalId}`);

    if (!modal) {
      modal = createBulkModal();
    }

    modal.style.display = 'flex';
  }

  function openKyivstarModal() {
    let modal = $(`#${CONFIG.kyivstarModalId}`);

    if (!modal) {
      modal = createKyivstarModal();
    }

    modal.style.display = 'flex';
  }

  function openFmcModal() {
    clearFmcState();

    if (
      window.BinotelFmcLifecellEmbedded &&
      typeof window.BinotelFmcLifecellEmbedded.open === 'function'
    ) {
      window.BinotelFmcLifecellEmbedded.open();
      return;
    }

    setStatus('FMC Lifecell ще ініціалізується. Онови сторінку і спробуй ще раз.', 'warn');
  }

  function closeFmcModal() {
    const modal = $(`#${CONFIG.fmcModalId}`);
    if (modal) modal.style.display = 'none';
  }

  function createBulkModal() {
    const modal = document.createElement('div');
    modal.id = CONFIG.bulkModalId;

    modal.innerHTML = `
      <div class="bth-bulk-window">
        <div class="bth-bulk-header">
          <div>
            <div class="bth-bulk-title">Масове додавання номерів</div>
            <div class="bth-bulk-subtitle">Кожен номер окремим блоком, блоки розділяй через <b>---</b></div>
          </div>
          <button type="button" class="bth-bulk-close">×</button>
        </div>

        <div class="bth-bulk-options">
          <label><input type="checkbox" class="bth-option-trunk"> Це транк: register не потрібен</label>
          <div class="bth-option-note">Якщо галка не стоїть — register буде згенеровано автоматично.</div>
          <label><input type="checkbox" class="bth-option-proxy"> Враховувати outboundproxy у register</label>
          <label><input type="checkbox" class="bth-option-port"> Враховувати port у register</label>
        </div>

        <div class="bth-bulk-grid">
          <div>
            <div class="bth-bulk-label">Дані для додавання</div>
            <textarea class="bth-bulk-textarea" spellcheck="false"></textarea>
          </div>
          <div>
            <div class="bth-bulk-label">Приклад</div>
            <pre class="bth-bulk-example"></pre>
            <button type="button" class="bth-bulk-copy-example">Вставити приклад у поле</button>
          </div>
        </div>

        <div class="bth-bulk-actions">
          <button type="button" class="bth-bulk-start">Старт</button>
          <button type="button" class="bth-bulk-stop">Стоп</button>
          <button type="button" class="bth-bulk-clear">Очистити лог</button>
        </div>

        <div class="bth-bulk-log"></div>
      </div>
    `;

    document.body.appendChild(modal);

    $('.bth-bulk-example', modal).textContent = EXAMPLE_TEXT;
    $('.bth-bulk-close', modal).addEventListener('click', closeBulkModal);
    $('.bth-bulk-copy-example', modal).addEventListener('click', () => {
      $('.bth-bulk-textarea', modal).value = EXAMPLE_TEXT;
    });
    $('.bth-bulk-start', modal).addEventListener('click', runBulkAdd);
    $('.bth-bulk-stop', modal).addEventListener('click', () => {
      bulkStopRequested = true;
      clearBulkState();
      hideEmergencyStopButton();
      setBulkLog('Очікую завершення поточного номера і зупиняюся...', 'warn');
    });
    $('.bth-bulk-clear', modal).addEventListener('click', clearBulkLog);

    return modal;
  }

  function createKyivstarModal() {
    const modal = document.createElement('div');
    modal.id = CONFIG.kyivstarModalId;

    modal.innerHTML = `
      <div class="bth-kyivstar-window">
        <div class="bth-kyivstar-header">
          <div>
            <div class="bth-kyivstar-title">Kyivstar Trunk</div>
            <div class="bth-kyivstar-subtitle">Один PAI + список мобільних SIP-номерів. PAI додається як Tech SIP KS, SIP — як Mobile SIP KS.</div>
          </div>
          <button type="button" class="bth-kyivstar-close">×</button>
        </div>

        <div class="bth-kyivstar-options">
          <label>
            <span>PAI / технічний 089</span>
            <input type="text" class="bth-kyivstar-pai" value="" placeholder="Наприклад: 0897202782">
          </label>
          <label class="bth-kyivstar-check"><input type="checkbox" class="bth-kyivstar-add-pai" checked> Додати PAI як Tech SIP KS</label>
          <label class="bth-kyivstar-check"><input type="checkbox" class="bth-kyivstar-rdnis" checked> Після SIP увімкнути RDNIS = Да</label>
        </div>

        <div class="bth-kyivstar-grid">
          <div>
            <div class="bth-kyivstar-label">SIP-номери Kyivstar</div>
            <textarea class="bth-kyivstar-numbers" spellcheck="false" placeholder="0674002203&#10;0674002204"></textarea>
          </div>
          <div>
            <div class="bth-kyivstar-label">Приклад</div>
            <pre class="bth-kyivstar-example"></pre>
            <button type="button" class="bth-kyivstar-copy-example">Вставити приклад у поле</button>
          </div>
        </div>

        <div class="bth-kyivstar-actions">
          <button type="button" class="bth-kyivstar-start">Старт</button>
          <button type="button" class="bth-kyivstar-stop">Стоп</button>
          <button type="button" class="bth-kyivstar-clear">Очистити лог</button>
        </div>

        <div class="bth-kyivstar-log"></div>
      </div>
    `;

    document.body.appendChild(modal);

    $('.bth-kyivstar-example', modal).textContent = KYIVSTAR_EXAMPLE_TEXT;
    $('.bth-kyivstar-close', modal).addEventListener('click', closeKyivstarModal);
    $('.bth-kyivstar-copy-example', modal).addEventListener('click', () => {
      $('.bth-kyivstar-numbers', modal).value = KYIVSTAR_EXAMPLE_TEXT;
    });
    $('.bth-kyivstar-start', modal).addEventListener('click', runKyivstarAdd);
    $('.bth-kyivstar-stop', modal).addEventListener('click', () => {
      bulkStopRequested = true;
      clearKyivstarState();
      hideEmergencyStopButton();
      setKyivstarLog('Очікую завершення поточної дії і зупиняюся...', 'warn');
    });
    $('.bth-kyivstar-clear', modal).addEventListener('click', clearKyivstarLog);

    return modal;
  }

  function createFmcModal() {
    const modal = document.createElement('div');
    modal.id = CONFIG.fmcModalId;

    modal.innerHTML = `
      <div class="bth-fmc-window">
        <div class="bth-fmc-header">
          <div>
            <div class="bth-fmc-title">FMC Lifecell</div>
            <div class="bth-fmc-subtitle">Префікс + VoIP + мобайли з ВЛ. VoIP може бути багатоканальним, тому під ним можна вказати кілька мобайлів.</div>
          </div>
          <button type="button" class="bth-fmc-close">×</button>
        </div>

        <div class="bth-fmc-options">
          <label>
            <span>Префікс</span>
            <input type="text" class="bth-fmc-prefix" value="3916B" placeholder="3916B">
          </label>
          <label class="bth-fmc-check"><input type="checkbox" class="bth-fmc-add-prefix" checked> Додати / перевірити префікс</label>
          <div class="bth-fmc-note">Якщо Panel покаже “Номер уже используется (companyID: …)” — префікс вважаємо вже доданим на Life-Asterisk 1 і пропускаємо.</div>
        </div>

        <div class="bth-fmc-grid">
          <div>
            <div class="bth-fmc-label">Дерево FMC</div>
            <textarea class="bth-fmc-tree" spellcheck="false" placeholder="0930000000&#10;0730000000 | 901&#10;&#10;0930000001&#10;0730000001 | 902"></textarea>
          </div>
          <div>
            <div class="bth-fmc-label">Приклад</div>
            <pre class="bth-fmc-example"></pre>
            <button type="button" class="bth-fmc-copy-example">Вставити приклад у поле</button>
            <div class="bth-fmc-help">
              <b>Формат:</b><br>
              1-й рядок блоку — VoIP.<br>
              Нижче — мобайли: <code>номер | ВЛ</code>.<br>
              Порожній рядок — наступний VoIP.
            </div>
          </div>
        </div>

        <div class="bth-fmc-actions">
          <button type="button" class="bth-fmc-start">Старт</button>
          <button type="button" class="bth-fmc-stop">Стоп</button>
          <button type="button" class="bth-fmc-clear">Очистити лог</button>
        </div>

        <div class="bth-fmc-log"></div>
      </div>
    `;

    document.body.appendChild(modal);

    $('.bth-fmc-example', modal).textContent = FMC_EXAMPLE_TEXT;
    $('.bth-fmc-tree', modal).value = FMC_EXAMPLE_TEXT;
    $('.bth-fmc-close', modal).addEventListener('click', closeFmcModal);
    $('.bth-fmc-copy-example', modal).addEventListener('click', () => {
      $('.bth-fmc-tree', modal).value = FMC_EXAMPLE_TEXT;
    });
    $('.bth-fmc-start', modal).addEventListener('click', runFmcAdd);
    $('.bth-fmc-stop', modal).addEventListener('click', () => {
      bulkStopRequested = true;
      clearFmcState();
      hideEmergencyStopButton();
      setFmcLog('Очікую завершення поточної дії і зупиняюсь...', 'warn');
    });
    $('.bth-fmc-clear', modal).addEventListener('click', clearFmcLog);

    return modal;
  }

  function toggleMenu() {
    const panel = $(`#${CONFIG.panelId}`);
    if (!panel) return;

    panel.classList.toggle('bth-open');
  }

  function getSavedPosition() {
    try {
      const raw = localStorage.getItem(CONFIG.positionStorageKey);
      if (!raw) return null;

      const position = JSON.parse(raw);

      if (
        typeof position.left !== 'number' ||
        typeof position.top !== 'number'
      ) {
        return null;
      }

      return position;
    } catch (err) {
      return null;
    }
  }

  function savePosition(left, top) {
    localStorage.setItem(
      CONFIG.positionStorageKey,
      JSON.stringify({ left, top })
    );
  }

  function applyInitialPosition(panel) {
    const savedPosition = getSavedPosition();

    panel.style.position = 'fixed';

    if (savedPosition) {
      panel.style.left = `${savedPosition.left}px`;
      panel.style.top = `${savedPosition.top}px`;
      panel.style.right = 'auto';
      return;
    }

    panel.style.right = '28px';
    panel.style.top = '135px';
  }

  function clampPosition(left, top, panel) {
    const rect = panel.getBoundingClientRect();
    const margin = 8;

    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function enableDrag(panel) {
    const dragHandle = panel.querySelector('.bth-main-btn');
    if (!dragHandle) return;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    dragHandle.addEventListener('mousedown', event => {
      if (event.button !== 0) return;

      dragging = true;
      moved = false;

      const rect = panel.getBoundingClientRect();

      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      panel.style.right = 'auto';
      panel.classList.add('bth-dragging');

      event.preventDefault();
    });

    document.addEventListener('mousemove', event => {
      if (!dragging) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        moved = true;
      }

      const next = clampPosition(startLeft + dx, startTop + dy, panel);

      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', event => {
      if (!dragging) return;

      dragging = false;
      panel.classList.remove('bth-dragging');

      const rect = panel.getBoundingClientRect();
      const next = clampPosition(rect.left, rect.top, panel);

      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = 'auto';

      savePosition(next.left, next.top);

      if (moved) {
        event.stopPropagation();
      }
    }, true);

    dragHandle.addEventListener('click', event => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
        return;
      }

      toggleMenu();
    });
  }

  function createPanel() {
    if ($(`#${CONFIG.panelId}`)) return;

    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;

    panel.innerHTML = `
      <button type="button" class="bth-main-btn" title="Клік — відкрити меню, затисни й перетягни — змінити позицію">
        ⚙️ Binotel helper
      </button>

      <div class="bth-menu">
        <button type="button" class="bth-btn bth-open-universal">
          🔓 Універсальний шаблон
        </button>

        <button type="button" class="bth-btn bth-set-tele2">
          📡 SIP-шаблон Tele2
        </button>

        <button type="button" class="bth-btn bth-open-bulk">
          📦 Масове додавання
        </button>

        <button type="button" class="bth-btn bth-open-kyivstar">
          ⭐ Kyivstar Trunk
        </button>

        <button type="button" class="bth-btn bth-open-fmc">
          📱 FMC Lifecell
        </button>

        <div class="bth-status info">Готово</div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #${CONFIG.panelId} {
        z-index: 999999;
        width: 185px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        user-select: none;
      }

      #${CONFIG.panelId} .bth-main-btn {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        background: #1f2937;
        color: #ffffff;
        cursor: grab;
        font-weight: 700;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      }

      #${CONFIG.panelId}.bth-dragging .bth-main-btn {
        cursor: grabbing;
      }

      #${CONFIG.panelId} .bth-main-btn:hover {
        background: #111827;
      }

      #${CONFIG.panelId} .bth-menu {
        display: none;
        margin-top: 6px;
        padding: 8px;
        background: #1f2937;
        border-radius: 9px;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28);
      }

      #${CONFIG.panelId}.bth-open .bth-menu {
        display: block;
      }

      #${CONFIG.panelId} .bth-btn {
        width: 100%;
        display: block;
        border: none;
        border-radius: 7px;
        padding: 8px 7px;
        margin-bottom: 7px;
        cursor: pointer;
        color: #ffffff;
        font-weight: 700;
        font-size: 12px;
        line-height: 1.2;
      }

      #${CONFIG.panelId} .bth-open-universal {
        background: #2563eb;
      }

      #${CONFIG.panelId} .bth-open-universal:hover {
        background: #1d4ed8;
      }

      #${CONFIG.panelId} .bth-set-tele2 {
        background: #16a34a;
      }

      #${CONFIG.panelId} .bth-set-tele2:hover {
        background: #15803d;
      }

      #${CONFIG.panelId} .bth-open-bulk {
        background: #9333ea;
      }

      #${CONFIG.panelId} .bth-open-bulk:hover {
        background: #7e22ce;
      }

      #${CONFIG.panelId} .bth-open-kyivstar {
        background: #f59e0b;
      }

      #${CONFIG.panelId} .bth-open-kyivstar:hover {
        background: #d97706;
      }

      #${CONFIG.panelId} .bth-open-fmc {
        background: #0d9488;
      }

      #${CONFIG.panelId} .bth-open-fmc:hover {
        background: #0f766e;
      }

      #${CONFIG.panelId} .bth-status {
        margin-top: 2px;
        padding: 6px;
        border-radius: 7px;
        font-size: 11px;
        line-height: 1.2;
        text-align: center;
        word-break: break-word;
      }

      #${CONFIG.panelId} .bth-status.info {
        background: rgba(255, 255, 255, 0.12);
        color: #e5e7eb;
      }

      #${CONFIG.panelId} .bth-status.success {
        background: rgba(34, 197, 94, 0.18);
        color: #bbf7d0;
      }

      #${CONFIG.panelId} .bth-status.error {
        background: rgba(239, 68, 68, 0.2);
        color: #fecaca;
      }

      #${CONFIG.panelId} .bth-status.warn {
        background: rgba(245, 158, 11, 0.2);
        color: #fde68a;
      }

      #${CONFIG.bulkModalId} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font-family: Arial, sans-serif;
      }

      #${CONFIG.bulkModalId} .bth-bulk-window {
        width: min(1120px, calc(100vw - 50px));
        max-height: calc(100vh - 50px);
        overflow: auto;
        background: #ffffff;
        color: #111827;
        border-radius: 12px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }

      #${CONFIG.bulkModalId} .bth-bulk-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      #${CONFIG.bulkModalId} .bth-bulk-title {
        font-size: 20px;
        font-weight: 800;
      }

      #${CONFIG.bulkModalId} .bth-bulk-subtitle {
        margin-top: 4px;
        color: #6b7280;
        font-size: 12px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-close {
        border: none;
        background: transparent;
        font-size: 28px;
        line-height: 1;
        cursor: pointer;
        color: #6b7280;
      }

      #${CONFIG.bulkModalId} .bth-bulk-options {
        display: grid;
        grid-template-columns: repeat(2, minmax(260px, 1fr));
        gap: 8px 18px;
        padding: 12px 18px;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
        font-size: 13px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-options label {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      #${CONFIG.bulkModalId} .bth-option-note {
        color: #64748b;
        font-size: 12px;
        line-height: 1.25;
        padding-left: 23px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 14px;
        padding: 14px 18px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-label {
        margin-bottom: 7px;
        font-weight: 700;
      }

      #${CONFIG.bulkModalId} .bth-bulk-textarea {
        width: 100%;
        min-height: 360px;
        resize: vertical;
        padding: 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
        box-sizing: border-box;
      }

      #${CONFIG.bulkModalId} .bth-bulk-example {
        min-height: 330px;
        max-height: 360px;
        overflow: auto;
        margin: 0;
        padding: 10px;
        background: #0f172a;
        color: #dbeafe;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      #${CONFIG.bulkModalId} .bth-bulk-copy-example {
        margin-top: 8px;
        border: none;
        border-radius: 7px;
        padding: 8px 10px;
        background: #475569;
        color: #ffffff;
        cursor: pointer;
      }

      #${CONFIG.bulkModalId} .bth-bulk-actions {
        display: flex;
        gap: 8px;
        padding: 0 18px 12px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-actions button {
        border: none;
        border-radius: 7px;
        padding: 9px 14px;
        color: #ffffff;
        font-weight: 700;
        cursor: pointer;
      }

      #${CONFIG.bulkModalId} .bth-bulk-start {
        background: #16a34a;
      }

      #${CONFIG.bulkModalId} .bth-bulk-stop {
        background: #dc2626;
      }

      #${CONFIG.bulkModalId} .bth-bulk-clear {
        background: #64748b;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log {
        margin: 0 18px 18px;
        padding: 10px;
        min-height: 70px;
        max-height: 150px;
        overflow: auto;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 12px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log-row {
        margin-bottom: 4px;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log-row.success {
        color: #15803d;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log-row.error {
        color: #b91c1c;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log-row.warn {
        color: #b45309;
      }

      #${CONFIG.bulkModalId} .bth-bulk-log-row.info {
        color: #334155;
      }

      #${CONFIG.kyivstarModalId} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font-family: Arial, sans-serif;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-window {
        width: min(980px, calc(100vw - 50px));
        max-height: calc(100vh - 50px);
        overflow: auto;
        background: #ffffff;
        color: #111827;
        border-radius: 12px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-title {
        font-size: 20px;
        font-weight: 800;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-subtitle {
        margin-top: 4px;
        color: #6b7280;
        font-size: 12px;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-close {
        border: none;
        background: transparent;
        font-size: 28px;
        line-height: 1;
        cursor: pointer;
        color: #6b7280;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-options {
        display: grid;
        grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr);
        gap: 10px 16px;
        padding: 12px 18px;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
        font-size: 13px;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-options label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-weight: 700;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-options input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-options .bth-kyivstar-check {
        flex-direction: row;
        align-items: center;
        font-weight: 500;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-grid {
        display: grid;
        grid-template-columns: 1fr 0.8fr;
        gap: 14px;
        padding: 14px 18px;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-label {
        margin-bottom: 7px;
        font-weight: 700;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-numbers {
        width: 100%;
        min-height: 240px;
        resize: vertical;
        padding: 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 13px;
        line-height: 1.45;
        box-sizing: border-box;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-example {
        min-height: 210px;
        max-height: 240px;
        overflow: auto;
        margin: 0;
        padding: 10px;
        background: #0f172a;
        color: #dbeafe;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-copy-example {
        margin-top: 8px;
        border: none;
        border-radius: 7px;
        padding: 8px 10px;
        background: #475569;
        color: #ffffff;
        cursor: pointer;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-actions {
        display: flex;
        gap: 8px;
        padding: 0 18px 12px;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-actions button {
        border: none;
        border-radius: 7px;
        padding: 9px 14px;
        color: #ffffff;
        font-weight: 700;
        cursor: pointer;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-start {
        background: #16a34a;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-stop {
        background: #dc2626;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-clear {
        background: #64748b;
      }

      #${CONFIG.kyivstarModalId} .bth-kyivstar-log {
        margin: 0 18px 18px;
        padding: 10px;
        min-height: 70px;
        max-height: 150px;
        overflow: auto;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 12px;
      }

      #${CONFIG.fmcModalId} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font-family: Arial, sans-serif;
      }

      #${CONFIG.fmcModalId} .bth-fmc-window {
        width: min(1040px, calc(100vw - 50px));
        max-height: calc(100vh - 50px);
        overflow: auto;
        background: #ffffff;
        color: #111827;
        border-radius: 12px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }

      #${CONFIG.fmcModalId} .bth-fmc-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      #${CONFIG.fmcModalId} .bth-fmc-title {
        font-size: 20px;
        font-weight: 800;
      }

      #${CONFIG.fmcModalId} .bth-fmc-subtitle {
        margin-top: 4px;
        color: #6b7280;
        font-size: 12px;
      }

      #${CONFIG.fmcModalId} .bth-fmc-close {
        border: none;
        background: transparent;
        font-size: 28px;
        line-height: 1;
        cursor: pointer;
        color: #6b7280;
      }

      #${CONFIG.fmcModalId} .bth-fmc-options {
        display: grid;
        grid-template-columns: minmax(220px, 0.7fr) minmax(240px, 0.8fr) minmax(320px, 1.5fr);
        gap: 10px 16px;
        padding: 12px 18px;
        background: #f8fafc;
        border-bottom: 1px solid #e5e7eb;
        font-size: 13px;
      }

      #${CONFIG.fmcModalId} .bth-fmc-options label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-weight: 700;
      }

      #${CONFIG.fmcModalId} .bth-fmc-options input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
      }

      #${CONFIG.fmcModalId} .bth-fmc-options .bth-fmc-check {
        flex-direction: row;
        align-items: center;
        font-weight: 500;
      }

      #${CONFIG.fmcModalId} .bth-fmc-note {
        color: #64748b;
        line-height: 1.35;
      }

      #${CONFIG.fmcModalId} .bth-fmc-grid {
        display: grid;
        grid-template-columns: 1fr 0.9fr;
        gap: 14px;
        padding: 14px 18px;
      }

      #${CONFIG.fmcModalId} .bth-fmc-label {
        margin-bottom: 7px;
        font-weight: 700;
      }

      #${CONFIG.fmcModalId} .bth-fmc-tree {
        width: 100%;
        min-height: 260px;
        resize: vertical;
        padding: 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 13px;
        line-height: 1.45;
        box-sizing: border-box;
      }

      #${CONFIG.fmcModalId} .bth-fmc-example {
        min-height: 100px;
        max-height: 160px;
        overflow: auto;
        margin: 0;
        padding: 10px;
        background: #0f172a;
        color: #dbeafe;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      #${CONFIG.fmcModalId} .bth-fmc-copy-example {
        margin-top: 8px;
        border: none;
        border-radius: 7px;
        padding: 8px 10px;
        background: #475569;
        color: #ffffff;
        cursor: pointer;
      }

      #${CONFIG.fmcModalId} .bth-fmc-help {
        margin-top: 10px;
        padding: 10px;
        border-radius: 8px;
        background: #f1f5f9;
        color: #334155;
        font-size: 12px;
        line-height: 1.45;
      }

      #${CONFIG.fmcModalId} .bth-fmc-actions {
        display: flex;
        gap: 8px;
        padding: 0 18px 12px;
      }

      #${CONFIG.fmcModalId} .bth-fmc-actions button {
        border: none;
        border-radius: 7px;
        padding: 9px 14px;
        color: #ffffff;
        font-weight: 700;
        cursor: pointer;
      }

      #${CONFIG.fmcModalId} .bth-fmc-start {
        background: #16a34a;
      }

      #${CONFIG.fmcModalId} .bth-fmc-stop {
        background: #dc2626;
      }

      #${CONFIG.fmcModalId} .bth-fmc-clear {
        background: #64748b;
      }

      #${CONFIG.fmcModalId} .bth-fmc-log {
        margin: 0 18px 18px;
        padding: 10px;
        min-height: 80px;
        max-height: 170px;
        overflow: auto;
        background: #f8fafc;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-family: Consolas, monospace;
        font-size: 12px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    applyInitialPosition(panel);
    enableDrag(panel);

    panel.querySelector('.bth-open-universal').addEventListener('click', openUniversalTemplate);
    panel.querySelector('.bth-set-tele2').addEventListener('click', setTele2SipTemplate);
    panel.querySelector('.bth-open-bulk').addEventListener('click', openBulkModal);
    panel.querySelector('.bth-open-kyivstar').addEventListener('click', openKyivstarModal);
    panel.querySelector('.bth-open-fmc').addEventListener('click', openFmcModal);

    const password = getUnlockPasswordFromPage();

    if (password) {
      setStatus('Пароль знайдено', 'success');
    } else {
      setStatus('Пароль не знайдено', 'warn');
    }
  }

  async function init() {
    if (!isTargetPage()) return;

    await waitForElement('body', 5000);
    createPanel();

    const pendingBulkState = getBulkState();
    if (
      pendingBulkState &&
      isBulkActive() &&
      pendingBulkState.index < pendingBulkState.entries.length
    ) {
      showEmergencyStopButton();
      setStatus(
        `Продовжую масове додавання: ${pendingBulkState.index + 1}/${pendingBulkState.entries.length}`,
        'info'
      );
      setTimeout(processBulkState, 700);
    } else if (pendingBulkState && !isBulkActive()) {
      clearBulkState();
      hideEmergencyStopButton();
    }

    const pendingKyivstarState = getKyivstarState();
    if (
      pendingKyivstarState &&
      isKyivstarActive() &&
      (
        pendingKyivstarState.index < pendingKyivstarState.entries.length ||
        (pendingKyivstarState.phase && pendingKyivstarState.phase.startsWith('rdnis'))
      )
    ) {
      showEmergencyStopButton();
      setStatus('Продовжую Kyivstar Trunk', 'info');
      setTimeout(processKyivstarState, 700);
    } else if (pendingKyivstarState && !isKyivstarActive()) {
      clearKyivstarState();
      hideEmergencyStopButton();
    }

    const pendingFmcState = getFmcState();
    if (
      pendingFmcState &&
      isFmcActive() &&
      pendingFmcState.index < pendingFmcState.entries.length
    ) {
      showEmergencyStopButton();
      setStatus('Продовжую FMC Lifecell', 'info');
      setTimeout(processFmcState, 700);
    } else if (pendingFmcState && !isFmcActive()) {
      clearFmcState();
      hideEmergencyStopButton();
    }

    console.log('[Binotel helper] initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ===== Embedded FMC Lifecell helper v0.1.8 =====
(function () {
  'use strict';

  if (window.BinotelFmcLifecellEmbeddedLoaded) return;
  window.BinotelFmcLifecellEmbeddedLoaded = true;

  const CONFIG = {
    panelId: 'binotel-template-helper-fmc-v2-panel',
    modalId: 'binotel-template-helper-fmc-v2-modal',
    stopButtonId: 'binotel-template-helper-fmc-v2-stop',
    lifeModalSelector: '#operatorLifeBinotel',
    mobileEndpointModalSelector: '#addMobileEndpoint',
    stateKey: 'binotel_template_helper_fmc_v2_state_v1',
    activeKey: 'binotel_template_helper_fmc_v2_active_v1',
    logKey: 'binotel_template_helper_fmc_v2_log_v1',
    delayAfterInsertMs: 900,
    delayAfterSaveMs: 1700,
  };

  let processing = false;
  let stopRequested = false;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeCompact(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function dispatchFieldEvents(element) {
    if (!element) return;

    ['input', 'change', 'keyup', 'blur'].forEach(eventName => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });

    if (window.jQuery) {
      try {
        window.jQuery(element)
          .trigger('input')
          .trigger('change')
          .trigger('keyup')
          .trigger('blur');
      } catch (err) {
        console.warn('[FMC Lifecell helper] jQuery trigger error:', err);
      }
    }
  }

  function setFieldValue(element, value) {
    if (!element) return false;
    element.value = value || '';
    element.setAttribute('value', value || '');
    dispatchFieldEvents(element);
    return true;
  }

  function removeInputValidation(input) {
    if (!input) return;
    input.removeAttribute('data-replace-online');
    input.removeAttribute('pattern');
    input.removeAttribute('maxlength');
    input.removeAttribute('minlength');
  }

  function setSelectByValueOrText(select, variants) {
    if (!select) return false;
    const wanted = variants
      .filter(Boolean)
      .map(item => normalizeCompact(item).toLowerCase());

    const options = Array.from(select.options || []);

    const match = options.find(option => {
      const value = normalizeCompact(option.value).toLowerCase();
      const text = normalizeCompact(option.textContent).toLowerCase();
      return wanted.includes(value) || wanted.includes(text);
    });

    if (!match) return false;

    select.value = match.value;
    dispatchFieldEvents(select);
    return true;
  }

  function waitForElement(selector, timeoutMs = 8000, root = document) {
    return new Promise(resolve => {
      const existing = $(selector, root);
      if (existing) {
        resolve(existing);
        return;
      }

      const startedAt = Date.now();
      const timer = setInterval(() => {
        const element = $(selector, root);

        if (element) {
          clearInterval(timer);
          resolve(element);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 150);
    });
  }

  function getPanelParams(state = null) {
    const params = new URLSearchParams(window.location.search);
    return {
      companyID: params.get('companyID') || (state && state.companyID) || '',
      showProjectID: params.get('showProjectID') || (state && state.showProjectID) || '',
      module: params.get('module') || '',
      action: params.get('action') || '',
    };
  }

  function buildPanelUrl(moduleName, state = null, extra = {}) {
    const current = getPanelParams(state);
    const url = new URL('https://panel.binotel.com/');
    url.searchParams.set('module', moduleName);

    if (current.companyID) url.searchParams.set('companyID', current.companyID);
    if (current.showProjectID) url.searchParams.set('showProjectID', current.showProjectID);

    Object.keys(extra).forEach(key => {
      if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') {
        url.searchParams.set(key, extra[key]);
      }
    });

    return url.toString();
  }

  function navigateToPanelModule(moduleName, state = null, extra = {}) {
    window.location.href = buildPanelUrl(moduleName, state, extra);
  }

  function getState() {
    try {
      const raw = localStorage.getItem(CONFIG.stateKey);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.entries) || typeof state.index !== 'number') return null;
      return state;
    } catch (err) {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(CONFIG.stateKey, JSON.stringify(state));
  }

  function setActive() {
    sessionStorage.setItem(CONFIG.activeKey, '1');
  }

  function isActive() {
    return sessionStorage.getItem(CONFIG.activeKey) === '1';
  }

  function clearState() {
    localStorage.removeItem(CONFIG.stateKey);
    sessionStorage.removeItem(CONFIG.activeKey);
  }

  function readLogRows() {
    try {
      const raw = localStorage.getItem(CONFIG.logKey);
      const rows = JSON.parse(raw || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      return [];
    }
  }

  function writeLogRows(rows) {
    localStorage.setItem(CONFIG.logKey, JSON.stringify(rows.slice(-250)));
  }

  function refreshLogView() {
    const log = $(`#${CONFIG.modalId} .fmc-log`);
    if (!log) return;

    const rows = readLogRows();
    log.innerHTML = '';

    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = `fmc-log-row ${row.type || 'info'}`;
      item.textContent = row.text || '';
      log.appendChild(item);
    });

    log.scrollTop = log.scrollHeight;
  }

  function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const rows = readLogRows();
    rows.push({
      type,
      text: `${time} — ${message}`,
    });
    writeLogRows(rows);
    refreshLogView();
    setStatus(message, type);
  }

  function clearLog() {
    localStorage.removeItem(CONFIG.logKey);
    refreshLogView();
  }

  function setStatus(message, type = 'info') {
    const status = $(`#${CONFIG.panelId} .fmc-status`);
    if (!status) return;
    status.textContent = message || '';
    status.className = `fmc-status ${type}`;
  }

  function fmcEntryLabel(entry) {
    if (!entry) return 'невідомий крок';
    if (entry.kind === 'prefix') return `префікс ${entry.number}`;
    if (entry.kind === 'voip') return `VoIP ${entry.number}`;
    if (entry.kind === 'mobileNumber') return `мобайл ${entry.number} → ${entry.voip}`;
    if (entry.kind === 'mobileEndpoint') return `ВЛ ${entry.endpoint} для ${entry.mobile}`;
    return entry.number || entry.kind;
  }

  function findVisibleButtonByText(patterns, root = document) {
    const variants = Array.isArray(patterns) ? patterns : [patterns];
    const candidates = $all('button, a, input[type="button"], input[type="submit"]', root);

    return candidates.find(element => {
      if (!isVisible(element)) return false;
      const text = normalizeText(element.textContent || element.value || '');
      return variants.some(pattern => {
        if (pattern instanceof RegExp) return pattern.test(text);
        return text === pattern;
      });
    }) || null;
  }

  function findAddButton() {
    const candidates = $all('button, a, input[type="button"], input[type="submit"]');
    return candidates.find(element => {
      if (!isVisible(element)) return false;
      const text = normalizeText(element.textContent || element.value || '');
      return text === 'Добавить' && !/временн/i.test(text);
    }) || null;
  }

  function findSaveButton(root = document) {
    return findVisibleButtonByText([/^Сохранить$/i, /^Зберегти$/i], root);
  }

  async function clickMainSave() {
    const button = findSaveButton(document);
    if (!button) throw new Error('не знайшов кнопку "Сохранить"');
    button.click();
    await sleep(CONFIG.delayAfterSaveMs);
  }

  function numberExistsOnList(number) {
    const target = normalizeCompact(number).toLowerCase();
    if (!target) return false;

    const rows = $all('table tbody tr, table tr');
    return rows.some(row => normalizeCompact(row.textContent).toLowerCase().includes(target));
  }

  function endpointExistsOnList(entry) {
    const endpoint = normalizeCompact(entry.endpoint).toLowerCase();
    const mobile = normalizeCompact(entry.mobile).toLowerCase();
    const expectedMarks = [
      `CSIP=${entry.mobile}`,
      `CSIP=${entry.voip}`,
      entry.mobile,
    ]
      .map(value => normalizeCompact(value).toLowerCase())
      .filter(Boolean);

    const rows = $all('table tbody tr, table tr');
    return rows.some(row => {
      const cells = $all('td, th', row).map(cell => normalizeCompact(cell.textContent).toLowerCase());
      const text = normalizeCompact(row.textContent).toLowerCase();
      const hasExactEndpoint = endpoint && cells.includes(endpoint);
      const hasFmcMark = expectedMarks.some(mark => text.includes(mark));

      return hasExactEndpoint && hasFmcMark;
    });
  }

  function getVisibleConflictText() {
    const candidates = $all('body *');

    const found = candidates.find(element => {
      if (!isVisible(element)) return false;
      const text = normalizeText(element.textContent);
      return /Номер\s+уже\s+используется/i.test(text) || /номер\s+вже\s+використовується/i.test(text);
    });

    return found ? normalizeText(found.textContent) : '';
  }

  async function ensureLifeModalVisible() {
    let modal = $(CONFIG.lifeModalSelector);

    if (!modal) {
      const addButton = findAddButton();
      if (addButton) {
        addButton.click();
        modal = await waitForElement(CONFIG.lifeModalSelector, 10000);
      }
    }

    if (!modal) return null;

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
    } else {
      const opener = $('a[href="#operatorLifeBinotel"][data-toggle="modal"]') || $('a[href="#operatorLifeBinotel"]');
      if (opener) opener.click();
      modal.classList.add('in');
      modal.removeAttribute('aria-hidden');
      modal.style.display = 'block';
    }

    await sleep(250);
    return modal;
  }

  async function insertLifeTemplate(entry) {
    const modal = await ensureLifeModalVisible();
    if (!modal) throw new Error('не відкрився шаблон Life Binotel');

    const lifeServer = $('select[name="lifeBinotelServer"]', modal);
    const numberField = $('input[name="number"]', modal);
    const csipSelect = $('select[name="csip"]', modal);
    const insertButton = $('button.saveNumber', modal) || findVisibleButtonByText(['Вставить', 'Вставити'], modal);

    if (!lifeServer || !numberField || !insertButton) {
      throw new Error('не знайдено потрібні поля Life Binotel');
    }

    setSelectByValueOrText(lifeServer, ['life-binotel-1', 'life binotel 1', 'Life-Asterisk 1']);
    removeInputValidation(numberField);
    setFieldValue(numberField, entry.number);

    if (entry.kind === 'mobileNumber') {
      if (!csipSelect) throw new Error('не знайдено поле CSIP для мобайла');
      const selected = setSelectByValueOrText(csipSelect, [entry.voip, normalizeCompact(entry.voip)]);
      if (!selected) {
        throw new Error(`не знайшов VoIP ${entry.voip} у CSIP списку`);
      }
    } else if (csipSelect) {
      setSelectByValueOrText(csipSelect, ['', 'Выберите номер']);
    }

    insertButton.click();
    await sleep(CONFIG.delayAfterInsertMs);

    const conflict = getVisibleConflictText();

    if (conflict) {
      return {
        ok: true,
        skipSave: true,
        reason: conflict,
      };
    }

    if (entry.name) {
      const nameInput = $('input[name="name"]') || $('input[name="title"]');
      if (nameInput) setFieldValue(nameInput, entry.name);
    }

    return {
      ok: true,
      skipSave: false,
    };
  }

  async function processAdvancedNumber(state, entry) {
    const params = getPanelParams(state);

    if (params.module !== 'pbxNumbersEnhanced') {
      addLog(`відкриваю розширені номери для ${fmcEntryLabel(entry)}`, 'info');
      navigateToPanelModule('pbxNumbersEnhanced', state);
      return;
    }

    if (!params.action && numberExistsOnList(entry.number)) {
      addLog(`${fmcEntryLabel(entry)} вже є — пропускаю`, 'warn');
      markDone(state, `пропущено: ${fmcEntryLabel(entry)}`);
      return;
    }

    if (!$(CONFIG.lifeModalSelector)) {
      const addButton = findAddButton();

      if (!addButton && params.action !== 'edit') {
        throw new Error('починати потрібно зі сторінки розширених номерів, де видно кнопку "Добавить"');
      }

      if (addButton) {
        saveState({
          ...state,
          phase: 'openingNumber',
          pendingIndex: state.index,
        });
        addButton.click();
        await sleep(900);
      }
    }

    const result = await insertLifeTemplate(entry);

    if (result.skipSave) {
      addLog(`${fmcEntryLabel(entry)}: ${result.reason}; не зберігаю і йду далі`, 'warn');
      markDone({
        ...state,
        phase: 'ready',
      }, `пропущено: ${fmcEntryLabel(entry)}`);
      navigateToPanelModule('pbxNumbersEnhanced', state);
      return;
    }

    saveState({
      ...state,
      phase: 'savingNumber',
      pendingIndex: state.index,
    });

    await clickMainSave();
  }

  async function processNumberSaveReturn(state) {
    const params = getPanelParams(state);

    if (params.module === 'pbxNumbersEnhanced' && !params.action) {
      markDone(state, `збережено: ${fmcEntryLabel(state.entries[state.pendingIndex ?? state.index])}`);
      return;
    }

    addLog('чекаю повернення до списку розширених номерів', 'info');
  }

  async function ensureMobileEndpointModalVisible() {
    let modal = $(CONFIG.mobileEndpointModalSelector);

    if (modal) {
      if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
        window.jQuery(modal).modal('show');
      } else {
        modal.classList.add('in');
        modal.removeAttribute('aria-hidden');
        modal.style.display = 'block';
      }

      await sleep(250);
      return modal;
    }

    const addButton = findVisibleButtonByText([/^Добавить$/i]);
    if (addButton) {
      addButton.click();
      await sleep(300);
    }

    const mobileItem = findVisibleButtonByText([/Мобильная\s+внутренняя\s+линия/i]);
    if (mobileItem) {
      mobileItem.click();
      modal = await waitForElement(CONFIG.mobileEndpointModalSelector, 8000);
    }

    if (!modal) return null;

    if (window.jQuery && typeof window.jQuery(modal).modal === 'function') {
      window.jQuery(modal).modal('show');
    }

    await sleep(250);
    return modal;
  }

  async function createMobileEndpoint(entry) {
    const modal = await ensureMobileEndpointModalVisible();
    if (!modal) throw new Error('не відкрився блок додавання мобільної ВЛ');

    const fmcType = $('select[name="fmcType"]', modal);
    const mobileInput = $('input[name="mobileEndpointLogin"]', modal);
    const submitButton = findVisibleButtonByText(['Добавить', 'Додати'], modal);

    if (!fmcType || !mobileInput || !submitButton) {
      throw new Error('не знайдено поля додавання мобільної ВЛ');
    }

    setSelectByValueOrText(fmcType, ['lc', 'lifecell', 'Lifecell']);
    removeInputValidation(mobileInput);
    setFieldValue(mobileInput, entry.mobile);

    submitButton.click();
    await sleep(CONFIG.delayAfterSaveMs);
  }

  async function fillEndpointEditAndSave(state, entry) {
    const internalNumberInput = $('input[name="internalNumber"]');

    if (!internalNumberInput) {
      throw new Error('не відкрилась сторінка редагування мобільної ВЛ');
    }

    setFieldValue(internalNumberInput, entry.endpoint);

    saveState({
      ...state,
      phase: 'savingEndpoint',
      pendingIndex: state.index,
    });

    await clickMainSave();
  }

  async function processEndpoint(state, entry) {
    const params = getPanelParams(state);

    if (params.module !== 'endpoints') {
      addLog(`відкриваю внутрішні лінії для ${fmcEntryLabel(entry)}`, 'info');
      navigateToPanelModule('endpoints', state);
      return;
    }

    if (!params.action && endpointExistsOnList(entry)) {
      addLog(`${fmcEntryLabel(entry)} вже є — пропускаю`, 'warn');
      markDone(state, `пропущено: ${fmcEntryLabel(entry)}`);
      return;
    }

    if (params.action === 'edit') {
      await fillEndpointEditAndSave(state, entry);
      return;
    }

    saveState({
      ...state,
      phase: 'endpointEdit',
      pendingIndex: state.index,
    });

    await createMobileEndpoint(entry);
  }

  async function processEndpointEdit(state) {
    const entry = state.entries[state.pendingIndex ?? state.index];
    const params = getPanelParams(state);

    if (params.module !== 'endpoints') {
      navigateToPanelModule('endpoints', state);
      return;
    }

    if (params.action === 'edit') {
      await fillEndpointEditAndSave(state, entry);
      return;
    }

    addLog(`чекаю сторінку редагування для ${fmcEntryLabel(entry)}`, 'info');
  }

  async function processEndpointSaveReturn(state) {
    const params = getPanelParams(state);

    if (params.module === 'endpoints' && !params.action) {
      markDone(state, `збережено: ${fmcEntryLabel(state.entries[state.pendingIndex ?? state.index])}`);
      return;
    }

    addLog('чекаю повернення до списку внутрішніх ліній', 'info');
  }

  function markDone(state, message) {
    const completedIndex =
      typeof state.pendingIndex === 'number'
        ? state.pendingIndex
        : state.index;

    const nextState = {
      ...state,
      index: completedIndex + 1,
      phase: 'ready',
    };

    delete nextState.pendingIndex;
    saveState(nextState);

    if (message) addLog(message, 'success');
    setTimeout(processState, 250);
  }

  function detectCurrentSipServer() {
    const resolveSipCandidate = digits => {
      const value = String(digits || '').replace(/\D+/g, '');
      if (!value) return '';

      if ($(`#sip${value}WithSipSysUpdate`)) return value;

      for (let cut = 1; cut <= 2; cut += 1) {
        const trimmed = value.slice(0, -cut);
        if (trimmed && $(`#sip${trimmed}WithSipSysUpdate`)) return trimmed;
      }

      return value;
    };

    const sipBox = $('.sip-server');

    if (sipBox) {
      const countdown = normalizeCompact(
        $('#pbx-next-update-countdown')
          ? $('#pbx-next-update-countdown').textContent
          : ''
      );
      let sipText = normalizeCompact(sipBox.textContent).toUpperCase();

      if (countdown && sipText.endsWith(countdown)) {
        sipText = sipText.slice(0, -countdown.length);
      }

      const sipBoxMatch = sipText.match(/^SIP(\d{1,3})$/i);
      if (sipBoxMatch) return resolveSipCandidate(sipBoxMatch[1]);
    }

    const visibleTexts = $all('span, div, td, th, a, b, strong')
      .filter(isVisible)
      .map(element => normalizeText(element.textContent))
      .filter(text => /^SIP\s*\d{1,3}$/i.test(text));

    const visibleMatch = visibleTexts
      .map(text => text.match(/^SIP\s*(\d{1,3})$/i))
      .find(Boolean);

    if (visibleMatch) return resolveSipCandidate(visibleMatch[1]);

    const bodyMatch = normalizeText(document.body ? document.body.innerText : '')
      .match(/\bSIP\s*(\d{1,3})\b/i);

    return bodyMatch ? resolveSipCandidate(bodyMatch[1]) : '';
  }

  async function clickPanelUpdateAnchor(anchor, label) {
    if (!anchor) throw new Error(`не знайшов пункт оновлення ${label}`);

    const oldAlert = window.alert;
    const oldPrompt = window.prompt;
    const oldConfirm = window.confirm;

    window.alert = () => true;
    window.prompt = () => 'binotel';
    window.confirm = () => true;

    try {
      anchor.click();
      await sleep(6000);
    } finally {
      window.alert = oldAlert;
      window.prompt = oldPrompt;
      window.confirm = oldConfirm;
    }
  }

  async function processFinalUpdates(state) {
    const currentSip = state.sipServer || detectCurrentSipServer();

    if (!currentSip) {
      throw new Error('не бачу поточний SIP сервер у Panel — фінальне оновлення не виконано');
    }

    const updateStep = state.updateStep || 'sip';

    if (updateStep === 'sip') {
      const sipAnchor = $(`#sip${currentSip}WithSipSysUpdate`);
      addLog(`фінал: оновлюю SIP${currentSip}`, 'info');
      await clickPanelUpdateAnchor(sipAnchor, `SIP${currentSip}`);

      saveState({
        ...state,
        phase: 'finalUpdates',
        updateStep: 'life',
        sipServer: currentSip,
      });

      addLog(`оновлено SIP${currentSip}`, 'success');
      setTimeout(processState, 3000);
      return;
    }

    if (updateStep === 'life') {
      const lifeAnchor = $('#LifeAsterisk1');
      addLog('фінал: оновлюю Life-Asterisk 1', 'info');
      await clickPanelUpdateAnchor(lifeAnchor, 'Life-Asterisk 1');

      saveState({
        ...state,
        phase: 'done',
        updateStep: 'done',
        finalUpdatesDone: true,
        sipServer: currentSip,
      });

      addLog('оновлено Life-Asterisk 1', 'success');
      setTimeout(processState, 3000);
      return;
    }

    saveState({
      ...state,
      phase: 'done',
      finalUpdatesDone: true,
    });
    setTimeout(processState, 250);
  }

  async function processState() {
    if (processing) return;

    const state = getState();

    if (!state || !isActive()) {
      hideStopButton();
      return;
    }

    processing = true;
    showStopButton();

    try {
      if (stopRequested) {
        addLog('зупинено користувачем', 'warn');
        clearState();
        hideStopButton();
        return;
      }

      if (state.phase === 'finalUpdates') {
        await processFinalUpdates(state);
        return;
      }

      if (state.phase === 'done' || state.finalUpdatesDone) {
        addLog('готово, FMC Lifecell оброблено', 'success');
        clearState();
        hideStopButton();
        return;
      }

      if (state.index >= state.entries.length) {
        await processFinalUpdates({
          ...state,
          phase: 'finalUpdates',
          updateStep: 'sip',
          sipServer: state.sipServer || detectCurrentSipServer(),
        });
        return;
      }

      if (state.phase === 'savingNumber') {
        await processNumberSaveReturn(state);
        return;
      }

      if (state.phase === 'endpointEdit') {
        await processEndpointEdit(state);
        return;
      }

      if (state.phase === 'savingEndpoint') {
        await processEndpointSaveReturn(state);
        return;
      }

      const entry = state.entries[state.index];
      addLog(`${state.index + 1}/${state.entries.length}: ${fmcEntryLabel(entry)}`, 'info');

      if (entry.kind === 'prefix' || entry.kind === 'voip' || entry.kind === 'mobileNumber') {
        await processAdvancedNumber(state, entry);
        return;
      }

      if (entry.kind === 'mobileEndpoint') {
        await processEndpoint(state, entry);
        return;
      }

      throw new Error(`невідомий тип кроку: ${entry.kind}`);
    } catch (err) {
      addLog(err.message || String(err), 'error');
      clearState();
      hideStopButton();
    } finally {
      processing = false;
    }
  }

  function showStopButton() {
    if ($(`#${CONFIG.stopButtonId}`)) return;

    const button = document.createElement('button');
    button.id = CONFIG.stopButtonId;
    button.type = 'button';
    button.textContent = '⛔ СТОП FMC';

    Object.assign(button.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '1000004',
      border: 'none',
      borderRadius: '999px',
      padding: '14px 22px',
      background: '#dc2626',
      color: '#fff',
      fontWeight: '900',
      fontSize: '16px',
      cursor: 'pointer',
      boxShadow: '0 14px 34px rgba(220, 38, 38, 0.45)',
    });

    button.addEventListener('click', () => {
      stopRequested = true;
      clearState();
      addLog('натиснуто СТОП. Поточна дія може завершитись, наступні не підуть.', 'warn');
      button.textContent = '⛔ ЗУПИНЕНО';
      setTimeout(hideStopButton, 1600);
    });

    document.body.appendChild(button);
  }

  function hideStopButton() {
    const button = $(`#${CONFIG.stopButtonId}`);
    if (button) button.remove();
  }

  function createPanel() {
    if ($(`#${CONFIG.panelId}`)) return;

    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.innerHTML = `
      <div class="fmc-panel-head">
        <span>📱 FMC Life</span>
        <button type="button" class="fmc-mini">−</button>
      </div>
      <div class="fmc-panel-body">
        <button type="button" class="fmc-open">Відкрити</button>
        <div class="fmc-status">Окремий тестовий скрипт</div>
      </div>
    `;

    document.body.appendChild(panel);

    $('.fmc-open', panel).addEventListener('click', openModal);
    $('.fmc-mini', panel).addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });
  }

  function openModal() {
    let modal = $(`#${CONFIG.modalId}`);

    if (!modal) {
      modal = createModal();
      document.body.appendChild(modal);
    }

    modal.classList.add('open');
    refreshLogView();
    renderSummary();
  }

  function closeModal() {
    const modal = $(`#${CONFIG.modalId}`);
    if (modal) modal.classList.remove('open');
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.id = CONFIG.modalId;
    modal.innerHTML = `
      <div class="fmc-modal-window">
        <div class="fmc-modal-head">
          <div>
            <div class="fmc-modal-title">FMC Lifecell helper 0.1.8</div>
            <div class="fmc-modal-subtitle">Префікс → VoIP → мобайли → мобільні ВЛ. Поля пусті: інженер сам вносить робочі дані.</div>
          </div>
          <button type="button" class="fmc-close">×</button>
        </div>

        <div class="fmc-modal-body">
          <div class="fmc-left">
            <section class="fmc-card fmc-prefix-card">
              <div>
                <h3>Префікс Life-Asterisk 1</h3>
                <div class="fmc-note compact">Пусте поле — префікс не додається. “Номер уже используется” — пропускаємо.</div>
              </div>
              <input type="text" class="fmc-prefix" placeholder="Наприклад: 3916B">
            </section>

            <section class="fmc-card fmc-tree-card">
              <div class="fmc-card-line">
                <div>
                  <h3>VoIP та мобайли</h3>
                  <div class="fmc-summary">Префікс: — · VoIP: 0 · Мобайлів: 0 · ВЛ: 0</div>
                </div>
                <button type="button" class="fmc-add-voip">+ VoIP</button>
              </div>
              <div class="fmc-voip-list"></div>
            </section>
          </div>

          <section class="fmc-card fmc-log-card">
            <div class="fmc-card-line">
              <h3>Лог</h3>
              <span class="fmc-log-hint">хід виконання</span>
            </div>
            <div class="fmc-log"></div>
          </section>
        </div>

        <div class="fmc-modal-actions">
          <button type="button" class="fmc-start">Старт</button>
          <button type="button" class="fmc-stop">Стоп</button>
          <button type="button" class="fmc-clear-log">Очистити лог</button>
          <button type="button" class="fmc-close-bottom">Закрити</button>
        </div>
      </div>
    `;

    $('.fmc-close', modal).addEventListener('click', closeModal);
    $('.fmc-close-bottom', modal).addEventListener('click', closeModal);
    $('.fmc-add-voip', modal).addEventListener('click', () => addVoipCard());
    $('.fmc-start', modal).addEventListener('click', startFmc);
    $('.fmc-stop', modal).addEventListener('click', () => {
      stopRequested = true;
      clearState();
      addLog('зупинено вручну', 'warn');
      hideStopButton();
    });
    $('.fmc-clear-log', modal).addEventListener('click', clearLog);
    $('.fmc-prefix', modal).addEventListener('input', renderSummary);

    return modal;
  }

  function addVoipCard(data = {}) {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;

    const list = $('.fmc-voip-list', modal);
    const card = document.createElement('div');
    card.className = 'fmc-voip-card';
    card.innerHTML = `
      <div class="fmc-voip-head">
        <label>
          <span>VoIP номер</span>
          <input type="text" class="fmc-voip-number" placeholder="0930000000" value="">
        </label>
        <div class="fmc-row-actions">
          <button type="button" class="fmc-add-mobile">+ мобайл</button>
          <button type="button" class="fmc-delete">Видалити VoIP</button>
        </div>
      </div>
      <div class="fmc-mobile-list"></div>
    `;

    $('.fmc-voip-number', card).value = data.voip || '';
    $('.fmc-voip-number', card).addEventListener('input', renderSummary);
    $('.fmc-add-mobile', card).addEventListener('click', () => addMobileRow(card));
    $('.fmc-delete', card).addEventListener('click', () => {
      card.remove();
      renderSummary();
    });

    list.appendChild(card);

    (data.mobiles || []).forEach(mobile => addMobileRow(card, mobile));
    renderSummary();
  }

  function addMobileRow(card, data = {}) {
    const list = $('.fmc-mobile-list', card);
    const row = document.createElement('div');
    row.className = 'fmc-mobile-row';
    row.innerHTML = `
      <label>
        <span>Мобайл</span>
        <input type="text" class="fmc-mobile-number" placeholder="0730000000" value="">
      </label>
      <label>
        <span>ВЛ</span>
        <input type="text" class="fmc-endpoint" placeholder="901" value="">
      </label>
      <button type="button" class="fmc-delete-mobile">×</button>
    `;

    $('.fmc-mobile-number', row).value = data.mobile || '';
    $('.fmc-endpoint', row).value = data.endpoint || '';
    $('.fmc-mobile-number', row).addEventListener('input', renderSummary);
    $('.fmc-endpoint', row).addEventListener('input', renderSummary);
    $('.fmc-delete-mobile', row).addEventListener('click', () => {
      row.remove();
      renderSummary();
    });

    list.appendChild(row);
    renderSummary();
  }

  function collectFormData() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) throw new Error('не відкрито FMC меню');

    const prefix = normalizeCompact($('.fmc-prefix', modal).value || '');
    const blocks = $all('.fmc-voip-card', modal).map((card, index) => {
      const voip = normalizeCompact($('.fmc-voip-number', card).value || '');
      const mobiles = $all('.fmc-mobile-row', card).map(row => ({
        mobile: normalizeCompact($('.fmc-mobile-number', row).value || ''),
        endpoint: normalizeCompact($('.fmc-endpoint', row).value || ''),
      }));

      return {
        index: index + 1,
        voip,
        mobiles,
      };
    });

    return {
      prefix,
      blocks,
    };
  }

  function validateFormData(data) {
    const phonePattern = /^0\d{9}$/;
    const errors = [];

    data.blocks.forEach(block => {
      if (!block.voip) {
        errors.push(`VoIP #${block.index}: не вказано номер`);
      } else if (!phonePattern.test(block.voip)) {
        errors.push(`VoIP #${block.index}: номер має бути у форматі 0XXXXXXXXX`);
      }

      if (!block.mobiles.length) {
        errors.push(`VoIP #${block.index}: не додано жодного мобайла`);
      }

      block.mobiles.forEach((mobile, mobileIndex) => {
        if (!mobile.mobile) {
          errors.push(`VoIP #${block.index}, мобайл #${mobileIndex + 1}: не вказано мобайл`);
        } else if (!phonePattern.test(mobile.mobile)) {
          errors.push(`VoIP #${block.index}, мобайл #${mobileIndex + 1}: мобайл має бути у форматі 0XXXXXXXXX`);
        }

        if (!mobile.endpoint) {
          errors.push(`VoIP #${block.index}, мобайл #${mobileIndex + 1}: не вказано ВЛ`);
        } else if (!/^\d{2,6}$/.test(mobile.endpoint)) {
          errors.push(`VoIP #${block.index}, мобайл #${mobileIndex + 1}: ВЛ має бути числом`);
        }
      });
    });

    if (!data.prefix && !data.blocks.length) {
      errors.push('нічого додавати: вкажи префікс або додай VoIP');
    }

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
  }

  function buildEntries(data) {
    const entries = [];

    if (data.prefix) {
      entries.push({
        kind: 'prefix',
        number: data.prefix,
      });
    }

    data.blocks.forEach(block => {
      entries.push({
        kind: 'voip',
        number: block.voip,
      });

      block.mobiles.forEach(mobile => {
        const name = `CSIP=${block.voip}`;

        entries.push({
          kind: 'mobileNumber',
          number: mobile.mobile,
          voip: block.voip,
          name,
        });

        entries.push({
          kind: 'mobileEndpoint',
          mobile: mobile.mobile,
          voip: block.voip,
          endpoint: mobile.endpoint,
          name,
        });
      });
    });

    return entries;
  }

  function renderSummary() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;

    const summary = $('.fmc-summary', modal);
    if (!summary) return;

    try {
      const data = collectFormData();
      const voipCount = data.blocks.filter(block => block.voip).length;
      const mobileCount = data.blocks.reduce((sum, block) => {
        return sum + block.mobiles.filter(item => item.mobile).length;
      }, 0);
      const endpointCount = data.blocks.reduce((sum, block) => {
        return sum + block.mobiles.filter(item => item.endpoint).length;
      }, 0);

      summary.textContent = [
        `Префікс: ${data.prefix ? 'є' : '—'}`,
        `VoIP: ${voipCount}`,
        `Мобайлів: ${mobileCount}`,
        `ВЛ: ${endpointCount}`,
      ].join(' · ');
    } catch (err) {
      summary.textContent = 'Помилка підсумку';
    }
  }

  async function startFmc() {
    try {
      const params = getPanelParams();
      const data = collectFormData();
      validateFormData(data);

      const entries = buildEntries(data);

      if (!params.companyID) {
        throw new Error('не бачу companyID у поточній сторінці Panel');
      }

      clearLog();
      stopRequested = false;

      saveState({
        companyID: params.companyID,
        showProjectID: params.showProjectID,
        sipServer: detectCurrentSipServer(),
        entries,
        index: 0,
        phase: 'ready',
        startedAt: new Date().toISOString(),
      });

      setActive();
      addLog(`старт: ${entries.length} кроків`, 'info');
      showStopButton();
      await processState();
    } catch (err) {
      addLog(err.message || String(err), 'error');
    }
  }

  function injectStyles() {
    if ($('#binotel-fmc-life-styles')) return;

    const style = document.createElement('style');
    style.id = 'binotel-fmc-life-styles';
    style.textContent = `
      #${CONFIG.panelId} {
        position: fixed;
        top: 118px;
        right: 24px;
        z-index: 1000001;
        width: 250px;
        background: #111827;
        color: #fff;
        border-radius: 10px;
        box-shadow: 0 14px 34px rgba(15, 23, 42, .35);
        font-family: Arial, sans-serif;
        overflow: hidden;
      }

      #${CONFIG.panelId}.collapsed .fmc-panel-body {
        display: none;
      }

      #${CONFIG.panelId} .fmc-panel-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        font-weight: 800;
      }

      #${CONFIG.panelId} .fmc-mini {
        width: 28px;
        height: 24px;
        border: none;
        border-radius: 7px;
        cursor: pointer;
      }

      #${CONFIG.panelId} .fmc-panel-body {
        padding: 0 10px 10px;
      }

      #${CONFIG.panelId} .fmc-open {
        width: 100%;
        border: none;
        border-radius: 8px;
        padding: 10px;
        color: #fff;
        background: #2563eb;
        font-weight: 800;
        cursor: pointer;
      }

      #${CONFIG.panelId} .fmc-status {
        margin-top: 8px;
        padding: 8px;
        border-radius: 8px;
        background: #1f2937;
        font-size: 12px;
        line-height: 1.25;
      }

      #${CONFIG.panelId} .fmc-status.success { background: #064e3b; }
      #${CONFIG.panelId} .fmc-status.warn { background: #78350f; }
      #${CONFIG.panelId} .fmc-status.error { background: #7f1d1d; }

      #${CONFIG.modalId} {
        position: fixed;
        inset: 0;
        z-index: 1000003;
        display: none;
        background: rgba(15, 23, 42, .55);
        font-family: Arial, sans-serif;
      }

      #${CONFIG.modalId}.open {
        display: block;
      }

      #${CONFIG.modalId} .fmc-modal-window {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(1180px, calc(100vw - 56px));
        height: min(820px, calc(100vh - 56px));
        background: #f8fafc;
        color: #0f172a;
        border-radius: 14px;
        box-shadow: 0 22px 60px rgba(0, 0, 0, .35);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      #${CONFIG.modalId} .fmc-modal-head {
        background: #0f172a;
        color: #fff;
        padding: 14px 18px;
        display: flex;
        justify-content: space-between;
        gap: 14px;
      }

      #${CONFIG.modalId} .fmc-modal-title {
        font-size: 20px;
        font-weight: 900;
      }

      #${CONFIG.modalId} .fmc-modal-subtitle {
        margin-top: 4px;
        color: #cbd5e1;
        font-size: 13px;
      }

      #${CONFIG.modalId} .fmc-close {
        width: 34px;
        height: 34px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 24px;
        font-weight: 900;
      }

      #${CONFIG.modalId} .fmc-modal-body {
        flex: 1;
        overflow: auto;
        padding: 16px;
        display: grid;
        grid-template-columns: minmax(620px, 1fr) minmax(360px, 440px);
        gap: 14px;
        align-items: stretch;
      }

      #${CONFIG.modalId} .fmc-left {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
      }

      #${CONFIG.modalId} .fmc-card {
        background: #fff;
        border: 1px solid #dbe4f0;
        border-radius: 12px;
        padding: 14px;
      }

      #${CONFIG.modalId} .fmc-card h3 {
        margin: 0 0 10px;
        font-size: 18px;
      }

      #${CONFIG.modalId} .fmc-prefix-card {
        display: grid;
        grid-template-columns: minmax(270px, 1fr) minmax(260px, 420px);
        gap: 14px;
        align-items: center;
      }

      #${CONFIG.modalId} .fmc-prefix-card h3 {
        margin-bottom: 6px;
      }

      #${CONFIG.modalId} .fmc-card-line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }

      #${CONFIG.modalId} input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 10px 11px;
        font-size: 14px;
      }

      #${CONFIG.modalId} label span {
        display: block;
        margin-bottom: 5px;
        color: #475569;
        font-weight: 700;
        font-size: 12px;
      }

      #${CONFIG.modalId} .fmc-note {
        margin-top: 8px;
        padding: 10px;
        border-radius: 8px;
        color: #1e3a8a;
        background: #eff6ff;
        font-size: 13px;
        line-height: 1.35;
      }

      #${CONFIG.modalId} .fmc-note.compact {
        margin-top: 0;
        padding: 0;
        background: transparent;
        font-size: 12px;
      }

      #${CONFIG.modalId} .fmc-summary {
        color: #475569;
        font-size: 13px;
        font-weight: 700;
      }

      #${CONFIG.modalId} .fmc-add-voip,
      #${CONFIG.modalId} .fmc-add-mobile {
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        color: #fff;
        background: #16a34a;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
      }

      #${CONFIG.modalId} .fmc-voip-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 12px;
      }

      #${CONFIG.modalId} .fmc-voip-card {
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 12px;
        background: #f8fafc;
      }

      #${CONFIG.modalId} .fmc-voip-head {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
      }

      #${CONFIG.modalId} .fmc-row-actions {
        display: flex;
        gap: 8px;
      }

      #${CONFIG.modalId} .fmc-delete,
      #${CONFIG.modalId} .fmc-delete-mobile {
        border: none;
        border-radius: 8px;
        background: #fee2e2;
        color: #991b1b;
        font-weight: 900;
        cursor: pointer;
      }

      #${CONFIG.modalId} .fmc-delete {
        padding: 9px 12px;
      }

      #${CONFIG.modalId} .fmc-delete-mobile {
        width: 38px;
        height: 38px;
        align-self: end;
      }

      #${CONFIG.modalId} .fmc-mobile-list {
        margin-top: 10px;
        padding-left: 22px;
        border-left: 3px solid #bfdbfe;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #${CONFIG.modalId} .fmc-mobile-row {
        display: grid;
        grid-template-columns: 1fr 130px 42px;
        gap: 8px;
        align-items: end;
      }

      #${CONFIG.modalId} .fmc-log-card {
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      #${CONFIG.modalId} .fmc-log-card h3 {
        margin-bottom: 0;
      }

      #${CONFIG.modalId} .fmc-log-hint {
        color: #64748b;
        font-size: 12px;
        font-weight: 700;
      }

      #${CONFIG.modalId} .fmc-log {
        flex: 1;
        min-height: 420px;
        overflow: auto;
        margin: 0;
        margin-top: 10px;
        padding: 12px;
        border-radius: 10px;
        background: #0f172a;
        color: #e5e7eb;
        font-size: 13px;
        line-height: 1.45;
      }

      #${CONFIG.modalId} .fmc-log-row {
        margin-bottom: 5px;
      }

      #${CONFIG.modalId} .fmc-log-row.success { color: #86efac; }
      #${CONFIG.modalId} .fmc-log-row.warn { color: #fde68a; }
      #${CONFIG.modalId} .fmc-log-row.error { color: #fca5a5; }

      #${CONFIG.modalId} .fmc-modal-actions {
        padding: 12px 16px;
        background: #e2e8f0;
        display: flex;
        gap: 10px;
      }

      #${CONFIG.modalId} .fmc-modal-actions button {
        border: none;
        border-radius: 9px;
        padding: 11px 16px;
        color: #fff;
        font-weight: 900;
        cursor: pointer;
      }

      #${CONFIG.modalId} .fmc-start { background: #16a34a; }
      #${CONFIG.modalId} .fmc-stop { background: #dc2626; }
      #${CONFIG.modalId} .fmc-clear-log,
      #${CONFIG.modalId} .fmc-close-bottom { background: #64748b; }
    `;

    document.head.appendChild(style);
  }

  function openEmbeddedModal() {
    injectStyles();
    openModal();
  }

  function init() {
    if (!location.hostname.includes('panel.binotel.com')) return;

    injectStyles();
    window.BinotelFmcLifecellEmbedded = {
      open: openEmbeddedModal,
      resume: processState,
      clear: clearState,
      version: '0.1.8',
    };

    if (getState() && isActive()) {
      setTimeout(processState, 700);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ===== /Embedded FMC Lifecell helper v0.1.8 =====

