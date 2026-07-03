import { createSign } from "node:crypto";

const DRIVE_FOLDER_ID = "135RnZu-d1nKdnPiysxpvCtZKlomrGwND";
const GOOGLE_SCOPE = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
].join(" ");

export async function handler(event, context) {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "僅支援讀取資料。" });
  }

  if (!context.clientContext?.user) {
    return jsonResponse(401, { error: "請先登入。" });
  }

  const range = parseRequestedRange(event.queryStringParameters || {});
  if (!range) {
    return jsonResponse(400, { error: "日期範圍無效，最多可選擇 10 日。" });
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const driveFiles = await listDriveSpreadsheets(accessToken);
    const resolution = resolveMonthlyFiles(driveFiles, getMonthKeys(range));
    const records = [];
    const warnings = [...resolution.warnings];

    for (const selection of resolution.selections) {
      const rows = await getMergedResultRows(accessToken, selection.file.id);
      if (!rows) {
        warnings.push(`${selection.key} 的「合併結果」欄位不存在`);
        continue;
      }
      records.push(...extractMergedResults(rows, range));
    }

    records.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    return jsonResponse(200, {
      records,
      warnings,
      files: resolution.selections.map((item) => item.file.name)
    });
  } catch (error) {
    console.error("Google Sheets import failed:", error?.message || error);
    return jsonResponse(500, {
      error: "無法讀取 Google Drive，請檢查 API、Netlify 金鑰與資料夾分享權限。"
    });
  }
}

function parseRequestedRange(parameters) {
  const start = parseIsoDate(parameters.start);
  const end = parseIsoDate(parameters.end);
  if (!start || !end || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  return days > 0 && days <= 10
    ? { start: parameters.start, end: parameters.end, startDate: start, endDate: end }
    : null;
}

function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("Missing Google service account settings");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: GOOGLE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Google authentication failed");
  return data.access_token;
}

async function listDriveSpreadsheets(accessToken) {
  const query = new URLSearchParams({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "1000",
    spaces: "drive",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true"
  });
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error("Unable to list Google Drive files");
  return data.files || [];
}

function getMonthKeys(range) {
  const keys = [];
  const cursor = new Date(Date.UTC(
    range.startDate.getUTCFullYear(),
    range.startDate.getUTCMonth(),
    1
  ));
  const finalMonth = new Date(Date.UTC(
    range.endDate.getUTCFullYear(),
    range.endDate.getUTCMonth(),
    1
  ));

  while (cursor <= finalMonth) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function resolveMonthlyFiles(files, monthKeys) {
  const selections = [];
  const warnings = [];

  monthKeys.forEach((key) => {
    const [yearText, monthText] = key.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const candidates = files
      .map((file) => ({ file, parsed: parseMonthlyFileName(file.name) }))
      .filter((item) => item.parsed?.month === month);
    const exactYear = candidates.filter((item) => item.parsed.year === year);
    const noYear = candidates.filter((item) => item.parsed.year === null);
    const pool = exactYear.length ? exactYear : noYear;

    if (!pool.length) {
      warnings.push(`${key} 找不到月份試算表`);
      return;
    }

    pool.sort((a, b) => {
      if (a.parsed.isBackup !== b.parsed.isBackup) return a.parsed.isBackup ? 1 : -1;
      return String(b.file.modifiedTime || "").localeCompare(String(a.file.modifiedTime || ""));
    });
    selections.push({ key, file: pool[0].file });
    if (pool[0].parsed.isBackup) {
      warnings.push(`${key} 使用備份檔「${pool[0].file.name}」`);
    }
    if (pool.length > 1) {
      warnings.push(`${key} 找到 ${pool.length} 份，已使用「${pool[0].file.name}」`);
    }
  });

  return { selections, warnings };
}

function parseMonthlyFileName(name) {
  const normalized = String(name || "").normalize("NFKC");
  const monthMatch = normalized.match(/(\d{1,2})月行程輸出/);
  if (!monthMatch) return null;
  const yearMatch = normalized.match(/(\d{4})\s*(?:年|-)\s*\d{1,2}月行程輸出/);
  return {
    year: yearMatch ? Number(yearMatch[1]) : null,
    month: Number(monthMatch[1]),
    isBackup: /備份|backup/i.test(normalized)
  };
}

async function getSheetTitles(accessToken, spreadsheetId) {
  const fields = encodeURIComponent("sheets.properties(sheetId,title)");
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error("Unable to read spreadsheet metadata");
  return (data.sheets || [])
    .map((item) => item.properties?.title)
    .filter(Boolean);
}

async function getSheetRows(accessToken, spreadsheetId, sheetTitle) {
  const escapedTitle = sheetTitle.replace(/'/g, "''");
  const sheetRange = encodeURIComponent(`'${escapedTitle}'!O:Q`);
  const query = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER"
  });
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetRange}?${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error("Unable to read spreadsheet values");
  return data.values || [];
}

async function getMergedResultRows(accessToken, spreadsheetId) {
  const titles = await getSheetTitles(accessToken, spreadsheetId);
  for (const title of titles) {
    const rows = await getSheetRows(accessToken, spreadsheetId, title);
    if (rows.some((row) => String(row[2] ?? "").trim() === "合併結果")) return rows;
  }
  return null;
}

function extractMergedResults(rows, range) {
  const records = [];
  let foundMergedSection = false;
  let currentDate = "";

  rows.forEach((row) => {
    const dateValue = row[0];
    const result = String(row[2] ?? "").trim();

    if (result === "合併結果") {
      foundMergedSection = true;
      currentDate = "";
      return;
    }
    if (!foundMergedSection || !result) return;

    const parsedDate = googleValueToIsoDate(dateValue, range.startDate.getUTCFullYear());
    if (parsedDate) currentDate = parsedDate;
    if (!currentDate || currentDate < range.start || currentDate > range.end) return;

    records.push({
      date: isoToMonthDay(currentDate),
      isoDate: currentDate,
      text: result
    });
  });

  return records;
}

function googleValueToIsoDate(value, fallbackYear) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.round((Math.floor(value) - 25569) * 86400000);
    return new Date(milliseconds).toISOString().slice(0, 10);
  }

  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (match) return toIso(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[\/月](\d{1,2})日?$/);
  if (match) return toIso(fallbackYear, Number(match[1]), Number(match[2]));
  return "";
}

function toIso(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function isoToMonthDay(value) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0"
    },
    body: JSON.stringify(body)
  };
}

export const testHelpers = {
  extractMergedResults,
  getMonthKeys,
  googleValueToIsoDate,
  parseMonthlyFileName,
  parseRequestedRange,
  resolveMonthlyFiles
};
