import * as Setting from "../Setting";

export function getModels(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-models?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getModel(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-model?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateModel(owner, name, model) {
  const newModel = Setting.deepCopy(model);
  return fetch(`${Setting.ServerUrl}/api/update-model?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newModel),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addModel(model) {
  const newModel = Setting.deepCopy(model);
  return fetch(`${Setting.ServerUrl}/api/add-model`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newModel),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteModel(model) {
  const newModel = Setting.deepCopy(model);
  return fetch(`${Setting.ServerUrl}/api/delete-model`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newModel),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
