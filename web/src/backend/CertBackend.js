import * as Setting from "../Setting";

export function getCerts(owner, page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-certs?owner=${owner}&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getGlobalCerts(page = "", pageSize = "", field = "", value = "", sortField = "", sortOrder = "") {
  return fetch(`${Setting.ServerUrl}/api/get-global-certs?&p=${page}&pageSize=${pageSize}&field=${field}&value=${value}&sortField=${sortField}&sortOrder=${sortOrder}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getCert(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-cert?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateCert(owner, name, cert) {
  const newCert = Setting.deepCopy(cert);
  return fetch(`${Setting.ServerUrl}/api/update-cert?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newCert),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addCert(cert) {
  const newCert = Setting.deepCopy(cert);
  return fetch(`${Setting.ServerUrl}/api/add-cert`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newCert),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteCert(cert) {
  const newCert = Setting.deepCopy(cert);
  return fetch(`${Setting.ServerUrl}/api/delete-cert`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(newCert),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
