// ==UserScript==
// @name         Binotel TZ automation helper
// @namespace    http://tampermonkey.net/
// @version      0.5.13
// @description  Мінімальний помічник ТЗ: параметри компанії, внутрішні лінії та групи ВЛ
// @author       Codex
// @match        https://panel.binotel.com/*
// @updateURL    https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-tz-automation-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Vispiris/binotel-tampermonkey-scripts/main/binotel-tz-automation-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    panelId: 'binotel-tz-helper-panel',
    modalId: 'binotel-tz-helper-modal',
    alertId: 'binotel-tz-helper-alert',
    stopButtonId: 'binotel-tz-helper-stop',
    positionStorageKey: 'binotel_tz_helper_position_v2',
    draftStorageKey: 'binotel_tz_helper_draft_v2',
    flowStorageKey: 'binotel_tz_helper_flow_v2',
    pbxSchemeModule: 'pbxScheme',
    companyParamsModule: 'companyProperties',
    endpointsModule: 'endpoints',
    ringGroupsModule: 'ringGroups',
    gsmPortsModule: 'gsmPorts',
    pbxNumbersEnhancedModule: 'pbxNumbersEnhanced',
    departmentsModule: 'departments',
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

  function log(message, type = 'info') {
    setStatus(message, type);
    const modal = $(`#${CONFIG.modalId}`);
    const box = modal && $('.bth-log', modal);
    if (!box) return;

    const line = document.createElement('div');
    line.className = `bth-log-line ${type}`;
    line.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
    box.prepend(line);
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
        name: clean(lines[1] || lines[0]),
      }))
      .filter(item => item.number);
  }

  function getDepartmentItems(value) {
    return getBlockItems(value)
      .map(lines => ({
        name: clean(lines[0]),
        phoneNumber: clean(lines[1]),
        endpoints: lines.slice(2).map(clean).filter(Boolean),
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
    setFieldValue(nameField, item.name || item.number);
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
    const targets = [
      department.phoneNumber,
      temporaryMap[department.phoneNumber],
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
      #${CONFIG.panelId} .bth-status {
        margin-top: 8px;
        padding: 8px;
        background: #1f2a44;
        border-radius: 8px;
        line-height: 1.25;
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
      #${CONFIG.modalId} .bth-log-line { margin-bottom: 5px; }
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
          <span>⚙️ TZ helper</span>
          <button class="bth-toggle" type="button">−</button>
        </div>
        <div class="bth-body">
          <button class="bth-main bth-open" type="button">Відкрити</button>
          <div class="bth-status">Мінімальний режим: параметри, ВЛ, групи.</div>
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

      $('.bth-open', panel).addEventListener('click', openModal);
    }
  }

  function renderModal() {
    renderStyles();
    const draft = loadDraft();
    let modal = $(`#${CONFIG.modalId}`);

    if (!modal) {
      modal = document.createElement('div');
      modal.id = CONFIG.modalId;
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="bth-modal-head">
        <h2>TZ helper — мінімальний режим</h2>
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

        <div class="bth-card">
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

  function openModal() {
    renderModal();
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
