const APP_VERSION = "V3.0.1";
const APP_STORAGE_KEY = "line-schedule-tool-state-v1";
const RELEASE_STORAGE_KEY = "line-schedule-tool-seen-release";
const MOCK_COLLAB_STORAGE_KEY = "line-schedule-tool-mock-collaboration-v1";
const SHARE_HASH_PREFIX = "#share=";
const SHARE_QUERY_KEY = "share";
const COLLAB_QUERY_KEY = "schedule";
const SHARE_MESSAGE_PREFIX = "點我繼續編輯行程";
const PRODUCTION_HOSTNAME = "dazzling-croquembouche-edae63.netlify.app";
const RELEASE_NOTES = [
  "🏥 新增中南區醫院「亞大」辨識。",
  "💬 調整跨區提醒文字為「跨區提醒 麻煩 @協助安排」。",
  "🔒 優化分享錯誤提示，避免顯示開發資訊。"
];

const NORTH_PLACES = [
  "北辦", "林長一科", "林長二科", "林長小兒", "台大", "北榮", "國桃", "敏盛", "亞東", "振興",
  "花慈", "竹北生醫", "陽大", "三總", "雙和", "北醫", "竹馬", "竹大", "淡馬", "萬芳",
  "東馬", "北國", "大同", "北馬", "北慈", "新慈", "林長", "基長", "輔大"
];

const SOUTH_PLACES = [
  "中榮", "中榮秀傳", "濱秀", "中國", "中國醫", "中國醫B棟", "中國兒科", "彰基", "中山", "亞大", "大里仁愛",
  "麻新", "嘉長", "嘉榮", "嘉基", "高榮", "高醫", "高醫岡山", "南辦", "中辦", "高辦",
  "雲大", "雲林台大", "斗六成大", "成大", "高長", "長安", "屏基", "屏榮", "大林慈濟",
  "中慈", "奇美", "高雄全統", "嘉義全統", "802", "802醫院"
];

const CARGO_CODES = [
  "EX1", "EX2", "EX3", "EX4", "E1", "E2", "E3", "E4",
  "ICE-H", "ICE-H2", "ICE-H-2", "ICE-H-3", "WMC-1", "WMC-2"
];

const OFFICE_DESTINATIONS = new Set(["北辦", "中辦", "南辦", "高辦", "未辨識"]);

let schedules = [];
let importWarnings = [];

const rawInput = document.getElementById("rawInput");
const scheduleBody = document.getElementById("scheduleBody");
const summaryText = document.getElementById("summaryText");
const northOutput = document.getElementById("northOutput");
const southOutput = document.getElementById("southOutput");
const rowTemplate = document.getElementById("rowTemplate");
const instrumentSelect = document.getElementById("instrumentSelect");
const trackingSummary = document.getElementById("trackingSummary");
const trackingBody = document.getElementById("trackingBody");
const trackingText = document.getElementById("trackingText");
const weeklyStatsBody = document.getElementById("weeklyStatsBody");
const rangeStartInput = document.getElementById("rangeStart");
const rangeEndInput = document.getElementById("rangeEnd");
const sheetImportBtn = document.getElementById("sheetImportBtn");
const loginBtn = document.getElementById("loginBtn");
const importStatus = document.getElementById("importStatus");
const releaseDialog = document.getElementById("releaseDialog");
const releaseVersion = document.getElementById("releaseVersion");
const releaseNotesList = document.getElementById("releaseNotesList");
const releaseConfirmBtn = document.getElementById("releaseConfirmBtn");
const releaseCloseBtn = document.getElementById("releaseCloseBtn");
const messageFormatSelect = document.getElementById("messageFormatSelect");
const scheduleRegionFilter = document.getElementById("scheduleRegionFilter");
const shareEditBtn = document.getElementById("shareEditBtn");
const shareStatus = document.getElementById("shareStatus");

let currentShareUrl = "";
let currentSharedSchedule = null;
let collaborationDirty = false;

document.getElementById("appVersion").textContent = APP_VERSION;
setDefaultDateRange();
if (!loadMockCollaborativeStateFromUrl() && !loadSharedStateFromUrl()) restoreAppState();
loadServerSharedStateFromUrl();
showReleaseNotesOnce();

releaseConfirmBtn.addEventListener("click", closeReleaseNotes);
releaseCloseBtn.addEventListener("click", closeReleaseNotes);
releaseDialog.addEventListener("close", markReleaseSeen);
messageFormatSelect.addEventListener("change", () => {
  saveAppState();
  markCollaborationDirty();
  renderOutputs();
});

scheduleRegionFilter.addEventListener("change", () => {
  saveAppState();
  markCollaborationDirty();
  renderTable();
});

shareEditBtn.addEventListener("click", shareCurrentEdit);

function showReleaseNotesOnce() {
  try {
    if (localStorage.getItem(RELEASE_STORAGE_KEY) === APP_VERSION) return;
  } catch {
    // Show the notice when browser storage is unavailable.
  }

  releaseVersion.textContent = APP_VERSION;
  releaseNotesList.innerHTML = "";
  RELEASE_NOTES.forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    releaseNotesList.appendChild(item);
  });

  if (typeof releaseDialog.showModal === "function") {
    releaseDialog.showModal();
  } else {
    releaseDialog.setAttribute("open", "");
  }
}

function closeReleaseNotes() {
  if (typeof releaseDialog.close === "function") {
    releaseDialog.close();
    return;
  }
  releaseDialog.removeAttribute("open");
  markReleaseSeen();
}

function markReleaseSeen() {
  try {
    localStorage.setItem(RELEASE_STORAGE_KEY, APP_VERSION);
  } catch {
    // The notice may reappear when browser storage is unavailable.
  }
}

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((item) => {
      item.classList.remove("active");
      item.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".page-view").forEach((page) => page.classList.remove("active"));
    button.classList.add("active");
    button.setAttribute("aria-selected", "true");
    document.getElementById(button.dataset.page).classList.add("active");
  });
});

instrumentSelect.addEventListener("change", () => {
  renderTrackingResult();
});

rangeStartInput.addEventListener("change", () => {
  updateDateRangeLimits();
  saveAppState();
  markCollaborationDirty();
  renderOutputs();
  renderWeeklyStatistics();
});

rangeEndInput.addEventListener("change", () => {
  updateDateRangeLimits();
  saveAppState();
  markCollaborationDirty();
  renderOutputs();
  renderWeeklyStatistics();
});

sheetImportBtn.addEventListener("click", () => {
  importFromGoogleSheet();
});

window.addEventListener("beforeunload", saveAppState);

loginBtn.addEventListener("click", async () => {
  const identity = window.netlifyIdentity;
  if (!identity) {
    setImportStatus("登入功能需從 Netlify 網址開啟。", true);
    return;
  }
  if (identity.currentUser()) {
    identity.logout();
  } else {
    try {
      const loginUrl = await identity.gotrue.loginExternalUrl("google");
      window.location.assign(loginUrl);
    } catch {
      setImportStatus("請確認 Netlify Identity 已啟用 Google 登入。", true);
      identity.open("login");
    }
  }
});

document.querySelectorAll(".copy-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.target);
    target.select();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(target.value);
    } else {
      document.execCommand("copy");
    }
    const original = button.textContent;
    button.textContent = "已複製";
    setTimeout(() => {
      button.textContent = original;
    }, 1000);
  });
});

function normalizeText(value) {
  return (value || "")
    .normalize("NFKC")
    .replace(/[⾄]/g, "至")
    .replace(/[⼀]/g, "一")
    .replace(/[⼆]/g, "二")
    .replace(/[⼩]/g, "小")
    .replace(/[⼤]/g, "大")
    .replace(/[⽵]/g, "竹")
    .replace(/[⾺]/g, "馬")
    .replace(/[⾼]/g, "高")
    .replace(/[⿇]/g, "麻")
    .replace(/[⽃]/g, "斗")
    .replace(/[⽣]/g, "生")
    .replace(/[⾥]/g, "里")
    .replace(/[⼭]/g, "山")
    .replace(/[⼈]/g, "人")
    .replace(/[⾏]/g, "行")
    .replace(/[⾃]/g, "自")
    .replace(/[⽅]/g, "方")
    .replace(/[⽤]/g, "用")
    .replace(/[⽂]/g, "文")
    .replace(/[⾞]/g, "車")
    .replace(/[“”]/g, "\"")
    .replace(/[，]/g, ",")
    .replace(/[：]/g, ":")
    .replace(/[　]/g, " ")
    .replace(/\r/g, "");
}

function parseInput(text) {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let currentDate = "";
  let current = [];

  lines.forEach((line) => {
    const dateMatch = line.match(/^(\d{1,2}\/\d{1,2})$/);
    if (dateMatch) {
      if (current.length) blocks.push({ date: currentDate, lines: current });
      currentDate = dateMatch[1];
      current = [];
      return;
    }

    const cleaned = line.replace(/^"+|"+$/g, "").trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(cleaned)) {
      if (current.length) blocks.push({ date: currentDate, lines: current });
      currentDate = cleaned;
      current = [];
      return;
    }

    if (line.startsWith("\"") && current.length) {
      blocks.push({ date: currentDate, lines: current });
      current = [];
    }
    current.push(cleaned);
  });

  if (current.length) blocks.push({ date: currentDate, lines: current });

  return blocks
    .map((block, index) => parseBlock(block, index))
    .filter(Boolean);
}

function parseBlock(block, index) {
  const routeLine = block.lines[0] || "";
  const contactLine = block.lines.find((line) => line.startsWith("聯絡人_")) || "";
  const instrumentLine = block.lines.find((line) => line.startsWith("儀器_")) || "";
  const route = parseRoute(routeLine);
  if (route.missingOrigin) return null;

  const contact = parseContact(contactLine);
  const instruments = instrumentLine.replace(/^儀器_/, "").trim();
  const region = classifyRouteRegion(route.from, route.to);

  return {
    id: `${Date.now()}-${index}`,
    date: block.date,
    from: route.from,
    to: route.to,
    time: route.time,
    note: route.note,
    action: route.action,
    contact: contact.name || "業務",
    phone: contact.phone,
    contactEntries: contact.entries,
    instruments,
    region,
    delivery: classifyDelivery(instruments),
    parseWarning: route.joinedNumericPlaceTime
  };
}

function parseRoute(line) {
  let clean = line.replace(/\s+/g, "").replace(/^"+|"+$/g, "");
  const noteInfo = extractRouteNote(clean);
  clean = noteInfo.routeText;
  let action = "";
  const hasPickup = /取回/.test(clean);
  const hasNextDayDelivery = /隔日送達/.test(clean);
  const hasDelivery = /送達|抵達|到達/.test(clean);
  const hasColonTime = /\d{1,2}:\d{2}/.test(clean);
  const standaloneNumericDestination = hasStandaloneNumericDestination(clean);
  const joinedNumericPlaceTime =
    /至\d{3,}\d{1,2}:\d{2}(?:隔日送達|送達|抵達|到達|取回)/.test(clean) ||
    /至\d{7,}(?:隔日送達|送達|抵達|到達|取回)/.test(clean);

  if (hasPickup) action = "取回";
  if (hasDelivery) action = hasNextDayDelivery ? "隔日送達" : "送達";

  const time = standaloneNumericDestination ? "" : extractTime(clean);
  clean = clean.replace(/\d{1,2}:\d{2}/g, "");
  if (!hasColonTime && !standaloneNumericDestination) {
    clean = clean
      .replace(/(隔日送達|送達|抵達|到達|取回)(\d{3,4})/g, "$1")
      .replace(/(\d{3,4})(隔日送達|送達|抵達|到達|取回)/g, "$2");
  }
  clean = clean
    .replace(/備取\d*:?[^至送取抵到]*/g, "")
    .replace(/隔日送達|送達|抵達|到達|取回/g, "");

  const separatorIndex = clean.indexOf("至");
  const from = separatorIndex >= 0 ? clean.slice(0, separatorIndex) : clean;
  const to = separatorIndex >= 0 ? clean.slice(separatorIndex + 1) : "";
  return {
    from: from || "未辨識",
    to: to || "未辨識",
    time,
    note: noteInfo.note,
    action,
    missingOrigin: separatorIndex === 0,
    joinedNumericPlaceTime
  };
}

function extractRouteNote(line) {
  const normalized = String(line || "");
  const colonTime = normalized.match(/\d{1,2}:\d{2}/);
  if (colonTime) {
    const beforeAndTime = normalized.slice(0, colonTime.index + colonTime[0].length);
    const afterTime = normalized.slice(colonTime.index + colonTime[0].length);
    const actionPrefix = afterTime.match(/^(隔日送達|送達|抵達|到達|取回)/)?.[0] || "";
    const rawNote = afterTime.slice(actionPrefix.length);
    const note = normalizeRouteNote(rawNote);
    if (note) {
      return {
        routeText: beforeAndTime + actionPrefix,
        note
      };
    }
    return { routeText: normalized, note: "" };
  }

  const compactAfterAction = normalized.match(/(?:隔日送達|送達|抵達|到達|取回)(\d{3,4})(\D.+)$/);
  if (compactAfterAction) {
    const note = normalizeRouteNote(compactAfterAction[2]);
    if (note) return { routeText: normalized.slice(0, -compactAfterAction[2].length), note };
  }

  const compactBeforeAction = normalized.match(/(\d{3,4})(?:隔日送達|送達|抵達|到達|取回)(\D.+)$/);
  if (compactBeforeAction) {
    const note = normalizeRouteNote(compactBeforeAction[2]);
    if (note) return { routeText: normalized.slice(0, -compactBeforeAction[2].length), note };
  }

  return { routeText: normalized, note: "" };
}

function normalizeRouteNote(value) {
  return String(value || "")
    .replace(/[：]/g, ":")
    .replace(/^[-,，。:：]+/, "")
    .trim();
}

function hasStandaloneNumericDestination(line) {
  const numericPlaces = [...NORTH_PLACES, ...SOUTH_PLACES].filter((place) => /^\d+$/.test(place));
  return numericPlaces.some((place) =>
    new RegExp(`至${place}(?:隔日送達|送達|抵達|到達|取回)$`).test(line)
  );
}

function extractTime(line) {
  const colon = line.match(/(\d{1,2}):(\d{2})/);
  if (colon) return `${colon[1].padStart(2, "0")}:${colon[2]}`;

  const compact = line.match(/(?:隔日送達|送達|抵達|到達|取回)(\d{3,4})|(\d{3,4})(?:隔日送達|送達|抵達|到達|取回)/);
  if (!compact) return "";
  const digits = (compact[1] || compact[2]).padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseContact(line) {
  if (!line) return { name: "業務", phone: "", entries: [] };
  const body = line.replace(/^聯絡人_/, "").trim();
  const parts = body.split("_");
  const name = (parts[0] || "業務").trim();
  const phoneText = (parts.slice(1).join("_") || "").trim();
  const names = splitContactNames(name);
  const phones = splitPhoneNumbers(phoneText);
  const entries = names
    .map((contactName, index) => ({
      name: contactName,
      phone: phones[index] || (phones.length === 1 ? phones[0] : "")
    }))
    .filter((entry) => entry.name && entry.phone);
  return { name, phone: phones[0] || phoneText, entries };
}

function splitContactNames(value) {
  return normalizeText(value)
    .split(/[\/,、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPhoneNumbers(value) {
  return normalizeText(value)
    .split(/[\/,、 ]+/)
    .map((item) => item.replace(/[^\d]/g, ""))
    .filter((item) => /^09\d{8}$/.test(item));
}

function findPhoneForContact(name) {
  const target = normalizeText(name).trim().toLocaleLowerCase();
  if (!target || target === "業務") return "";

  const directory = new Map();
  schedules.forEach((schedule) => {
    (schedule.contactEntries || []).forEach((entry) => {
      const key = normalizeText(entry.name).trim().toLocaleLowerCase();
      if (key && entry.phone && !directory.has(key)) directory.set(key, entry.phone);
    });

    const names = splitContactNames(schedule.contact);
    const phones = splitPhoneNumbers(schedule.phone);
    names.forEach((contactName, index) => {
      const key = normalizeText(contactName).trim().toLocaleLowerCase();
      const phone = phones[index] || (phones.length === 1 ? phones[0] : "");
      if (key && phone && !directory.has(key)) directory.set(key, phone);
    });
  });

  return directory.get(target) || "";
}

function syncContactPhone(schedule, contactValue) {
  schedule.contactEntries = [];
  if (!contactValue.trim()) {
    schedule.phone = "";
  } else if (!schedule.phone) {
    schedule.phone = findPhoneForContact(contactValue);
  }
  return schedule.phone || "";
}

function classifyRegion(from) {
  if (placeMatchesList(from, SOUTH_PLACES)) return "south";
  if (placeMatchesList(from, NORTH_PLACES)) return "north";
  return "unknown";
}

function classifyRouteRegion(from, to) {
  const originRegion = classifyRegion(from);
  if (originRegion !== "unknown") return originRegion;
  return classifyRegion(to);
}

function placeMatchesList(value, places) {
  const normalized = normalizeText(value).trim();
  return places.some((place) => place === "802" ? normalized === place : normalized.includes(place));
}

function scheduleNeedsReview(schedule) {
  if (schedule.warningAcknowledged) return false;
  return Boolean(schedule.parseWarning) ||
    classifyRegion(schedule.from) === "unknown" ||
    classifyRegion(schedule.to) === "unknown";
}

function classifyDelivery(instruments) {
  const normalized = normalizeText(instruments).toUpperCase();
  return CARGO_CODES.some((code) => normalized.includes(code.toUpperCase())) ? "cargo" : "self";
}

function renderTable() {
  const readOnly = isSharedReadOnly();
  scheduleBody.innerHTML = "";
  if (!schedules.length) {
    scheduleBody.innerHTML = '<tr class="empty-row"><td colspan="12">匯入正式資料後，這裡會顯示可編輯的行程。</td></tr>';
    summaryText.textContent = "尚未匯入行程";
    return;
  }

  const visibleIndexes = getVisibleScheduleIndexes();
  if (!visibleIndexes.length) {
    scheduleBody.innerHTML = '<tr class="empty-row"><td colspan="12">目前篩選範圍沒有行程。</td></tr>';
    updateSummaryText(0);
    return;
  }

  let previousRegion = "";
  let companyDividerShown = false;
  visibleIndexes.forEach((index) => {
    const schedule = schedules[index];
    if (schedule.delivery === "company" && !companyDividerShown) {
      scheduleBody.appendChild(createCompanyDeliveryDivider());
      companyDividerShown = true;
      previousRegion = "";
    }

    if (schedule.delivery !== "company" && schedule.region !== previousRegion) {
      scheduleBody.appendChild(createRegionDivider(schedule.region));
      previousRegion = schedule.region;
    }

    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    if (scheduleNeedsReview(schedule)) {
      row.classList.add("needs-review");
      row.title = "醫院無法辨識，或數字院所與時間相連，請人工確認";
      const warning = document.createElement("button");
      warning.type = "button";
      warning.className = "review-warning";
      warning.textContent = "❗️";
      warning.title = "完成編輯並取消警告";
      warning.setAttribute("aria-label", "完成編輯並取消警告");
      warning.disabled = readOnly;
      warning.addEventListener("click", () => {
        schedules[index].warningAcknowledged = true;
        schedules[index].parseWarning = false;
        saveAppState();
        markCollaborationDirty();
        renderTable();
        renderOutputs();
        renderTracker({ keepSelection: true });
      });
      row.querySelector("[data-remove]").parentElement.prepend(warning);
    }
    row.querySelectorAll("[data-field]").forEach((field) => {
      field.value = schedule[field.dataset.field] || "";
      field.disabled = readOnly;
      field.addEventListener("input", () => {
        schedules[index][field.dataset.field] = field.value;
        if (field.dataset.field === "from" || field.dataset.field === "to") {
          schedules[index].warningAcknowledged = false;
        }
        if (field.dataset.field === "contact") {
          const phoneField = row.querySelector('[data-field="phone"]');
          phoneField.value = syncContactPhone(schedules[index], field.value);
        }
        saveAppState();
        markCollaborationDirty();
        renderOutputs();
        renderTracker({ keepSelection: true });
      });
      if (field.dataset.field === "from" || field.dataset.field === "to") {
        field.addEventListener("change", () => {
          schedules[index].region = classifyRouteRegion(schedules[index].from, schedules[index].to);
          saveAppState();
          markCollaborationDirty();
          renderTable();
          renderOutputs();
          renderTracker({ keepSelection: true });
        });
      }
      if (field.dataset.field === "delivery") {
        field.addEventListener("change", () => {
          saveAppState();
          markCollaborationDirty();
          renderTable();
          renderOutputs();
          renderTracker({ keepSelection: true });
        });
      }
    });
    row.querySelector("[data-remove]").addEventListener("click", () => {
      schedules.splice(index, 1);
      saveAppState();
      markCollaborationDirty();
      renderTable();
      renderOutputs();
      renderTracker({ keepSelection: true });
    });
    row.querySelector("[data-remove]").disabled = readOnly;
    scheduleBody.appendChild(row);
  });

  updateSummaryText(visibleIndexes.length);
}

function updateSummaryText(visibleCount) {
  const northCount = schedules.filter((item) => item.region === "north").length;
  const southCount = schedules.filter((item) => item.region === "south").length;
  const companyCount = schedules.filter((item) => item.delivery === "company").length;
  const reviewCount = schedules.filter(scheduleNeedsReview).length;
  const filterLabel = getScheduleFilterLabel();
  const filterText = scheduleRegionFilter.value === "all" ? "" : `，目前顯示 ${filterLabel} ${visibleCount} 筆`;
  summaryText.textContent = `共 ${schedules.length} 筆，北區 ${northCount} 筆，中南區 ${southCount} 筆，公司物流自送 ${companyCount} 筆${reviewCount ? `，❗️待確認 ${reviewCount} 筆` : ""}${filterText}；表格依日期與區域排序`;
}

function createRegionDivider(region) {
  const row = document.createElement("tr");
  const dividerClass = region === "south" ? "south-divider" : region === "north" ? "north-divider" : "unknown-divider";
  row.className = `region-divider ${dividerClass}`;
  const cell = document.createElement("td");
  cell.colSpan = 12;
  cell.textContent = region === "south" ? "中南區" : region === "north" ? "北區" : "❗️ 待確認區域";
  row.appendChild(cell);
  return row;
}

function createCompanyDeliveryDivider() {
  const row = document.createElement("tr");
  row.className = "region-divider company-divider";
  const cell = document.createElement("td");
  cell.colSpan = 12;
  cell.textContent = "公司物流自送";
  row.appendChild(cell);
  return row;
}

function getVisibleScheduleIndexes() {
  const filterValue = scheduleRegionFilter.value || "all";
  return getSortedScheduleIndexes()
    .filter((index) => filterValue === "all" || schedules[index].region === filterValue);
}

function getSortedScheduleIndexes() {
  return schedules
    .map((schedule, index) => ({ schedule, index }))
    .sort((a, b) => {
      const deliveryGroupCompare = getDeliveryGroupSortValue(a.schedule.delivery) - getDeliveryGroupSortValue(b.schedule.delivery);
      if (deliveryGroupCompare) return deliveryGroupCompare;

      const dateCompare = compareDate(a.schedule.date, b.schedule.date);
      if (dateCompare) return dateCompare;

      const regionCompare = getRegionSortValue(a.schedule.region) - getRegionSortValue(b.schedule.region);
      if (regionCompare) return regionCompare;

      const fromCompare = compareText(a.schedule.from, b.schedule.from);
      if (fromCompare) return fromCompare;

      const toCompare = compareText(a.schedule.to, b.schedule.to);
      if (toCompare) return toCompare;

      const instrumentCompare = compareText(a.schedule.instruments, b.schedule.instruments);
      if (instrumentCompare) return instrumentCompare;

      const deliveryCompare = getDeliverySortValue(a.schedule.delivery) - getDeliverySortValue(b.schedule.delivery);
      if (deliveryCompare) return deliveryCompare;

      const actionCompare = compareText(a.schedule.action, b.schedule.action);
      if (actionCompare) return actionCompare;

      const timeCompare = compareText(a.schedule.time, b.schedule.time);
      if (timeCompare) return timeCompare;

      const contactCompare = compareText(a.schedule.contact, b.schedule.contact);
      if (contactCompare) return contactCompare;

      const phoneCompare = compareText(a.schedule.phone, b.schedule.phone);
      if (phoneCompare) return phoneCompare;

      return a.index - b.index;
    })
    .map((item) => item.index);
}

function getDeliveryGroupSortValue(delivery) {
  return delivery === "company" ? 1 : 0;
}

function getRegionSortValue(region) {
  if (region === "north") return 0;
  if (region === "south") return 1;
  return 2;
}

function getDeliverySortValue(delivery) {
  if (delivery === "cargo") return 0;
  if (delivery === "self") return 1;
  if (delivery === "ship") return 1;
  if (delivery === "company") return 2;
  return 2;
}

function getScheduleFilterLabel() {
  if (scheduleRegionFilter.value === "north") return "北區";
  if (scheduleRegionFilter.value === "south") return "中南區";
  return "全區";
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-Hant", {
    numeric: true,
    sensitivity: "base"
  });
}

function compareDate(a, b) {
  const parsedA = parseScheduleDate(a);
  const parsedB = parseScheduleDate(b);
  return parsedA - parsedB;
}

function parseScheduleDate(date) {
  const resolved = resolveScheduleDate(date);
  return resolved ? resolved.getTime() : Number.MAX_SAFE_INTEGER;
}

function resolveScheduleDate(date) {
  const match = String(date || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const range = getSelectedDateRange();
  if (!range) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const candidateYears = [range.start.getFullYear() - 1, range.start.getFullYear(), range.start.getFullYear() + 1];
  return candidateYears
    .map((year) => createValidLocalDate(year, month, day))
    .filter(Boolean)
    .find((candidate) => candidate >= range.start && candidate <= range.end) || null;
}

function createValidLocalDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateWithWeekday(date) {
  const resolved = resolveScheduleDate(date);
  if (!resolved) return date;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date} ${weekdays[resolved.getDay()]}`;
}

function setDefaultDateRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const daysUntilNextMonday = ((8 - today.getDay()) % 7) || 7;
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilNextMonday);
  rangeStartInput.value = formatDateInput(start);
  rangeEndInput.value = formatDateInput(end);
  updateDateRangeLimits();
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return createValidLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function updateDateRangeLimits() {
  const start = parseDateInput(rangeStartInput.value);
  if (!start) return;

  const latestEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 9);
  rangeEndInput.min = formatDateInput(start);
  rangeEndInput.max = formatDateInput(latestEnd);

  const end = parseDateInput(rangeEndInput.value);
  if (!end || end < start) rangeEndInput.value = formatDateInput(start);
  if (end && end > latestEnd) rangeEndInput.value = formatDateInput(latestEnd);
}

function getSelectedDateRange() {
  const start = parseDateInput(rangeStartInput.value);
  const end = parseDateInput(rangeEndInput.value);
  if (!start || !end || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  return days <= 10 ? { start, end, days } : null;
}

function getSchedulesForSelectedRange() {
  const range = getSelectedDateRange();
  if (!range) return [];

  return schedules.filter((schedule) => {
    const match = String(schedule.date || "").match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!match) return false;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const candidateYears = [range.start.getFullYear() - 1, range.start.getFullYear(), range.start.getFullYear() + 1];
    return candidateYears.some((year) => {
      const candidate = createValidLocalDate(year, month, day);
      return candidate && candidate >= range.start && candidate <= range.end;
    });
  });
}

function formatSelectedRangeLabel() {
  const range = getSelectedDateRange();
  if (!range) return "日期範圍無效";
  return `${range.start.getMonth() + 1}/${range.start.getDate()} 至 ${range.end.getMonth() + 1}/${range.end.getDate()}`;
}

function formatScheduleDateRangeFromSchedules() {
  const dates = [...new Set(schedules.map((schedule) => String(schedule.date || "").trim()).filter(Boolean))];
  if (!dates.length) return "日期範圍無效";
  const sortedDates = dates.sort(compareScheduleDateLabel);
  const firstDate = sortedDates[0];
  const lastDate = sortedDates[sortedDates.length - 1];
  return firstDate === lastDate ? firstDate : `${firstDate} 至 ${lastDate}`;
}

function compareScheduleDateLabel(a, b) {
  const resolvedA = resolveScheduleDate(a);
  const resolvedB = resolveScheduleDate(b);
  if (resolvedA && resolvedB) return resolvedA - resolvedB;
  const fallbackA = parseMonthDaySortValue(a);
  const fallbackB = parseMonthDaySortValue(b);
  if (fallbackA !== fallbackB) return fallbackA - fallbackB;
  return compareText(a, b);
}

function parseMonthDaySortValue(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 100 + Number(match[2]);
}

function renderOutputs() {
  northOutput.value = buildMessage("north");
  southOutput.value = buildMessage("south");
}

async function importFromGoogleSheet() {
  const range = getSelectedDateRange();
  if (!range) {
    setImportStatus("日期範圍最多只能選擇 10 日。", true);
    return;
  }
  if (location.protocol === "file:") {
    setImportStatus("試算表匯入需在 Netlify 網址使用；本機仍可手動貼上資料。", true);
    return;
  }

  const identity = window.netlifyIdentity;
  const user = identity?.currentUser();
  if (!user) {
    setImportStatus("請先使用受邀的 Google 帳號登入。", true);
    identity?.open("login");
    return;
  }

  sheetImportBtn.disabled = true;
  setImportStatus("正在讀取合併結果...");
  try {
    const token = await user.jwt();
    const params = new URLSearchParams({
      start: rangeStartInput.value,
      end: rangeEndInput.value
    });
    const response = await fetch(`/api/schedules?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "無法讀取試算表");

    importWarnings = Array.isArray(data.warnings) ? data.warnings : [];
    rawInput.value = recordsToRawText(data.records || []);
    schedules = parseInput(rawInput.value);
    saveAppState();
    markCollaborationDirty();
    renderTable();
    renderOutputs();
    renderTracker();
    const warningText = importWarnings.length ? `；❗️ ${importWarnings.join("；")}` : "";
    setImportStatus(
      `已匯入 ${schedules.length} 筆，範圍 ${formatSelectedRangeLabel()}${warningText}`,
      importWarnings.length > 0
    );
  } catch (error) {
    setImportStatus(error.message || "匯入失敗，請稍後再試。", true);
  } finally {
    sheetImportBtn.disabled = false;
  }
}

function recordsToRawText(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const date = String(record.date || "");
    const text = String(record.text || "").trim().replace(/^"+|"+$/g, "");
    if (!date || !text) return;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(text);
  });

  const lines = [];
  grouped.forEach((entries, date) => {
    if (lines.length) lines.push("");
    lines.push(date);
    entries.forEach((entry) => lines.push(`"${entry}"`));
  });
  return lines.join("\n");
}

function saveAppState() {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({
      rawInput: rawInput.value,
      schedules,
      importWarnings,
      rangeStart: rangeStartInput.value,
      rangeEnd: rangeEndInput.value,
      messageFormat: messageFormatSelect.value,
      scheduleRegionFilter: scheduleRegionFilter.value
    }));
  } catch {
    // The app remains usable when browser storage is unavailable.
  }
}

function restoreAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.schedules)) return;

    rawInput.value = String(saved.rawInput || "");
    schedules = saved.schedules;
    importWarnings = Array.isArray(saved.importWarnings) ? saved.importWarnings : [];
    if (saved.rangeStart) rangeStartInput.value = saved.rangeStart;
    if (saved.rangeEnd) rangeEndInput.value = saved.rangeEnd;
    if (saved.messageFormat === "traditional" || saved.messageFormat === "modern") {
      messageFormatSelect.value = saved.messageFormat;
    }
    if (saved.scheduleRegionFilter === "all" || saved.scheduleRegionFilter === "north" || saved.scheduleRegionFilter === "south") {
      scheduleRegionFilter.value = saved.scheduleRegionFilter;
    }
    updateDateRangeLimits();
  } catch {
    clearSavedState();
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(APP_STORAGE_KEY);
  } catch {
    // Clearing the current screen still succeeds when storage is unavailable.
  }
}

async function shareCurrentEdit() {
  if (!schedules.length) {
    setShareStatus("目前沒有可分享的行程。", true);
    return;
  }
  saveAppState();
  await shareScheduleDirectly();
}

function exportEditFile() {
  if (!schedules.length) {
    setShareStatus("目前沒有可匯出的行程。", true);
    return;
  }
  if (!window.confirm("備份檔會包含目前行程與電話資料，請只傳給可信任同事。")) return;

  saveAppState();
  const data = {
    type: "line-schedule-tool-edit",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    payload: createCompactSharePayload()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = createEditFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  setShareStatus("已匯出備份檔，可作為離線備份、還原或轉移使用。");
}

async function importEditFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const payload = data?.payload || data;
    applySharedState(payload);
    saveAppState();
    markCollaborationDirty();
    renderTable();
    renderOutputs();
    renderTracker();
    setShareStatus(`已匯入備份「${file.name}」，可接續編輯。`);
  } catch {
    setShareStatus("備份檔無法讀取，請確認是本程式匯出的 JSON 檔。", true);
  }
}

function createEditFileName() {
  const dates = schedules.map((schedule) => schedule.date).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const firstDate = dates[0] || today;
  const lastDate = dates[dates.length - 1] || firstDate;
  return `儀器排程備份_${sanitizeFileName(firstDate)}-${sanitizeFileName(lastDate)}.json`;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "")
    .slice(0, 30) || "未命名";
}

function prepareCollaborationPanel() {
  updateCollaborationPanel();
}

function createSharedScheduleObject(documentId, version = 1) {
  const now = new Date().toISOString();
  return {
    documentId,
    title: buildDefaultScheduleTitle(),
    dateRange: formatScheduleDateRangeFromSchedules(),
    schemaVersion: 1,
    appVersion: APP_VERSION,
    scheduleData: createCompactSharePayload(),
    shareMode: "edit",
    version,
    createdAt: currentSharedSchedule?.createdAt || now,
    createdBy: currentSharedSchedule?.createdBy || getMockUserName(),
    updatedAt: now,
    updatedBy: getMockUserName(),
    status: "active"
  };
}

function ensureCurrentScheduleIsShared() {
  if (!schedules.length) throw new Error("目前沒有可分享的行程。");

  if (!currentSharedSchedule) {
    currentSharedSchedule = createSharedScheduleObject(createMockDocumentId(), 1);
    saveMockSharedSchedule(currentSharedSchedule);
    currentShareUrl = buildCollaborationUrl(currentSharedSchedule.documentId);
    collaborationDirty = false;
    updateUrlForCollaboration(currentSharedSchedule.documentId);
    updateCollaborationPanel();
    return currentShareUrl;
  }

  const stored = getMockSharedSchedule(currentSharedSchedule.documentId);
  if (!stored || stored.status !== "active") {
    throw new Error("分享連結已失效，請重新整理後再試。");
  }
  if (stored.version !== currentSharedSchedule.version) {
    throw new Error("排程已被更新，請先重新載入最新內容。");
  }

  currentSharedSchedule = {
    ...createSharedScheduleObject(currentSharedSchedule.documentId, stored.version + 1),
    createdAt: stored.createdAt,
    createdBy: stored.createdBy
  };
  saveMockSharedSchedule(currentSharedSchedule);
  currentShareUrl = buildCollaborationUrl(currentSharedSchedule.documentId);
  collaborationDirty = false;
  updateUrlForCollaboration(currentSharedSchedule.documentId);
  updateCollaborationPanel();
  return currentShareUrl;
}

function createMockCollaboration() {
  if (!schedules.length) {
    setShareStatus("目前沒有可建立協作的行程。", true);
    return;
  }
  const documentId = createMockDocumentId();
  currentSharedSchedule = createSharedScheduleObject(documentId, 1);
  saveMockSharedSchedule(currentSharedSchedule);
  currentShareUrl = buildCollaborationUrl(currentSharedSchedule.documentId);
  collaborationDirty = false;
  updateUrlForCollaboration(currentSharedSchedule.documentId);
  updateCollaborationPanel("已儲存");
  setEditorReadOnly(false);
  openShareDialog(currentShareUrl);
  setShareStatus("已建立 Mock 協作連結，可複製到 LINE。");
}

function saveMockCollaboration() {
  if (!currentSharedSchedule) {
    createMockCollaboration();
    return;
  }
  const stored = getMockSharedSchedule(currentSharedSchedule.documentId);
  if (!stored || stored.status !== "active") {
    updateCollaborationPanel("協作已停止");
    setShareStatus("協作已停止，無法儲存。", true);
    return;
  }
  if (stored.version !== currentSharedSchedule.version) {
    updateCollaborationPanel("發生編輯衝突");
    setShareStatus("此排程已由其他同事更新，請先載入最新版本。", true);
    return;
  }
  if (stored.shareMode === "view") {
    updateCollaborationPanel("儲存失敗");
    setShareStatus("此協作連結為唯讀模式，無法儲存修改。", true);
    return;
  }

  updateCollaborationPanel("儲存中");
  const now = new Date().toISOString();
  currentSharedSchedule = {
    ...stored,
    title: stored.title || buildDefaultScheduleTitle(),
    shareMode: "edit",
    dateRange: formatSelectedRangeLabel(),
    appVersion: APP_VERSION,
    scheduleData: createCompactSharePayload(),
    version: stored.version + 1,
    updatedAt: now,
    updatedBy: getMockUserName()
  };
  saveMockSharedSchedule(currentSharedSchedule);
  collaborationDirty = false;
  updateCollaborationPanel("已儲存");
  setEditorReadOnly(false);
  setShareStatus(`已儲存 Mock 協作排程，版本 ${currentSharedSchedule.version}。`);
}

function loadLatestMockCollaboration() {
  if (!currentSharedSchedule) {
    const id = new URLSearchParams(location.search).get(COLLAB_QUERY_KEY);
    if (!id) {
      setShareStatus("目前沒有協作排程可載入。", true);
      return false;
    }
    return loadMockCollaborativeStateById(id);
  }
  return loadMockCollaborativeStateById(currentSharedSchedule.documentId);
}

function cloneMockCollaboration() {
  if (!schedules.length) {
    setShareStatus("目前沒有可另存副本的行程。", true);
    return;
  }
  const previousTitle = currentSharedSchedule?.title || buildDefaultScheduleTitle();
  currentSharedSchedule = null;
  currentShareUrl = "";
  createMockCollaboration();
  setShareStatus("已另存為新的 Mock 協作排程。");
}

function simulateMockConflict() {
  if (!currentSharedSchedule) {
    setShareStatus("請先建立或載入協作排程。", true);
    return;
  }
  const stored = getMockSharedSchedule(currentSharedSchedule.documentId);
  if (!stored || stored.status !== "active") {
    setShareStatus("此協作已停止，無法模擬衝突。", true);
    return;
  }
  const conflicted = {
    ...stored,
    version: stored.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "Mock 同事"
  };
  saveMockSharedSchedule(conflicted);
  updateCollaborationPanel("有新版本");
  setShareStatus("已模擬其他同事儲存新版。現在按儲存會出現版本衝突。", true);
}

function disableMockCollaboration() {
  if (!currentSharedSchedule) {
    setShareStatus("目前沒有協作可停止。", true);
    return;
  }
  if (!window.confirm("停止協作後，此連結將無法再載入或更新。確定停止？")) return;
  const stored = getMockSharedSchedule(currentSharedSchedule.documentId);
  if (!stored) return;
  const disabled = {
    ...stored,
    status: "disabled",
    updatedAt: new Date().toISOString(),
    updatedBy: getMockUserName()
  };
  saveMockSharedSchedule(disabled);
  currentSharedSchedule = disabled;
  collaborationDirty = false;
  updateCollaborationPanel("協作已停止");
  setShareStatus("Mock 協作已停止。", true);
}

async function shareMockCollaborationToLine() {
  await shareScheduleDirectly();
}

async function shareScheduleDirectly() {
  if (!schedules.length) {
    setShareStatus("目前沒有可分享的行程。", true);
    return;
  }
  setShareButtonState("正在建立分享連結…", true);
  setShareStatus("正在建立分享連結…");
  let shareUrl = "";
  try {
    setShareButtonState("正在儲存最新版…", true);
    setShareStatus("正在儲存最新版…");
    shareUrl = await createShareUrlForCurrentSchedule();
  } catch (error) {
    setShareButtonState("分享排程");
    setShareStatus(error?.message || "分享失敗，請重試。", true);
    return;
  }

  setShareButtonState("正在開啟分享…", true);
  setShareStatus("正在開啟分享…");
  const text = formatCollaborationShareText(shareUrl);
  const shareData = {
    title: "EP 排程",
    text
  };
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      await navigator.share(shareData);
      setShareStatus("已開啟系統分享。");
      setShareButtonState("分享排程");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      setShareStatus("已取消分享。");
      setShareButtonState("分享排程");
      return;
    }
  }

  const copied = await copyTextToClipboard(text);
  setShareStatus(copied ? "分享內容已複製。" : "分享失敗，請重試。", !copied);
  setShareButtonState("分享排程");
}

async function createShareUrlForCurrentSchedule() {
  if (!schedules.length) throw new Error("目前沒有可分享的行程。");
  saveAppState();
  if (isProduction() && isBlobAvailable()) {
    try {
      currentShareUrl = await createShortShareUrl(createCompactSharePayload());
      return currentShareUrl;
    } catch (error) {
      console.error("Production share storage failed. Falling back to local mock sharing.", error);
      if (isShareStorageUnavailable(error)) {
        setShareStatus("分享功能尚未啟用，請稍後再試。");
      }
    }
  } else {
    console.info("Sharing uses local mock storage outside production or when Blob storage is unavailable.");
  }
  return ensureCurrentScheduleIsShared();
}

async function copyCurrentShareLink() {
  if (!schedules.length) {
    setShareStatus("目前沒有可複製的分享連結。", true);
    return;
  }
  try {
    setShareStatus("正在建立分享連結…");
    const shareUrl = await createShareUrlForCurrentSchedule();
    const copied = await copyTextToClipboard(shareUrl);
    setShareStatus(copied ? "分享連結已複製。" : "無法自動複製，請再試一次。", !copied);
  } catch (error) {
    setShareStatus(error?.message || "分享失敗，請重試。", true);
  }
}

function loadMockCollaborativeStateFromUrl() {
  const id = new URLSearchParams(location.search).get(COLLAB_QUERY_KEY);
  if (!id) return false;
  return loadMockCollaborativeStateById(id);
}

function loadMockCollaborativeStateById(documentId) {
  const shared = getMockSharedSchedule(documentId);
  if (!shared) {
    setShareStatus("找不到此 Mock 協作排程，請確認連結是否正確。", true);
    return false;
  }
  currentSharedSchedule = shared;
  currentShareUrl = buildCollaborationUrl(shared.documentId);
  if (shared.status !== "active") {
    updateCollaborationPanel("協作已停止");
    setShareStatus("此 Mock 協作排程已停止。", true);
    setEditorReadOnly(true);
    return true;
  }
  applySharedState(shared.scheduleData);
  saveAppState();
  collaborationDirty = false;
  renderTable();
  renderOutputs();
  renderTracker();
  updateCollaborationPanel("已儲存");
  setEditorReadOnly(shared.shareMode === "view");
  setShareStatus(shared.shareMode === "view" ? "已載入唯讀 Mock 協作排程。" : "已載入可編輯 Mock 協作排程。");
  return true;
}

function getMockCollaborationStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOCK_COLLAB_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setMockCollaborationStore(store) {
  localStorage.setItem(MOCK_COLLAB_STORAGE_KEY, JSON.stringify(store));
}

function getMockSharedSchedule(documentId) {
  const store = getMockCollaborationStore();
  return store[documentId] || null;
}

function saveMockSharedSchedule(shared) {
  const store = getMockCollaborationStore();
  store[shared.documentId] = shared;
  setMockCollaborationStore(store);
}

function createMockDocumentId() {
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function buildCollaborationUrl(documentId) {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set(COLLAB_QUERY_KEY, documentId);
  return url.toString();
}

function updateUrlForCollaboration(documentId) {
  if (!history.replaceState) return;
  const url = new URL(location.href);
  url.searchParams.set(COLLAB_QUERY_KEY, documentId);
  history.replaceState(null, "", url.toString());
}

function buildDefaultScheduleTitle() {
  const rangeLabel = formatScheduleDateRangeFromSchedules();
  return rangeLabel === "日期範圍無效" ? "EP 排程" : `EP 排程｜${rangeLabel}`;
}

function formatCollaborationShareText(shareUrl = "") {
  const url = shareUrl || currentShareUrl || (currentSharedSchedule ? buildCollaborationUrl(currentSharedSchedule.documentId) : "");
  const rangeLabel = formatScheduleDateRangeFromSchedules();
  return [
    "【EP 排程】",
    "",
    `📅 ${rangeLabel}`,
    "",
    "👇 點我查看目前最新排程，並可繼續編輯。",
    "",
    url
  ].join("\n");
}

function updateCollaborationPanel(saveState = "") {
  const shared = currentSharedSchedule;
  currentShareUrl = shared ? buildCollaborationUrl(shared.documentId) : currentShareUrl;
}

function markCollaborationDirty() {
  if (!currentSharedSchedule || currentSharedSchedule.status !== "active") return;
  collaborationDirty = true;
  updateCollaborationPanel("尚未儲存");
}

function isSharedReadOnly() {
  return Boolean(currentSharedSchedule && (
    currentSharedSchedule.status !== "active" ||
    currentSharedSchedule.shareMode === "view"
  ));
}

function setShareButtonState(label, disabled = false) {
  shareEditBtn.textContent = label;
  shareEditBtn.disabled = disabled;
}

function setEditorReadOnly(readOnly) {
  rawInput.disabled = readOnly;
  sheetImportBtn.disabled = readOnly;
  renderTable();
}

function getMockUserName() {
  try {
    const user = window.netlifyIdentity?.currentUser?.();
    return user?.email || user?.user_metadata?.full_name || "Mock 使用者";
  } catch {
    return "Mock 使用者";
  }
}

function formatDisplayDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function buildShareUrl() {
  const payload = createCompactSharePayload();
  if (isProduction() && isBlobAvailable()) {
    try {
      const shortUrl = await createShortShareUrl(payload);
      if (shortUrl) return shortUrl;
    } catch (error) {
      console.error("Production share storage failed. Falling back to local mock sharing.", error);
      if (isShareStorageUnavailable(error)) {
        setShareStatus("分享功能尚未啟用，請稍後再試。");
      }
    }
  }
  return ensureCurrentScheduleIsShared();
}

async function createShortShareUrl(payload) {
  const response = await fetch("/api/share-schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload })
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok || !data.id) {
    const error = new Error(getSafeShareErrorMessage(data, response.status));
    error.status = response.status;
    error.code = data.code || "";
    error.detail = data;
    throw error;
  }
  const url = new URL(`${location.origin}${location.pathname}`);
  url.searchParams.set(SHARE_QUERY_KEY, data.id);
  return url.toString();
}

function isProduction() {
  return location.protocol === "https:" && location.hostname === PRODUCTION_HOSTNAME;
}

function isBlobAvailable() {
  return isProduction();
}

function isShareStorageUnavailable(error) {
  return error?.code === "SHARE_STORAGE_NOT_CONFIGURED" || error?.status === 503;
}

function getSafeShareErrorMessage(data, status) {
  if (data?.code === "SHARE_STORAGE_NOT_CONFIGURED" || status === 503) {
    return "分享功能尚未啟用，請稍後再試。";
  }
  if (containsInternalShareError(data?.error)) {
    return "分享功能尚未啟用，請稍後再試。";
  }
  return data?.error || `分享功能暫時無法使用，請稍後再試。`;
}

function containsInternalShareError(message) {
  return /NETLIFY_SITE_ID|NETLIFY_BLOBS_TOKEN|NETLIFY_AUTH_TOKEN|SITE_ID|Stack Trace|Internal Error|siteID,\s*token/i.test(String(message || ""));
}

async function loadServerSharedStateFromUrl() {
  const id = new URLSearchParams(location.search).get(SHARE_QUERY_KEY);
  if (!id) return false;

  try {
    const response = await fetch(`/api/share-schedules?id=${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok || !data.payload) throw new Error(data.error || "Unable to load share");
    applySharedState(data.payload);
    saveAppState();
    if (history.replaceState) history.replaceState(null, "", location.pathname);
    setShareStatus("已載入分享行程，可接續編輯。");
    renderTable();
    renderOutputs();
    renderTracker();
    return true;
  } catch {
    setShareStatus("分享連結無法讀取，請對方重新分享一次。", true);
    return false;
  }
}

function loadSharedStateFromUrl() {
  if (!location.hash.startsWith(SHARE_HASH_PREFIX)) return false;

  try {
    const shared = decodeSharePayload(location.hash.slice(SHARE_HASH_PREFIX.length));
    applySharedState(shared);
    saveAppState();
    if (history.replaceState) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    setShareStatus("已載入分享行程，可接續編輯。");
    return true;
  } catch {
    setShareStatus("分享連結無法讀取，請對方重新分享一次。", true);
    return false;
  }
}

function applySharedState(shared) {
  const sharedSchedules = shared.schedules || shared.s;
  if (!shared || !Array.isArray(sharedSchedules)) throw new Error("Invalid shared data");

  rawInput.value = String(shared.rawInput || "");
  schedules = normalizeSharedSchedules(sharedSchedules);
  importWarnings = Array.isArray(shared.importWarnings) ? shared.importWarnings : Array.isArray(shared.w) ? shared.w : [];
  if (shared.rangeStart || shared.rs) rangeStartInput.value = shared.rangeStart || shared.rs;
  if (shared.rangeEnd || shared.re) rangeEndInput.value = shared.rangeEnd || shared.re;
  const sharedMessageFormat = shared.messageFormat || shared.mf;
  if (sharedMessageFormat === "traditional" || sharedMessageFormat === "modern") {
    messageFormatSelect.value = sharedMessageFormat;
  }
  const sharedRegionFilter = shared.scheduleRegionFilter || shared.rf;
  if (sharedRegionFilter === "all" || sharedRegionFilter === "north" || sharedRegionFilter === "south") {
    scheduleRegionFilter.value = sharedRegionFilter;
  }
  updateDateRangeLimits();
}

function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSharePayload(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function createCompactSharePayload() {
  return {
    v: 2,
    s: schedules.map(compactScheduleForShare),
    w: importWarnings,
    rs: rangeStartInput.value,
    re: rangeEndInput.value,
    mf: messageFormatSelect.value,
    rf: scheduleRegionFilter.value
  };
}

function compactScheduleForShare(schedule) {
  return [
    schedule.date || "",
    schedule.region || "",
    schedule.from || "",
    schedule.to || "",
    schedule.instruments || "",
    schedule.delivery || "",
    schedule.action || "",
    schedule.time || "",
    schedule.note || "",
    schedule.contact || "",
    schedule.phone || "",
    schedule.parseWarning ? 1 : 0,
    schedule.warningAcknowledged ? 1 : 0
  ];
}

function normalizeSharedSchedules(sharedSchedules) {
  if (!Array.isArray(sharedSchedules)) return [];
  if (sharedSchedules.every(Array.isArray)) {
    return sharedSchedules.map(expandSharedSchedule);
  }
  return sharedSchedules;
}

function expandSharedSchedule(values, index) {
  return {
    id: `shared-${Date.now()}-${index}`,
    date: values[0] || "",
    region: values[1] || "unknown",
    from: values[2] || "",
    to: values[3] || "",
    instruments: values[4] || "",
    delivery: values[5] || "self",
    action: values[6] || "",
    time: values[7] || "",
    note: values.length > 12 ? values[8] || "" : "",
    contact: values.length > 12 ? values[9] || "" : values[8] || "",
    phone: values.length > 12 ? values[10] || "" : values[9] || "",
    contactEntries: (values.length > 12 ? values[9] : values[8]) ? [{
      name: values.length > 12 ? values[9] : values[8],
      phone: values.length > 12 ? values[10] || "" : values[9] || ""
    }] : [],
    parseWarning: values.length > 12 ? values[11] === 1 : values[10] === 1,
    warningAcknowledged: values.length > 12 ? values[12] === 1 : values[11] === 1
  };
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the older copy command below.
  }
  return fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function openShareDialog(url = "") {
  const shareDialog = document.getElementById("shareDialog");
  if (!shareDialog) return;
  const shareLinkText = document.getElementById("shareLinkText");
  if (shareLinkText) shareLinkText.value = url;
  if (typeof shareDialog.showModal === "function") {
    shareDialog.showModal();
  } else {
    shareDialog.setAttribute("open", "");
  }
}

function closeShareDialog() {
  const shareDialog = document.getElementById("shareDialog");
  if (!shareDialog) return;
  if (typeof shareDialog.close === "function") {
    shareDialog.close();
    return;
  }
  shareDialog.removeAttribute("open");
}

function formatShareText(url) {
  return `${SHARE_MESSAGE_PREFIX}\n${url}`;
}

function setShareStatus(message, isError = false) {
  shareStatus.textContent = message;
  shareStatus.classList.toggle("error", isError);
}

function setImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.classList.toggle("error", isError);
}

function initializeNetlifyIdentity() {
  const identity = window.netlifyIdentity;
  if (!identity) return;

  const updateLoginButton = (user) => {
    loginBtn.textContent = user ? "登出" : "使用 Google 登入";
  };

  identity.on("init", (user) => {
    updateLoginButton(user);
    if (user && location.protocol !== "file:") importFromGoogleSheet();
  });
  identity.on("login", (user) => {
    updateLoginButton(user);
    identity.close();
    importFromGoogleSheet();
  });
  identity.on("logout", () => {
    updateLoginButton(null);
    setImportStatus("已登出。");
  });
  identity.init();
}

function renderTracker(options = {}) {
  renderWeeklyStatistics();
  const previousSelection = options.keepSelection ? instrumentSelect.value : "";
  const instruments = getAvailableInstruments();
  instrumentSelect.innerHTML = "";

  if (!instruments.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "請先產生行程";
    instrumentSelect.appendChild(option);
    renderTrackingResult();
    return;
  }

  instruments.forEach((instrument) => {
    const option = document.createElement("option");
    option.value = instrument;
    option.textContent = instrument;
    instrumentSelect.appendChild(option);
  });

  if (previousSelection && instruments.includes(previousSelection)) {
    instrumentSelect.value = previousSelection;
  }
  renderTrackingResult();
}

function renderWeeklyStatistics() {
  weeklyStatsBody.innerHTML = "";
  const weeklyData = buildWeeklyBorrowingStatistics();

  if (!weeklyData.length) {
    const empty = document.createElement("p");
    empty.className = "statistics-empty";
    empty.textContent = "目前沒有送達借用紀錄。";
    weeklyStatsBody.appendChild(empty);
    return;
  }

  weeklyData.forEach((week) => {
    const section = document.createElement("section");
    section.className = "week-stat-block";

    const heading = document.createElement("h3");
    heading.textContent = formatWeekRange(week.start, week.end);
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "ranking-grid";
    grid.appendChild(createRankingPanel("借用儀器前五名", week.instrumentCounts));
    grid.appendChild(createRankingPanel("醫院借用次數前五名", week.hospitalCounts));
    section.appendChild(grid);
    weeklyStatsBody.appendChild(section);
  });
}

function buildWeeklyBorrowingStatistics() {
  const weeks = new Map();

  schedules.forEach((schedule) => {
    if (!isBorrowingSchedule(schedule)) return;
    const date = resolveScheduleDateForStatistics(schedule.date);
    const instruments = [...new Set(splitInstruments(schedule.instruments))];
    if (!date || !instruments.length || !schedule.to) return;

    const start = getMonday(date);
    const key = formatDateInput(start);
    if (!weeks.has(key)) {
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      weeks.set(key, {
        start,
        end,
        instrumentCounts: new Map(),
        hospitalCounts: new Map()
      });
    }

    const week = weeks.get(key);
    instruments.forEach((instrument) => {
      incrementCount(week.instrumentCounts, instrument);
      incrementCount(week.hospitalCounts, schedule.to);
    });
  });

  return [...weeks.values()].sort((a, b) => a.start - b.start);
}

function resolveScheduleDateForStatistics(date) {
  const resolved = resolveScheduleDate(date);
  if (resolved) return resolved;

  const match = String(date || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  const range = getSelectedDateRange();
  if (!match || !range) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  return [range.start.getFullYear() - 1, range.start.getFullYear(), range.start.getFullYear() + 1]
    .map((year) => createValidLocalDate(year, month, day))
    .filter(Boolean)
    .sort((a, b) => Math.abs(a - range.start) - Math.abs(b - range.start))[0];
}

function isBorrowingSchedule(schedule) {
  return (
    (schedule.action === "送達" || schedule.action === "隔日送達") &&
    Boolean(schedule.to) &&
    !OFFICE_DESTINATIONS.has(schedule.to)
  );
}

function getMonday(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  return monday;
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function createRankingPanel(title, counts) {
  const panel = document.createElement("section");
  panel.className = "ranking-panel";

  const heading = document.createElement("h4");
  heading.textContent = title;
  panel.appendChild(heading);

  const list = document.createElement("ol");
  list.className = "ranking-list";
  const ranking = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, 5);
  const highestCount = ranking[0]?.[1] || 1;

  ranking.forEach(([name, count]) => {
    const item = document.createElement("li");
    item.style.setProperty("--ranking-width", `${Math.max(12, (count / highestCount) * 100)}%`);
    const label = document.createElement("span");
    label.textContent = name;
    const total = document.createElement("strong");
    total.textContent = `${count}次`;
    item.append(label, total);
    list.appendChild(item);
  });

  if (!ranking.length) {
    const item = document.createElement("li");
    item.className = "ranking-empty";
    item.textContent = "無資料";
    list.appendChild(item);
  }

  panel.appendChild(list);
  return panel;
}

function formatMonthDayFromDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatWeekRange(start, end) {
  const startLabel = `${start.getFullYear()}/${formatMonthDayFromDate(start)}`;
  const endLabel = start.getFullYear() === end.getFullYear()
    ? formatMonthDayFromDate(end)
    : `${end.getFullYear()}/${formatMonthDayFromDate(end)}`;
  return `${startLabel}－${endLabel}`;
}

function getAvailableInstruments() {
  const seen = new Set();
  schedules.forEach((schedule) => {
    splitInstruments(schedule.instruments).forEach((instrument) => seen.add(instrument));
  });
  return [...seen].sort((a, b) => compareText(a, b));
}

function splitInstruments(value) {
  return normalizeText(value)
    .split(/[、,，/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderTrackingResult() {
  const selected = instrumentSelect.value;
  trackingBody.innerHTML = "";

  if (!selected) {
    trackingSummary.textContent = "調度次數：0次｜借用次數：0次";
    trackingText.value = "";
    trackingBody.innerHTML = '<tr class="empty-row"><td colspan="6">請先在第一頁貼上資料並產生行程。</td></tr>';
    return;
  }

  const routes = schedules
    .filter((schedule) => scheduleHasInstrument(schedule, selected))
    .slice()
    .sort(compareSchedulesForTracking);

  const borrowingCount = routes.filter(isBorrowingSchedule).length;
  trackingSummary.textContent = `調度次數：${routes.length}次｜借用次數：${borrowingCount}次`;

  if (!routes.length) {
    trackingText.value = "";
    trackingBody.innerHTML = '<tr class="empty-row"><td colspan="6">找不到這個儀器的行程。</td></tr>';
    return;
  }

  routes.forEach((route) => {
    const row = document.createElement("tr");
    if (scheduleNeedsReview(route)) row.classList.add("needs-review");
    [
      route.date || "未填日期",
      `${scheduleNeedsReview(route) ? "❗️ " : ""}${route.from}`,
      route.to,
      route.action || "",
      route.time || "",
      route.contact || "業務"
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    trackingBody.appendChild(row);
  });

  trackingText.value = buildTrackingText(selected, routes);
}

function scheduleHasInstrument(schedule, selected) {
  return splitInstruments(schedule.instruments).some((instrument) => instrument === selected);
}

function compareSchedulesForTracking(a, b) {
  const dateCompare = compareDate(a.date, b.date);
  if (dateCompare) return dateCompare;

  const timeCompare = compareText(a.time, b.time);
  if (timeCompare) return timeCompare;

  const fromCompare = compareText(a.from, b.from);
  if (fromCompare) return fromCompare;

  return compareText(a.to, b.to);
}

function buildTrackingText(instrument, routes) {
  const borrowingCount = routes.filter(isBorrowingSchedule).length;
  const lines = [
    `${instrument} 路徑追蹤`,
    `調度次數：${routes.length}次`,
    `借用次數：${borrowingCount}次`,
    ""
  ];
  routes.forEach((route) => {
    const details = [route.action, route.time, route.contact || "業務"].filter(Boolean).join(" ");
    lines.push(`${scheduleNeedsReview(route) ? "❗️ " : ""}${route.from} 至 ${route.to}${details ? `  ${details}` : ""}`);
  });
  return lines.join("\n");
}

function buildMessage(region) {
  const title = region === "north" ? "本週北部儀器行程更新" : "本週中南區儀器行程更新";
  const outputSchedules = getSchedulesForSelectedRange();
  const own = outputSchedules.filter((item) => item.region === region);
  const unknown = outputSchedules.filter((item) => item.region === "unknown");
  const cross = outputSchedules.filter((item) => item.region !== region && item.region !== "unknown" && isCrossRegionReminder(item, region));
  const cargo = own.filter((item) => item.delivery === "cargo");
  const self = own.filter((item) => item.delivery === "self" || item.delivery === "ship");
  const company = own.filter((item) => item.delivery === "company");
  const lines = [title, `日期範圍：${formatSelectedRangeLabel()}`, "請各業務務必確認行程內容謝謝"];

  if (importWarnings.length) {
    lines.push("", "❗️ 試算表提醒");
    importWarnings.forEach((warning) => lines.push(`❗️ ${warning}`));
  }

  if (unknown.length) {
    lines.push("", "❗️ 待確認區域");
    appendGrouped(lines, unknown);
  }

  if (cross.length) {
    lines.push("", "跨區提醒 麻煩 @協助安排");
    appendGrouped(lines, cross);
  }

  lines.push("", "===============物流貨運");
  appendGrouped(lines, cargo);
  lines.push("", "================ 同仁自送");
  appendGrouped(lines, self);
  lines.push("", "================ 公司物流自送");
  appendGrouped(lines, company);
  return lines.join("\n").trim();
}

function isCrossRegionReminder(item, targetRegion) {
  const destinationRegion = classifyRegion(item.to);
  return targetRegion === destinationRegion;
}

function appendGrouped(lines, items) {
  if (!items.length) {
    lines.push("目前無行程");
    return;
  }

  const grouped = new Map();
  items.forEach((item, index) => {
    const key = item.date || "未填日期";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ item, index });
  });

  [...grouped.entries()]
    .sort(([dateA], [dateB]) => compareDate(dateA, dateB))
    .forEach(([date, entries], dateIndex) => {
    if (dateIndex > 0) lines.push("");
    const dateLabel = messageFormatSelect.value === "traditional"
      ? formatTraditionalDateWithWeekday(date)
      : formatDateWithWeekday(date);
    lines.push(`<<${dateLabel}>>`);
    entries
      .sort(compareMessageEntry)
      .forEach(({ item }, index) => {
        if (index > 0) lines.push("");
        lines.push(formatSchedule(item));
    });
  });
}

function compareMessageEntry(a, b) {
  const timeCompare = getTimeSortValue(a.item.time) - getTimeSortValue(b.item.time);
  if (timeCompare) return timeCompare;

  const fromCompare = compareText(a.item.from, b.item.from);
  if (fromCompare) return fromCompare;

  const toCompare = compareText(a.item.to, b.item.to);
  if (toCompare) return toCompare;

  return a.index - b.index;
}

function getTimeSortValue(time) {
  const match = String(time || "").match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatSchedule(item) {
  if (messageFormatSelect.value === "traditional") {
    return formatTraditionalSchedule(item);
  }
  return formatModernSchedule(item);
}

function formatTraditionalSchedule(item) {
  const suffix = formatTraditionalTimeAction(item);
  const warning = scheduleNeedsReview(item) ? "❗️ " : "";
  const contact = item.contact || "業務";
  const contactLine = `聯絡人_ @${contact}${item.phone ? `_${item.phone}` : ""}`;
  const route = item.delivery === "ship"
    ? `${item.from} 寄送 ${item.to}`
    : item.action === "取回"
    ? `${item.from}${suffix} 至 ${item.to}`
    : `${item.from} 至 ${item.to}${suffix}`;
  const lines = [
    `${warning}${route}`,
    contactLine,
    `儀器_${item.instruments || "未填"}`
  ];
  if (item.note) lines.push(`備註_${item.note}`);
  return lines.join("\n");
}

function formatModernSchedule(item) {
  const suffix = formatTimeAction(item);
  const warning = scheduleNeedsReview(item) ? "❗️ " : "";
  const route = item.delivery === "ship"
    ? `${item.from} 寄送 ${item.to}`
    : item.action === "取回"
    ? `${item.from}${suffix} 至 ${item.to}`
    : `${item.from} 至 ${item.to}${suffix}`;
  const lines = [
    `${warning}📍 ${route}`,
    `👤 聯絡人： @${item.contact || "業務"}`
  ];
  if (item.phone) lines.push(`📞 電話：${item.phone}`);
  lines.push(`📦 儀器：${item.instruments || "未填"}`);
  if (item.note) lines.push(`🔴備註：${item.note}`);
  return lines.join("\n");
}

function formatTraditionalDateWithWeekday(date) {
  return formatDateWithWeekday(date).replace(/\s+/g, "");
}

function formatTraditionalTimeAction(item) {
  const time = String(item.time || "").replace(/:/g, "");
  if (!time && !item.action) return "";
  if (time && item.action) return `（${time}${item.action}）`;
  if (time) return `（${time}）`;
  return `（${item.action}）`;
}

function formatTimeAction(item) {
  if (!item.time && !item.action) return "";
  if (item.time && item.action) return `（${item.time}${item.action}）`;
  if (item.time) return `（${item.time}）`;
  return `（${item.action}）`;
}

renderTable();
renderOutputs();
renderTracker();
initializeNetlifyIdentity();
