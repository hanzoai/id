import * as Setting from "../Setting";

export function getEnforcers(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-enforcers?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getEnforcer(owner, name, loadModelCfg = false) {
  return fetch(`${Setting.ServerUrl}/api/get-enforcer?id=${owner}/${encodeURIComponent(name)}&loadModelCfg=${loadModelCfg}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateEnforcer(owner, name, enforcer) {
  const newEnforcer = Setting.deepCopy(enforcer);
  return fetch(`${Setting.ServerUrl}/api/update-enforcer?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newEnforcer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addEnforcer(enforcer) {
  const newEnforcer = Setting.deepCopy(enforcer);
  return fetch(`${Setting.ServerUrl}/api/add-enforcer`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newEnforcer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteEnforcer(enforcer) {
  const newEnforcer = Setting.deepCopy(enforcer);
  return fetch(`${Setting.ServerUrl}/api/delete-enforcer`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newEnforcer),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
