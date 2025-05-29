import * as Setting from "../Setting";

export function getTokens(owner, organization = "", page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-tokens?owner=${owner}&organization=${organization}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getToken(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-token?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateToken(owner, name, token) {
  const newToken = Setting.deepCopy(token);
  return fetch(`${Setting.ServerUrl}/api/update-token?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newToken),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addToken(token) {
  const newToken = Setting.deepCopy(token);
  return fetch(`${Setting.ServerUrl}/api/add-token`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newToken),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteToken(token) {
  const newToken = Setting.deepCopy(token);
  return fetch(`${Setting.ServerUrl}/api/delete-token`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newToken),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
