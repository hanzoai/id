import * as Setting from "../Setting";

export function getAdapters(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-adapters?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getAdapter(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-adapter?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateAdapter(owner, name, Adapter) {
  const newAdapter = Setting.deepCopy(Adapter);
  return fetch(`${Setting.ServerUrl}/api/update-adapter?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newAdapter),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addAdapter(Adapter) {
  const newAdapter = Setting.deepCopy(Adapter);
  return fetch(`${Setting.ServerUrl}/api/add-adapter`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newAdapter),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteAdapter(Adapter) {
  const newAdapter = Setting.deepCopy(Adapter);
  return fetch(`${Setting.ServerUrl}/api/delete-adapter`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newAdapter),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function UpdatePolicy(owner, name, policy) {
  return fetch(`${Setting.ServerUrl}/api/update-policy?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(policy),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function AddPolicy(owner, name, policy) {
  return fetch(`${Setting.ServerUrl}/api/add-policy?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(policy),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function RemovePolicy(owner, name, policy) {
  return fetch(`${Setting.ServerUrl}/api/remove-policy?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(policy),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPolicies(owner, name, adapterId = "") {
  return fetch(`${Setting.ServerUrl}/api/get-policies?id=${owner}/${encodeURIComponent(name)}&adapterId=${adapterId}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
