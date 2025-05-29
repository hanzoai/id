import * as Setting from "../Setting";

export function getProviders(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-providers?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getGlobalProviders(page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-global-providers?p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getProvider(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-provider?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateProvider(owner, name, provider) {
  const newProvider = Setting.deepCopy(provider);
  return fetch(`${Setting.ServerUrl}/api/update-provider?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProvider),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addProvider(provider) {
  const newProvider = Setting.deepCopy(provider);
  return fetch(`${Setting.ServerUrl}/api/add-provider`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProvider),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteProvider(provider) {
  const newProvider = Setting.deepCopy(provider);
  return fetch(`${Setting.ServerUrl}/api/delete-provider`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newProvider),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
