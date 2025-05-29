import * as Setting from "../Setting";

export function getLdaps(owner) {
  return fetch(`${Setting.ServerUrl}/api/get-ldaps?owner=${owner}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getLdap(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-ldap?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function addLdap(body) {
  return fetch(`${Setting.ServerUrl}/api/add-ldap`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function deleteLdap(body) {
  return fetch(`${Setting.ServerUrl}/api/delete-ldap`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function updateLdap(body) {
  return fetch(`${Setting.ServerUrl}/api/update-ldap`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function getLdapUser(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-ldap-users?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}

export function syncUsers(owner, name, body) {
  return fetch(`${Setting.ServerUrl}/api/sync-ldap-users?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
    headers: {
      "Accept-Language": Setting.getAcceptLanguage(),
    },
  }).then(res => res.json());
}
