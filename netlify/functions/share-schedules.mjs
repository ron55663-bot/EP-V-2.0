import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "schedule-shares";
const MAX_BODY_LENGTH = 250000;
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,32}$/;

export async function handler(event) {
  if (event.httpMethod === "POST") return createShare(event);
  if (event.httpMethod === "GET") return readShare(event);
  return jsonResponse(405, { error: "僅支援建立與讀取分享連結。" });
}

async function createShare(event) {
  const body = String(event.body || "");
  if (!body || body.length > MAX_BODY_LENGTH) {
    return jsonResponse(400, { error: "分享資料過大或格式不正確。" });
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonResponse(400, { error: "分享資料格式不正確。" });
  }

  if (!parsed?.payload || !Array.isArray(parsed.payload.s)) {
    return jsonResponse(400, { error: "分享資料缺少行程內容。" });
  }

  const id = createShareId();
  try {
    const store = getShareStore();
    await store.set(id, JSON.stringify({
      payload: parsed.payload,
      createdAt: new Date().toISOString()
    }));
  } catch (error) {
    console.error("Share save failed:", error?.message || error);
    return jsonResponse(500, {
      error: `短網址儲存失敗：${sanitizeErrorMessage(error)}`
    });
  }

  return jsonResponse(200, { id });
}

async function readShare(event) {
  const id = String(event.queryStringParameters?.id || "").trim();
  if (!ID_PATTERN.test(id)) {
    return jsonResponse(400, { error: "分享代碼格式不正確。" });
  }

  let raw;
  try {
    const store = getShareStore();
    raw = await store.get(id);
  } catch (error) {
    console.error("Share read failed:", error?.message || error);
    return jsonResponse(500, {
      error: `分享資料讀取失敗：${sanitizeErrorMessage(error)}`
    });
  }
  if (!raw) return jsonResponse(404, { error: "找不到此分享行程。" });

  try {
    const saved = JSON.parse(raw);
    return jsonResponse(200, { payload: saved.payload });
  } catch {
    return jsonResponse(500, { error: "分享資料讀取失敗。" });
  }
}

function createShareId() {
  return randomBytes(9).toString("base64url");
}

function getShareStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE_NAME, siteID, token });
  }
  return getStore(STORE_NAME);
}

function sanitizeErrorMessage(error) {
  const message = String(error?.message || error || "Netlify Blobs / Functions 發生未知錯誤");
  if (/siteID,\s*token/i.test(message)) {
    return "Netlify Blobs 需要環境變數 NETLIFY_SITE_ID 與 NETLIFY_BLOBS_TOKEN。";
  }
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]")
    .slice(0, 180);
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(data)
  };
}
