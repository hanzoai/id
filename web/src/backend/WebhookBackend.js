import * as Setting from "../Setting";

export function getWebhooks(owner, organization, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-webhooks?owner=${owner}&organization=${organization}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getWebhook(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-webhook?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateWebhook(owner, name, webhook) {
  const newWebhook = Setting.deepCopy(webhook);
  return fetch(`${Setting.ServerUrl}/api/update-webhook?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newWebhook),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addWebhook(webhook) {
  const newWebhook = Setting.deepCopy(webhook);
  return fetch(`${Setting.ServerUrl}/api/add-webhook`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newWebhook),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteWebhook(webhook) {
  const newWebhook = Setting.deepCopy(webhook);
  return fetch(`${Setting.ServerUrl}/api/delete-webhook`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newWebhook),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
