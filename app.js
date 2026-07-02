const NORTH_PLACES = [
  "北辦", "林長一科", "林長二科", "林長小兒", "台大", "北榮", "國桃", "敏盛", "亞東", "振興",
  "花慈", "竹北生醫", "陽大", "三總", "雙和", "北醫", "竹馬", "竹大", "淡馬", "萬芳",
  "東馬", "北國", "大同", "北馬", "北慈", "林長", "輔大"
];

const SOUTH_PLACES = [
  "中榮", "中榮秀傳", "濱秀", "中國", "中國醫", "中國兒科", "彰基", "中山", "大里仁愛",
  "麻新", "嘉長", "嘉榮", "嘉基", "高榮", "高醫", "高醫岡山", "南辦", "中辦", "高辦",
  "雲大", "雲林台大", "斗六成大", "成大", "高長", "長安", "屏基", "屏榮", "大林慈濟",
  "中慈", "奇美", "高雄全統"
];

const CARGO_CODES = [
  "EX1", "EX2", "EX3", "EX4", "E1", "E2", "E3", "E4",
  "ICE-H", "ICE-H2", "ICE-H-2", "ICE-H-3", "WMC-1", "WMC-2"
];

const SAMPLE_TEXT = `7/1
"北辦至高醫岡山送達0800
儀器_WMC-2"
"高醫岡山至南辦取回1600
儀器_WMC-2、A2、P4"
"中辦至中國送達0730
聯絡人_Daniel_0958169200
儀器_CF(34478)"
7/3
"南辦至麻新0730到達
聯絡人_Luke/Harper_0928086129/0971867665
儀器_WMC-2、A2、P3、CF(36814)"
"中國醫至北辦15:00取回
儀器_ICE-TS"`;

let schedules = [];

const rawInput = document.getElementById("rawInput");
const scheduleBody = document.getElementById("scheduleBody");
const summaryText = document.getElementById("summaryText");
const northOutput = document.getElementById("northOutput");
const southOutput = document.getElementById("southOutput");
const rowTemplate = document.getElementById("rowTemplate");

document.getElementById("parseBtn").addEventListener("click", () => {
  schedules = parseInput(rawInput.value);
  renderTable();
  renderOutputs();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  rawInput.value = "";
  schedules = [];
  renderTable();
  renderOutputs();
});

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  rawInput.value = SAMPLE_TEXT;
  schedules = parseInput(rawInput.value);
  renderTable();
  renderOutputs();
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
    .filter((item) => item.from && item.to);
}

function parseBlock(block, index) {
  const routeLine = block.lines[0] || "";
  const contactLine = block.lines.find((line) => line.startsWith("聯絡人_")) || "";
  const instrumentLine = block.lines.find((line) => line.startsWith("儀器_")) || "";
  const route = parseRoute(routeLine);
  const contact = parseContact(contactLine);
  const instruments = instrumentLine.replace(/^儀器_/, "").trim();
  const region = classifyRegion(route.from);

  return {
    id: `${Date.now()}-${index}`,
    date: block.date,
    from: route.from,
    to: route.to,
    time: route.time,
    action: route.action,
    contact: contact.name || "業務",
    phone: contact.phone,
    instruments,
    region,
    delivery: classifyDelivery(instruments)
  };
}

function parseRoute(line) {
  let clean = line.replace(/\s+/g, "").replace(/^"+|"+$/g, "");
  let action = "";
  const hasPickup = /取回/.test(clean);
  const hasDelivery = /送達|抵達|到達/.test(clean);

  if (hasPickup) action = "取回";
  if (hasDelivery) action = "送達";

  const time = extractTime(clean);
  clean = clean
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(/\d{3,4}/g, "")
    .replace(/備取\d*:?[^至送取抵到]*/g, "")
    .replace(/送達|抵達|到達|取回/g, "");

  const parts = clean.split("至").filter(Boolean);
  return {
    from: parts.length >= 2 ? parts[0] : "",
    to: parts.length >= 2 ? parts.slice(1).join("至") : "",
    time,
    action
  };
}

function extractTime(line) {
  const colon = line.match(/(\d{1,2}):(\d{2})/);
  if (colon) return `${colon[1].padStart(2, "0")}:${colon[2]}`;

  const compact = line.match(/(?:^|[^\d])(\d{3,4})(?:[^\d]|$)/);
  if (!compact) return "";
  const digits = compact[1].padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseContact(line) {
  if (!line) return { name: "業務", phone: "" };
  const body = line.replace(/^聯絡人_/, "").trim();
  const parts = body.split("_");
  const name = (parts[0] || "業務").trim();
  const phoneText = (parts.slice(1).join("_") || "").trim();
  const phone = phoneText.split(/[\/,、 ]+/).find((item) => /^09\d{8}$/.test(item)) || phoneText;
  return { name, phone };
}

function classifyRegion(from) {
  if (SOUTH_PLACES.some((place) => from.includes(place))) return "south";
  if (NORTH_PLACES.some((place) => from.includes(place))) return "north";
  return "north";
}

function classifyDelivery(instruments) {
  const normalized = normalizeText(instruments).toUpperCase();
  return CARGO_CODES.some((code) => normalized.includes(code.toUpperCase())) ? "cargo" : "self";
}

function renderTable() {
  scheduleBody.innerHTML = "";
  if (!schedules.length) {
    scheduleBody.innerHTML = '<tr class="empty-row"><td colspan="11">貼上資料後，這裡會顯示可編輯的行程。</td></tr>';
    summaryText.textContent = "尚未產生行程";
    return;
  }

  let previousRegion = "";
  getSortedScheduleIndexes().forEach((index) => {
    const schedule = schedules[index];
    if (schedule.region !== previousRegion) {
      scheduleBody.appendChild(createRegionDivider(schedule.region));
      previousRegion = schedule.region;
    }

    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelectorAll("[data-field]").forEach((field) => {
      field.value = schedule[field.dataset.field] || "";
      field.addEventListener("input", () => {
        schedules[index][field.dataset.field] = field.value;
        renderOutputs();
      });
    });
    row.querySelector("[data-remove]").addEventListener("click", () => {
      schedules.splice(index, 1);
      renderTable();
      renderOutputs();
    });
    scheduleBody.appendChild(row);
  });

  const northCount = schedules.filter((item) => item.region === "north").length;
  const southCount = schedules.filter((item) => item.region === "south").length;
  summaryText.textContent = `共 ${schedules.length} 筆，北區 ${northCount} 筆，中南區 ${southCount} 筆；表格依日期與區域排序`;
}

function createRegionDivider(region) {
  const row = document.createElement("tr");
  row.className = `region-divider ${region === "south" ? "south-divider" : "north-divider"}`;
  const cell = document.createElement("td");
  cell.colSpan = 11;
  cell.textContent = region === "south" ? "中南區" : "北區";
  row.appendChild(cell);
  return row;
}

function getSortedScheduleIndexes() {
  return schedules
    .map((schedule, index) => ({ schedule, index }))
    .sort((a, b) => {
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

function getRegionSortValue(region) {
  if (region === "north") return 0;
  if (region === "south") return 1;
  return 2;
}

function getDeliverySortValue(delivery) {
  if (delivery === "cargo") return 0;
  if (delivery === "self") return 1;
  return 2;
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
  const match = String(date || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 100 + Number(match[2]);
}

function renderOutputs() {
  northOutput.value = buildMessage("north");
  southOutput.value = buildMessage("south");
}

function buildMessage(region) {
  const title = region === "north" ? "本週北部儀器行程更新" : "本週中南區儀器行程更新";
  const own = schedules.filter((item) => item.region === region);
  const cross = schedules.filter((item) => item.region !== region && isCrossRegionReminder(item, region));
  const cargo = own.filter((item) => item.delivery === "cargo");
  const self = own.filter((item) => item.delivery === "self");
  const lines = [title, "請各業務務必確認行程內容謝謝"];

  if (cross.length) {
    lines.push("", "跨區提醒");
    appendGrouped(lines, cross);
  }

  lines.push("", "===============物流貨運");
  appendGrouped(lines, cargo);
  lines.push("", "================ 同仁自送");
  appendGrouped(lines, self);
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
  items.forEach((item) => {
    const key = item.date || "未填日期";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });

  [...grouped.entries()].forEach(([date, entries], dateIndex) => {
    if (dateIndex > 0) lines.push("");
    lines.push(`<<${date}>>`);
    entries.forEach((item, index) => {
      if (index > 0) lines.push("");
      lines.push(formatSchedule(item));
    });
  });
}

function formatSchedule(item) {
  const suffix = formatTimeAction(item);
  const lines = [
    `📍 ${item.from} 至 ${item.to}${suffix}`,
    `👤 聯絡人：${item.contact || "業務"}`
  ];
  if (item.phone) lines.push(`📞 電話：${item.phone}`);
  lines.push(`📦 儀器：${item.instruments || "未填"}`);
  return lines.join("\n");
}

function formatTimeAction(item) {
  if (!item.time && !item.action) return "";
  if (item.time && item.action) return `（${item.time}${item.action}）`;
  if (item.time) return `（${item.time}）`;
  return `（${item.action}）`;
}

renderTable();
renderOutputs();
