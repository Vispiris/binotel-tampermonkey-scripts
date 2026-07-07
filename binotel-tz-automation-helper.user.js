// ==UserScript==
// @name         Binotel TZ automation helper 0.6.9
// @namespace    http://tampermonkey.net/
// @version      0.6.9
// @description  Мінімальний помічник ТЗ: параметри компанії, внутрішні лінії та групи ВЛ
// @author       Codex
// @match        https://panel.binotel.com/*
// @updateURL    https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-tz-automation-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-tz-automation-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.6.9';

  const CONFIG = {
    panelId: 'binotel-tz-helper-panel',
    modalId: 'binotel-tz-helper-modal',
    alertId: 'binotel-tz-helper-alert',
    stopButtonId: 'binotel-tz-helper-stop',
    positionStorageKey: 'binotel_tz_helper_position_v2',
    draftStorageKey: 'binotel_tz_helper_draft_v2',
    flowStorageKey: 'binotel_tz_helper_flow_v2',
    logStorageKey: 'binotel_tz_helper_log_v2',
    pbxSchemeModule: 'pbxScheme',
    companyParamsModule: 'companyProperties',
    endpointsModule: 'endpoints',
    ringGroupsModule: 'ringGroups',
    gsmPortsModule: 'gsmPorts',
    pbxNumbersEnhancedModule: 'pbxNumbersEnhanced',
    departmentsModule: 'departments',
    routesModule: 'routes',
  };

  const TARIFFS = [
    'Unknown',
    'Lite',
    'Pro',
    'Pro+',
    'Enterprise',
    'Phone number',
    'Pro SOHO',
    'Pro Wire',
    'Pro Wire One',
    'Bookon',
    'Bookon One',
    'Chat',
    'Feedback',
    'SmartCRM',
    'OnlineKasa',
    'RestoApp',
  ];

  const REGIONS = [
    { value: '', text: 'Оберіть регіон' },
    'Україна',
    'Європа',
    'Казахстан',
    'Узбекистан',
    'Азербайджан',
  ];

  const LANGUAGES = [
    { value: 'ua', text: 'Українська' },
    { value: 'ru', text: 'Русский' },
    { value: 'en', text: 'English' },
    { value: 'pl', text: 'Polski' },
    { value: 'es', text: 'Español' },
    { value: 'de', text: 'Deutsch' },
    { value: 'ge', text: 'Georgian' },
  ];

  const TIMEZONES = [
    'Europe/Kiev',
    'Europe/Moscow',
    'Europe/London',
    'Europe/Warsaw',
    'Europe/Chisinau',
    'Asia/Yerevan',
    'America/New_York',
    'America/Los_Angeles',
    'Canada/Atlantic',
    'Asia/Barnaul',
    'Asia/Baku',
    'Asia/Aqtau',
    'Asia/Kuala_Lumpur',
    'Asia/Yekaterinburg',
    'Asia/Vladivostok',
    'Asia/Magadan',
  ];

  const DEFAULT_DRAFT = {
    contextCompanyId: '',
    contextProjectId: '',
    companyId: '',
    projectId: '',
    tzUrl: '',
    tariff: 'Pro',
    region: '',
    regionNotImportant: false,
    language: 'ua',
    timezone: 'Europe/Kiev',
    endpointsFirstLine: '',
    endpointsCount: '',
    ringGroupsRows: '',
    gsmNumbersRows: '',
    gsmEmail: '',
    createTemporaryNumbers: false,
    departmentsRows: '',
    ivrScenarioPrefix: 'IVR TEST',
    ivrUseScenarioPrefixNumbering: true,
    ivrConfigName: '',
    ivrWaitSeconds: '5',
    ivrTreeRows: '',
    ivrNodesJson: '',
    ivrRootRouteId: '',
    ivrRootRouteName: '',
    ivrRootRouteEditUrl: '',
    ivrCreatedRoutesJson: '{}',
    ivrRepeatSettingsJson: '{}',
    ivrFallbacksJson: '{}',
    ivrImportConfig: '',
  };

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

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getModule() {
    return getParams().get('module') || '';
  }

  function getCompanyIdFromUrl() {
    return getParams().get('companyID') || '';
  }

  function getProjectIdFromUrl() {
    return getParams().get('showProjectID') || '';
  }

  function isProjectAgnosticModule() {
    return getModule() === CONFIG.gsmPortsModule;
  }

  function isPanelPage() {
    return location.hostname === 'panel.binotel.com';
  }

  function loadDraft() {
    try {
      return { ...DEFAULT_DRAFT, ...JSON.parse(localStorage.getItem(CONFIG.draftStorageKey) || '{}') };
    } catch (error) {
      return { ...DEFAULT_DRAFT };
    }
  }

  function saveDraft(patch = {}) {
    const current = loadDraft();
    const next = { ...current, ...patch };
    localStorage.setItem(CONFIG.draftStorageKey, JSON.stringify(next));
    return next;
  }

  function makeUrlBoundDraft(companyId = getCompanyIdFromUrl(), projectId = getProjectIdFromUrl()) {
    const cleanCompanyId = clean(companyId);
    const cleanProjectId = clean(projectId);

    return {
      ...DEFAULT_DRAFT,
      contextCompanyId: cleanCompanyId,
      contextProjectId: cleanProjectId,
      companyId: cleanCompanyId,
      projectId: cleanProjectId,
    };
  }

  function replaceDraftForCurrentUrl(reason = '') {
    const next = makeUrlBoundDraft();
    localStorage.setItem(CONFIG.draftStorageKey, JSON.stringify(next));
    clearFlow();

    if (reason) {
      setStatus(reason, 'warn');
    }

    return next;
  }

  function loadFlow() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.flowStorageKey) || 'null');
    } catch (error) {
      return null;
    }
  }

  function saveFlow(patch = {}) {
    const next = {
      active: true,
      stage: 'context',
      index: 0,
      ...loadFlow(),
      ...patch,
    };
    localStorage.setItem(CONFIG.flowStorageKey, JSON.stringify(next));
    return next;
  }

  function clearFlow() {
    localStorage.removeItem(CONFIG.flowStorageKey);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function optionList(values, selected) {
    return values
      .map(item => {
        const value = typeof item === 'string' ? item : item.value;
        const text = typeof item === 'string' ? item : item.text;
        return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`;
      })
      .join('');
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function digitsOnly(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function visibleField(field) {
    if (!field) return false;
    const style = window.getComputedStyle(field);
    return style.display !== 'none' && style.visibility !== 'hidden' && field.type !== 'hidden';
  }

  function visibleElement(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function getCompanyId() {
    const draft = loadDraft();
    return clean(draft.companyId || getCompanyIdFromUrl());
  }

  function getProjectId() {
    const draft = loadDraft();
    return clean(draft.projectId || getProjectIdFromUrl());
  }

  function rememberUrlContext() {
    const flow = loadFlow();
    if (flow && flow.active) return;

    const companyId = getCompanyIdFromUrl();
    const projectId = getProjectIdFromUrl();
    const draft = loadDraft();

    if (!companyId) return;

    const draftCompanyId = clean(draft.contextCompanyId || draft.companyId);
    const draftProjectId = clean(draft.contextProjectId || draft.projectId);
    const companyChanged = draftCompanyId && draftCompanyId !== companyId;
    const projectChanged = projectId && draftProjectId && draftProjectId !== projectId;

    if (companyChanged || projectChanged) {
      replaceDraftForCurrentUrl('Відкрита інша компанія/проєкт — старі дані очищено.');
      return;
    }

    const patch = {};
    if (companyId && !draft.companyId) patch.companyId = companyId;
    if (projectId && !draft.projectId) patch.projectId = projectId;
    if (companyId && !draft.contextCompanyId) patch.contextCompanyId = companyId;
    if (projectId && !draft.contextProjectId) patch.contextProjectId = projectId;

    if (Object.keys(patch).length) saveDraft(patch);
  }

  function buildPanelUrl(module, action = '') {
    const companyId = getCompanyId();
    const projectId = getProjectId();
    const params = new URLSearchParams();

    params.set('module', module);
    if (action) params.set('action', action);
    if (companyId) params.set('companyID', companyId);
    if (projectId) params.set('showProjectID', projectId);

    return `https://panel.binotel.com/?${params.toString()}`;
  }

  function buildPbxSchemeUrl(companyId) {
    const params = new URLSearchParams();
    params.set('module', CONFIG.pbxSchemeModule);
    params.set('companyID', companyId);
    return `https://panel.binotel.com/?${params.toString()}`;
  }

  function setStatus(message, type = 'info') {
    const panel = $(`#${CONFIG.panelId}`);
    const status = panel && $('.bth-status', panel);
    if (status) {
      status.textContent = message;
      status.dataset.type = type;
    }
    console.log('[TZ helper]', message);
  }

  function readStoredLogs() {
    try {
      const value = JSON.parse(localStorage.getItem(CONFIG.logStorageKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function saveStoredLogs(items) {
    try {
      localStorage.setItem(CONFIG.logStorageKey, JSON.stringify(items.slice(0, 120)));
    } catch (error) {
      // localStorage can be blocked in rare cases; visual log still works.
    }
  }

  function addLogLineToBox(box, item) {
    if (!box || !item) return;
    const line = document.createElement('div');
    line.className = `bth-log-line ${item.type || 'info'}`;
    line.textContent = `${item.time || new Date().toLocaleTimeString()} — ${item.message || ''}`;
    box.prepend(line);
  }

  function renderStoredLogs(box) {
    if (!box) return;
    box.innerHTML = '';
    readStoredLogs().slice().reverse().forEach(item => addLogLineToBox(box, item));
  }

  function log(message, type = 'info') {
    setStatus(message, type);
    const item = {
      time: new Date().toLocaleTimeString(),
      message,
      type,
    };
    const stored = readStoredLogs();
    stored.unshift(item);
    saveStoredLogs(stored);

    const modal = $(`#${CONFIG.modalId}`);
    const box = modal && $('.bth-log', modal);
    if (!box) return;
    addLogLineToBox(box, item);
  }

  function showCenterAlert(message, type = 'error') {
    renderStyles();

    let alert = $(`#${CONFIG.alertId}`);
    if (!alert) {
      alert = document.createElement('div');
      alert.id = CONFIG.alertId;
      document.body.appendChild(alert);
    }

    alert.dataset.type = type;
    alert.innerHTML = `
      <div class="bth-alert-card">
        <div class="bth-alert-title">${type === 'error' ? 'Помилка' : 'Повідомлення'}</div>
        <div class="bth-alert-text">${escapeHtml(message)}</div>
        <button class="bth-alert-ok" type="button">Ок</button>
      </div>
    `;

    $('.bth-alert-ok', alert).addEventListener('click', () => {
      alert.classList.remove('open');
    });

    alert.classList.add('open');
  }

  function showStopButton() {
    let button = $(`#${CONFIG.stopButtonId}`);
    if (!button) {
      button = document.createElement('button');
      button.id = CONFIG.stopButtonId;
      button.textContent = '⛔ STOP';
      button.addEventListener('click', () => {
        stopRequested = true;
        clearFlow();
        log('Зупинку запитано. Скрипт не піде на наступний крок.', 'warn');
      });
      document.body.appendChild(button);
    }
    button.style.display = 'block';
  }

  function hideStopButton() {
    const button = $(`#${CONFIG.stopButtonId}`);
    if (button) button.style.display = 'none';
  }

  function setFieldValue(field, value) {
    if (!field || value === undefined || value === null || value === '') return false;

    field.focus();
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setSelectValue(select, value) {
    if (!select || value === undefined || value === null || value === '') return false;

    const target = normalize(value);
    const option = Array.from(select.options || []).find(item =>
      normalize(item.value) === target ||
      normalize(item.textContent) === target ||
      normalize(item.textContent).includes(target)
    );

    if (!option) return false;

    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findSelectByOptionText(value) {
    const target = normalize(value);
    if (!target) return null;

    return $all('select').find(select =>
      Array.from(select.options || []).some(option =>
        normalize(option.value) === target ||
        normalize(option.textContent) === target
      )
    ) || null;
  }

  function getField(selectors) {
    return String(selectors)
      .split(',')
      .map(selector => $(selector.trim()))
      .find(Boolean) || null;
  }

  function getVisibleField(selectors, root = document) {
    return String(selectors)
      .split(',')
      .map(selector => Array.from(root.querySelectorAll(selector.trim())).find(visibleField))
      .find(Boolean) || null;
  }

  function getFormWithField(selectors) {
    const fields = $all(selectors).filter(visibleField);
    const field = fields[0];
    return field ? field.closest('form') : null;
  }

  function findInputByLabel(labelText) {
    const target = normalize(labelText);
    const labels = $all('label');

    for (const label of labels) {
      if (!normalize(label.textContent).includes(target)) continue;

      const forId = label.getAttribute('for');
      if (forId) {
        const byFor = document.getElementById(forId);
        if (byFor) return byFor;
      }

      const local = label.querySelector('input, textarea, select');
      if (local) return local;

      const wrapper = label.closest('div, tr, .control-group, .form-group');
      const nearby = wrapper && wrapper.querySelector('input, textarea, select');
      if (nearby) return nearby;
    }

    return null;
  }

  function getFieldValue(field) {
    if (!field) return '';

    if (field.tagName === 'SELECT') {
      const optionText = field.selectedOptions && field.selectedOptions[0]
        ? field.selectedOptions[0].textContent
        : '';
      return clean(`${field.value || ''} ${optionText || ''}`);
    }

    return clean(field.value || field.textContent || '');
  }

  function getFirstNumber(value) {
    const match = clean(value).match(/\d+/);
    return match ? String(Number(match[0])) : '';
  }

  function assertSipServerIsAllowed() {
    const sipField =
      findInputByLabel('SIP сервер') ||
      findInputByLabel('Sip сервер') ||
      findInputByLabel('SIP server') ||
      getField('select[name*="sip" i], input[name*="sip" i]');

    if (!sipField) {
      throw new Error('Не знайшов поле "SIP сервер" у параметрах компанії. Перевірку не пройдено.');
    }

    const sipValue = getFieldValue(sipField);
    const sipNumber = getFirstNumber(sipValue);

    if (sipNumber === '') {
      throw new Error('Не зміг прочитати значення поля "SIP сервер". Перевірку не пройдено.');
    }

    if (sipNumber === '0') {
      throw new Error('SIP сервер = 0. Звернись до СВ для зміни SIP сервера.');
    }

    return sipNumber;
  }

  function assertSipServerMatchesRegion(sipNumber, draft) {
    if (draft.regionNotImportant) {
      log('Перевірку регіону пропущено: увімкнено "регіон не важливий".', 'warn');
      return;
    }

    const region = clean(draft.region);
    const sip = Number(sipNumber);

    if (!region) {
      throw new Error('Оберіть регіон або поставте галку "регіон не важливий".');
    }

    let ok = false;
    let expected = '';

    if (region === 'Україна') {
      ok = sip >= 1 && sip <= 49;
      expected = 'SIP 1–49';
    } else if (region === 'Казахстан') {
      ok = sip >= 50 && sip <= 53;
      expected = 'SIP 50–53';
    } else if (region === 'Узбекистан') {
      ok = sip === 70;
      expected = 'SIP 70';
    } else if (region === 'Європа') {
      ok = sip === 80;
      expected = 'SIP 80';
    } else if (region === 'Азербайджан') {
      ok = sip === 65;
      expected = 'SIP 65';
    } else {
      throw new Error(`Невідомий регіон: ${region}.`);
    }

    if (!ok) {
      throw new Error(`SIP сервер ${sipNumber} не відповідає регіону "${region}". Очікується ${expected}. Звернись до СВ для зміни SIP сервера.`);
    }

    log(`Регіон "${region}" відповідає SIP серверу ${sipNumber}.`, 'success');
  }

  function clickButtonByText(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    return clickButtonByTextIn(document, list);
  }

  function clickButtonByTextIn(root, texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const buttons = Array.from(root.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, .btn'))
      .filter(visibleElement)
      .filter(button => !button.disabled);
    const found = buttons.find(button => {
      const value = button.value || button.textContent || '';
      return list.some(text => normalize(value).includes(normalize(text)));
    });

    if (!found) return false;
    found.click();
    return true;
  }

  function clickSubmitNear(field, texts) {
    const form = field && field.closest('form');
    if (form && clickButtonByTextIn(form, texts)) return true;

    const card = field && field.closest('.modal, .panel, .well, .container-fluid, .span10, .row-fluid, div');
    if (card && clickButtonByTextIn(card, texts)) return true;

    return clickButtonByText(texts);
  }

  function clickButtonByTextWithTemporaryConfirm(texts) {
    const originalConfirm = window.confirm;

    window.confirm = function(message) {
      const text = String(message || '');
      if (/временн|тимчас/i.test(text)) {
        log(`Автопідтверджено: ${text}`, 'info');
        return true;
      }

      return originalConfirm.call(window, message);
    };

    try {
      return clickButtonByText(texts);
    } finally {
      setTimeout(() => {
        if (window.confirm !== originalConfirm) {
          window.confirm = originalConfirm;
        }
      }, 1500);
    }
  }

  async function clickSubmitAndContinue(message, nextStage, nextIndex = 0) {
    const clicked = clickButtonByText(['Сохранить', 'Зберегти', 'Добавить', 'Додати']);
    if (!clicked) throw new Error('Не знайшов кнопку збереження/додавання на сторінці.');

    saveFlow({ stage: nextStage, index: nextIndex });
    log(message, 'success');
    await sleep(1200);
  }

  function normalizeLineList(value) {
    return String(value || '')
      .split(/[,\n;]+/)
      .map(item => clean(item))
      .filter(Boolean);
  }

  function getBlockItems(value) {
    return String(value || '')
      .trim()
      .split(/\n\s*\n+/)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => block
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
      );
  }

  function getGsmNumberItems(value) {
    return getBlockItems(value)
      .map(lines => ({
        number: clean(lines[0]),
        name: clean(lines[1] || ''),
      }))
      .filter(item => item.number);
  }

  function getDepartmentBlocks(value) {
    const blocks = getBlockItems(value);
    const result = [];

    blocks.forEach(lines => {
      if (lines.length > 3 && lines.length % 3 === 0) {
        for (let index = 0; index < lines.length; index += 3) {
          result.push(lines.slice(index, index + 3));
        }
        return;
      }

      result.push(lines);
    });

    return result;
  }

  function getDepartmentItems(value) {
    return getDepartmentBlocks(value)
      .map(lines => ({
        name: clean(lines[0]),
        phoneNumbers: normalizeLineList(lines[1]),
        endpoints: normalizeLineList(lines.slice(2).join(',')),
      }))
      .filter(item => item.name);
  }

  function getTemporaryMap() {
    const flow = loadFlow() || {};
    return { ...(flow.temporaryNumbersByRealNumber || {}) };
  }

  function rememberTemporaryNumber(realNumber, temporaryNumber) {
    const map = getTemporaryMap();
    map[clean(realNumber)] = clean(temporaryNumber);
    saveFlow({ temporaryNumbersByRealNumber: map });
  }

  function extractTemporaryNumbersFromText(text) {
    return Array.from(new Set(String(text || '').match(/\b089\d{7}\b/g) || []));
  }

  function collectTemporaryNumbersFromPage() {
    return extractTemporaryNumbersFromText(document.body ? document.body.textContent : '');
  }

  function getRingGroupItems(value) {
    const text = String(value || '').trim();
    if (!text) return [];

    return text
      .split(/\n\s*\n+/)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const lines = block
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);

        if (lines.length === 1 && lines[0].includes('|')) {
          const [number, name, endpointLines] = lines[0].split('|').map(part => part.trim());
          return { number, name, endpointLines };
        }

        return {
          number: lines[0] || '',
          name: lines[1] || '',
          endpointLines: lines.slice(2).join(','),
        };
      });
  }

  function validateDraft(draft) {
    if (!clean(draft.companyId) && !getCompanyIdFromUrl()) {
      throw new Error('Вкажи Panel ID / companyID.');
    }

    if (!clean(draft.projectId) && !getProjectIdFromUrl()) {
      throw new Error('Вкажи Project ID / showProjectID. Це важливо, щоб скрипт працював саме в потрібному проєкті.');
    }

    if (!clean(draft.tzUrl)) {
      throw new Error('Вкажи посилання на ТЗ.');
    }

    if (!draft.regionNotImportant && !clean(draft.region)) {
      throw new Error('Оберіть регіон або поставте галку "регіон не важливий".');
    }
  }

  async function ensurePanelContext(draft) {
    const companyId = clean(draft.companyId || getCompanyIdFromUrl());
    const projectId = clean(draft.projectId || getProjectIdFromUrl());
    if (!companyId) throw new Error('Вкажи Panel ID / companyID.');
    if (!projectId) throw new Error('Вкажи Project ID / showProjectID.');

    const currentCompany = getCompanyIdFromUrl();
    const currentProject = getProjectIdFromUrl();

    if (currentCompany === companyId && currentProject === projectId) {
      saveDraft({ companyId, projectId });
      saveFlow({ stage: 'company', index: 0 });
      await runAutomaticFlow();
      return;
    }

    if (currentCompany === companyId && currentProject && currentProject !== projectId) {
      log(`В URL відкритий інший showProjectID: ${currentProject}. Відкриваю потрібний проєкт ${projectId}.`, 'info');
    }

    saveDraft({ companyId, projectId });
    log(`Відкриваю проєкт ${projectId} компанії ${companyId}.`, 'info');
    window.location.href = buildPanelUrl(CONFIG.pbxSchemeModule);
  }

  function assertCurrentProjectContext(draft, flow) {
    if (!flow || flow.stage === 'context') return;

    const companyId = clean(draft.companyId);
    const projectId = clean(draft.projectId);
    const currentCompany = getCompanyIdFromUrl();
    const currentProject = getProjectIdFromUrl();

    if (!currentCompany && !currentProject) return;

    if (currentCompany !== companyId || (!isProjectAgnosticModule() && currentProject && currentProject !== projectId)) {
      clearFlow();
      throw new Error(`Скрипт зупинено: відкрита інша компанія або проєкт. Очікувалось companyID ${companyId}, showProjectID ${projectId}; зараз companyID ${currentCompany || '—'}, showProjectID ${currentProject || '—'}.`);
    }
  }

  async function applyCompanyParams() {
    const draft = loadDraft();

    if (getModule() !== CONFIG.companyParamsModule) {
      log('Відкриваю параметри компанії.', 'info');
      window.location.href = buildPanelUrl(CONFIG.companyParamsModule);
      return;
    }

    const sipNumber = assertSipServerIsAllowed();
    log(`SIP сервер перевірено: ${sipNumber}.`, 'success');
    assertSipServerMatchesRegion(sipNumber, draft);

    const tzUrlField =
      findInputByLabel('Адрес технического задания') ||
      findInputByLabel('Адрес технічного завдання') ||
      getField('input[name*="technical" i], input[name*="tz" i], input[name*="task" i]');
    setFieldValue(tzUrlField, draft.tzUrl);

    const tariffField =
      findInputByLabel('Пакет') ||
      findInputByLabel('Тариф') ||
      findInputByLabel('Package') ||
      getField('select[name*="package" i], select[name*="tariff" i]');
    const tariffSelect =
      tariffField && tariffField.tagName === 'SELECT'
        ? tariffField
        : findSelectByOptionText(draft.tariff);
    if (tariffSelect) {
      const changed = setSelectValue(tariffSelect, draft.tariff);
      log(changed ? `Пакет встановлено: ${draft.tariff}.` : `Не знайшов пакет у списку: ${draft.tariff}.`, changed ? 'success' : 'warn');
    } else {
      log('Не знайшов поле "Пакет/Тариф".', 'warn');
    }

    const languageField =
      findInputByLabel('Язык в MyBusiness') ||
      findInputByLabel('Мова в MyBusiness') ||
      getField('select[name*="language" i], select[name*="lang" i]');
    if (languageField && languageField.tagName === 'SELECT') setSelectValue(languageField, draft.language);

    const timezoneField =
      findInputByLabel('Часовой пояс') ||
      findInputByLabel('Часовий пояс') ||
      getField('select[name*="timezone" i], select[name*="timeZone" i]');
    if (timezoneField && timezoneField.tagName === 'SELECT') setSelectValue(timezoneField, draft.timezone);

    await clickSubmitAndContinue('Параметри компанії збережено.', 'endpoints', 0);
  }

  async function applyEndpoints() {
    const draft = loadDraft();
    const firstLine = clean(draft.endpointsFirstLine);
    const countLines = clean(draft.endpointsCount);

    if (!firstLine && !countLines) {
      saveFlow({ stage: 'ringGroups', index: 0 });
      await runAutomaticFlow();
      return;
    }

    if (!firstLine || !countLines) {
      throw new Error('Для ліній потрібно вказати стартову ВЛ і кількість.');
    }

    if (getModule() !== CONFIG.endpointsModule) {
      log('Відкриваю внутрішні лінії.', 'info');
      window.location.href = buildPanelUrl(CONFIG.endpointsModule);
      return;
    }

    const firstLineNumber = Number(firstLine);
    const countLinesNumber = Number(countLines);
    if (Number.isFinite(firstLineNumber) && Number.isFinite(countLinesNumber) && countLinesNumber > 0) {
      const requestedLines = Array.from({ length: countLinesNumber }, (_, index) => String(firstLineNumber + index));
      const existingLines = requestedLines.filter(line => visibleRowExistsByTarget(line));

      if (existingLines.length) {
        log(`ВЛ уже існують: ${existingLines.join(', ')}. Масове додавання ВЛ пропущено, щоб не створити дубль.`, 'warn');
        saveFlow({ stage: 'ringGroups', index: 0 });
        await runAutomaticFlow();
        return;
      }
    }

    const firstLineField =
      getField('#batchAdd input[name="params[firstLineNumber]"], input[name*="firstLine" i], input[name*="first" i]');
    const countLinesField =
      getField('#batchAdd input[name="params[countLines]"], input[name*="countLines" i], input[name*="count" i]');
    const submit =
      getField('#batchAdd button[type="submit"], #batchAdd input[type="submit"]');

    setFieldValue(firstLineField, firstLine);
    setFieldValue(countLinesField, countLines);

    if (!submit) throw new Error('Не знайшов кнопку додавання у масовому додаванні ВЛ.');

    saveFlow({ stage: 'ringGroups', index: 0 });
    log(`Додаю внутрішні лінії: з ${firstLine}, кількість ${countLines}.`, 'info');
    submit.click();
    await sleep(1500);
    await runAutomaticFlow();
  }

  function findRingGroupEditButton(groupNumber) {
    const rows = $all('tr');
    const target = clean(groupNumber);

    for (const row of rows) {
      if (!clean(row.textContent).includes(target)) continue;
      const edit =
        row.querySelector('a[href*="action=edit"], a[href*="edit"], .glyphicon-wrench, .icon-edit, button, a');
      if (edit) return edit;
    }

    return null;
  }

  function findEditButtonByRowText(targetText) {
    const target = clean(targetText);
    if (!target) return null;

    const rows = $all('tr');
    for (const row of rows) {
      if (!clean(row.textContent).includes(target)) continue;
      const edit =
        row.querySelector('a[href*="action=edit"], a[href*="edit"], .glyphicon-wrench, .icon-edit, button, a');
      if (edit) return edit;
    }

    return null;
  }

  function visibleRowExistsByTarget(targetText) {
    return $all('tr, label')
      .filter(visibleElement)
      .some(item => textMatchesTarget(item.textContent, targetText));
  }

  function visibleRowExistsByName(targetText) {
    const target = clean(targetText).toLowerCase();
    if (!target) return false;

    return $all('tr')
      .filter(visibleElement)
      .some(item => clean(item.textContent).toLowerCase().includes(target));
  }

  async function waitForVisibleRows(timeoutMs = 4000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if ($all('tr').filter(visibleElement).length > 1) return true;
      await sleep(250);
    }
    return false;
  }

  function textMatchesTarget(text, targetText) {
    const target = clean(targetText);
    if (!target) return false;

    const source = clean(text);
    if (!source) return false;

    const targetDigits = digitsOnly(target);
    const sourceDigits = digitsOnly(source);

    if (/^\d+$/.test(target)) {
      const exactNumber = new RegExp(`(^|\\D)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`);
      if (exactNumber.test(source)) return true;

      // Для телефонних номерів панель часто ставить пробіли: 0670000000 -> 067 000 00 00.
      return targetDigits.length >= 7 && sourceDigits.includes(targetDigits);
    }

    return source.toLowerCase().includes(target.toLowerCase());
  }

  function ringGroupExists(groupNumber, groupName) {
    const number = clean(groupNumber);
    const name = clean(groupName).toLowerCase();

    return $all('tr')
      .filter(visibleElement)
      .some(row => {
        const text = clean(row.textContent);
        const lower = text.toLowerCase();
        return (
          (number && textMatchesTarget(text, number)) ||
          (name && lower.includes(name))
        );
      });
  }

  function findCheckboxByTarget(targetText) {
    const candidates = [
      ...$all('label'),
      ...$all('tr'),
      ...$all('li'),
      ...$all('div'),
    ]
      .filter(visibleElement)
      .map(element => ({
        element,
        checkbox: element.querySelector('input[type="checkbox"]'),
        text: clean(element.textContent),
      }))
      .filter(item => item.checkbox && visibleElement(item.checkbox) && textMatchesTarget(item.text, targetText))
      .sort((a, b) => a.text.length - b.text.length);

    return candidates[0] ? candidates[0].checkbox : null;
  }

  function setCheckboxByExactText(targetText, checked = true) {
    const checkbox = findCheckboxByTarget(targetText);
    if (!checkbox) return false;

    if (checkbox.checked !== checked) checkbox.click();
    return true;
  }

  function setEndpointCheckboxByLine(lineNumber, checked = true) {
    const checkbox = findCheckboxByTarget(lineNumber);
    if (!checkbox) return false;

    if (checkbox.checked !== checked) {
      checkbox.click();
    }

    return true;
  }

  function selectOptionByTextOrValue(targetText) {
    const target = clean(targetText);
    if (!target) return false;

    for (const select of $all('select')) {
      if (!visibleField(select) || select.disabled) continue;

      const options = Array.from(select.options || []);
      const option = options.find(item =>
        textMatchesTarget(item.textContent, target) ||
        textMatchesTarget(item.value, target)
      );

      if (!option) continue;

      if (select.multiple) {
        option.selected = true;
      } else {
        select.value = option.value;
      }

      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  function selectTargetOnPage(targetText) {
    return setCheckboxByExactText(targetText, true) || selectOptionByTextOrValue(targetText);
  }

  async function applyRingGroups() {
    const draft = loadDraft();
    const rows = getRingGroupItems(draft.ringGroupsRows);
    const flow = loadFlow() || {};
    const index = Number(flow.index || 0);

    if (!rows.length || index >= rows.length) {
      saveFlow({ stage: 'gsmNumbers', index: 0, ringGroupAction: '' });
      await runAutomaticFlow();
      return;
    }

    const row = rows[index];
    const groupNumber = clean(row.number);
    const groupName = clean(row.name);
    const lines = normalizeLineList(row.endpointLines);

    if (!groupNumber || !groupName) {
      throw new Error('Формат групи має бути: номер, назва, лінії. Нова група відділяється пустим рядком.');
    }

    const params = getParams();
    const isEditPage = getModule() === CONFIG.ringGroupsModule && params.get('action') === 'edit';

    if (getModule() !== CONFIG.ringGroupsModule) {
      log('Відкриваю групи виклику.', 'info');
      window.location.href = buildPanelUrl(CONFIG.ringGroupsModule);
      return;
    }

    if (isEditPage && flow.ringGroupAction !== 'create') {
      log(`Сторінка додавання групи відкрита без перевірки списку. Повертаюсь до списку, щоб не створити дубль групи ${groupNumber}.`, 'warn');
      window.location.href = buildPanelUrl(CONFIG.ringGroupsModule);
      return;
    }

    if (!isEditPage) {
      await waitForVisibleRows(5000);

      if (ringGroupExists(groupNumber, groupName)) {
        log(`Група ${groupNumber} / "${groupName}" вже існує — пропускаю створення.`, 'warn');
        saveFlow({ stage: 'ringGroups', index: index + 1, ringGroupAction: '' });
        await runAutomaticFlow();
        return;
      }

      log(`Створюю нову групу ${groupNumber}.`, 'info');
      saveFlow({ stage: 'ringGroups', index, ringGroupAction: 'create' });
      window.location.href = buildPanelUrl(CONFIG.ringGroupsModule, 'edit');
      return;
    }

    setFieldValue(getField('input[name="number"], #ringGroupNumber'), groupNumber);
    setFieldValue(getField('input[name="name"]'), groupName);

    const missing = [];
    const selected = [];
    lines.forEach(line => {
      if (setEndpointCheckboxByLine(line, true)) {
        selected.push(line);
      } else {
        missing.push(line);
      }
    });

    if (selected.length) {
      log(`Для групи ${groupNumber} вибрано ВЛ: ${selected.join(', ')}`, 'success');
    }

    if (missing.length) {
      log(`Не знайшов ВЛ для групи ${groupNumber}: ${missing.join(', ')}`, 'warn');
    }

    const clicked = clickButtonByText(['Сохранить', 'Зберегти', 'Добавить', 'Додати']);
    if (!clicked) throw new Error('Не знайшов кнопку збереження/додавання групи.');

    saveFlow({ stage: 'ringGroups', index: index + 1, ringGroupAction: '' });
    log(`Група ${groupNumber} збережена.`, 'success');
    await sleep(1200);
    await continueAfterRingGroupSave_();
  }

  async function continueAfterRingGroupSave_() {
    await runAutomaticFlow();
  }

  function getVisibleWritableFields() {
    return $all('input[type="text"], input:not([type]), input[type="email"], textarea')
      .filter(visibleField)
      .filter(field => !field.disabled && !field.readOnly);
  }

  async function applyGsmNumbers() {
    const draft = loadDraft();
    const rows = getGsmNumberItems(draft.gsmNumbersRows);
    const flow = loadFlow() || {};
    const index = Number(flow.index || 0);

    if (!rows.length || index >= rows.length) {
      saveFlow({ stage: 'departments', index: 0 });
      await runAutomaticFlow();
      return;
    }

    const item = rows[index];
    if (!item.number) throw new Error('У блоці номерів не вказано номер.');

    if (getModule() !== CONFIG.gsmPortsModule) {
      log('Відкриваю GSM порти.', 'info');
      window.location.href = buildPanelUrl(CONFIG.gsmPortsModule);
      return;
    }

    const isEditPage = getParams().get('action') === 'edit';

    if (!isEditPage) {
      if (visibleRowExistsByTarget(item.number)) {
        log(`GSM номер ${item.number} вже існує — пропускаю створення.`, 'warn');
        saveFlow({ stage: 'gsmNumbers', index: index + 1 });
        await runAutomaticFlow();
        return;
      }

      if (!clickButtonByText(['Додати', 'Добавить'])) {
        throw new Error('Не знайшов кнопку додавання GSM номера.');
      }

      log(`Відкриваю форму додавання GSM номера ${item.number}.`, 'info');
      return;
    }

    const gsmForm =
      getFormWithField('input[name="number"]') ||
      getFormWithField('select[name="server"]') ||
      document;
    const visibleFields = getVisibleWritableFields().filter(field => !field.closest('form') || field.closest('form') === gsmForm);
    const numberField =
      getVisibleField('input[name="number"]', gsmForm) ||
      getVisibleField('input[name*="phone" i]', gsmForm) ||
      visibleFields[0];

    if (!numberField || numberField.disabled || numberField.readOnly) {
      throw new Error(`Форма GSM номера відкрита, але не знайшов активне поле "Номер" для ${item.number}.`);
    }

    const nameField =
      getVisibleField('input[name="name"]', gsmForm) ||
      getVisibleField('input[name*="title" i]', gsmForm) ||
      visibleFields.find(field => field !== numberField && /name|title|назв/i.test(field.name || field.id || field.placeholder || '')) ||
      visibleFields.find(field => field !== numberField);
    const emailField =
      getVisibleField('input[name="email"]', gsmForm) ||
      getVisibleField('input[type="email"], input[name*="email" i]', gsmForm) ||
      visibleFields.find(field => /mail|email|почт|пошт/i.test(field.name || field.id || field.placeholder || ''));
    const serverField =
      getVisibleField('select[name="server"]', gsmForm) ||
      getVisibleField('select[name*="server" i]', gsmForm);

    if (!setFieldValue(numberField, item.number)) {
      throw new Error(`Не зміг заповнити номер GSM: ${item.number}.`);
    }
    if (item.name) {
      setFieldValue(nameField, item.name);
    }
    setFieldValue(emailField, clean(draft.gsmEmail) || 'noemail');

    if (serverField && serverField.tagName === 'SELECT') {
      const serverChanged = setSelectValue(serverField, 'rgsm0');
      log(serverChanged ? 'GSM сервер встановлено: rgsm0.' : 'Не знайшов rgsm0 у списку GSM серверів.', serverChanged ? 'success' : 'warn');
    } else {
      log('Не знайшов поле GSM сервера. Перевір, чи rgsm0 виставився автоматично.', 'warn');
    }

    const nextStage = draft.createTemporaryNumbers ? 'gsmTemporaryOpen' : 'gsmNumbers';
    const nextIndex = draft.createTemporaryNumbers ? index : index + 1;

    saveFlow({
      stage: nextStage,
      index: nextIndex,
      pendingRealNumber: item.number,
      temporaryBefore: collectTemporaryNumbersFromPage(),
    });

    log(`Додаю GSM номер ${item.number}.`, 'info');
    if (!clickSubmitNear(numberField, ['Зберегти', 'Сохранить', 'Додати', 'Добавить'])) {
      throw new Error('Не знайшов кнопку збереження GSM номера.');
    }

    return;
  }

  async function applyGsmTemporaryOpen() {
    const flow = loadFlow() || {};
    const realNumber = clean(flow.pendingRealNumber);

    if (!realNumber) {
      saveFlow({ stage: 'gsmNumbers', index: Number(flow.index || 0) + 1 });
      await runAutomaticFlow();
      return;
    }

    if (getModule() !== CONFIG.pbxNumbersEnhancedModule) {
      log(`Відкриваю розширені телефонні номери для тимчасового номера до ${realNumber}.`, 'info');
      window.location.href = buildPanelUrl(CONFIG.pbxNumbersEnhancedModule);
      return;
    }

    const before = collectTemporaryNumbersFromPage();
    saveFlow({
      stage: 'gsmTemporaryFind',
      index: Number(flow.index || 0),
      pendingRealNumber: realNumber,
      temporaryBefore: before,
    });

    if (!clickButtonByTextWithTemporaryConfirm(['Добавить временный номер для ВАТС', 'Добавить временный', 'Додати тимчасовий', 'тимчасовий номер'])) {
      log(`Не знайшов кнопку тимчасового номера для ${realNumber}. Йду далі без мапи тимчасового.`, 'warn');
      saveFlow({ stage: 'gsmNumbers', index: Number(flow.index || 0) + 1 });
      await runAutomaticFlow();
      return;
    }

    log(`Створюю тимчасовий номер для ${realNumber}.`, 'info');
    await sleep(1800);
    await runAutomaticFlow();
  }

  async function applyGsmTemporaryFind() {
    const flow = loadFlow() || {};
    const realNumber = clean(flow.pendingRealNumber);
    const before = Array.isArray(flow.temporaryBefore) ? flow.temporaryBefore : [];

    if (getModule() !== CONFIG.pbxNumbersEnhancedModule) {
      window.location.href = buildPanelUrl(CONFIG.pbxNumbersEnhancedModule);
      return;
    }

    const after = collectTemporaryNumbersFromPage();
    const created = after.find(number => !before.includes(number));

    if (created) {
      rememberTemporaryNumber(realNumber, created);
      log(`Запам’ятав тимчасовий номер: ${realNumber} → ${created}.`, 'success');
    } else {
      log(`Не зміг визначити новий тимчасовий номер для ${realNumber}. У відділ додам тільки основний номер.`, 'warn');
    }

    saveFlow({
      stage: 'gsmNumbers',
      index: Number(flow.index || 0) + 1,
      pendingRealNumber: '',
      temporaryBefore: [],
    });
    await runAutomaticFlow();
  }

  async function applyDepartments() {
    const draft = loadDraft();
    const rows = getDepartmentItems(draft.departmentsRows);
    const flow = loadFlow() || {};
    const index = Number(flow.index || 0);

    if (!rows.length || index >= rows.length) {
      saveFlow({ stage: 'done', index: 0 });
      await runAutomaticFlow();
      return;
    }

    const department = rows[index];
    const params = getParams();
    const isEditPage = getModule() === CONFIG.departmentsModule && params.get('action') === 'edit';

    if (getModule() !== CONFIG.departmentsModule) {
      log('Відкриваю відділи.', 'info');
      window.location.href = buildPanelUrl(CONFIG.departmentsModule);
      return;
    }

    if (!isEditPage) {
      if (visibleRowExistsByName(department.name)) {
        log(`Відділ "${department.name}" вже існує — пропускаю створення.`, 'warn');
        saveFlow({ stage: 'departments', index: index + 1 });
        await runAutomaticFlow();
        return;
      }

      log(`Створюю відділ "${department.name}".`, 'info');
      window.location.href = buildPanelUrl(CONFIG.departmentsModule, 'edit');
      return;
    }

    setFieldValue(
      getVisibleField('input[name="name"], input[name*="title" i]') ||
      findInputByLabel('Назва') ||
      findInputByLabel('Название') ||
      findInputByLabel('Name'),
      department.name
    );

    const temporaryMap = getTemporaryMap();
    const phoneTargets = [];
    (department.phoneNumbers || []).forEach(phoneNumber => {
      phoneTargets.push(phoneNumber);
      if (temporaryMap[phoneNumber]) {
        phoneTargets.push(temporaryMap[phoneNumber]);
      }
    });

    const targets = [
      ...phoneTargets,
      ...department.endpoints,
    ].map(clean).filter(Boolean);

    const missing = [];
    const selected = [];
    targets.forEach(target => {
      if (selectTargetOnPage(target)) {
        selected.push(target);
      } else {
        missing.push(target);
      }
    });

    if (selected.length) log(`Для відділу "${department.name}" вибрано: ${selected.join(', ')}`, 'success');
    if (missing.length) log(`Не знайшов для відділу "${department.name}": ${missing.join(', ')}`, 'warn');

    await clickSubmitAndContinue(`Відділ "${department.name}" збережено.`, 'departments', index + 1);
  }

  async function runAutomaticFlow() {
    if (stopRequested) {
      clearFlow();
      log('Виконання зупинено.', 'warn');
      return;
    }

    const currentFlow = loadFlow();
    if (currentFlow && currentFlow.type === 'ivr') {
      return runIvrFlow();
    }

    const draft = loadDraft();
    validateDraft(draft);
    const flow = saveFlow(loadFlow() || { stage: 'context', index: 0 });
    assertCurrentProjectContext(draft, flow);

    if (flow.stage === 'context') return ensurePanelContext(draft);
    if (flow.stage === 'company') return applyCompanyParams();
    if (flow.stage === 'endpoints') return applyEndpoints();
    if (flow.stage === 'ringGroups') return applyRingGroups();
    if (flow.stage === 'gsmNumbers') return applyGsmNumbers();
    if (flow.stage === 'gsmTemporaryOpen') return applyGsmTemporaryOpen();
    if (flow.stage === 'gsmTemporaryFind') return applyGsmTemporaryFind();
    if (flow.stage === 'departments') return applyDepartments();

    clearFlow();
    log('Готово: параметри компанії, ВЛ, групи, GSM номери та відділи пройдені.', 'success');
  }

  function parseIvrTreeRows(value) {
    const rows = String(value || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map((line, index) => {
        const parts = line.split('|').map(part => clean(part));
        const path = parts[0] || '';
        return {
          raw: line,
          lineNumber: index + 1,
          path,
          label: parts[1] || '',
          routeId: parts[2] || '',
        };
      });

    const errors = [];
    const nodes = new Map();

    rows.forEach(row => {
      if (!row.path) {
        errors.push(`Рядок ${row.lineNumber}: не вказано шлях кнопки.`);
        return;
      }

      if (row.path !== 't' && !/^[0-9](?:-[0-9]+)*$/.test(row.path)) {
        errors.push(`Рядок ${row.lineNumber}: шлях "${row.path}" має бути формату 1, 1-1, 2-3 або t.`);
        return;
      }

      if (!row.label) {
        errors.push(`Рядок ${row.lineNumber}: для "${row.path}" не вказано назву.`);
        return;
      }

      if (nodes.has(row.path)) {
        errors.push(`Рядок ${row.lineNumber}: дубль шляху "${row.path}".`);
        return;
      }

      nodes.set(row.path, {
        ...row,
        children: [],
      });
    });

    nodes.forEach(node => {
      if (node.path === 't') return;

      const parts = node.path.split('-');
      if (parts.length <= 1) return;

      const parentPath = parts.slice(0, -1).join('-');
      if (!nodes.has(parentPath)) {
        nodes.set(parentPath, {
          path: parentPath,
          label: `Підменю ${parentPath}`,
          routeId: '',
          lineNumber: 0,
          raw: '',
          children: [],
          generatedParent: true,
        });
      }
    });

    nodes.forEach(node => {
      if (node.path === 't') return;

      const parts = node.path.split('-');
      if (parts.length <= 1) return;

      const parent = nodes.get(parts.slice(0, -1).join('-'));
      if (parent && !parent.children.includes(node.path)) {
        parent.children.push(node.path);
      }
    });

    nodes.forEach(node => {
      node.children.sort((a, b) => {
        const aLast = Number(a.split('-').pop());
        const bLast = Number(b.split('-').pop());
        return aLast - bLast;
      });
    });

    const rootChildren = [...nodes.values()]
      .filter(node => node.path !== 't' && !node.path.includes('-'))
      .map(node => node.path)
      .sort((a, b) => Number(a) - Number(b));

    nodes.forEach(node => {
      if (node.path === 't') return;
      if (!node.children.length && !node.routeId) {
        errors.push(`Пункт "${node.path} — ${node.label}" не має ні routeID, ні підменю.`);
      }
    });

    if (!rootChildren.length) {
      errors.push('Не знайдено жодної кнопки першого рівня.');
    }

    return {
      nodes,
      rootChildren,
      defaultNode: nodes.get('t') || null,
      errors,
    };
  }

  function getIvrRoutePlaceholder(path) {
    return `__ROUTE_ID_IVR_${path}__`;
  }

  function getIvrFinalPlaceholder(path) {
    return `__ROUTE_ID_${path}__`;
  }

  function getIvrPathTitle(nodes, path) {
    return path
      .split('-')
      .map((_, index, parts) => {
        const key = parts.slice(0, index + 1).join('-');
        return nodes.get(key)?.label || key;
      })
      .join(' / ');
  }

  function getIvrScenarioRouteId(node) {
    if (!node) return '';
    if (node.children && node.children.length) return getIvrRoutePlaceholder(node.path);
    return node.routeId || getIvrFinalPlaceholder(node.path);
  }

  function buildIvrConfigBlock({ contextName, children, nodes, defaultNode, waitSeconds }) {
    const lines = [
      `[${contextName}]`,
      'exten => s,1,Answer(500)',
      'exten => s,n,BackGround(${ARG1})',
      `exten => s,n,WaitExten(${waitSeconds || 5})`,
      '',
    ];

    children.forEach(childPath => {
      const child = nodes.get(childPath);
      const button = childPath.split('-').pop();
      const routeId = getIvrScenarioRouteId(child);
      lines.push(`; ${button} — ${child?.label || childPath}`);
      lines.push(`exten => ${button},1,Set(ivrRouteID=${routeId})`);
      lines.push(`exten => ${button},n,Return`);
      lines.push('');
    });

    const defaultRoute = defaultNode?.routeId || getIvrFinalPlaceholder('t');
    lines.push('; t — сценарій за замовчуванням');
    lines.push(`exten => t,1,Set(ivrRouteID=${defaultRoute})`);
    lines.push('exten => t,n,Return');
    lines.push('exten => i,1,Goto(t,1)');
    lines.push('exten => h,1,Goto(vOfficeIvrAddHangupedCall,s,1)');

    return lines.join('\n');
  }

  function buildIvrBuilderResult(draft) {
    const parsed = parseIvrTreeRows(draft.ivrTreeRows);
    const companyId = clean(draft.companyId || getCompanyIdFromUrl()) || 'COMPANY_ID';
    const configName = clean(draft.ivrConfigName) || 'IVR';
    const waitSeconds = clean(draft.ivrWaitSeconds) || '5';
    const scenarios = [];
    const configBlocks = [];
    const treeLines = [];

    if (parsed.errors.length) {
      return {
        ok: false,
        errors: parsed.errors,
        tree: '',
        scenarios: '',
        config: '',
      };
    }

    scenarios.push(`ROOT — ${configName}`);
    configBlocks.push(buildIvrConfigBlock({
      contextName: `ivr-${companyId}`,
      children: parsed.rootChildren,
      nodes: parsed.nodes,
      defaultNode: parsed.defaultNode,
      waitSeconds,
    }));

    parsed.rootChildren.forEach(path => {
      const walk = (currentPath, depth = 0) => {
        const node = parsed.nodes.get(currentPath);
        if (!node) return;

        const indent = '  '.repeat(depth);
        const marker = node.children.length ? 'підменю' : `routeID: ${node.routeId || getIvrFinalPlaceholder(node.path)}`;
        treeLines.push(`${indent}${node.path} — ${node.label} (${marker})`);

        if (node.children.length) {
          scenarios.push(`IVR ${node.path} — ${getIvrPathTitle(parsed.nodes, node.path)} → ${getIvrRoutePlaceholder(node.path)}`);
          configBlocks.push(buildIvrConfigBlock({
            contextName: `ivr-${companyId}-${node.path}`,
            children: node.children,
            nodes: parsed.nodes,
            defaultNode: parsed.defaultNode,
            waitSeconds,
          }));
        }

        node.children.forEach(childPath => walk(childPath, depth + 1));
      };

      walk(path, 0);
    });

    if (parsed.defaultNode) {
      treeLines.push(`t — ${parsed.defaultNode.label} (routeID: ${parsed.defaultNode.routeId || getIvrFinalPlaceholder('t')})`);
    }

    return {
      ok: true,
      errors: [],
      tree: treeLines.join('\n'),
      scenarios: scenarios.join('\n'),
      config: configBlocks.join('\n\n; --------------------------------------------------\n\n'),
    };
  }

  function setIvrBuilderOutputs(result) {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;

    const errorsField = $('[data-ivr-output="errors"]', modal);
    const treeField = $('[data-ivr-output="tree"]', modal);
    const scenariosField = $('[data-ivr-output="scenarios"]', modal);
    const configField = $('[data-ivr-output="config"]', modal);

    if (errorsField) {
      errorsField.textContent = result.errors.length ? result.errors.join('\n') : 'Помилок не знайдено.';
      errorsField.dataset.type = result.ok ? 'success' : 'error';
    }
    if (treeField) treeField.value = result.tree || '';
    if (scenariosField) scenariosField.value = result.scenarios || '';
    if (configField) configField.value = result.config || '';
  }

  async function copyTextFromField(selector) {
    const field = $(selector);
    if (!field) return false;

    const text = field.value || field.textContent || '';
    if (!text) return false;

    await navigator.clipboard.writeText(text);
    return true;
  }

  function getDefaultIvrNodes() {
    return [
      { id: 'ivr-1', parentId: 'root', key: '1', label: 'Продажі', type: 'submenu', routeId: '' },
      { id: 'ivr-1-1', parentId: 'ivr-1', key: '1', label: 'Новий клієнт', type: 'final', routeId: '188677' },
      { id: 'ivr-1-2', parentId: 'ivr-1', key: '2', label: 'Діючий клієнт', type: 'final', routeId: '188678' },
      { id: 'ivr-2', parentId: 'root', key: '2', label: 'Підтримка', type: 'submenu', routeId: '' },
      { id: 'ivr-2-1', parentId: 'ivr-2', key: '1', label: 'Технічне питання', type: 'final', routeId: '188679' },
      { id: 'ivr-2-2', parentId: 'ivr-2', key: '2', label: 'Фінансове питання', type: 'final', routeId: '188680' },
      { id: 'ivr-3', parentId: 'root', key: '3', label: 'Бухгалтерія', type: 'final', routeId: '188682' },
      { id: 'ivr-t', parentId: 'root', key: 't', label: 'За замовчуванням', type: 'final', routeId: '188681' },
    ];
  }

  function normalizeIvrNode(node) {
    return {
      id: clean(node && node.id) || `ivr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      parentId: clean(node && node.parentId) || 'root',
      key: clean(node && node.key).toLowerCase(),
      label: clean(node && node.label),
      type: clean(node && node.type) === 'submenu' ? 'submenu' : 'final',
      routeId: clean(node && node.routeId),
    };
  }

  function getIvrNodesFromDraft(draft = loadDraft()) {
    try {
      const parsed = JSON.parse(draft.ivrNodesJson || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeIvrNode).filter(node => node.id && node.parentId);
    } catch (error) {
      return [];
    }
  }

  function saveIvrNodes(nodes) {
    const cleanNodes = (nodes || []).map(normalizeIvrNode);
    saveDraft({ ivrNodesJson: JSON.stringify(cleanNodes) });
    return cleanNodes;
  }

  function getIvrChildren(nodes, parentId) {
    return nodes
      .filter(node => node.parentId === parentId)
      .sort((a, b) => {
        if (a.key === 't') return 1;
        if (b.key === 't') return -1;
        return Number(a.key) - Number(b.key);
      });
  }

  function getIvrPath(nodes, node) {
    const parts = [];
    let current = node;
    let guard = 0;
    while (current && current.parentId !== 'root' && guard < 20) {
      parts.unshift(current.key);
      current = nodes.find(item => item.id === current.parentId);
      guard += 1;
    }
    if (current) parts.unshift(current.key);
    return parts.join('-');
  }

  function buildIvrVisualResult(draft = loadDraft()) {
    const nodes = getIvrNodesFromDraft(draft);
    const errors = [];
    const companyId = clean(draft.companyId || getCompanyIdFromUrl()) || 'COMPANY_ID';
    const waitSeconds = clean(draft.ivrWaitSeconds) || '5';
    const nodesByPath = new Map();
    const scenarios = [];
    const treeLines = ['Головне меню'];
    const configBlocks = [];

    const validateNode = (node, depth = 0) => {
      if (!/^(?:[0-9]|t)$/.test(node.key)) {
        errors.push(`"${node.label || node.id}": кнопка має бути 0-9 або t.`);
      }
      if (!node.label) {
        errors.push(`Кнопка ${node.key}: не вказано назву.`);
      }

      const siblings = getIvrChildren(nodes, node.parentId).filter(item => item.key === node.key);
      if (siblings.length > 1 && siblings[0].id !== node.id) {
        errors.push(`Дубль кнопки "${node.key}" на одному рівні.`);
      }

      const children = getIvrChildren(nodes, node.id);
      const hasChildren = children.length > 0;
      const isSubmenu = hasChildren || node.type === 'submenu';
      const path = getIvrPath(nodes, node);

      if (!isSubmenu && !node.routeId) {
        errors.push(`Пункт "${path} ${node.label}" не завершений: немає routeID.`);
      }

      nodesByPath.set(path, {
        path,
        label: node.label,
        routeId: isSubmenu ? '' : node.routeId,
        children: children.map(child => getIvrPath(nodes, child)),
      });

      const indent = '  '.repeat(depth);
      const arrow = isSubmenu ? '' : ` → ${node.routeId || 'routeID?'}`;
      treeLines.push(`${indent}• ${node.key} ${node.label}${arrow}`);

      children.forEach(child => validateNode(child, depth + 1));
    };

    const rootChildren = getIvrChildren(nodes, 'root');
    if (!rootChildren.length) {
      errors.push('Головне меню порожнє: додайте хоча б один пункт.');
    }

    rootChildren.forEach(node => validateNode(node, 0));

    configBlocks.push(buildIvrConfigBlock({
      contextName: `ivr-${companyId}`,
      children: rootChildren.map(node => getIvrPath(nodes, node)),
      nodes: nodesByPath,
      defaultNode: nodesByPath.get('t') || null,
      waitSeconds,
    }));

    [...nodesByPath.values()]
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
      .forEach(node => {
        if (node.children.length) {
          scenarios.push(`IVR ${node.path} — ${node.label} → ${getIvrRoutePlaceholder(node.path)}`);
        } else {
          scenarios.push(`${node.path} ${node.label} → ${node.routeId || getIvrFinalPlaceholder(node.path)}`);
        }
      });

    nodesByPath.forEach(node => {
      if (!node.children.length) return;
      const contextName = `ivr-${companyId}-${node.path}`;
      configBlocks.push(buildIvrConfigBlock({
        contextName,
        children: node.children,
        nodes: nodesByPath,
        defaultNode: nodesByPath.get('t') || null,
        waitSeconds,
      }));
    });

    return {
      ok: errors.length === 0,
      errors,
      tree: treeLines.join('\n'),
      scenarios: scenarios.join('\n'),
      config: configBlocks.join('\n\n; --------------------------------------------------\n\n'),
    };
  }

  function renderIvrTreeHtml(nodes, parentId = 'root', depth = 0) {
    const children = getIvrChildren(nodes, parentId);
    if (!children.length) return depth ? '' : '<div class="bth-empty-tree">Головне меню порожнє. Додайте перший пункт.</div>';

    return `
      <ul class="bth-ivr-tree-list ${depth ? '' : 'root'}">
        ${children.map(node => {
          const hasChildren = getIvrChildren(nodes, node.id).length > 0;
          const isSubmenu = hasChildren || node.type === 'submenu';
          const typeText = isSubmenu ? 'підменю' : `→ ${escapeHtml(node.routeId || 'routeID?')}`;
          const invalid = !isSubmenu && !node.routeId ? ' invalid' : '';
          return `
            <li class="bth-ivr-node${invalid}" data-node-id="${escapeHtml(node.id)}">
              <div class="bth-ivr-node-row">
                <span class="bth-ivr-node-title">${escapeHtml(node.key)} ${escapeHtml(node.label || 'Без назви')}</span>
                <span class="bth-ivr-node-type">${typeText}</span>
                <button type="button" data-ivr-action="add-child" data-node-id="${escapeHtml(node.id)}">+</button>
                <button type="button" data-ivr-action="edit" data-node-id="${escapeHtml(node.id)}">Ред.</button>
                <button type="button" data-ivr-action="toggle-type" data-node-id="${escapeHtml(node.id)}">${isSubmenu ? 'Сцен.' : 'Підм.'}</button>
                <button type="button" data-ivr-action="delete" data-node-id="${escapeHtml(node.id)}">×</button>
              </div>
              ${renderIvrTreeHtml(nodes, node.id, depth + 1)}
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  function refreshIvrVisualBuilder() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const nodes = getIvrNodesFromDraft();
    const treeBox = $('.bth-ivr-visual-tree', modal);
    if (treeBox) treeBox.innerHTML = `<h4>Головне меню</h4>${renderIvrTreeHtml(nodes)}`;
    setIvrBuilderOutputs(buildIvrVisualResult(loadDraft()));
  }

  function setIvrEditor(parentId = 'root', node = null) {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const idField = $('[data-ivr-editor="id"]', modal);
    const parentField = $('[data-ivr-editor="parentId"]', modal);
    const keyField = $('[data-ivr-editor="key"]', modal);
    const labelField = $('[data-ivr-editor="label"]', modal);
    const typeField = $('[data-ivr-editor="type"]', modal);
    const routeField = $('[data-ivr-editor="routeId"]', modal);

    if (idField) idField.value = node ? node.id : '';
    if (parentField) parentField.value = node ? node.parentId : parentId;
    if (keyField) keyField.value = node ? node.key : '';
    if (labelField) labelField.value = node ? node.label : '';
    if (typeField) typeField.value = node ? node.type : 'final';
    if (routeField) routeField.value = node ? node.routeId : '';
  }

  function saveIvrEditorNode() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const id = clean($('[data-ivr-editor="id"]', modal)?.value);
    const parentId = clean($('[data-ivr-editor="parentId"]', modal)?.value) || 'root';
    const key = clean($('[data-ivr-editor="key"]', modal)?.value).toLowerCase();
    const label = clean($('[data-ivr-editor="label"]', modal)?.value);
    const type = clean($('[data-ivr-editor="type"]', modal)?.value) === 'submenu' ? 'submenu' : 'final';
    const routeId = clean($('[data-ivr-editor="routeId"]', modal)?.value);
    const nodes = getIvrNodesFromDraft();
    const node = normalizeIvrNode({ id: id || `ivr-${Date.now()}-${Math.random().toString(16).slice(2)}`, parentId, key, label, type, routeId });

    if (id) {
      const index = nodes.findIndex(item => item.id === id);
      if (index >= 0) nodes[index] = node;
    } else {
      nodes.push(node);
    }

    saveIvrNodes(nodes);
    setIvrEditor('root');
    refreshIvrVisualBuilder();
  }

  function deleteIvrNode(nodeId) {
    const nodes = getIvrNodesFromDraft();
    const idsToDelete = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach(node => {
        if (idsToDelete.has(node.parentId) && !idsToDelete.has(node.id)) {
          idsToDelete.add(node.id);
          changed = true;
        }
      });
    }
    deleteIvrRepeatSettings(Array.from(idsToDelete));
    saveIvrNodes(nodes.filter(node => !idsToDelete.has(node.id)));
    refreshIvrVisualBuilder();
  }

  function toggleIvrNodeType(nodeId) {
    const nodes = getIvrNodesFromDraft();
    const node = nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.type = node.type === 'submenu' ? 'final' : 'submenu';
    if (node.type === 'submenu') node.routeId = '';
    saveIvrNodes(nodes);
    refreshIvrVisualBuilder();
  }

  function getIvrAutoPlaceholder(path, label) {
    const safePath = String(path || '')
      .toUpperCase()
      .replace(/-/g, '_')
      .replace(/[^0-9A-ZА-ЯІЇЄҐ_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const safeLabel = String(label || '')
      .toUpperCase()
      .replace(/[^0-9A-ZА-ЯІЇЄҐ]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `__ROUTE_ID_${safePath}${safeLabel ? '_' + safeLabel : ''}__`;
  }

  function getIvrContextName(companyId, path) {
    return path ? `ivr-${companyId}-${path}` : `ivr-${companyId}`;
  }

  function getNextIvrKey(nodes, parentId) {
    const used = new Set(getIvrChildren(nodes, parentId).map(node => node.key));
    for (let i = 1; i <= 9; i += 1) {
      if (!used.has(String(i))) return String(i);
    }
    if (!used.has('0')) return '0';
    if (!used.has('t')) return 't';
    return '1';
  }

  function getIvrNodePath(nodes, node) {
    return getIvrPath(nodes, node);
  }

  function getIvrNodeKind(nodes, node) {
    const hasChildren = getIvrChildren(nodes, node.id).length > 0;
    return hasChildren || node.type === 'submenu' ? 'submenu' : 'final';
  }

  function buildIvrTableRows(nodes) {
    const rows = [];
    const walk = parentId => {
      getIvrChildren(nodes, parentId).forEach(node => {
        rows.push(node);
        walk(node.id);
      });
    };
    walk('root');
    return rows;
  }

  function buildIvrVisualResult(draft = loadDraft()) {
    const nodes = getIvrNodesFromDraft(draft);
    const companyId = clean(draft.companyId || getCompanyIdFromUrl()) || 'COMPANY_ID';
    const waitSeconds = clean(draft.ivrWaitSeconds) || '5';
    const errors = [];
    const rows = buildIvrTableRows(nodes);
    const rootChildren = getIvrChildren(nodes, 'root');
    const nodesByPath = new Map();
    const treeLines = ['Головне меню'];
    const scenarios = [`1. Головне меню — [${getIvrContextName(companyId, '')}]`];
    const configBlocks = [];
    let scenarioIndex = 2;

    if (!rootChildren.length) {
      errors.push('Головне меню порожнє: додайте хоча б один пункт.');
    }

    const walkTree = (parentId, prefix = '', depth = 0) => {
      const children = getIvrChildren(nodes, parentId);
      children.forEach((node, index) => {
        const path = getIvrNodePath(nodes, node);
        const kind = getIvrNodeKind(nodes, node);
        const childItems = getIvrChildren(nodes, node.id);
        const isLast = index === children.length - 1;
        const branch = depth === 0 ? (isLast ? '└─ ' : '├─ ') : prefix + (isLast ? '└─ ' : '├─ ');
        treeLines.push(`${branch}${node.key} ${node.label || 'Без назви'}`);

        if (!/^(?:[0-9]|t)$/.test(node.key)) errors.push(`Пункт ${path}: кнопка має бути 0-9 або t.`);
        if (!node.label) errors.push(`Пункт ${path}: не вказано назву.`);
        if (kind === 'final' && !node.label) errors.push(`Пункт ${path}: не завершений.`);

        nodesByPath.set(path, {
          path,
          button: node.key,
          label: node.label,
          type: kind,
          routeId: kind === 'submenu' ? getIvrRoutePlaceholder(path) : getIvrAutoPlaceholder(path, node.label),
          children: childItems.map(child => getIvrNodePath(nodes, child)),
        });

        if (kind === 'submenu') {
          scenarios.push(`${scenarioIndex}. IVR ${path} ${node.label || 'Без назви'} — [${getIvrContextName(companyId, path)}]`);
        } else {
          scenarios.push(`${scenarioIndex}. Кінцевий сценарій ${path} ${node.label || 'Без назви'} — placeholder ${getIvrAutoPlaceholder(path, node.label)}`);
        }
        scenarioIndex += 1;

        walkTree(node.id, prefix + (isLast ? '   ' : '│  '), depth + 1);
      });
    };

    walkTree('root');

    const duplicateKeys = new Map();
    nodes.forEach(node => {
      const key = `${node.parentId}:${node.key}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    });
    duplicateKeys.forEach((count, key) => {
      if (count > 1) errors.push(`Дубль кнопки на одному рівні: ${key.split(':')[1]}.`);
    });

    const buildConfig = (contextPath, children) => {
      const contextName = getIvrContextName(companyId, contextPath);
      const lines = [
        `[${contextName}]`,
        'exten => s,1,Answer(500)',
        'exten => s,n,BackGround(${ARG1})',
        `exten => s,n,WaitExten(${waitSeconds || 5})`,
        '',
      ];

      children.forEach(childPath => {
        const child = nodesByPath.get(childPath);
        if (!child) return;
        if (child.button === 't') return;
        lines.push(`; ${child.button} — ${child.label || child.path}`);
        lines.push(`exten => ${child.button},1,Set(ivrRouteID=${child.routeId})`);
        lines.push(`exten => ${child.button},n,Return`);
        lines.push('');
      });

      const defaultNode = nodesByPath.get('t');
      lines.push('; t — сценарій за замовчуванням');
      lines.push(`exten => t,1,Set(ivrRouteID=${defaultNode?.routeId || getIvrAutoPlaceholder('t', 'За замовчуванням')})`);
      lines.push('exten => t,n,Return');
      lines.push('exten => i,1,Goto(t,1)');
      lines.push('exten => h,1,Goto(vOfficeIvrAddHangupedCall,s,1)');
      return lines.join('\n');
    };

    configBlocks.push(buildConfig('', rootChildren.map(node => getIvrNodePath(nodes, node))));
    rows.forEach(node => {
      const path = getIvrNodePath(nodes, node);
      const kind = getIvrNodeKind(nodes, node);
      if (kind !== 'submenu') return;
      const children = getIvrChildren(nodes, node.id).map(child => getIvrNodePath(nodes, child));
      if (children.length) configBlocks.push(buildConfig(path, children));
    });

    return {
      ok: errors.length === 0,
      errors,
      tree: treeLines.join('\n'),
      scenarios: scenarios.join('\n'),
      config: configBlocks.join('\n\n; --------------------------------------------------\n\n'),
    };
  }

  function renderIvrTreeHtml(nodes) {
    const rows = buildIvrTableRows(nodes);
    if (!rows.length) {
      return '<div class="bth-empty-tree">Головне меню порожнє. Натисніть “+ пункт головного меню”.</div>';
    }

    return `
      <table class="bth-ivr-table">
        <thead>
          <tr>
            <th>Шлях</th>
            <th>Кнопка</th>
            <th>Назва пункту</th>
            <th>Тип</th>
            <th>Дія</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(node => {
            const path = getIvrNodePath(nodes, node);
            const kind = getIvrNodeKind(nodes, node);
            const hasChildren = getIvrChildren(nodes, node.id).length > 0;
            return `
              <tr data-node-id="${escapeHtml(node.id)}">
                <td class="bth-ivr-path">${escapeHtml(path)}</td>
                <td>
                  <select data-ivr-row-field="key" data-node-id="${escapeHtml(node.id)}">
                    ${['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 't'].map(key => `<option value="${key}" ${node.key === key ? 'selected' : ''}>${key}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <input data-ivr-row-field="label" data-node-id="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" placeholder="Назва пункту">
                </td>
                <td>
                  <select data-ivr-row-field="type" data-node-id="${escapeHtml(node.id)}" ${hasChildren ? 'disabled' : ''}>
                    <option value="submenu" ${kind === 'submenu' ? 'selected' : ''}>Підменю</option>
                    <option value="final" ${kind === 'final' ? 'selected' : ''}>Кінцевий</option>
                  </select>
                </td>
                <td class="bth-ivr-actions-cell">
                  <button type="button" data-ivr-action="add-child" data-node-id="${escapeHtml(node.id)}">+ підпункт</button>
                  <button type="button" data-ivr-action="delete" data-node-id="${escapeHtml(node.id)}">Видалити</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function refreshIvrVisualBuilder() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const nodes = getIvrNodesFromDraft();
    const treeBox = $('.bth-ivr-visual-tree', modal);
    if (treeBox) treeBox.innerHTML = renderIvrTreeHtml(nodes);
    setIvrBuilderOutputs(buildIvrVisualResult(loadDraft()));
  }

  function addIvrNode(parentId = 'root') {
    const nodes = getIvrNodesFromDraft();
    const key = getNextIvrKey(nodes, parentId);
    nodes.push(normalizeIvrNode({
      id: `ivr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      parentId,
      key,
      label: '',
      type: 'final',
      routeId: '',
    }));
    saveIvrNodes(nodes);
    refreshIvrVisualBuilder();
  }

  function updateIvrNodeField(nodeId, field, value, shouldRefresh = true) {
    const nodes = getIvrNodesFromDraft();
    const node = nodes.find(item => item.id === nodeId);
    if (!node) return;
    if (field === 'key') node.key = clean(value).toLowerCase();
    if (field === 'label') node.label = clean(value);
    if (field === 'type') node.type = clean(value) === 'submenu' ? 'submenu' : 'final';
    saveIvrNodes(nodes);
    if (shouldRefresh) refreshIvrVisualBuilder();
  }

  // IVR Builder 1.0. Цей блок навмисно перевизначає старий IVR-модуль вище:
  // дерево без ручних шляхів, автоматичні сценарії, імпорт існуючих IVR-конфігів.
  const IVR_NODE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
  const IVR_IMPORT_KEYS = [...IVR_NODE_KEYS, 't'];
  const IVR_FALLBACK_KEY = 't';
  const IVR_UNSUPPORTED_RE = /\b(ExecIfTime|GotoIf|CALLERID|AGI|Gosub|repeat)\b/i;

  function renderIvrBuilderStyles() {
    if ($('#binotel-tz-ivr-builder-styles')) return;

    const style = document.createElement('style');
    style.id = 'binotel-tz-ivr-builder-styles';
    style.textContent = `
      #${CONFIG.modalId}[data-mode="ivr"] {
        inset: 2vh 2vw;
      }
      #${CONFIG.modalId}[data-mode="ivr"] .bth-content {
        grid-template-columns: 1fr;
      }
      #${CONFIG.modalId} .bth-ivr-builder-grid {
        display: grid;
        grid-template-columns: minmax(560px, 1fr) minmax(460px, .9fr);
        gap: 14px;
        align-items: stretch;
      }
      #${CONFIG.modalId} .bth-ivr-pane {
        border: 1px solid #dbe3ef;
        border-radius: 12px;
        background: #f8fafc;
        padding: 12px;
        min-height: 520px;
      }
      #${CONFIG.modalId} .bth-ivr-pane h4 {
        margin: 0 0 10px;
        font-size: 17px;
      }
      #${CONFIG.modalId} .bth-ivr-visual-tree {
        min-height: 470px;
        max-height: 68vh;
        overflow: auto;
        border: 0;
        padding: 0;
        background: transparent;
      }
      #${CONFIG.modalId} .bth-ivr-tree-list {
        list-style: none;
        margin: 8px 0 0 24px;
        padding: 0;
      }
      #${CONFIG.modalId} .bth-ivr-tree-list.root {
        margin-left: 0;
      }
      #${CONFIG.modalId} .bth-ivr-node-row {
        display: grid;
        grid-template-columns: 72px minmax(180px, 1fr) 132px auto;
        gap: 7px;
        align-items: center;
        margin: 7px 0;
        padding: 8px;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        background: #fff;
      }
      #${CONFIG.modalId} .bth-ivr-node.invalid > .bth-ivr-node-row {
        border-color: #fb7185;
        background: #fff1f2;
      }
      #${CONFIG.modalId} .bth-ivr-node-row select,
      #${CONFIG.modalId} .bth-ivr-node-row input {
        min-height: 34px;
        padding: 5px 8px;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions {
        display: flex;
        gap: 5px;
        justify-content: flex-end;
        white-space: nowrap;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions button,
      #${CONFIG.modalId} .bth-mini-actions button {
        border: 0;
        border-radius: 8px;
        padding: 7px 9px;
        font-weight: 800;
        cursor: pointer;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions button {
        background: #e2e8f0;
        color: #0f172a;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions button[data-ivr-action="add-child"] {
        background: #dbeafe;
        color: #1d4ed8;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions button[data-ivr-action="repeat"] {
        background: #ede9fe;
        color: #5b21b6;
      }
      #${CONFIG.modalId} .bth-ivr-node-actions button[data-ivr-action="delete"] {
        background: #fee2e2;
        color: #991b1b;
      }
      #${CONFIG.modalId} .bth-ivr-route-badge {
        grid-column: 1 / -1;
        color: #64748b;
        font-size: 12px;
      }
      #${CONFIG.modalId} .bth-ivr-route-badge.done {
        color: #047857;
        font-weight: 800;
      }
      #${CONFIG.modalId} .bth-ivr-preview {
        min-height: 470px;
        max-height: 68vh;
        overflow: auto;
        white-space: pre;
        font: 15px/1.45 Consolas, "Courier New", monospace;
        background: #0f172a;
        color: #e5e7eb;
        border-radius: 10px;
        padding: 14px;
      }
      #${CONFIG.modalId} .bth-ivr-import {
        min-height: 210px;
        font-family: Consolas, "Courier New", monospace;
      }
      #${CONFIG.modalId} .bth-ivr-repeat-editor {
        margin: 12px 0;
        padding: 12px;
        border: 1px solid #c4b5fd;
        border-radius: 12px;
        background: #f5f3ff;
      }
      #${CONFIG.modalId} .bth-ivr-repeat-editor[hidden] {
        display: none;
      }
      #${CONFIG.modalId} .bth-ivr-repeat-editor h4 {
        margin: 0 0 8px;
        font-size: 17px;
      }
      #${CONFIG.modalId} .bth-ivr-output[data-ivr-output="config"] {
        min-height: 380px;
        font-family: Consolas, "Courier New", monospace;
      }
      #${CONFIG.modalId} .bth-ivr-output[data-ivr-output="scenarios"],
      #${CONFIG.modalId} .bth-ivr-output[data-ivr-output="tree"] {
        min-height: 180px;
        font-family: Consolas, "Courier New", monospace;
      }
      #${CONFIG.modalId} .bth-ivr-errors[data-type="warn"] {
        background: #fef3c7;
        color: #92400e;
      }
    `;
    document.head.appendChild(style);
  }

  function loadIvrCreatedRoutes() {
    try {
      const draft = loadDraft();
      const parsed = JSON.parse(draft.ivrCreatedRoutesJson || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveIvrCreatedRoutes(routes) {
    saveDraft({ ivrCreatedRoutesJson: JSON.stringify(routes || {}) });
  }

  function normalizeIvrNode(node) {
    const key = clean(node && node.key).toLowerCase() || '1';
    return {
      id: clean(node && node.id) || `ivr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      parentId: clean(node && node.parentId) || 'root',
      key,
      label: clean(node && node.label),
      type: clean(node && node.type) === 'submenu' ? 'submenu' : 'final',
      routeId: clean(node && node.routeId),
      routeName: clean(node && node.routeName),
      routeEditUrl: clean(node && node.routeEditUrl),
    };
  }

  function normalizeIvrFallback(fallback) {
    return {
      label: clean(fallback && fallback.label) || 'За замовчуванням',
      routeId: clean(fallback && fallback.routeId),
      routeName: clean(fallback && fallback.routeName),
      routeEditUrl: clean(fallback && fallback.routeEditUrl),
    };
  }

  function isIvrFallbackKey(key) {
    return clean(key).toLowerCase() === IVR_FALLBACK_KEY;
  }

  function getLegacyFallbacksFromNodes(rawNodes) {
    const map = {};
    (rawNodes || []).map(normalizeIvrNode).forEach(node => {
      if (!isIvrFallbackKey(node.key)) return;
      map[node.parentId || 'root'] = normalizeIvrFallback({
        label: node.label,
        routeId: node.routeId,
        routeName: node.routeName,
        routeEditUrl: node.routeEditUrl,
      });
    });
    return map;
  }

  function removeIvrFallbackNodes(nodes) {
    const normalized = (nodes || []).map(normalizeIvrNode);
    const blockedIds = new Set(normalized.filter(node => isIvrFallbackKey(node.key)).map(node => node.id));
    let changed = true;
    while (changed) {
      changed = false;
      normalized.forEach(node => {
        if (blockedIds.has(node.parentId) && !blockedIds.has(node.id)) {
          blockedIds.add(node.id);
          changed = true;
        }
      });
    }
    return normalized.filter(node => !blockedIds.has(node.id));
  }

  function loadIvrFallbacks(draft = loadDraft()) {
    let parsed = {};
    try {
      const raw = JSON.parse(draft.ivrFallbacksJson || '{}');
      parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (error) {
      parsed = {};
    }

    let legacy = {};
    try {
      const rawNodes = JSON.parse(draft.ivrNodesJson || '[]');
      legacy = Array.isArray(rawNodes) ? getLegacyFallbacksFromNodes(rawNodes) : {};
    } catch (error) {
      legacy = {};
    }

    const merged = { ...legacy, ...parsed };
    Object.keys(merged).forEach(key => {
      merged[key] = normalizeIvrFallback(merged[key]);
    });
    return merged;
  }

  function saveIvrFallbacks(fallbacks) {
    const normalized = {};
    Object.entries(fallbacks || {}).forEach(([menuId, fallback]) => {
      normalized[menuId || 'root'] = normalizeIvrFallback(fallback);
    });
    saveDraft({ ivrFallbacksJson: JSON.stringify(normalized) });
    return normalized;
  }

  function getIvrFallback(menuId = 'root', draft = loadDraft()) {
    const fallbacks = loadIvrFallbacks(draft);
    return normalizeIvrFallback(fallbacks[menuId] || {});
  }

  function getDefaultIvrNodes() {
    return [
      { id: 'ivr-1', parentId: 'root', key: '1', label: 'Продажі', type: 'submenu' },
      { id: 'ivr-1-1', parentId: 'ivr-1', key: '1', label: 'Новий клієнт', type: 'final' },
      { id: 'ivr-1-2', parentId: 'ivr-1', key: '2', label: 'Діючий клієнт', type: 'final' },
      { id: 'ivr-2', parentId: 'root', key: '2', label: 'Підтримка', type: 'submenu' },
      { id: 'ivr-2-1', parentId: 'ivr-2', key: '1', label: 'Технічне питання', type: 'final' },
      { id: 'ivr-2-2', parentId: 'ivr-2', key: '2', label: 'Фінансове питання', type: 'final' },
      { id: 'ivr-3', parentId: 'root', key: '3', label: 'Бухгалтерія', type: 'final' },
    ].map(normalizeIvrNode);
  }

  function getIvrNodesFromDraft(draft = loadDraft()) {
    try {
      const parsed = JSON.parse(draft.ivrNodesJson || '[]');
      if (!Array.isArray(parsed)) return [];
      return removeIvrFallbackNodes(parsed).filter(node => node.id && node.parentId);
    } catch (error) {
      return [];
    }
  }

  function saveIvrNodes(nodes) {
    const cleanNodes = removeIvrFallbackNodes(nodes || []);
    saveDraft({ ivrNodesJson: JSON.stringify(cleanNodes) });
    return cleanNodes;
  }

  function getIvrSortWeight(key) {
    if (key === '0') return 10;
    if (key === '*') return 11;
    if (key === '#') return 12;
    const number = Number(key);
    return Number.isFinite(number) ? number : 99;
  }

  function getIvrChildren(nodes, parentId) {
    return nodes
      .filter(node => node.parentId === parentId)
      .sort((a, b) => {
        const diff = getIvrSortWeight(a.key) - getIvrSortWeight(b.key);
        if (diff) return diff;
        return String(a.label || a.id).localeCompare(String(b.label || b.id), 'uk', { numeric: true });
      });
  }

  function getIvrPath(nodes, node) {
    const parts = [];
    let current = node;
    let guard = 0;
    while (current && guard < 30) {
      parts.unshift(current.key);
      if (current.parentId === 'root') break;
      current = nodes.find(item => item.id === current.parentId);
      guard += 1;
    }
    return parts.join('-');
  }

  function getIvrNodeKind(nodes, node) {
    return getIvrChildren(nodes, node.id).length || node.type === 'submenu' ? 'submenu' : 'final';
  }

  function buildIvrTableRows(nodes) {
    const rows = [];
    const walk = parentId => {
      getIvrChildren(nodes, parentId).forEach(node => {
        rows.push(node);
        walk(node.id);
      });
    };
    walk('root');
    return rows;
  }

  function getNextIvrKey(nodes, parentId) {
    const used = new Set(getIvrChildren(nodes, parentId).map(node => node.key));
    for (const key of IVR_NODE_KEYS) {
      if (!used.has(key)) return key;
    }
    return '1';
  }

  function makeIvrScenarioPrefix(draft = loadDraft()) {
    return clean(draft.ivrScenarioPrefix || draft.ivrConfigName) || 'IVR TEST';
  }

  function shouldUseIvrScenarioPrefixNumbering(draft = loadDraft()) {
    return draft.ivrUseScenarioPrefixNumbering !== false;
  }

  function makeIvrScenarioName(draft, path, label = '') {
    const cleanPath = clean(path);
    const cleanLabel = clean(label);
    if (!shouldUseIvrScenarioPrefixNumbering(draft)) {
      if (!cleanPath) return cleanLabel || clean(draft.ivrConfigName) || 'Головне меню';
      return cleanLabel || `Сценарій ${cleanPath}`;
    }

    const prefix = makeIvrScenarioPrefix(draft);
    if (!cleanPath) return `${prefix} — Головне меню`;
    return `${prefix} — ${cleanPath}${cleanLabel ? ` ${cleanLabel}` : ''}`;
  }

  function makeIvrFallbackScenarioName(draft, menuPath = '', fallback = {}) {
    const label = clean(fallback.label) || 'За замовчуванням';
    if (!shouldUseIvrScenarioPrefixNumbering(draft)) return label;

    const prefix = makeIvrScenarioPrefix(draft);
    return clean(menuPath)
      ? `${prefix} — ${menuPath} ${label}`
      : `${prefix} — t ${label}`;
  }

  function getIvrMenuPath(nodes, menuId) {
    if (!menuId || menuId === 'root') return '';
    const node = nodes.find(item => item.id === menuId);
    return node ? getIvrPath(nodes, node) : '';
  }

  function getIvrScenarioItems(draft = loadDraft()) {
    const nodes = getIvrNodesFromDraft(draft);
    const fallbacks = loadIvrFallbacks(draft);
    const items = [{
      storageKey: 'root',
      nodeId: 'root',
      path: '',
      template: 'Голосовое меню',
      name: makeIvrScenarioName(draft, ''),
      routeId: clean(draft.ivrRootRouteId),
      routeName: clean(draft.ivrRootRouteName),
      routeEditUrl: clean(draft.ivrRootRouteEditUrl),
    }];

    buildIvrTableRows(nodes).forEach(node => {
      const path = getIvrPath(nodes, node);
      items.push({
        storageKey: node.id,
        nodeId: node.id,
        path,
        template: 'Сценарий в IVR #',
        name: makeIvrScenarioName(draft, path, node.label),
        routeId: clean(node.routeId),
        routeName: clean(node.routeName),
        routeEditUrl: clean(node.routeEditUrl),
        node,
      });
    });

    const fallbackMenuIds = new Set(['root']);
    Object.keys(fallbacks).forEach(menuId => {
      if (menuId === 'root' || nodes.some(node => node.id === menuId)) fallbackMenuIds.add(menuId);
    });

    fallbackMenuIds.forEach(menuId => {
      const menuPath = getIvrMenuPath(nodes, menuId);
      const fallback = getIvrFallback(menuId, draft);
      items.push({
        storageKey: `fallback:${menuId}`,
        nodeId: menuId,
        menuId,
        path: menuPath ? `${menuPath} timeout` : 'timeout',
        template: 'Сценарий в IVR #',
        name: makeIvrFallbackScenarioName(draft, menuPath, fallback),
        routeId: clean(fallback.routeId),
        routeName: clean(fallback.routeName),
        routeEditUrl: clean(fallback.routeEditUrl),
        fallback: true,
      });
    });

    return items;
  }

  function updateIvrScenarioOnDraft(item, route) {
    const routeId = clean(route.routeId);
    const routeName = clean(route.routeName || item.name);
    const routeEditUrl = clean(route.routeEditUrl);
    if (!routeId) return;

    const routes = loadIvrCreatedRoutes();
    routes[item.storageKey] = {
      routeId,
      routeName,
      routeEditUrl,
      path: item.path,
      updatedAt: new Date().toISOString(),
    };

    if (item.storageKey === 'root') {
      saveDraft({
        ivrRootRouteId: routeId,
        ivrRootRouteName: routeName,
        ivrRootRouteEditUrl: routeEditUrl,
        ivrCreatedRoutesJson: JSON.stringify(routes),
      });
      return;
    }

    if (String(item.storageKey || '').startsWith('fallback:')) {
      const menuId = clean(item.menuId || String(item.storageKey).replace(/^fallback:/, '')) || 'root';
      const fallbacks = loadIvrFallbacks();
      fallbacks[menuId] = normalizeIvrFallback({
        ...(fallbacks[menuId] || {}),
        label: (fallbacks[menuId] || {}).label || 'За замовчуванням',
        routeId,
        routeName,
        routeEditUrl,
      });
      saveIvrFallbacks(fallbacks);
      saveIvrCreatedRoutes(routes);
      return;
    }

    const nodes = getIvrNodesFromDraft();
    const node = nodes.find(current => current.id === item.nodeId);
    if (node) {
      node.routeId = routeId;
      node.routeName = routeName;
      node.routeEditUrl = routeEditUrl;
      saveIvrNodes(nodes);
    }
    saveIvrCreatedRoutes(routes);
  }

  function validateIvrTree(nodes) {
    const errors = [];
    const rows = buildIvrTableRows(nodes);

    if (!getIvrChildren(nodes, 'root').length) {
      errors.push('Головне меню порожнє: додайте хоча б один пункт.');
    }

    rows.forEach(node => {
      const path = getIvrPath(nodes, node);
      if (path.split('-').includes(IVR_FALLBACK_KEY)) errors.push(`Пункт ${path}: t не може бути рівнем дерева. Це fallback меню.`);
      if (!IVR_NODE_KEYS.includes(node.key)) errors.push(`Пункт ${path}: кнопка має бути 0-9, * або #.`);
      if (!node.label) errors.push(`Пункт ${path}: не вказано назву.`);
    });

    const groups = new Map();
    rows.forEach(node => {
      const key = `${node.parentId}:${node.key}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    groups.forEach((count, key) => {
      if (count > 1) errors.push(`Дубль кнопки "${key.split(':')[1]}" на одному рівні дерева.`);
    });

    return errors;
  }

  function buildIvrPreviewTree(nodes = getIvrNodesFromDraft(), draft = loadDraft()) {
    const rootRepeat = getIvrRepeatSetting('root', draft);
    const lines = [`Головне меню${rootRepeat.enabled ? ` ↻${rootRepeat.count}` : ''}`];
    const walk = (parentId, prefix = '') => {
      const children = getIvrChildren(nodes, parentId);
      children.forEach((node, index) => {
        const isLast = index === children.length - 1;
        const connector = isLast ? '└─ ' : '├─ ';
        const repeat = getIvrNodeKind(nodes, node) === 'submenu'
          ? getIvrRepeatSetting(node.id, draft)
          : { enabled: false };
        lines.push(`${prefix}${connector}${node.key} ${node.label || 'Без назви'}${repeat.enabled ? ` ↻${repeat.count}` : ''}`);
        walk(node.id, `${prefix}${isLast ? '   ' : '│  '}`);
      });
    };
    walk('root');
    return lines.join('\n');
  }

  function makeIvrPlaceholder(path, label) {
    const safePath = String(path || 'root')
      .toUpperCase()
      .replace(/\*/g, 'STAR')
      .replace(/#/g, 'HASH')
      .replace(/-/g, '_')
      .replace(/[^0-9A-ZА-ЯІЇЄҐ_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const safeLabel = String(label || '')
      .toUpperCase()
      .replace(/\*/g, 'STAR')
      .replace(/#/g, 'HASH')
      .replace(/[^0-9A-ZА-ЯІЇЄҐ]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `__ROUTE_ID_${safePath}${safeLabel ? '_' + safeLabel : ''}__`;
  }

  function getIvrRouteValue(nodes, node, allowPlaceholders, errors) {
    const path = getIvrPath(nodes, node);
    if (node.routeId) return node.routeId;
    if (allowPlaceholders) return makeIvrPlaceholder(path, node.label);
    errors.push(`Для пункту ${path} ${node.label || ''} ще немає ID сценарію.`);
    return '';
  }

  function getIvrFallbackRouteValue(nodes, menuId, contextPath, draft, allowPlaceholders, errors) {
    const fallbacks = loadIvrFallbacks(draft);
    const menuFallback = fallbacks[menuId];
    const rootFallback = fallbacks.root;
    const fallback = normalizeIvrFallback(menuFallback || rootFallback || {});
    const routes = loadIvrCreatedRoutes();
    const routeId = fallback.routeId ||
      routes[`fallback:${menuId}`]?.routeId ||
      routes['fallback:root']?.routeId ||
      '';

    if (routeId) return routeId;

    const label = fallback.label || 'За замовчуванням';
    if (allowPlaceholders) {
      return makeIvrPlaceholder(contextPath ? `${contextPath}_TIMEOUT` : 't', label);
    }

    const menuName = contextPath ? `меню ${contextPath}` : 'головного меню';
    errors.push(`Для timeout/fallback ${menuName} ще немає ID сценарію.`);
    return '';
  }

  function normalizeIvrRepeatCount(value) {
    const number = parseInt(clean(value), 10);
    if (!Number.isFinite(number) || number < 1) return 3;
    return Math.min(number, 9);
  }

  function loadIvrRepeatSettings(draft = loadDraft()) {
    try {
      const settings = JSON.parse(draft.ivrRepeatSettingsJson || '{}');
      return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    } catch (error) {
      return {};
    }
  }

  function saveIvrRepeatSettings(settings) {
    saveDraft({ ivrRepeatSettingsJson: JSON.stringify(settings || {}) });
  }

  function getIvrRepeatSetting(menuId = 'root', draft = loadDraft()) {
    const settings = loadIvrRepeatSettings(draft);
    const raw = settings[menuId] || {};
    return {
      enabled: Boolean(raw.enabled),
      count: normalizeIvrRepeatCount(raw.count),
    };
  }

  function setIvrRepeatSetting(menuId, patch) {
    const settings = loadIvrRepeatSettings();
    const current = getIvrRepeatSetting(menuId);
    settings[menuId] = {
      ...current,
      ...patch,
      count: normalizeIvrRepeatCount(patch && Object.prototype.hasOwnProperty.call(patch, 'count') ? patch.count : current.count),
    };
    saveIvrRepeatSettings(settings);
  }

  function deleteIvrRepeatSettings(menuIds) {
    const ids = new Set(Array.isArray(menuIds) ? menuIds : [menuIds]);
    const settings = loadIvrRepeatSettings();
    let changed = false;
    ids.forEach(id => {
      if (Object.prototype.hasOwnProperty.call(settings, id)) {
        delete settings[id];
        changed = true;
      }
    });
    if (changed) saveIvrRepeatSettings(settings);
  }

  function getIvrMenuRepeatLabel(menuId, nodes = getIvrNodesFromDraft()) {
    if (menuId === 'root') return 'Головне меню';
    const node = nodes.find(item => item.id === menuId);
    if (!node) return 'Меню';
    const path = getIvrPath(nodes, node);
    return `${path} ${node.label || 'Без назви'}`.trim();
  }

  function buildIvrConfig(draft = loadDraft(), allowPlaceholders = true) {
    const nodes = getIvrNodesFromDraft(draft);
    const companyId = clean(draft.companyId || getCompanyIdFromUrl()) || 'COMPANY_ID';
    const waitSeconds = clean(draft.ivrWaitSeconds) || '5';
    const errors = [];
    const blocks = [];

    const buildBlock = (contextPath, parentId) => {
      const contextName = contextPath ? `ivr-${companyId}-${contextPath}` : `ivr-${companyId}`;
      const children = getIvrChildren(nodes, parentId);
      const repeat = getIvrRepeatSetting(parentId, draft);
      const lines = [
        `[${contextName}]`,
        'exten => s,1,Answer(500)',
      ];

      if (repeat.enabled) {
        lines.push('exten => s,n,Set(repeat=0)');
        lines.push('exten => s,n,BackGround(${ARG1},m)');
      } else {
        lines.push('exten => s,n,BackGround(${ARG1})');
      }

      lines.push(`exten => s,n,WaitExten(${waitSeconds})`);

      children.forEach(node => {
        const routeValue = getIvrRouteValue(nodes, node, allowPlaceholders, errors);
        lines.push(`exten => ${node.key},1,Set(ivrRouteID=${routeValue})`);
        lines.push(`exten => ${node.key},n,Return`);
      });

      const tRoute = getIvrFallbackRouteValue(nodes, parentId, contextPath, draft, allowPlaceholders, errors);

      if (!tRoute && !allowPlaceholders) {
        errors.push('Не знайдено t-сценарій за замовчуванням.');
      }

      if (repeat.enabled) {
        lines.push('exten => t,1,Set(repeat=${MATH(${repeat}+1)})');
        lines.push(`exten => t,n,GotoIf($["\${repeat}" != "${repeat.count}.000000"]?s,3)`);
        lines.push(`exten => t,n,Set(ivrRouteID=${tRoute})`);
      } else {
        lines.push(`exten => t,1,Set(ivrRouteID=${tRoute})`);
      }
      lines.push('exten => t,n,Return');
      lines.push('exten => i,1,Goto(t,1)');
      lines.push('exten => h,1,Goto(vOfficeIvrAddHangupedCall,s,1)');
      blocks.push(lines.join('\n'));
    };

    buildBlock('', 'root');
    buildIvrTableRows(nodes).forEach(node => {
      if (getIvrNodeKind(nodes, node) !== 'submenu') return;
      const children = getIvrChildren(nodes, node.id);
      if (!children.length) return;
      buildBlock(getIvrPath(nodes, node), node.id);
    });

    return {
      errors,
      config: blocks.join('\n\n'),
    };
  }

  function buildIvrScenarioList(draft = loadDraft()) {
    const items = getIvrScenarioItems(draft);
    const activeKeys = new Set(items.map(item => item.storageKey));
    const routes = loadIvrCreatedRoutes();
    const lines = items.map((item, index) => {
      const routeId = item.routeId || routes[item.storageKey]?.routeId || 'буде створено';
      const prefix = item.storageKey === 'root'
        ? 'Голосове меню'
        : (item.fallback ? `Fallback t${item.path && item.path !== 'timeout' ? ` (${item.path})` : ''}` : `Сценарій ${item.path}`);
      return `${index + 1}. ${prefix}: ${item.name} — ${routeId}`;
    });

    Object.entries(routes).forEach(([key, route]) => {
      if (activeKeys.has(key)) return;
      lines.push(`Не використовується: ${route.routeName || key} — ${route.routeId}`);
    });

    return lines.join('\n');
  }

  function buildIvrVisualResult(draft = loadDraft(), finalConfig = false) {
    const nodes = getIvrNodesFromDraft(draft);
    const errors = validateIvrTree(nodes);
    const configResult = buildIvrConfig(draft, !finalConfig);
    const allErrors = [...errors, ...configResult.errors];

    return {
      ok: allErrors.length === 0,
      errors: allErrors,
      tree: buildIvrPreviewTree(nodes, draft),
      scenarios: buildIvrScenarioList(draft),
      config: configResult.config,
    };
  }

  function makeErrorSummary(errors, limit = 4) {
    const list = (errors || []).filter(Boolean);
    if (!list.length) return '';
    const shown = list
      .slice(0, limit)
      .map((error, index) => `${index + 1}. ${error}`)
      .join('\n');
    const hidden = list.length > limit ? `\n... ще ${list.length - limit}` : '';
    return `${shown}${hidden}`;
  }

  function setIvrBuilderOutputs(result) {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;

    const errorsField = $('[data-ivr-output="errors"]', modal);
    const treeField = $('[data-ivr-output="tree"]', modal);
    const previewField = $('[data-ivr-preview]', modal);
    const scenariosField = $('[data-ivr-output="scenarios"]', modal);
    const configField = $('[data-ivr-output="config"]', modal);

    if (errorsField) {
      errorsField.textContent = result.errors.length ? result.errors.join('\n') : 'Помилок не знайдено.';
      errorsField.dataset.type = result.errors.length ? 'error' : 'success';
    }
    if (treeField) treeField.value = result.tree || '';
    if (previewField) previewField.textContent = result.tree || 'Головне меню';
    if (scenariosField) scenariosField.value = result.scenarios || '';
    if (configField) configField.value = result.config || '';
  }

  function renderIvrTreeHtml(nodes = getIvrNodesFromDraft(), parentId = 'root', depth = 0) {
    const children = getIvrChildren(nodes, parentId);
    if (!children.length && depth === 0) {
      return '<div class="bth-empty-tree">Головне меню порожнє. Натисніть “+ Головний пункт”.</div>';
    }

    return `
      <ul class="bth-ivr-tree-list ${depth ? '' : 'root'}">
        ${children.map(node => {
          const kind = getIvrNodeKind(nodes, node);
          const path = getIvrPath(nodes, node);
          const invalid = !node.label ? ' invalid' : '';
          const routeText = node.routeId ? `ID сценарію: ${escapeHtml(node.routeId)}` : 'ID буде створено автоматично';
          const routeClass = node.routeId ? 'done' : '';
          const repeat = kind === 'submenu' ? getIvrRepeatSetting(node.id) : { enabled: false };
          const repeatBadge = repeat.enabled ? ` ↻${repeat.count}` : '';

          return `
            <li class="bth-ivr-node${invalid}" data-node-id="${escapeHtml(node.id)}">
              <div class="bth-ivr-node-row">
                <select data-ivr-row-field="key" data-node-id="${escapeHtml(node.id)}" title="Кнопка">
                  ${IVR_NODE_KEYS.map(key => `<option value="${key}" ${node.key === key ? 'selected' : ''}>${key}</option>`).join('')}
                </select>
                <input data-ivr-row-field="label" data-node-id="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" placeholder="Назва пункту">
                <select data-ivr-row-field="type" data-node-id="${escapeHtml(node.id)}" ${getIvrChildren(nodes, node.id).length ? 'disabled' : ''}>
                  <option value="submenu" ${kind === 'submenu' ? 'selected' : ''}>Підменю</option>
                  <option value="final" ${kind === 'final' ? 'selected' : ''}>Кінцевий</option>
                </select>
                <div class="bth-ivr-node-actions">
                  <button type="button" data-ivr-action="add-child" data-node-id="${escapeHtml(node.id)}">+ підпункт</button>
                  ${kind === 'submenu' ? `<button type="button" data-ivr-action="repeat" data-node-id="${escapeHtml(node.id)}" title="Повтори цього меню">⚙${repeatBadge}</button>` : ''}
                  <button type="button" data-ivr-action="focus" data-node-id="${escapeHtml(node.id)}">✎</button>
                  <button type="button" data-ivr-action="delete" data-node-id="${escapeHtml(node.id)}">🗑</button>
                </div>
                <div class="bth-ivr-route-badge ${routeClass}">${escapeHtml(routeText)} · шлях: ${escapeHtml(path)}</div>
              </div>
              ${renderIvrTreeHtml(nodes, node.id, depth + 1)}
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  function refreshIvrVisualBuilder(finalConfig = false) {
    renderIvrBuilderStyles();
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const nodes = getIvrNodesFromDraft();
    const treeBox = $('.bth-ivr-visual-tree', modal);
    if (treeBox) treeBox.innerHTML = renderIvrTreeHtml(nodes);
    setIvrBuilderOutputs(buildIvrVisualResult(loadDraft(), finalConfig));
  }

  function openIvrRepeatEditor(menuId = 'root') {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const editor = $('.bth-ivr-repeat-editor', modal);
    if (!editor) return;

    const nodes = getIvrNodesFromDraft();
    const setting = getIvrRepeatSetting(menuId);
    const idField = $('[data-ivr-repeat-menu-id]', editor);
    const title = $('[data-ivr-repeat-title]', editor);
    const enabled = $('[data-ivr-repeat-enabled]', editor);
    const count = $('[data-ivr-repeat-count]', editor);

    if (idField) idField.value = menuId;
    if (title) title.textContent = `Повтори: ${getIvrMenuRepeatLabel(menuId, nodes)}`;
    if (enabled) enabled.checked = setting.enabled;
    if (count) count.value = String(setting.count || 3);

    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeIvrRepeatEditor() {
    const modal = $(`#${CONFIG.modalId}`);
    const editor = modal && $('.bth-ivr-repeat-editor', modal);
    if (editor) editor.hidden = true;
  }

  function saveIvrRepeatEditor() {
    const modal = $(`#${CONFIG.modalId}`);
    const editor = modal && $('.bth-ivr-repeat-editor', modal);
    if (!editor) return;

    const menuId = clean(($('[data-ivr-repeat-menu-id]', editor) || {}).value) || 'root';
    const enabled = Boolean(($('[data-ivr-repeat-enabled]', editor) || {}).checked);
    const count = normalizeIvrRepeatCount(($('[data-ivr-repeat-count]', editor) || {}).value);
    setIvrRepeatSetting(menuId, { enabled, count });
    refreshIvrVisualBuilder();
    log(`IVR Builder: повтори для "${getIvrMenuRepeatLabel(menuId)}" ${enabled ? `увімкнено (${count})` : 'вимкнено'}.`, enabled ? 'success' : 'warn');
  }

  function addIvrNode(parentId = 'root') {
    const nodes = getIvrNodesFromDraft();
    const parent = nodes.find(node => node.id === parentId);
    if (parent) parent.type = 'submenu';
    nodes.push(normalizeIvrNode({
      id: `ivr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      parentId,
      key: getNextIvrKey(nodes, parentId),
      label: 'Новий пункт',
      type: 'final',
    }));
    saveIvrNodes(nodes);
    refreshIvrVisualBuilder();
  }

  function updateIvrNodeField(nodeId, field, value, shouldRefresh = true) {
    const nodes = getIvrNodesFromDraft();
    const node = nodes.find(item => item.id === nodeId);
    if (!node) return;
    if (field === 'key') node.key = clean(value).toLowerCase();
    if (field === 'label') node.label = clean(value);
    if (field === 'type') node.type = clean(value) === 'submenu' ? 'submenu' : 'final';
    saveIvrNodes(nodes);
    if (shouldRefresh) refreshIvrVisualBuilder();
  }

  function deleteIvrNode(nodeId) {
    const nodes = getIvrNodesFromDraft();
    const idsToDelete = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach(node => {
        if (idsToDelete.has(node.parentId) && !idsToDelete.has(node.id)) {
          idsToDelete.add(node.id);
          changed = true;
        }
      });
    }
    saveIvrNodes(nodes.filter(node => !idsToDelete.has(node.id)));
    refreshIvrVisualBuilder();
  }

  function getIvrBlockPath(blockName, companyId, strictCompany = false) {
    const name = clean(blockName);
    const cleanCompanyId = clean(companyId);

    if (cleanCompanyId) {
      const escaped = cleanCompanyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exact = name.match(new RegExp(`^ivr-${escaped}(?:-(.+))?$`, 'i'));
      if (exact) return exact[1] || '';
      if (strictCompany) return null;
    }

    const generic = name.match(/^ivr-[^-]+(?:-(.+))?$/i);
    return generic ? (generic[1] || '') : null;
  }

  function isValidIvrImportedBlockPath(path) {
    const value = clean(path);
    if (!value) return true;
    return value.split('-').every(part => IVR_NODE_KEYS.includes(part));
  }

  function parseIvrImportedConfig(configText, companyId = getCompanyId(), routeNameMap = new Map()) {
    const text = String(configText || '');
    const unsupported = IVR_UNSUPPORTED_RE.test(text);
    const blockRe = /^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/gm;
    const blocks = [];
    let match;

    while ((match = blockRe.exec(text))) {
      blocks.push({
        name: match[1],
        start: match.index + match[0].length,
        end: text.length,
      });
    }

    blocks.forEach((block, index) => {
      block.end = index + 1 < blocks.length ? blocks[index + 1].start : text.length;
      block.body = text.slice(block.start, block.end);
      block.exactPath = getIvrBlockPath(block.name, companyId, true);
    });

    const hasExactCompanyBlocks = blocks.some(block => block.exactPath !== null);
    blocks.forEach(block => {
      block.path = hasExactCompanyBlocks
        ? block.exactPath
        : getIvrBlockPath(block.name, companyId, false);
    });

    const invalidTBlocks = blocks.filter(block =>
      block.path !== null &&
      !isValidIvrImportedBlockPath(block.path)
    );
    const ivrBlocks = blocks.filter(block =>
      block.path !== null &&
      isValidIvrImportedBlockPath(block.path)
    );
    const blockPaths = new Set(ivrBlocks.map(block => block.path));
    const nodesByPath = new Map();
    const repeatSettings = {};
    const fallbackSettings = {};

    ivrBlocks.forEach(block => {
      const parentPath = block.path;
      const parentId = parentPath ? `ivr-${parentPath}` : 'root';
      const repeatCountMatch = block.body.match(/GotoIf\s*\(\s*\$\[\s*["']?\$\{repeat\}["']?\s*!=\s*["']?(\d+)\.000000["']?\s*\]\s*\?s,3\s*\)/i);
      if (/Set\s*\(\s*repeat\s*=\s*0\s*\)/i.test(block.body) || repeatCountMatch) {
        repeatSettings[parentId] = {
          enabled: true,
          count: normalizeIvrRepeatCount(repeatCountMatch ? repeatCountMatch[1] : 3),
        };
      }

      block.body.split(/\r?\n/).forEach(line => {
        const lineMatch = line.match(/^\s*exten\s*=>\s*([0-9t*#])\s*,\s*(?:1|n|\d+)\s*,\s*Set\s*\(\s*ivrRouteID\s*=\s*([^)]+?)\s*\)\s*(?:[;#].*)?$/i);
        if (!lineMatch) return;

        const key = clean(lineMatch[1]).toLowerCase();
        const routeId = clean(lineMatch[2]);
        const routeName = routeNameMap.get(routeId) || '';

        if (key === IVR_FALLBACK_KEY) {
          fallbackSettings[parentId] = normalizeIvrFallback({
            label: routeName || 'За замовчуванням',
            routeId,
            routeName,
          });
          return;
        }

        if (!IVR_NODE_KEYS.includes(key)) return;

        const path = parentPath ? `${parentPath}-${key}` : key;
        const isSubmenu = blockPaths.has(path);
        const label = routeName || `Пункт ${path}`;
        nodesByPath.set(path, normalizeIvrNode({
          id: `ivr-${path}`,
          parentId,
          key,
          label,
          type: isSubmenu ? 'submenu' : 'final',
          routeId,
          routeName,
        }));
      });
    });

    blockPaths.forEach(path => {
      if (!path || nodesByPath.has(path)) return;
      const parts = path.split('-');
      const key = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('-');
      nodesByPath.set(path, normalizeIvrNode({
        id: `ivr-${path}`,
        parentId: parentPath ? `ivr-${parentPath}` : 'root',
        key,
        label: `Пункт ${path}`,
        type: 'submenu',
        routeId: '',
        routeName: '',
      }));
    });

    return {
      nodes: Array.from(nodesByPath.values()),
      repeatSettings,
      fallbackSettings,
      unsupported,
      warnings: [
        ...(unsupported ? ['У конфігу знайдена нестандартна логіка. Дерево побудовано частково. Перевірте результат вручну.'] : []),
        ...(invalidTBlocks.length ? [`У конфігу знайдено неправильні IVR-блоки з t у назві (${invalidTBlocks.map(block => `[${block.name}]`).join(', ')}). Я їх не імпортував як дерево.`] : []),
      ],
    };
  }

  function importIvrConfigFromModal() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return;
    const field = $('[data-field="ivrImportConfig"]', modal);
    const configText = field ? field.value : '';
    const routeNames = getRouteNameMapFromCurrentPage();
    const parsed = parseIvrImportedConfig(configText, clean(loadDraft().companyId || getCompanyIdFromUrl()), routeNames.names);

    if (!parsed.nodes.length) {
      log('IVR Builder: у конфігу не знайдено стандартні IVR-блоки для цієї компанії.', 'error');
      return;
    }

    saveIvrNodes(parsed.nodes);
    saveIvrRepeatSettings(parsed.repeatSettings || {});
    saveIvrFallbacks(parsed.fallbackSettings || {});
    refreshIvrVisualBuilder();
    const routeIds = Array.from(new Set(parsed.nodes.map(node => clean(node.routeId)).filter(Boolean)));
    const foundRouteNames = routeIds.filter(routeId => routeNames.names.has(routeId)).length;
    if (routeNames.available && routeIds.length) {
      log(`IVR Builder: назви сценаріїв по routeID підтягнуто для ${foundRouteNames} із ${routeIds.length}.`, foundRouteNames ? 'success' : 'warn');
    } else if (routeIds.length) {
      log('IVR Builder: назви сценаріїв по routeID не підтягувались, бо імпорт виконано не на сторінці сценаріїв.', 'warn');
    }
    if (parsed.warnings.length) {
      log(parsed.warnings.join(' '), 'warn');
    } else {
      log('IVR Builder: конфіг розібрано, дерево побудовано.', 'success');
    }
  }

  function upgradeIvrBuilderCard(modal, draft) {
    const card = $('.bth-ivr-card', modal);
    if (!card) return;
    renderIvrBuilderStyles();

    card.innerHTML = `
      <h3>IVR Builder 1.0</h3>
      <div class="bth-note">
        Будуємо дерево візуально. Сценарії створюються автоматично, ID підставляються в конфіг після створення.
      </div>

      <div class="bth-row">
        <div>
          <label>Префікс назв сценаріїв</label>
          <input data-field="ivrScenarioPrefix" value="${escapeHtml(draft.ivrScenarioPrefix || 'IVR TEST')}" placeholder="IVR TEST">
          <label class="bth-checkbox">
            <input type="checkbox" data-field="ivrUseScenarioPrefixNumbering" ${draft.ivrUseScenarioPrefixNumbering !== false ? 'checked' : ''}>
            Додавати префікс і номер шляху до назв сценаріїв
          </label>
        </div>
        <div>
          <label>WaitExten, сек</label>
          <input data-field="ivrWaitSeconds" value="${escapeHtml(draft.ivrWaitSeconds || '5')}" placeholder="5">
        </div>
      </div>

      <div class="bth-mini-actions">
        <button class="bth-green bth-ivr-add-root" type="button">+ Головний пункт</button>
        <button class="bth-gray bth-ivr-repeat-root" type="button">⚙ Повтори головного меню</button>
        <button class="bth-gray bth-ivr-example" type="button">Приклад</button>
        <button class="bth-gray bth-ivr-clear-tree" type="button">Очистити дерево</button>
      </div>

      <div class="bth-ivr-errors" data-ivr-output="errors">Ще не генерували.</div>

      <div class="bth-ivr-repeat-editor" hidden>
        <input type="hidden" data-ivr-repeat-menu-id>
        <h4 data-ivr-repeat-title>Повтори меню</h4>
        <div class="bth-note">Якщо увімкнено, при t меню повториться потрібну кількість разів, а потім піде у t-сценарій.</div>
        <label class="bth-checkbox">
          <input type="checkbox" data-ivr-repeat-enabled>
          Увімкнути повтор для цього меню
        </label>
        <div class="bth-row">
          <div>
            <label>Кількість повторів</label>
            <input data-ivr-repeat-count value="3" placeholder="3">
          </div>
          <div>
            <label>Після повторів</label>
            <input value="t За замовчуванням" disabled>
          </div>
        </div>
        <div class="bth-mini-actions">
          <button class="bth-green bth-ivr-repeat-save" type="button">Зберегти повтор</button>
          <button class="bth-gray bth-ivr-repeat-close" type="button">Закрити</button>
        </div>
      </div>

      <div class="bth-ivr-builder-grid">
        <div class="bth-ivr-pane">
          <h4>Конструктор дерева</h4>
          <div class="bth-ivr-visual-tree"></div>
        </div>
        <div class="bth-ivr-pane">
          <h4>Попередній перегляд дерева</h4>
          <pre class="bth-ivr-preview" data-ivr-preview></pre>
        </div>
      </div>

      <div class="bth-mini-actions">
        <button class="bth-green bth-ivr-create-routes" type="button">Створити сценарії та згенерувати конфіг</button>
        <button class="bth-blue bth-ivr-generate" type="button">Згенерувати конфіг без створення</button>
        <button class="bth-blue bth-copy-scenarios" type="button">Копіювати сценарії</button>
        <button class="bth-blue bth-copy-config" type="button">Копіювати конфіг</button>
      </div>

      <label>Список створених сценаріїв</label>
      <textarea class="bth-ivr-output" data-ivr-output="scenarios" readonly></textarea>

      <label>Готовий конфіг</label>
      <textarea class="bth-ivr-output" data-ivr-output="config" readonly></textarea>

      <h3 style="margin-top:16px;">Імпорт існуючого IVR-конфіга</h3>
      <textarea class="bth-ivr-import" data-field="ivrImportConfig" placeholder="[ivr-10689]&#10;exten => s,1,Answer(500)&#10;exten => 1,1,Set(ivrRouteID=188677)">${escapeHtml(draft.ivrImportConfig || '')}</textarea>
      <div class="bth-mini-actions">
        <button class="bth-green bth-ivr-parse-import" type="button">Розібрати конфіг</button>
      </div>
    `;
  }

  function extractRouteIdFromHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      const keys = ['routeID', 'routeId', 'route_id', 'ID', 'id'];
      for (const key of keys) {
        const value = url.searchParams.get(key);
        if (/^\d+$/.test(value || '')) return value;
      }
      const companyId = clean(loadDraft().companyId || getCompanyIdFromUrl());
      const projectId = clean(loadDraft().projectId || getProjectIdFromUrl());
      const candidates = Array.from(url.searchParams.values()).filter(value =>
        /^\d+$/.test(value) && value !== companyId && value !== projectId
      );
      if (candidates.length) return candidates[candidates.length - 1];
    } catch (error) {
      // ignore
    }

    const matches = String(href).match(/\b\d{4,}\b/g) || [];
    const companyId = clean(loadDraft().companyId || getCompanyIdFromUrl());
    const projectId = clean(loadDraft().projectId || getProjectIdFromUrl());
    return matches.filter(value => value !== companyId && value !== projectId).pop() || '';
  }

  function isRouteActionText(text) {
    const value = normalize(text);
    return !value ||
      value === 'edit' ||
      value === 'ред.' ||
      value === 'ред' ||
      value === 'изменить' ||
      value === 'редактировать' ||
      value === 'налаштування' ||
      value === 'настройки' ||
      value === 'удалить' ||
      value === 'видалити' ||
      value === 'меню';
  }

  function getRouteNameFromRow(row, editLink, routeId) {
    const linkText = clean(editLink && editLink.textContent);
    if (linkText && !/^\d+$/.test(linkText) && !isRouteActionText(linkText)) {
      return linkText;
    }

    const cells = $all('td, th', row)
      .map(cell => clean(cell.textContent))
      .filter(Boolean);

    for (const cell of cells) {
      if (cell === routeId || /^\d+$/.test(cell) || isRouteActionText(cell)) continue;
      return cell;
    }

    return '';
  }

  function getRouteNameMapFromCurrentPage() {
    const result = {
      available: getModule() === CONFIG.routesModule,
      names: new Map(),
      scanned: 0,
    };
    if (!result.available) return result;

    const rows = $all('tr, .row-fluid, .route-row, li').filter(visibleElement);
    rows.forEach(row => {
      const links = $all('a[href]', row);
      const editLink = links.find(link =>
        /module=routes/i.test(link.href) &&
        /action=edit/i.test(link.href) &&
        extractRouteIdFromHref(link.href)
      ) || links.find(link =>
        /action=edit/i.test(link.href) &&
        extractRouteIdFromHref(link.href)
      );
      if (!editLink) return;

      const routeId = extractRouteIdFromHref(editLink.href);
      if (!routeId || result.names.has(routeId)) return;

      const routeName = getRouteNameFromRow(row, editLink, routeId);
      if (!routeName) return;

      result.names.set(routeId, routeName);
      result.scanned += 1;
    });

    return result;
  }

  function findRouteOnCurrentPageByName(routeName) {
    const target = normalize(routeName);
    if (!target) return null;

    const rows = $all('tr, .row-fluid, .route-row, li').filter(row => normalize(row.textContent).includes(target));
    for (const row of rows) {
      const editLink = $all('a[href]', row).find(link =>
        /module=routes/i.test(link.href) &&
        /action=edit/i.test(link.href)
      ) || $all('a[href]', row).find(link => /action=edit/i.test(link.href));
      if (editLink) {
        return {
          routeName,
          routeEditUrl: editLink.href,
          routeId: extractRouteIdFromHref(editLink.href),
        };
      }
    }

    const links = $all('a[href]').filter(link => normalize(link.textContent).includes(target));
    for (const link of links) {
      const routeId = extractRouteIdFromHref(link.href);
      if (routeId) {
        return { routeName, routeEditUrl: link.href, routeId };
      }
    }

    return null;
  }

  function clickVisibleText(text) {
    const target = normalize(text);
    const elements = $all('a, button, li, span, div')
      .filter(visibleElement)
      .filter(element => normalize(element.textContent) === target || normalize(element.textContent).includes(target));

    const element = elements.find(item => item.matches('a,button')) || elements[0];
    if (!element) return false;
    const clickable = element.closest('a,button') || element;
    clickable.click();
    return true;
  }

  async function chooseRouteTemplate(templateName) {
    const toggles = $all('a.btn-inverse.dropdown-toggle, button.btn-inverse.dropdown-toggle, .btn-inverse.dropdown-toggle')
      .filter(visibleElement);
    const toggle = toggles[0] || $all('.dropdown-toggle').filter(visibleElement)[0];
    if (!toggle) throw new Error('Не знайшов кнопку вибору шаблону сценарію.');

    toggle.click();
    await sleep(350);

    if (!clickVisibleText(templateName)) {
      throw new Error(`Не знайшов шаблон сценарію "${templateName}".`);
    }
    await sleep(650);
  }

  function getRouteNameField() {
    return $('#routeName') ||
      getVisibleField('input[name*="route" i], input[name*="name" i]') ||
      findInputByLabel('Название сценария') ||
      findInputByLabel('Назва сценарію');
  }

  async function fillAndSaveRouteScenario(item) {
    await chooseRouteTemplate(item.template);

    const nameField = getRouteNameField();
    if (!nameField) throw new Error('Не знайшов поле назви сценарію.');
    setFieldValue(nameField, item.name);
    await sleep(150);
    setFieldValue(nameField, item.name);

    const clicked = clickButtonByText(['Сохранить', 'Зберегти']);
    if (!clicked) throw new Error('Не знайшов кнопку збереження сценарію.');
  }

  function getIvrFlowItems() {
    const draft = loadDraft();
    return getIvrScenarioItems(draft);
  }

  function validateIvrStart(draft = loadDraft()) {
    if (!clean(draft.companyId) && !getCompanyIdFromUrl()) throw new Error('Вкажи Panel ID / companyID.');
    if (!clean(draft.projectId) && !getProjectIdFromUrl()) throw new Error('Вкажи Project ID / showProjectID.');
    const errors = validateIvrTree(getIvrNodesFromDraft(draft));
    if (errors.length) throw new Error(errors.join('\n'));
  }

  async function startIvrScenarioFlow() {
    const draft = collectModalDraft();
    validateIvrStart(draft);
    saveFlow({
      type: 'ivr',
      stage: 'ivrContext',
      index: 0,
      companyId: clean(draft.companyId || getCompanyIdFromUrl()),
      projectId: clean(draft.projectId || getProjectIdFromUrl()),
    });
    await runWithStop(runAutomaticFlow);
  }

  async function runIvrFlow() {
    if (stopRequested) {
      clearFlow();
      log('IVR Builder: виконання зупинено.', 'warn');
      return;
    }

    const draft = loadDraft();
    const flow = saveFlow(loadFlow() || { type: 'ivr', stage: 'ivrContext', index: 0 });
    assertCurrentProjectContext(draft, flow);

    if (flow.stage === 'ivrContext') {
      const companyId = clean(flow.companyId || draft.companyId || getCompanyIdFromUrl());
      const projectId = clean(flow.projectId || draft.projectId || getProjectIdFromUrl());
      if (!companyId) throw new Error('Вкажи Panel ID / companyID.');
      if (!projectId) throw new Error('Вкажи Project ID / showProjectID.');
      saveDraft({ companyId, projectId });

      if (getCompanyIdFromUrl() !== companyId || getProjectIdFromUrl() !== projectId || getModule() !== CONFIG.routesModule) {
        log('IVR Builder: відкриваю Графики / сценарии.', 'info');
        saveFlow({ stage: 'ivrFindExisting', index: 0, companyId, projectId });
        window.location.href = buildPanelUrl(CONFIG.routesModule);
        return;
      }

      saveFlow({ stage: 'ivrFindExisting', index: 0, companyId, projectId });
      return runIvrFlow();
    }

    const items = getIvrFlowItems();
    const index = Number(flow.index || 0);

    if (index >= items.length) {
      const result = buildIvrVisualResult(loadDraft(), true);
      setIvrBuilderOutputs(result);
      clearFlow();
      log(
        result.ok
          ? 'IVR Builder: сценарії створено, фінальний конфіг готовий.'
          : `IVR Builder: сценарії створено, але є помилки у конфігу:\n${makeErrorSummary(result.errors)}`,
        result.ok ? 'success' : 'error'
      );
      return;
    }

    const item = items[index];
    if (item.routeId && item.routeName && item.routeName !== item.name && item.routeEditUrl && flow.stage !== 'ivrRename') {
      log(`IVR Builder: перейменовую сценарій ${item.routeId} на "${item.name}".`, 'info');
      saveFlow({ stage: 'ivrRename', index, renameUrl: item.routeEditUrl });
      window.location.href = item.routeEditUrl;
      return;
    }

    if (item.routeId && (!item.routeName || item.routeName === item.name || !item.routeEditUrl)) {
      if (item.routeName && item.routeName !== item.name && !item.routeEditUrl) {
        log(`IVR Builder: у "${item.name}" ID є (${item.routeId}), але немає edit-посилання для перейменування. Використовую існуючий ID.`, 'warn');
      }
      log(`IVR Builder: "${item.name}" вже має ID ${item.routeId}.`, 'success');
      saveFlow({ stage: 'ivrFindExisting', index: index + 1 });
      return runIvrFlow();
    }

    if (flow.stage === 'ivrFindExisting') {
      if (getModule() !== CONFIG.routesModule || getParams().get('action') === 'edit') {
        log('IVR Builder: повертаюсь до списку сценаріїв.', 'info');
        window.location.href = buildPanelUrl(CONFIG.routesModule);
        return;
      }

      const existing = findRouteOnCurrentPageByName(item.name);
      if (existing && existing.routeId) {
        updateIvrScenarioOnDraft(item, existing);
        log(`IVR Builder: знайдено існуючий сценарій "${item.name}" — ID ${existing.routeId}.`, 'success');
        saveFlow({ stage: 'ivrFindExisting', index: index + 1 });
        return runIvrFlow();
      }

      log(`IVR Builder: створюю сценарій "${item.name}".`, 'info');
      saveFlow({ stage: 'ivrCreate', index });
      window.location.href = buildPanelUrl(CONFIG.routesModule, 'edit');
      return;
    }

    if (flow.stage === 'ivrCreate') {
      if (getModule() !== CONFIG.routesModule || getParams().get('action') !== 'edit') {
        window.location.href = buildPanelUrl(CONFIG.routesModule, 'edit');
        return;
      }

      saveFlow({ stage: 'ivrFindAfterCreate', index, expectedName: item.name });
      await fillAndSaveRouteScenario(item);
      setTimeout(() => runWithStop(runAutomaticFlow), 1600);
      return;
    }

    if (flow.stage === 'ivrRename') {
      if (getModule() !== CONFIG.routesModule || getParams().get('action') !== 'edit') {
        window.location.href = flow.renameUrl || item.routeEditUrl;
        return;
      }

      const nameField = getRouteNameField();
      if (!nameField) throw new Error('Не знайшов поле назви сценарію для перейменування.');
      setFieldValue(nameField, item.name);
      updateIvrScenarioOnDraft(item, {
        routeId: item.routeId,
        routeName: item.name,
        routeEditUrl: item.routeEditUrl,
      });
      saveFlow({ stage: 'ivrFindExisting', index: index + 1 });
      const clicked = clickButtonByText(['Сохранить', 'Зберегти']);
      if (!clicked) throw new Error('Не знайшов кнопку збереження сценарію після перейменування.');
      setTimeout(() => runWithStop(runAutomaticFlow), 1600);
      return;
    }

    if (flow.stage === 'ivrFindAfterCreate') {
      if (getModule() !== CONFIG.routesModule || getParams().get('action') === 'edit') {
        window.location.href = buildPanelUrl(CONFIG.routesModule);
        return;
      }

      const created = findRouteOnCurrentPageByName(flow.expectedName || item.name);
      if (!created || !created.routeId) {
        throw new Error(`Сценарій "${flow.expectedName || item.name}" створився, але я не зміг знайти його ID у списку.`);
      }

      updateIvrScenarioOnDraft(item, created);
      log(`IVR Builder: "${created.routeName}" — ID ${created.routeId}.`, 'success');
      saveFlow({ stage: 'ivrFindExisting', index: index + 1 });
      return runIvrFlow();
    }
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener('mousedown', event => {
      if (event.target.closest('button')) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startRight = parseFloat(panel.style.right || 24);
      startTop = parseFloat(panel.style.top || 110);
      event.preventDefault();
    });

    document.addEventListener('mousemove', event => {
      if (!dragging) return;
      const right = Math.max(8, startRight - (event.clientX - startX));
      const top = Math.max(8, startTop + (event.clientY - startY));
      panel.style.right = `${right}px`;
      panel.style.top = `${top}px`;
      panel.style.bottom = 'auto';
      localStorage.setItem(CONFIG.positionStorageKey, JSON.stringify({ right, top }));
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function renderStyles() {
    if ($('#binotel-tz-helper-styles')) return;

    const style = document.createElement('style');
    style.id = 'binotel-tz-helper-styles';
    style.textContent = `
      #${CONFIG.panelId} {
        position: fixed;
        right: 24px;
        top: 110px;
        width: 230px;
        z-index: 999999;
        background: #101827;
        color: #f8fafc;
        border-radius: 10px;
        box-shadow: 0 14px 36px rgba(15, 23, 42, .32);
        font: 13px Arial, sans-serif;
        overflow: hidden;
      }
      #${CONFIG.panelId}.collapsed .bth-body { display: none; }
      #${CONFIG.panelId} .bth-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 10px;
        cursor: move;
        font-weight: 800;
      }
      #${CONFIG.panelId} .bth-toggle {
        border: 0;
        border-radius: 7px;
        background: #e5e7eb;
        color: #111827;
        cursor: pointer;
      }
      #${CONFIG.panelId} .bth-body {
        padding: 8px;
        border-top: 1px solid rgba(255,255,255,.08);
      }
      #${CONFIG.panelId} .bth-main {
        width: 100%;
        border: 0;
        border-radius: 8px;
        background: #2563eb;
        color: white;
        padding: 9px;
        font-weight: 800;
        cursor: pointer;
      }
      #${CONFIG.panelId} .bth-main + .bth-main {
        margin-top: 7px;
      }
      #${CONFIG.panelId} .bth-status {
        margin-top: 8px;
        padding: 8px;
        background: #1f2a44;
        border-radius: 8px;
        line-height: 1.25;
        white-space: pre-wrap;
      }
      #${CONFIG.panelId} .bth-status[data-type="success"] { background: #064e3b; }
      #${CONFIG.panelId} .bth-status[data-type="warn"] { background: #713f12; }
      #${CONFIG.panelId} .bth-status[data-type="error"] { background: #7f1d1d; }

      #${CONFIG.alertId} {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 1000002;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, .45);
        font: 16px Arial, sans-serif;
      }
      #${CONFIG.alertId}.open {
        display: flex;
      }
      #${CONFIG.alertId} .bth-alert-card {
        width: min(720px, calc(100vw - 48px));
        border-radius: 18px;
        background: #7f1d1d;
        color: white;
        box-shadow: 0 28px 90px rgba(15, 23, 42, .55);
        padding: 26px 30px;
        border: 2px solid rgba(255,255,255,.18);
      }
      #${CONFIG.alertId} .bth-alert-title {
        font-size: 30px;
        font-weight: 900;
        margin-bottom: 14px;
      }
      #${CONFIG.alertId} .bth-alert-text {
        font-size: 22px;
        line-height: 1.35;
        white-space: pre-wrap;
      }
      #${CONFIG.alertId} .bth-alert-ok {
        margin-top: 22px;
        border: 0;
        border-radius: 10px;
        background: white;
        color: #7f1d1d;
        padding: 12px 28px;
        font-size: 18px;
        font-weight: 900;
        cursor: pointer;
      }

      #${CONFIG.modalId} {
        display: none;
        position: fixed;
        inset: 3vh 3vw;
        z-index: 1000000;
        background: #f8fafc;
        color: #111827;
        border-radius: 14px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, .45);
        overflow: hidden;
        font: 14px Arial, sans-serif;
      }
      #${CONFIG.modalId}.open { display: flex; flex-direction: column; }
      #${CONFIG.modalId}[data-mode="fast"] .bth-ivr-card { display: none; }
      #${CONFIG.modalId}[data-mode="ivr"] .bth-content > .bth-card:not(.bth-ivr-card):not(.bth-log-card) { display: none; }
      #${CONFIG.modalId}[data-mode="ivr"] .bth-actions .bth-main-run { display: none; }
      #${CONFIG.modalId} .bth-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        background: #111827;
        color: white;
      }
      #${CONFIG.modalId} h2, #${CONFIG.modalId} h3 { margin: 0; }
      #${CONFIG.modalId} .bth-close {
        border: 0;
        background: transparent;
        color: white;
        font-size: 24px;
        cursor: pointer;
      }
      #${CONFIG.modalId} .bth-content {
        padding: 16px;
        overflow: auto;
        display: grid;
        grid-template-columns: repeat(2, minmax(400px, 1fr));
        gap: 14px;
      }
      #${CONFIG.modalId} .bth-card {
        background: white;
        border: 1px solid #dbe3ef;
        border-radius: 12px;
        padding: 14px;
      }
      #${CONFIG.modalId} label {
        display: block;
        margin: 10px 0 4px;
        font-weight: 700;
      }
      #${CONFIG.modalId} input,
      #${CONFIG.modalId} textarea,
      #${CONFIG.modalId} select {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 8px 12px;
        font: 14px Arial, sans-serif;
        line-height: 20px;
      }
      #${CONFIG.modalId} input,
      #${CONFIG.modalId} select {
        min-height: 38px;
      }
      #${CONFIG.modalId} select {
        height: 38px;
        padding-top: 6px;
        padding-bottom: 6px;
      }
      #${CONFIG.modalId} textarea {
        min-height: 150px;
        resize: vertical;
      }
      #${CONFIG.modalId} textarea[data-field="ringGroupsRows"] {
        min-height: 220px;
      }
      #${CONFIG.modalId} textarea[data-field="gsmNumbersRows"],
      #${CONFIG.modalId} textarea[data-field="departmentsRows"] {
        min-height: 180px;
      }
      #${CONFIG.modalId} .bth-card.bth-wide {
        grid-column: 1 / -1;
      }
      #${CONFIG.modalId} .bth-ivr-grid {
        display: grid;
        grid-template-columns: minmax(360px, .9fr) minmax(420px, 1.1fr);
        gap: 12px;
        align-items: start;
      }
      #${CONFIG.modalId} .bth-ivr-output {
        min-height: 130px;
        font-family: Consolas, "Courier New", monospace;
        font-size: 13px;
      }
      #${CONFIG.modalId} textarea[data-field="ivrTreeRows"] {
        min-height: 260px;
        font-family: Consolas, "Courier New", monospace;
      }
      #${CONFIG.modalId} textarea[data-ivr-output="config"] {
        min-height: 320px;
      }
      #${CONFIG.modalId} .bth-ivr-visual-tree {
        min-height: 260px;
        max-height: 520px;
        overflow: auto;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        padding: 12px;
        background: #f8fafc;
      }
      #${CONFIG.modalId} .bth-ivr-visual-tree h4 {
        margin: 0 0 10px;
        font-size: 16px;
      }
      #${CONFIG.modalId} .bth-ivr-tree-list {
        list-style: none;
        margin: 6px 0 0 16px;
        padding: 0;
      }
      #${CONFIG.modalId} .bth-ivr-tree-list.root {
        margin-left: 0;
      }
      #${CONFIG.modalId} .bth-ivr-node-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 6px 0;
        padding: 7px;
        border: 1px solid #dbe3ef;
        border-radius: 9px;
        background: white;
      }
      #${CONFIG.modalId} .bth-ivr-node.invalid > .bth-ivr-node-row {
        border-color: #fca5a5;
        background: #fff1f2;
      }
      #${CONFIG.modalId} .bth-ivr-node-title {
        flex: 1;
        font-weight: 800;
      }
      #${CONFIG.modalId} .bth-ivr-node-type {
        color: #475569;
        font-size: 12px;
      }
      #${CONFIG.modalId} .bth-ivr-node-row button {
        border: 0;
        border-radius: 7px;
        padding: 5px 8px;
        background: #e2e8f0;
        cursor: pointer;
        font-weight: 800;
      }
      #${CONFIG.modalId} .bth-empty-tree {
        padding: 16px;
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
        color: #64748b;
        text-align: center;
      }
      #${CONFIG.modalId} .bth-ivr-table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        font-size: 13px;
      }
      #${CONFIG.modalId} .bth-ivr-table th,
      #${CONFIG.modalId} .bth-ivr-table td {
        border: 1px solid #dbe3ef;
        padding: 7px;
        vertical-align: middle;
      }
      #${CONFIG.modalId} .bth-ivr-table th {
        background: #e2e8f0;
        text-align: left;
        font-weight: 900;
      }
      #${CONFIG.modalId} .bth-ivr-table input,
      #${CONFIG.modalId} .bth-ivr-table select {
        min-height: 34px;
        padding: 5px 8px;
      }
      #${CONFIG.modalId} .bth-ivr-path {
        width: 80px;
        font-weight: 900;
        color: #1e3a8a;
        white-space: nowrap;
      }
      #${CONFIG.modalId} .bth-ivr-actions-cell {
        width: 190px;
        white-space: nowrap;
      }
      #${CONFIG.modalId} .bth-ivr-actions-cell button {
        border: 0;
        border-radius: 7px;
        padding: 6px 8px;
        margin-right: 5px;
        background: #e2e8f0;
        cursor: pointer;
        font-weight: 800;
      }
      #${CONFIG.modalId} .bth-ivr-actions-cell button:first-child {
        background: #dbeafe;
        color: #1d4ed8;
      }
      #${CONFIG.modalId} .bth-ivr-errors {
        margin: 10px 0;
        padding: 10px 12px;
        border-radius: 10px;
        white-space: pre-wrap;
        background: #ecfdf5;
        color: #065f46;
        font-weight: 700;
      }
      #${CONFIG.modalId} .bth-ivr-errors[data-type="error"] {
        background: #fee2e2;
        color: #991b1b;
      }
      #${CONFIG.modalId} .bth-mini-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 10px 0;
      }
      #${CONFIG.modalId} .bth-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      #${CONFIG.modalId} .bth-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        font-weight: 700;
      }
      #${CONFIG.modalId} .bth-checkbox input {
        width: auto;
        min-height: auto;
      }
      #${CONFIG.modalId} .bth-note {
        margin-top: 10px;
        padding: 9px;
        border-radius: 8px;
        background: #eff6ff;
        color: #1e3a8a;
      }
      #${CONFIG.modalId} .bth-log {
        min-height: 100px;
        max-height: 170px;
        overflow: auto;
        background: #0f172a;
        color: #e5e7eb;
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
      }
      #${CONFIG.modalId} .bth-log-line { margin-bottom: 5px; white-space: pre-wrap; }
      #${CONFIG.modalId} .bth-log-line.success { color: #86efac; }
      #${CONFIG.modalId} .bth-log-line.warn { color: #fde68a; }
      #${CONFIG.modalId} .bth-log-line.error { color: #fca5a5; }
      #${CONFIG.modalId} .bth-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        border-top: 1px solid #dbe3ef;
        background: #eef2f7;
      }
      #${CONFIG.modalId} .bth-actions button {
        border: 0;
        border-radius: 8px;
        color: white;
        padding: 10px 14px;
        font-weight: 800;
        cursor: pointer;
      }
      #${CONFIG.modalId} .bth-green { background: #16a34a; }
      #${CONFIG.modalId} .bth-blue { background: #2563eb; }
      #${CONFIG.modalId} .bth-gray { background: #64748b; }
      #${CONFIG.stopButtonId} {
        display: none;
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 1000001;
        border: 0;
        border-radius: 999px;
        padding: 14px 22px;
        background: #dc2626;
        color: white;
        font-weight: 900;
        box-shadow: 0 10px 30px rgba(220, 38, 38, .4);
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  function renderPanel() {
    if (!isPanelPage()) return;
    rememberUrlContext();
    renderStyles();

    let panel = $(`#${CONFIG.panelId}`);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = CONFIG.panelId;
      panel.innerHTML = `
        <div class="bth-head">
          <span>⚙️ TZ helper ${SCRIPT_VERSION}</span>
          <button class="bth-toggle" type="button">−</button>
        </div>
        <div class="bth-body">
          <button class="bth-main bth-open-fast" type="button">Фаст ТЗ</button>
          <button class="bth-main bth-open-ivr" type="button">IVR Builder</button>
          <div class="bth-status">Вибери потрібний режим роботи.</div>
        </div>
      `;
      document.body.appendChild(panel);

      const savedPosition = JSON.parse(localStorage.getItem(CONFIG.positionStorageKey) || 'null');
      if (savedPosition) {
        panel.style.right = `${savedPosition.right}px`;
        panel.style.top = `${savedPosition.top}px`;
        panel.style.bottom = 'auto';
      }

      makeDraggable(panel, $('.bth-head', panel));

      $('.bth-toggle', panel).addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        $('.bth-toggle', panel).textContent = panel.classList.contains('collapsed') ? '+' : '−';
      });

      $('.bth-open-fast', panel).addEventListener('click', () => openModal('fast'));
      $('.bth-open-ivr', panel).addEventListener('click', () => openModal('ivr'));
    }
  }

  function renderModal(mode = 'fast') {
    renderStyles();
    const draft = loadDraft();
    let modal = $(`#${CONFIG.modalId}`);

    if (!modal) {
      modal = document.createElement('div');
      modal.id = CONFIG.modalId;
      document.body.appendChild(modal);
    }

    modal.dataset.mode = mode;

    modal.innerHTML = `
      <div class="bth-modal-head">
        <h2>${mode === 'ivr' ? 'IVR Builder' : 'TZ helper — Фаст ТЗ'} ${SCRIPT_VERSION}</h2>
        <button class="bth-close" type="button">×</button>
      </div>
      <div class="bth-content">
        <div class="bth-card">
          <h3>Параметри компанії</h3>

          <label>Panel ID / companyID *</label>
          <input data-field="companyId" value="${escapeHtml(draft.companyId || getCompanyIdFromUrl())}" placeholder="Наприклад 10689">

          <label>Project ID / showProjectID *</label>
          <input data-field="projectId" value="${escapeHtml(draft.projectId || getProjectIdFromUrl())}" placeholder="Наприклад 100025">

          <label>Посилання на ТЗ *</label>
          <input data-field="tzUrl" value="${escapeHtml(draft.tzUrl)}" placeholder="https://docs.google.com/spreadsheets/d/...">

          <div class="bth-row">
            <div>
              <label>Пакет</label>
              <select data-field="tariff">${optionList(TARIFFS, draft.tariff)}</select>
            </div>
            <div>
              <label>Регіон</label>
              <select data-field="region">${optionList(REGIONS, draft.region)}</select>
              <label class="bth-checkbox">
                <input type="checkbox" data-field="regionNotImportant" ${draft.regionNotImportant ? 'checked' : ''}>
                Регіон не важливий
              </label>
            </div>
          </div>

          <div class="bth-row">
            <div>
              <label>Мова MyBusiness</label>
              <select data-field="language">${optionList(LANGUAGES, draft.language)}</select>
            </div>
            <div>
              <label>Часовий пояс</label>
              <select data-field="timezone">${optionList(TIMEZONES, draft.timezone)}</select>
            </div>
          </div>

          <div class="bth-note">
            Panel ID і Project ID обов’язкові: так скрипт відкриває саме потрібний проєкт компанії.
          </div>
        </div>

        <div class="bth-card">
          <h3>Внутрішні лінії</h3>
          <div class="bth-row">
            <div>
              <label>Стартова ВЛ</label>
              <input data-field="endpointsFirstLine" value="${escapeHtml(draft.endpointsFirstLine)}" placeholder="Наприклад 901">
            </div>
            <div>
              <label>Кількість</label>
              <input data-field="endpointsCount" value="${escapeHtml(draft.endpointsCount)}" placeholder="Наприклад 5">
            </div>
          </div>
        </div>

        <div class="bth-card">
          <h3>Групи ВЛ</h3>
          <label>Список груп</label>
          <textarea data-field="ringGroupsRows" placeholder="801&#10;Менеджер&#10;901,902,903&#10;&#10;802&#10;Менеджер&#10;904,905,906">${escapeHtml(draft.ringGroupsRows)}</textarea>
          <div class="bth-note">
            Кожна група — 3 рядки: номер, назва, лінії. Пустий рядок означає наступну групу.
          </div>
        </div>

        <div class="bth-card">
          <h3>Номери GSM</h3>
          <label>Список номерів</label>
          <textarea data-field="gsmNumbersRows" placeholder="0630000000&#10;Назва номера&#10;&#10;0730000000&#10;Назва номера">${escapeHtml(draft.gsmNumbersRows)}</textarea>

          <label>Email для номерів</label>
          <input data-field="gsmEmail" value="${escapeHtml(draft.gsmEmail)}" placeholder="Якщо пусто — буде noemail">

          <label class="bth-checkbox">
            <input type="checkbox" data-field="createTemporaryNumbers" ${draft.createTemporaryNumbers ? 'checked' : ''}>
            Створювати тимчасовий номер для кожного GSM
          </label>

          <div class="bth-note">
            GSM сервер при додаванні виставляється автоматично: rgsm0. Кожен номер — 2 рядки: номер і назва. Пустий рядок означає наступний номер.
          </div>
        </div>

        <div class="bth-card">
          <h3>Відділи</h3>
          <label>Список відділів</label>
          <textarea data-field="departmentsRows" placeholder="Продажі-1&#10;0630000000&#10;901&#10;902&#10;&#10;Продажі-2&#10;0630000001&#10;903&#10;904">${escapeHtml(draft.departmentsRows)}</textarea>
          <div class="bth-note">
            Кожен відділ — блок: назва, номер, далі ВЛ. Якщо для номера створився тимчасовий — він буде доданий у цей відділ автоматично.
          </div>
        </div>

        <div class="bth-card bth-wide bth-ivr-card">
          <h3>IVR Builder</h3>
          <div class="bth-note">
            Етап 1: таблиця дерева IVR. Інженер не пише шлях руками: шлях формується автоматично, кнопка використовується в конфігу.
          </div>

          <div class="bth-row">
            <div>
              <label>Назва конфіга / головного IVR</label>
              <input data-field="ivrConfigName" value="${escapeHtml(draft.ivrConfigName)}" placeholder="Наприклад: Основне меню">
              <label class="bth-checkbox">
                <input type="checkbox" data-field="ivrUseScenarioPrefixNumbering" ${draft.ivrUseScenarioPrefixNumbering !== false ? 'checked' : ''}>
                Додавати префікс і номер шляху до назв сценаріїв
              </label>
            </div>
            <div>
              <label>WaitExten, сек</label>
              <input data-field="ivrWaitSeconds" value="${escapeHtml(draft.ivrWaitSeconds)}" placeholder="5">
            </div>
          </div>

          <div class="bth-mini-actions">
            <button class="bth-green bth-ivr-add-root" type="button">+ пункт головного меню</button>
            <button class="bth-gray bth-ivr-example" type="button">Приклад</button>
            <button class="bth-gray bth-ivr-clear-tree" type="button">Очистити дерево</button>
          </div>

          <div class="bth-ivr-errors" data-ivr-output="errors">Ще не генерували.</div>

          <div class="bth-ivr-visual-tree"></div>

          <div class="bth-mini-actions">
            <button class="bth-green bth-ivr-generate" type="button">Згенерувати IVR</button>
            <button class="bth-blue bth-copy-scenarios" type="button">Копіювати сценарії</button>
            <button class="bth-blue bth-copy-config" type="button">Копіювати конфіг</button>
          </div>

          <label>1. Дерево</label>
          <textarea class="bth-ivr-output" data-ivr-output="tree" readonly></textarea>

          <label>2. Список сценаріїв для створення</label>
          <textarea class="bth-ivr-output" data-ivr-output="scenarios" readonly></textarea>

          <label>3. Конфіги</label>
          <textarea class="bth-ivr-output" data-ivr-output="config" readonly></textarea>
        </div>

        <div class="bth-card bth-log-card">
          <h3>Лог</h3>
          <div class="bth-log"></div>
        </div>
      </div>
      <div class="bth-actions">
        <button class="bth-green bth-main-run" type="button">Запустити</button>
        <button class="bth-gray bth-save" type="button">Зберегти</button>
        <button class="bth-gray bth-close-bottom" type="button">Закрити</button>
      </div>
    `;

    const departmentsField = $('[data-field="departmentsRows"]', modal);
    if (departmentsField) {
      departmentsField.placeholder = [
        'Продажі-1',
        '0630000000, 0730000000',
        '801, 802',
        '',
        'Продажі-2',
        '0500000000',
        '803, 804',
      ].join('\n');
    }

    upgradeIvrBuilderCard(modal, draft);
    renderStoredLogs($('.bth-log', modal));

    $('.bth-close', modal).addEventListener('click', closeModal);
    $('.bth-close-bottom', modal).addEventListener('click', closeModal);
    $('.bth-save', modal).addEventListener('click', () => {
      collectModalDraft();
      log('Введені дані збережено.', 'success');
    });
    $('.bth-main-run', modal).addEventListener('click', async () => {
      const draft = collectModalDraft();
      clearFlow();
      saveFlow({
        stage: 'context',
        index: 0,
        companyId: clean(draft.companyId || getCompanyIdFromUrl()),
        projectId: clean(draft.projectId || getProjectIdFromUrl()),
      });
      await runWithStop(runAutomaticFlow);
    });

    $('.bth-ivr-example', modal).addEventListener('click', () => {
      saveIvrNodes(getDefaultIvrNodes());
      const nameField = $('[data-field="ivrScenarioPrefix"]', modal) || $('[data-field="ivrConfigName"]', modal);
      const waitField = $('[data-field="ivrWaitSeconds"]', modal);
      if (nameField && !nameField.value) nameField.value = 'IVR TEST';
      if (waitField && !waitField.value) waitField.value = '5';
      collectModalDraft();
      refreshIvrVisualBuilder();
      log('IVR Builder: приклад вставлено.', 'success');
    });

    $('.bth-ivr-clear-tree', modal).addEventListener('click', () => {
      saveIvrNodes([]);
      saveIvrRepeatSettings({ root: getIvrRepeatSetting('root') });
      saveIvrFallbacks({});
      setIvrEditor('root');
      refreshIvrVisualBuilder();
      log('IVR Builder: дерево очищено.', 'warn');
    });

    $('.bth-ivr-add-root', modal).addEventListener('click', () => {
      addIvrNode('root');
      log('IVR Builder: пункт головного меню додано.', 'success');
    });

    $('.bth-ivr-repeat-root', modal).addEventListener('click', () => {
      openIvrRepeatEditor('root');
    });

    $('.bth-ivr-repeat-save', modal).addEventListener('click', () => {
      saveIvrRepeatEditor();
    });

    $('.bth-ivr-repeat-close', modal).addEventListener('click', () => {
      closeIvrRepeatEditor();
    });

    $('.bth-ivr-visual-tree', modal).addEventListener('click', event => {
      const button = event.target.closest('[data-ivr-action]');
      if (!button) return;
      const nodeId = button.dataset.nodeId;
      const action = button.dataset.ivrAction;
      const nodes = getIvrNodesFromDraft();
      const node = nodes.find(item => item.id === nodeId);
      if (!node) return;

      if (action === 'add-child') addIvrNode(node.id);
      if (action === 'repeat') openIvrRepeatEditor(node.id);
      if (action === 'delete') deleteIvrNode(node.id);
    });

    $('.bth-ivr-visual-tree', modal).addEventListener('input', event => {
      const field = event.target.closest('[data-ivr-row-field]');
      if (!field) return;
      updateIvrNodeField(field.dataset.nodeId, field.dataset.ivrRowField, field.value, false);
      setIvrBuilderOutputs(buildIvrVisualResult(loadDraft()));
    });

    $('.bth-ivr-visual-tree', modal).addEventListener('change', event => {
      const field = event.target.closest('[data-ivr-row-field]');
      if (!field) return;
      updateIvrNodeField(field.dataset.nodeId, field.dataset.ivrRowField, field.value);
    });

    $('.bth-ivr-generate', modal).addEventListener('click', () => {
      collectModalDraft();
      const result = buildIvrVisualResult(loadDraft());
      setIvrBuilderOutputs(result);
      log(
        result.ok
          ? 'IVR Builder: конфіг згенеровано.'
          : `IVR Builder: є помилки у дереві/конфігу:\n${makeErrorSummary(result.errors)}`,
        result.ok ? 'success' : 'error'
      );
    });

    $('.bth-copy-scenarios', modal).addEventListener('click', async () => {
      const ok = await copyTextFromField('[data-ivr-output="scenarios"]');
      log(ok ? 'IVR Builder: список сценаріїв скопійовано.' : 'IVR Builder: немає сценаріїв для копіювання.', ok ? 'success' : 'warn');
    });

    $('.bth-copy-config', modal).addEventListener('click', async () => {
      const ok = await copyTextFromField('[data-ivr-output="config"]');
      log(ok ? 'IVR Builder: конфіг скопійовано.' : 'IVR Builder: немає конфіга для копіювання.', ok ? 'success' : 'warn');
    });

    const parseImportButton = $('.bth-ivr-parse-import', modal);
    if (parseImportButton) {
      parseImportButton.addEventListener('click', () => {
        collectModalDraft();
        importIvrConfigFromModal();
      });
    }

    const createRoutesButton = $('.bth-ivr-create-routes', modal);
    if (createRoutesButton) {
      createRoutesButton.addEventListener('click', async () => {
        collectModalDraft();
        await startIvrScenarioFlow();
      });
    }

    refreshIvrVisualBuilder();

    $all('[data-field]', modal).forEach(field => {
      field.addEventListener('input', collectModalDraft);
      field.addEventListener('change', collectModalDraft);
    });
  }

  function collectModalDraft() {
    const modal = $(`#${CONFIG.modalId}`);
    if (!modal) return loadDraft();

    const patch = {};
    $all('[data-field]', modal).forEach(field => {
      patch[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value;
    });

    patch.companyId = clean(patch.companyId || getCompanyIdFromUrl());
    patch.projectId = clean(patch.projectId || getProjectIdFromUrl());
    patch.contextCompanyId = patch.companyId;
    patch.contextProjectId = patch.projectId;

    return saveDraft(patch);
  }

  function openModal(mode = 'fast') {
    renderModal(mode);
    $(`#${CONFIG.modalId}`).classList.add('open');
  }

  function closeModal() {
    const modal = $(`#${CONFIG.modalId}`);
    if (modal) modal.classList.remove('open');
  }

  async function runWithStop(task) {
    stopRequested = false;
    showStopButton();

    try {
      await task();
    } catch (error) {
      const message = error.message || String(error);
      clearFlow();
      log(message, 'error');
      showCenterAlert(message, 'error');
    } finally {
      await sleep(250);
      hideStopButton();
    }
  }

  function boot() {
    if (!isPanelPage()) return;

    renderPanel();

    const flow = loadFlow();
    if (flow && flow.active) {
      const currentCompany = getCompanyIdFromUrl();
      const currentProject = getProjectIdFromUrl();
      const expectedCompany = clean(flow.companyId || loadDraft().companyId);
      const expectedProject = clean(flow.projectId || loadDraft().projectId);

      if (
        expectedCompany &&
        expectedProject &&
        currentCompany &&
        (currentCompany !== expectedCompany || (!isProjectAgnosticModule() && currentProject && currentProject !== expectedProject))
      ) {
        clearFlow();
        setStatus('Автозапуск зупинено: відкрита інша компанія або проєкт.', 'warn');
        return;
      }

      setTimeout(() => runWithStop(runAutomaticFlow), 500);
    }
  }

  boot();
})();
