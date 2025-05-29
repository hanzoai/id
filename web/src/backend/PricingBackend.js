import * as Setting from "../Setting";

export function getPricings(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-pricings?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPricing(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-pricing?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updatePricing(owner, name, pricing) {
  const newPricing = Setting.deepCopy(pricing);
  return fetch(`${Setting.ServerUrl}/api/update-pricing?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPricing),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addPricing(pricing) {
  const newPricing = Setting.deepCopy(pricing);
  return fetch(`${Setting.ServerUrl}/api/add-pricing`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPricing),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deletePricing(pricing) {
  const newPricing = Setting.deepCopy(pricing);
  return fetch(`${Setting.ServerUrl}/api/delete-pricing`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPricing),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
