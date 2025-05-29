import * as Setting from "../Setting";

export function getSubscriptions(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-subscriptions?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getSubscription(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-subscription?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateSubscription(owner, name, subscription) {
  const newSubscription = Setting.deepCopy(subscription);
  return fetch(`${Setting.ServerUrl}/api/update-subscription?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSubscription),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addSubscription(subscription) {
  const newSubscription = Setting.deepCopy(subscription);
  return fetch(`${Setting.ServerUrl}/api/add-subscription`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSubscription),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteSubscription(subscription) {
  const newSubscription = Setting.deepCopy(subscription);
  return fetch(`${Setting.ServerUrl}/api/delete-subscription`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newSubscription),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
