import * as Setting from "../Setting";

export function getTransactions(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-transactions?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getTransaction(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-transaction?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateTransaction(owner, name, transaction) {
  const newTransaction = Setting.deepCopy(transaction);
  return fetch(`${Setting.ServerUrl}/api/update-transaction?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newTransaction),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addTransaction(transaction) {
  const newTransaction = Setting.deepCopy(transaction);
  return fetch(`${Setting.ServerUrl}/api/add-transaction`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newTransaction),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteTransaction(transaction) {
  const newTransaction = Setting.deepCopy(transaction);
  return fetch(`${Setting.ServerUrl}/api/delete-transaction`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newTransaction),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
