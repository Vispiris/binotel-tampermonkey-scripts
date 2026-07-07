// ==UserScript==
// @name         Binotel helper → шаблони номерів
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  Перетягуване меню для pbxNumbersEnhanced: універсальний шаблон, Tele2, Kyivstar Trunk, масове додавання номерів
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
    stopButtonId: 'binotel-template-helper-emergency-stop',
    positionStorageKey: 'binotel_template_helper_position_v1',
    bulkStateStorageKey: 'binotel_template_helper_bulk_state_v1',
    bulkActiveStorageKey: 'binotel_template_helper_bulk_active_v1',
    kyivstarStateStorageKey: 'binotel_template_helper_kyivstar_state_v1',
    kyivstarActiveStorageKey: 'binotel_template_helper_kyivstar_active_v1',
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
      setStatus('Масове додавання зупинено', 'warn');
      setBulkLog('Натиснуто аварійний СТОП. Поточна дія може завершитись, але наступний номер не запуститься.', 'warn');
      setKyivstarLog('Натиснуто аварійний СТОП. Поточна дія може завершитись, але наступний номер не запуститься.', 'warn');
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

  function closeBulkModal() {
    const modal = $(`#${CONFIG.bulkModalId}`);
    if (modal) modal.style.display = 'none';
  }

  function closeKyivstarModal() {
    const modal = $(`#${CONFIG.kyivstarModalId}`);
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
            <input type="text" class="bth-kyivstar-pai" value="0897202782" placeholder="0897202782">
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
    $('.bth-kyivstar-numbers', modal).value = '0674002203';
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
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    applyInitialPosition(panel);
    enableDrag(panel);

    panel.querySelector('.bth-open-universal').addEventListener('click', openUniversalTemplate);
    panel.querySelector('.bth-set-tele2').addEventListener('click', setTele2SipTemplate);
    panel.querySelector('.bth-open-bulk').addEventListener('click', openBulkModal);
    panel.querySelector('.bth-open-kyivstar').addEventListener('click', openKyivstarModal);

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

    console.log('[Binotel helper] initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
