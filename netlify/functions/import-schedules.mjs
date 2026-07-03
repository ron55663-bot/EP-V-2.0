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
      const sheets = await getMergedResultSheets(accessToken, selection.file.id);
      if (!sheets.length) {
        warnings.push(`${selection.key} 的「合併結果」欄位不存在`);
        continue;
      }
      sheets.forEach(({ rows }) => {
        records.push(...extractMergedResults(rows, range));
      });
    }

    records.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    return jsonResponse(200, {
      records,
      warnings,
      files: resolution.selections.map((item) => item.file.name)
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("Google Sheets import failed:", message);
    let userMessage = "無法讀取 Google Drive，請檢查 API、Netlify 金鑰與資料夾分享權限。";
    if (message.startsWith("PRIVATE_KEY_FORMAT_INVALID")) {
      userMessage = "GOOGLE_PRIVATE_KEY 格式不正確，請重新貼上服務帳戶 JSON 中的 private_key。";
    } else if (message.startsWith("GOOGLE_AUTH_REJECTED")) {
      userMessage = "Google 拒絕服務帳戶金鑰，請確認 Email 與私密金鑰來自同一份 JSON。";
    }
    return jsonResponse(500, {
      error: userMessage
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
  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL || "").trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!clientEmail || !privateKey) throw new Error("Missing Google service account settings");
  if (
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error("PRIVATE_KEY_FORMAT_INVALID");
  }

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
  let signature;
  try {
    signature = signer.sign(privateKey).toString("base64url");
  } catch {
    throw new Error("PRIVATE_KEY_FORMAT_INVALID");
  }
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
  if (!response.ok || !data.access_token) {
    const reason = String(data.error || response.status).replace(/[^a-zA-Z0-9_.-]/g, "");
    throw new Error(`GOOGLE_AUTH_REJECTED:${reason || "unknown"}`);
  }
  return data.access_token;
}

function normalizePrivateKey(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";

  try {
    if (raw.startsWith("{")) {
      const serviceAccount = JSON.parse(raw);
      raw = String(serviceAccount.private_key || "").trim();
    } else if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = String(JSON.parse(raw)).trim();
    }
  } catch {
    // Continue below so the caller can show a clear format error.
  }

  return raw
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
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
  const sheetRange = encodeURIComponent(`'${escapedTitle}'!A:ZZ`);
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

async function getMergedResultSheets(accessToken, spreadsheetId) {
  const titles = await getSheetTitles(accessToken, spreadsheetId);
  const matches = [];
  for (const title of titles) {
    const rows = await getSheetRows(accessToken, spreadsheetId, title);
    const hasMergedResult = rows.some((row) =>
      row.some((cell) => String(cell ?? "").trim() === "合併結果")
    );
    if (hasMergedResult) matches.push({ title, rows });
  }
  return matches;
}

function extractMergedResults(rows, range) {
  const records = [];
  const headers = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (String(cell ?? "").trim() === "合併結果") {
        headers.push({ rowIndex, columnIndex });
      }
    });
  });

  headers.forEach(({ rowIndex, columnIndex }) => {
    const dateColumn = findDateColumn(rows[rowIndex], columnIndex);
    if (dateColumn < 0) return;
    let currentDate = "";

    for (let dataRow = rowIndex + 1; dataRow < rows.length; dataRow += 1) {
      const parsedDate = googleValueToIsoDate(
        rows[dataRow]?.[dateColumn],
        range.startDate.getUTCFullYear()
      );
      if (parsedDate) currentDate = parsedDate;

      const text = String(rows[dataRow]?.[columnIndex] ?? "").trim();
      if (
        !text ||
        !currentDate ||
        currentDate < range.start ||
        currentDate > range.end
      ) {
        continue;
      }
      records.push({
        date: isoToMonthDay(currentDate),
        isoDate: currentDate,
        text
      });
    }
  });

  return records;
}

function findDateColumn(headerRow, resultColumn) {
  const firstCandidateColumn = Math.max(0, resultColumn - 10);
  for (let columnIndex = resultColumn - 1; columnIndex >= firstCandidateColumn; columnIndex -= 1) {
    if (String(headerRow?.[columnIndex] ?? "").trim() === "日期") {
      return columnIndex;
    }
  }
  return -1;
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
  findDateColumn,
  getMonthKeys,
  googleValueToIsoDate,
  parseMonthlyFileName,
  parseRequestedRange,
  resolveMonthlyFiles
};
