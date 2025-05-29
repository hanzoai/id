import * as Setting from "../Setting";

export function getPayments(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-payments?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getPayment(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-payment?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updatePayment(owner, name, payment) {
  const newPayment = Setting.deepCopy(payment);
  return fetch(`${Setting.ServerUrl}/api/update-payment?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPayment),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addPayment(payment) {
  const newPayment = Setting.deepCopy(payment);
  return fetch(`${Setting.ServerUrl}/api/add-payment`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPayment),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deletePayment(payment) {
  const newPayment = Setting.deepCopy(payment);
  return fetch(`${Setting.ServerUrl}/api/delete-payment`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newPayment),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function invoicePayment(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/invoice-payment?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function notifyPayment(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/notify-payment/${owner}/${name}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
