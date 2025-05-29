import * as Setting from "../Setting";

export function getPlans(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-plans?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPlan(owner, name, includeOption = false) {
  return fetch(`${Setting.ServerUrl}/api/get-plan?id=${owner}/${encodeURIComponent(name)}&includeOption=${includeOption}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updatePlan(owner, name, plan) {
  const newPlan = Setting.deepCopy(plan);
  return fetch(`${Setting.ServerUrl}/api/update-plan?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPlan),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addPlan(plan) {
  const newPlan = Setting.deepCopy(plan);
  return fetch(`${Setting.ServerUrl}/api/add-plan`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPlan),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deletePlan(plan) {
  const newPlan = Setting.deepCopy(plan);
  return fetch(`${Setting.ServerUrl}/api/delete-plan`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPlan),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
